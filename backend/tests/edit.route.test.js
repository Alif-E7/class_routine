'use strict';

/**
 * Integration tests for POST /api/batches/:id/edit
 *
 * MySQL is mocked at the module boundary. The aiProvider is mocked
 * separately so we can simulate every interesting outcome without
 * making a real HTTP call to Gemini:
 *
 *   - 200 happy path (mocked provider returns a valid proposal)
 *   - 400 INVALID_BATCH_ID, INVALID_PROMPT (too short / too long)
 *   - 404 BATCH_NOT_FOUND
 *   - 409 BATCH_NOT_READY (batch exists but schedules table is empty)
 *   - 503 AI_UNAVAILABLE (no_api_key)
 *   - 503 AI_UNAVAILABLE (network timeout)
 *   - 502 AI_INVALID_RESPONSE (model returned garbage we can't parse)
 *
 * The real provider module is kept untouched — the route imports
 * `parseEditRequest` and `isEnabled` once at require time, so we
 * override both via jest.doMock in beforeEach.
 */

const request = require('supertest');

// Mock the DB pool up front (must happen before app.js is loaded).
jest.mock('../src/db/pool', () => {
  const recorded = [];
  function getPool() {
    return {
      query: jest.fn(async (sql, params) => {
        recorded.push({
          sql: sql.trim().split(/\s+/, 3).join(' ').toUpperCase(),
          params,
        });
        const s = sql.trim();

        if (/FROM\s+upload_batches\s+WHERE\s+id\s*=/i.test(s)) {
          const id = params && params[0];
          if (id === 1) {
            return [[{
              id: 1,
              university: 'Test University',
              department: 'CSE',
              semester: '2026 July-December',
              status: 'completed',
              total_sessions: 28,
              generated_at: new Date('2026-07-01T10:00:00Z'),
            }]];
          }
          if (id === 2) {
            // Batch exists but no schedules yet → 409.
            return [[{
              id: 2,
              university: 'Test University',
              department: 'CSE',
              semester: '2026 July-December',
              status: 'completed',
              total_sessions: 28,
              generated_at: null,
            }]];
          }
          return [[]];
        }
        if (/FROM\s+schedules\s+WHERE\s+batch_id\s*=/i.test(s)) {
          const id = params && params[0];
          if (id === 1) {
            return [[
              { course_code: 'CSE406', teacher_abbr: 'T1', room_id: 'R1',
                day: 'SUN', slot_start: 540, slot_end: 590,
                year_sem: '4-1', session_index: 0 },
              { course_code: 'CSE406', teacher_abbr: 'T1', room_id: 'R1',
                day: 'SUN', slot_start: 600, slot_end: 650,
                year_sem: '4-1', session_index: 1 },
            ]];
          }
          return [[]];
        }
        return [[]];
      }),
    };
  }
  return { getPool, _recorded: recorded, _reset() { recorded.length = 0; } };
});

// We import the app AFTER mocking pool, but we re-mock aiProvider per test
// using jest.isolateModules so different scenarios can simulate different
// provider outcomes without polluting each other.
const poolMock = require('../src/db/pool');

// Helper to build a fresh app with a chosen aiProvider mock.
// Accepts either an object (used directly as the mocked module's
// exports) or a factory function (invoked once to produce the
// exports — useful when each test needs a fresh closure).
const path = require('path');
const PROVIDER_ABS = path.resolve(__dirname, '..', 'src', 'services', 'aiProvider.js');

function buildAppWithProvider(providerMockOrFactory) {
  jest.resetModules();
  const factory = typeof providerMockOrFactory === 'function'
    ? providerMockOrFactory
    : () => providerMockOrFactory;
  jest.doMock(PROVIDER_ABS, factory);
  // Re-require the app and return its express instance.
  // eslint-disable-next-line global-require
  const { createApp } = require('../src/app');
  return createApp();
}

// Default happy-path mock.
const happyProvider = () => ({
  isEnabled: () => true,
  parseEditRequest: async () => ({
    available: true,
    proposal: {
      kind: 'proposed_change',
      summary: 'Move CSE406 from Sunday 9am to Monday 10am',
      change: {
        course_code: 'CSE406',
        from: { day: 'SUN', slot_start: 540, slot_end: 590 },
        to:   { day: 'MON', slot_start: 600, slot_end: 650 },
      },
      concerns: ['Room R1 free at 10am Monday'],
    },
  }),
});

const noKeyProvider = () => ({
  isEnabled: () => false,
  parseEditRequest: async () => ({
    available: false,
    proposal: null,
    reason: 'no_api_key',
  }),
});

const timeoutProvider = () => ({
  isEnabled: () => true,
  parseEditRequest: async () => ({
    available: true,
    proposal: null,
    reason: 'timeout',
  }),
});

const garbageProvider = () => ({
  isEnabled: () => true,
  parseEditRequest: async () => ({
    available: true,
    proposal: null,
    reason: 'invalid_json',
  }),
});

// ---------------------------------------------------------------------------

describe('POST /api/batches/:id/edit — happy path', () => {
  let app;
  beforeAll(() => { app = buildAppWithProvider(happyProvider()); });
  beforeEach(() => { poolMock._reset(); });

  test('returns 200 EDIT_PROPOSED with a normalized proposal', async () => {
    const res = await request(app)
      .post('/api/batches/1/edit')
      .send({ prompt: 'Please move CSE406 from Sunday 9am to Monday 10am' });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.code).toBe('EDIT_PROPOSED');
    expect(res.body.batch_id).toBe(1);
    expect(res.body.prompt).toContain('move CSE406');
    expect(res.body.proposal).toBeDefined();
    expect(res.body.proposal.kind).toBe('proposed_change');
    expect(res.body.proposal.change.course_code).toBe('CSE406');
    expect(res.body.proposal.change.from.day).toBe('SUN');
    expect(res.body.proposal.change.to.day).toBe('MON');
    expect(res.body.proposal.concerns).toEqual(
      expect.arrayContaining(['Room R1 free at 10am Monday'])
    );
  });
});

