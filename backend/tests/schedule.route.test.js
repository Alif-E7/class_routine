'use strict';

/**
 * Integration tests for POST /api/batches/:id/generate and
 * GET /api/batches/:id/schedule.
 *
 * MySQL is mocked at the module boundary so the suite stays hermetic
 * and runs in milliseconds. We exercise:
 *   - success path: solver finds a schedule, rows are bulk-inserted
 *     inside a transaction, prior schedules for the batch are cleared
 *   - infeasible path: SchedulingError bubbles up as 422 with
 *     structured error code + unplaceable list
 *   - 404 / 409 / 400 for missing / not-ready / invalid id
 *   - re-generation clears prior rows before inserting new ones
 *   - GET /schedule returns persisted rows
 */

jest.mock('../src/db/pool', () => {
  // A tiny in-memory mock of withTransaction + getPool.
  // The mock records every query so the test can assert that
  // DELETE-then-INSERT happens in the right order and that no writes
  // occur on the failure path.
  const recorded = [];
  // One stable `query` jest.fn shared across every getPool() call.
  // This is critical: the route handlers may call getPool() more
  // than once per request, and tests sometimes need to override the
  // implementation with .mockImplementationOnce. If we created a new
  // jest.fn per getPool() call, overrides would only affect the
  // specific object that the test happened to grab first — silently
  // leaving the route's later getPool() calls pointing at the
  // default implementation.
  const query = jest.fn(async (sql, params) => {
    recorded.push({ sql: sql.trim().split(/\s+/, 3).join(' ').toUpperCase(), params });
    const s = sql.trim();
    if (/SELECT\s+id\s+FROM\s+upload_batches/i.test(s)) {
      const id = params && params[0];
      if (id === 1) return [[{ id: 1 }]];
      return [[]];
    }
    if (/FROM\s+schedules/i.test(s)) {
      const id = params && params[0];
      if (id === 1) return [[
        { course_code: 'C1', teacher_abbr: 'T1', room_id: 'R1',
          day: 'SUN', slot_start: 540, slot_end: 590,
          year_sem: '1-2', session_index: 0 },
      ]];
      return [[]];
    }
    return [[{ insertId: 42, affectedRows: 1 }]];
  });
  function getPool() {
    return { query };
  }
  async function withTransaction(fn) {
    const conn = {
      query: jest.fn(async (sql, params) => {
        recorded.push({ sql: sql.trim().split(/\s+/, 3).join(' ').toUpperCase(), params, inTxn: true });
        return [{ affectedRows: 1 }];
      }),
      beginTransaction: jest.fn(async () => {}),
      commit: jest.fn(async () => {}),
      rollback: jest.fn(async () => {}),
      release: jest.fn(),
    };
    await conn.beginTransaction();
    try {
      const out = await fn(conn);
      await conn.commit();
      return out;
    } catch (err) {
      try { await conn.rollback(); } catch (_) {}
      throw err;
    }
  }
  return { getPool, withTransaction, _recorded: recorded, _reset() { recorded.length = 0; } };
});

jest.mock('../src/services/routineLoader', () => {
  // Default: a perfectly schedule-able batch (5 days, 1 course, 3 sessions).
  const validLoad = {
    batch: { id: 1, status: 'completed', filename: 'good.xlsx', semester: 'S1' },
    config: {
      working_days: 'SUN,MON,TUE,WED,THU',
      class_start: '09:00', class_end: '16:00',
      break_start: '12:30', break_end: '13:30',
      duration_minutes: 50,
    },
    courses: [
      { course_code: 'C1', course_name: 'Algorithms', teacher_abbr: 'T1',
        year_sem: '1-2', derived_type: 'theory',
        derived_duration_min: 50, derived_classes_per_week: 3 },
    ],
    rooms: [{ room_id: 'R1', room_name: 'Room 101', type: 'classroom' }],
    room_preference: [
      { room_id: 'R1', year_group: '1-2', weight_percent: 100 },
    ],
    teacher_unavailability: [],
  };
  class LoadError extends Error {
    constructor(message, code, details) {
      super(message); this.name = 'LoadError';
      this.code = code; this.details = details || null;
    }
  }
  return {
    LoadError,
    loadBatchForSchedule: jest.fn(async (id) => {
      if (id === 1) return JSON.parse(JSON.stringify(validLoad));
      throw new LoadError('No upload batch with id ' + id, 'BATCH_NOT_FOUND', { batchId: id });
    }),
  };
});

