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
  function getPool() {
    return {
      query: jest.fn(async (sql, params) => {
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
      }),
    };
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

const request = require('supertest');
const { createApp } = require('../src/app');
const poolMock = require('../src/db/pool');
const loaderMock = require('../src/services/routineLoader');
const aiMock = require('../src/services/aiProvider');

const app = createApp();

describe('POST /api/batches/:id/generate', () => {
  beforeEach(() => {
    poolMock._reset();
    loaderMock.loadBatchForSchedule.mockClear();
    aiMock.explainFailure.mockClear();
    aiMock.explainFailure.mockResolvedValue({ available: false, friendly_hint: null, reason: 'no_api_key' });
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
    // AI is opt-in; with no API key configured we get null hint.
    expect(res.body.friendly_hint).toBeNull();
    // CRITICAL: no schedules writes on failure path.
    const sqls = poolMock._recorded.map((r) => r.sql);
    expect(sqls).not.toContain('DELETE FROM SCHEDULES');
    expect(sqls).not.toContain('INSERT INTO SCHEDULES');
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
});