describe('POST /api/batches/:id/edit — input validation', () => {
  let app;
  beforeAll(() => { app = buildAppWithProvider(happyProvider()); });
  beforeEach(() => { poolMock._reset(); });

  test('400 INVALID_BATCH_ID for non-numeric / zero / negative ids', async () => {
    const a = await request(app).post('/api/batches/abc/edit').send({ prompt: 'long enough prompt here' });
    expect(a.status).toBe(400);
    expect(a.body.code).toBe('INVALID_BATCH_ID');

    const b = await request(app).post('/api/batches/-1/edit').send({ prompt: 'long enough prompt here' });
    expect(b.status).toBe(400);
    expect(b.body.code).toBe('INVALID_BATCH_ID');

    const c = await request(app).post('/api/batches/0/edit').send({ prompt: 'long enough prompt here' });
    expect(c.status).toBe(400);
    expect(c.body.code).toBe('INVALID_BATCH_ID');
  });

  test('400 INVALID_PROMPT when prompt is missing', async () => {
    const res = await request(app).post('/api/batches/1/edit').send({});
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('INVALID_PROMPT');
  });

  test('400 INVALID_PROMPT when prompt is too short', async () => {
    const res = await request(app).post('/api/batches/1/edit').send({ prompt: 'hi' });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('INVALID_PROMPT');
    expect(res.body.min_length).toBe(8);
  });

  test('400 INVALID_PROMPT when prompt is over 500 chars', async () => {
    const long = 'a'.repeat(501);
    const res = await request(app).post('/api/batches/1/edit').send({ prompt: long });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('INVALID_PROMPT');
    expect(res.body.max_length).toBe(500);
  });

  test('400 INVALID_PROMPT when prompt is not a string', async () => {
    const res = await request(app).post('/api/batches/1/edit').send({ prompt: 12345 });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('INVALID_PROMPT');
  });
});

describe('POST /api/batches/:id/edit — not found / not ready', () => {
  let app;
  beforeAll(() => { app = buildAppWithProvider(happyProvider()); });
  beforeEach(() => { poolMock._reset(); });

  test('404 BATCH_NOT_FOUND when id does not exist', async () => {
    const res = await request(app)
      .post('/api/batches/999/edit')
      .send({ prompt: 'Please move CSE406 from Sunday to Monday' });
    expect(res.status).toBe(404);
    expect(res.body.code).toBe('BATCH_NOT_FOUND');
  });

  test('409 BATCH_NOT_READY when batch exists but has no schedule', async () => {
    const res = await request(app)
      .post('/api/batches/2/edit')
      .send({ prompt: 'Please move CSE406 from Sunday to Monday' });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('BATCH_NOT_READY');
    expect(res.body.status).toBe('completed');
  });
});

describe('POST /api/batches/:id/edit — AI provider outcomes', () => {
  beforeEach(() => { poolMock._reset(); });

  test('503 AI_UNAVAILABLE when no GEMINI_API_KEY is configured', async () => {
    const app = buildAppWithProvider(noKeyProvider());
    const res = await request(app)
      .post('/api/batches/1/edit')
      .send({ prompt: 'Please move CSE406 from Sunday to Monday' });
    expect(res.status).toBe(503);
    expect(res.body.code).toBe('AI_UNAVAILABLE');
    expect(res.body.reason).toBe('no_api_key');
  });

  test('503 AI_UNAVAILABLE when provider timed out', async () => {
    const app = buildAppWithProvider(timeoutProvider());
    const res = await request(app)
      .post('/api/batches/1/edit')
      .send({ prompt: 'Please move CSE406 from Sunday to Monday' });
    expect(res.status).toBe(503);
    expect(res.body.code).toBe('AI_UNAVAILABLE');
    expect(res.body.reason).toBe('timeout');
  });

  test('502 AI_INVALID_RESPONSE when provider returned unparseable output', async () => {
    const app = buildAppWithProvider(garbageProvider());
    const res = await request(app)
      .post('/api/batches/1/edit')
      .send({ prompt: 'Please move CSE406 from Sunday to Monday' });
    expect(res.status).toBe(502);
    expect(res.body.code).toBe('AI_INVALID_RESPONSE');
    expect(res.body.reason).toBe('invalid_json');
  });

  test('502 AI_INVALID_RESPONSE when provider throws unexpectedly', async () => {
    const app = buildAppWithProvider(() => ({
      isEnabled: () => true,
      parseEditRequest: async () => { throw new Error('boom'); },
    }));
    const res = await request(app)
      .post('/api/batches/1/edit')
      .send({ prompt: 'Please move CSE406 from Sunday to Monday' });
    expect(res.status).toBe(502);
    expect(res.body.code).toBe('AI_INVALID_RESPONSE');
  });

  test('503 AI_UNAVAILABLE when available=true but reason is a transient transport error', async () => {
    const app = buildAppWithProvider(() => ({
      isEnabled: () => true,
      parseEditRequest: async () => ({
        available: true,
        proposal: null,
        reason: 'call_failed',
      }),
    }));
    const res = await request(app)
      .post('/api/batches/1/edit')
      .send({ prompt: 'Please move CSE406 from Sunday to Monday' });
    expect(res.status).toBe(503);
    expect(res.body.code).toBe('AI_UNAVAILABLE');
    expect(res.body.reason).toBe('call_failed');
  });
});