jest.mock('../src/services/aiProvider', () => ({
  // No-op AI by default. Individual tests can re-mock via jest.spyOn
  // if they want a friendly_hint returned.
  explainFailure: jest.fn(async () => ({ available: false, friendly_hint: null, reason: 'no_api_key' })),
  isEnabled: () => false,
}));

// Spy-able wrapper around the real solver. The route file does
// `const { solve, SchedulingError } = require('../src/services/scheduler')`
// at import time, so a `jest.spyOn(module, 'solve')` set inside a
// test would NOT intercept the captured reference. Instead we
// replace the module entirely with a thin proxy that records every
// (input, options) call and delegates to the real solve so the
// default test path (feasible batch → 200) keeps working unchanged.
const mockSolverCalls = [];
jest.mock('../src/services/scheduler', () => {
  const mockRealScheduler = jest.requireActual('../src/services/scheduler');
  const wrapped = (input, options) => {
    mockSolverCalls.push({ input, options });
    return mockRealScheduler.solve(input, options);
  };
  return {
    ...mockRealScheduler,
    solve: wrapped,
    __solverCalls: mockSolverCalls,
  };
});

const request = require('supertest');
const { createApp } = require('../src/app');
const poolMock = require('../src/db/pool');
const loaderMock = require('../src/services/routineLoader');
const aiMock = require('../src/services/aiProvider');
const schedulerMock = require('../src/services/scheduler');

const app = createApp();

describe('POST /api/batches/:id/generate', () => {
  beforeEach(() => {
    poolMock._reset();
    loaderMock.loadBatchForSchedule.mockClear();
    aiMock.explainFailure.mockClear();
    aiMock.explainFailure.mockResolvedValue({ available: false, friendly_hint: null, reason: 'no_api_key' });
    schedulerMock.__solverCalls.length = 0;
  });

  test('returns 200 + persisted assignments on a feasible batch', async () => {
    const res = await request(app).post('/api/batches/1/generate');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.code).toBe('SCHEDULE_OK');
    expect(res.body.batch_id).toBe(1);
    expect(res.body.assignments_count).toBeGreaterThan(0);
    expect(Array.isArray(res.body.assignments)).toBe(true);
    // Each assignment is well-formed.
    for (const a of res.body.assignments) {
      expect(a).toEqual(expect.objectContaining({
        course_code: expect.any(String),
        teacher_abbr: expect.any(String),
        room_id: expect.any(String),
        day: expect.any(String),
        slot_start: expect.any(Number),
        slot_end: expect.any(Number),
        year_sem: expect.any(String),
        session_index: expect.any(Number),
      }));
    }
    // Solver was called with the loaded batch.
    expect(loaderMock.loadBatchForSchedule).toHaveBeenCalledWith(1);
    // We saw a DELETE for prior schedules AND an INSERT INTO schedules.
    const sqls = poolMock._recorded.map((r) => r.sql);
    expect(sqls).toContain('DELETE FROM SCHEDULES');
    expect(sqls).toContain('INSERT INTO SCHEDULES');
  });

  test('clear-and-reinsert pattern: DELETE runs before INSERT in same txn', async () => {
    const res = await request(app).post('/api/batches/1/generate');
    expect(res.status).toBe(200);
    const txnSeq = poolMock._recorded.filter((r) => r.inTxn).map((r) => r.sql);
    const delIdx = txnSeq.indexOf('DELETE FROM SCHEDULES');
    const insIdx = txnSeq.indexOf('INSERT INTO SCHEDULES');
    expect(delIdx).toBeGreaterThanOrEqual(0);
    expect(insIdx).toBeGreaterThanOrEqual(0);
    expect(delIdx).toBeLessThan(insIdx);
  });

  test('rejects invalid batch id (non-numeric / negative)', async () => {
    const a = await request(app).post('/api/batches/abc/generate');
    expect(a.status).toBe(400);
    expect(a.body.code).toBe('INVALID_BATCH_ID');

    const b = await request(app).post('/api/batches/-5/generate');
    expect(b.status).toBe(400);
    expect(b.body.code).toBe('INVALID_BATCH_ID');
  });

  test('returns 404 when batch does not exist', async () => {
    const res = await request(app).post('/api/batches/999/generate');
    expect(res.status).toBe(404);
    expect(res.body.code).toBe('BATCH_NOT_FOUND');
    expect(res.body.success).toBe(false);
    // Crucially, NO schedules table writes on this path.
    const sqls = poolMock._recorded.map((r) => r.sql);
    expect(sqls).not.toContain('DELETE FROM SCHEDULES');
    expect(sqls).not.toContain('INSERT INTO SCHEDULES');
  });

  test('returns 409 when batch is not yet completed', async () => {
    loaderMock.loadBatchForSchedule.mockImplementationOnce(async () => {
      throw new loaderMock.LoadError(
        'Batch 1 is in status "processing"',
        'BATCH_NOT_READY',
        { batchId: 1, status: 'processing' }
      );
    });
    const res = await request(app).post('/api/batches/1/generate');
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('BATCH_NOT_READY');
    expect(res.body.status).toBe('processing');
  });

  test('returns 422 with structured error + unplaceable on solver infeasibility', async () => {
    // Force the solver to throw by giving the loader a batch whose
    // CSP will exhaust. We feed the schedule.js a config that the
    // real solver will reject.
    loaderMock.loadBatchForSchedule.mockImplementationOnce(async () => ({
      batch: { id: 1, status: 'completed' },
      config: {
        working_days: 'SUN,MON,TUE,WED,THU',
        class_start: '09:00', class_end: '16:00',
        break_start: '12:30', break_end: '13:30',
        duration_minutes: 50,
      },
      // 1 course needs 6 sessions/week, but only 5 working days exist.
      // The distinct-day rule (build prompt §5) makes this infeasible.
      courses: [
        { course_code: 'X', teacher_abbr: 'T1', year_sem: '1-2',
          derived_type: 'theory', derived_duration_min: 50,
          derived_classes_per_week: 6 },
      ],
      rooms: [{ room_id: 'R1', type: 'classroom' }],
      room_preference: [{ room_id: 'R1', year_group: '1-2', weight_percent: 100 }],
      teacher_unavailability: [],
    }));
    const res = await request(app).post('/api/batches/1/generate');
    expect(res.status).toBe(422);
    expect(res.body.code).toBe('SCHEDULE_INFEASIBLE');
    expect(res.body.success).toBe(false);
    expect(Array.isArray(res.body.unplaceable)).toBe(true);
    expect(res.body.unplaceable).toContain('X');
    // Only one course was in the fixture so not_attempted must be empty.
    expect(Array.isArray(res.body.not_attempted)).toBe(true);
    expect(res.body.not_attempted).toHaveLength(0);
    // AI is opt-in; with no API key configured we get null hint.
    expect(res.body.friendly_hint).toBeNull();
    // NEW: route attaches a computed capacity-vs-demand diagnostics
    // payload so the AI layer (and the client) can see WHY the
    // solver gave up, not just which courses were left over.
    expect(res.body.diagnostics).toBeDefined();
    expect(Array.isArray(res.body.diagnostics.unplaceable_courses)).toBe(true);
    expect(Array.isArray(res.body.diagnostics.capacity_by_type)).toBe(true);
    expect(Array.isArray(res.body.diagnostics.teacher_load)).toBe(true);
    expect(res.body.diagnostics.unplaceable_courses[0].course_code).toBe('X');
    // The fixture has a 'theory' course (derived_type) and a
    // 'classroom' room (room.type). The diagnostics module now
    // applies the same theory→classroom mapping the solver uses
    // (via roomSelector.requiredRoomType), so total_rooms_of_type
    // is 1, not 0. The capacity row math therefore reads:
    //   1 room × 7 slots/day × 5 days = 35 max_weekly_capacity.
    const theoryRow = res.body.diagnostics.capacity_by_type.find(
      (r) => r.type === 'theory' && r.duration_minutes === 50
    );
    expect(theoryRow).toBeDefined();
    expect(theoryRow.total_rooms_of_type).toBe(1);
    expect(theoryRow.slots_per_room_per_day).toBe(7);
    expect(theoryRow.working_days).toBe(5);
    expect(theoryRow.total_sessions_demanded).toBe(6);
    expect(theoryRow.max_weekly_capacity).toBe(35);
    // explainFailure is now called with a 2nd-arg diagnostics block.
    expect(aiMock.explainFailure).toHaveBeenCalled();
    const lastCall = aiMock.explainFailure.mock.calls[aiMock.explainFailure.mock.calls.length - 1];
    expect(lastCall[1]).toBeDefined();
    expect(lastCall[1].diagnostics).toBeDefined();
    expect(lastCall[1].diagnostics.capacity_by_type).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: 'theory', duration_minutes: 50 }),
      ])
    );
    // CRITICAL: no schedules writes on failure path.
    const sqls = poolMock._recorded.map((r) => r.sql);
    expect(sqls).not.toContain('DELETE FROM SCHEDULES');
    expect(sqls).not.toContain('INSERT INTO SCHEDULES');
  });

  test('splits unplaceable vs not_attempted when an early course fails', async () => {
    // First course provably infeasible (6 sessions/week on 5 days,
    // distinct-day rule). Second course is feasible on its own but
    // must NOT appear in `unplaceable` — it should land in
    // `not_attempted` because the solver never reached it.
    loaderMock.loadBatchForSchedule.mockImplementationOnce(async () => ({
      batch: { id: 1, status: 'completed' },
      config: {
        working_days: 'SUN,MON,TUE,WED,THU',
        class_start: '09:00', class_end: '16:00',
        break_start: '12:30', break_end: '13:30',
        duration_minutes: 50,
      },
      courses: [
        { course_code: 'EARLY', teacher_abbr: 'T1', year_sem: '1-2',
          derived_type: 'theory', derived_duration_min: 50,
          derived_classes_per_week: 6 }, // forces infeasibility
        { course_code: 'NEVER', teacher_abbr: 'T2', year_sem: '1-2',
          derived_type: 'theory', derived_duration_min: 50,
          derived_classes_per_week: 2 }, // never tried
      ],
      rooms: [{ room_id: 'R1', type: 'classroom' }],
      room_preference: [],
      teacher_unavailability: [],
    }));
    const res = await request(app).post('/api/batches/1/generate');
    expect(res.status).toBe(422);
    expect(res.body.unplaceable).toEqual(['EARLY']);
    // `not_attempted` is best-effort: the MRV order is deterministic
    // for this single-room fixture (EARLY has tighter constraints,
    // so it's attempted first), but if that ever changes the test
    // just checks that NEVER is *not* in unplaceable.
    expect(res.body.unplaceable).not.toContain('NEVER');
    expect(Array.isArray(res.body.not_attempted)).toBe(true);
    expect(res.body.not_attempted).toContain('NEVER');
    // Diagnostics only lists unplaceable courses (not not_attempted
    // ones) — keeps the AI prompt focused on root causes.
    const codes = res.body.diagnostics.unplaceable_courses.map((c) => c.course_code);
    expect(codes).toContain('EARLY');
    expect(codes).not.toContain('NEVER');
  });

  test('attaches aiProvider friendly_hint when AI is enabled', async () => {
    loaderMock.loadBatchForSchedule.mockImplementationOnce(async () => ({
      batch: { id: 1, status: 'completed' },
      config: {
        working_days: 'SUN,MON,TUE,WED,THU',
        class_start: '09:00', class_end: '16:00',
        break_start: '12:30', break_end: '13:30',
        duration_minutes: 50,
      },
      courses: [
        { course_code: 'X', teacher_abbr: 'T1', year_sem: '1-2',
          derived_type: 'theory', derived_duration_min: 50,
          derived_classes_per_week: 6 },
      ],
      rooms: [{ room_id: 'R1', type: 'classroom' }],
      room_preference: [{ room_id: 'R1', year_group: '1-2', weight_percent: 100 }],
      teacher_unavailability: [],
    }));
    aiMock.explainFailure.mockResolvedValueOnce({
      available: true,
      friendly_hint: 'Consider adding a second classroom or reducing classes-per-week to 5.',
    });
    const res = await request(app).post('/api/batches/1/generate');
    expect(res.status).toBe(422);
    expect(res.body.friendly_hint).toMatch(/classroom|classes-per-week/i);
    // aiProvider MUST NOT have caused any DB writes.
    const sqls = poolMock._recorded.map((r) => r.sql);
    expect(sqls).not.toContain('DELETE FROM SCHEDULES');
    expect(sqls).not.toContain('INSERT INTO SCHEDULES');
    // explainFailure must be called with the {diagnostics} 2nd arg so
    // the AI can quote exact capacity numbers.
    expect(aiMock.explainFailure).toHaveBeenCalled();
    const lastCall = aiMock.explainFailure.mock.calls[aiMock.explainFailure.mock.calls.length - 1];
    expect(lastCall[1]).toBeDefined();
    expect(lastCall[1].diagnostics).toBeDefined();
  });

  test('uses provided seed for deterministic re-runs', async () => {
    const res1 = await request(app)
      .post('/api/batches/1/generate')
      .send({ seed: 12345 });
    expect(res1.status).toBe(200);
    const res2 = await request(app)
      .post('/api/batches/1/generate')
      .send({ seed: 12345 });
    expect(res2.status).toBe(200);
    // Same seed → identical assignment arrays (deterministic re-run).
    expect(res2.body.assignments).toEqual(res1.body.assignments);
  });

  test('rejects non-numeric seed', async () => {
    const res = await request(app)
      .post('/api/batches/1/generate')
      .send({ seed: 'abc' });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('INVALID_SEED');
  });

  test('accepts a per-request budget override and uses it on the solver', async () => {
    schedulerMock.__solverCalls.length = 0;
    const res = await request(app)
      .post('/api/batches/1/generate')
      .send({ budget: 750000 });
    expect(res.status).toBe(200);
    expect(schedulerMock.__solverCalls.length).toBeGreaterThan(0);
    const lastOpts = schedulerMock.__solverCalls[schedulerMock.__solverCalls.length - 1].options;
    expect(lastOpts).toBeDefined();
    expect(lastOpts.budget).toBe(750000);
  });

  test('caps a too-large per-request budget at the internal max (10M)', async () => {
    schedulerMock.__solverCalls.length = 0;
    const res = await request(app)
      .post('/api/batches/1/generate')
      .send({ budget: 999_999_999 });
    expect(res.status).toBe(200);
    const lastOpts = schedulerMock.__solverCalls[schedulerMock.__solverCalls.length - 1].options;
    expect(lastOpts.budget).toBeLessThanOrEqual(10_000_000);
  });

  test('falls back to SCHEDULER_BUDGET env (or 200k) when no budget is sent', async () => {
    schedulerMock.__solverCalls.length = 0;
    const expectedDefault = parseInt(process.env.SCHEDULER_BUDGET || '', 10) || 200_000;
    const res = await request(app).post('/api/batches/1/generate');
    expect(res.status).toBe(200);
    const lastOpts = schedulerMock.__solverCalls[schedulerMock.__solverCalls.length - 1].options;
    expect(lastOpts.budget).toBe(expectedDefault);
  });

  test('rejects non-positive-integer budget', async () => {
    // Cases that MUST return 400 INVALID_BUDGET:
    const badCases = ['abc', 0, -1, 1.5, true, false, '', '0', '-1', '1.5', {}, []];
    for (const bad of badCases) {
      const res = await request(app)
        .post('/api/batches/1/generate')
        .send({ budget: bad });
      expect(res.status).toBe(400);
      expect(res.body.code).toBe('INVALID_BUDGET');
    }
    // null / undefined / NaN serialize to "absent" in JSON so the
    // route falls through to the default budget → feasible batch
    // mock returns 200.
    for (const absent of [null, undefined]) {
      const res = await request(app)
        .post('/api/batches/1/generate')
        .send({ budget: absent });
      expect(res.status).toBe(200);
    }
  });

  test('accepts string budget that parses to a positive integer', async () => {
    schedulerMock.__solverCalls.length = 0;
    const res = await request(app)
      .post('/api/batches/1/generate')
      .send({ budget: '500000' });
    expect(res.status).toBe(200);
    const lastOpts = schedulerMock.__solverCalls[schedulerMock.__solverCalls.length - 1].options;
    expect(lastOpts.budget).toBe(500000);
  });
});

describe('GET /api/batches/:id/schedule', () => {
  beforeEach(() => { poolMock._reset(); });

  test('returns the persisted routine', async () => {
    const res = await request(app).get('/api/batches/1/schedule');
    expect(res.status).toBe(200);
    expect(res.body.code).toBe('SCHEDULE_OK');
    expect(res.body.batch_id).toBe(1);
    expect(res.body.assignments_count).toBe(1);
    expect(res.body.assignments[0].course_code).toBe('C1');
  });

  test('returns 404 for unknown batch', async () => {
    const res = await request(app).get('/api/batches/999/schedule');
    expect(res.status).toBe(404);
    expect(res.body.code).toBe('BATCH_NOT_FOUND');
  });

  test('rejects invalid batch id', async () => {
    const res = await request(app).get('/api/batches/oops/schedule');
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('INVALID_BATCH_ID');
  });

  // Regression: mysql2 with dateStrings:true returns TIME columns as
  // 'HH:MM:SS' strings. The GET path normalizes them back to integer
  // minutes so the API response contract matches the just-generated
  // POST response. The shared jest.fn at the module level (set up in
  // the jest.mock factory above) is what we override — every getPool()
  // call returns the SAME object, so any .mockImplementation we set
  // here is visible to the route handler regardless of how many times
  // it calls getPool() internally.
  test('GET /api/batches/:id/schedule normalizes TIME strings to integer minutes', async () => {
    const pool = require('../src/db/pool').getPool();
    const origImpl = pool.query.getMockImplementation();
    // Persistent override (not mockImplementationOnce) so both the
    // upload_batches lookup and the schedule SELECT get the test-
    // shaped data — the shared jest.fn at the module level means
    // every getPool() call inside the route handler sees this body.
    pool.query.mockImplementation(async (sql, params) => {
      const s = String(sql).trim();
      if (/SELECT\s+id\s+FROM\s+upload_batches/i.test(s)) {
        return [[{ id: 1 }]];
      }
      if (/FROM\s+schedules/i.test(s)) {
        return [[
          {
            course_code: 'C1', teacher_abbr: 'T1', room_id: 'R1',
            day: 'SUN', slot_start: '09:00:00', slot_end: '09:50:00',
            year_sem: '1-2', session_index: 0,
          },
          {
            course_code: 'C2', teacher_abbr: 'T2', room_id: 'R2',
            day: 'MON', slot_start: '10:30', slot_end: '11:20',
            year_sem: '1-2', session_index: 0,
          },
        ]];
      }
      return [[]];
    });
    try {
      const res = await request(app).get('/api/batches/1/schedule');
      expect(res.status).toBe(200);
      expect(res.body.assignments).toHaveLength(2);
      expect(res.body.assignments[0].slot_start).toBe(540);
      expect(res.body.assignments[0].slot_end).toBe(590);
      expect(res.body.assignments[1].slot_start).toBe(630);
      expect(res.body.assignments[1].slot_end).toBe(680);
      // Types must be Number, not String — the frontend's
      // RoutineGrid uses `slot_start` as a Map key + numeric
      // arithmetic.
      for (const a of res.body.assignments) {
        expect(typeof a.slot_start).toBe('number');
        expect(typeof a.slot_end).toBe('number');
      }
    } finally {
      // Restore the default body for subsequent tests.
      if (origImpl) pool.query.mockImplementation(origImpl);
      else pool.query.mockReset();
    }
  });
});

// Regression: the `schedules` table stores `slot_start` / `slot_end`
// as MySQL TIME columns which REJECT raw integer minutes >= 838 with
// "Incorrect time value: '890' for column 'slot_end'". The POST
// path must convert integer minutes to 'HH:MM' strings before the
// bulk INSERT.
describe('POST /api/batches/:id/generate — slot TIME formatting', () => {
  test('binds slot_start / slot_end as zero-padded HH:MM strings, not raw minutes', async () => {
    poolMock._reset();
    const res = await request(app).post('/api/batches/1/generate');
    expect(res.status).toBe(200);
    const insertCall = poolMock._recorded.find(
      (r) => /INSERT INTO schedules/i.test(r.sql)
    );
    expect(insertCall).toBeDefined();
    // The bulk INSERT binds rows[][]; each row's slot_start + slot_end
    // are positions [5] and [6]. They must be 'HH:MM' strings, not
    // integers.
    const rows = insertCall.params[0];
    expect(Array.isArray(rows)).toBe(true);
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row[5]).toMatch(/^\d{2}:\d{2}$/); // slot_start
      expect(row[6]).toMatch(/^\d{2}:\d{2}$/); // slot_end
      // Defensive: NEVER an integer — that's the bug we just fixed.
      expect(typeof row[5]).toBe('string');
      expect(typeof row[6]).toBe('string');
    }
  });
});