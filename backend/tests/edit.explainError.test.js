'use strict';

/**
 * Tests for POST /api/batches/:id/explain-error.
 *
 * Mocks the DB pool and aiProvider (parseEditRequest + isEnabled)
 * to cover every documented response envelope:
 *
 *   200 EXPLANATION_PROVIDED
 *   400 INVALID_BATCH_ID     (non-numeric / zero / negative)
 *   400 INVALID_ISSUE        (missing message, wrong severity)
 *   404 BATCH_NOT_FOUND      (id exists in URL but not in DB)
 *   503 AI_UNAVAILABLE       (no_api_key, transient timeout)
 *   502 AI_INVALID_RESPONSE  (parse failure or empty response)
 *
 * Mirrors the pattern used by edit.route.test.js so failures are
 * easy to triage.
 */

const request = require('supertest');
const path = require('path');

// Pool mock — no real MySQL. The mock lets us change which id maps
// to an existing batch via __exists(id); default: id 1 exists, all
// others do not. Tests can override before calling the route.
jest.mock('../src/db/pool', () => {
  const calls = [];
  const existing = new Set([1]);
  function getPool() {
    return {
      query: jest.fn(async (sql, params) => {
        const s = String(sql).trim();
        calls.push({ sql: s, params });
        if (/FROM\s+upload_batches\s+WHERE\s+id\s*=/i.test(s)) {
          const id = params && params[0];
          return [[{ id }].filter((r) => existing.has(r.id))];
        }
        return [[]];
      }),
    };
  }
  return {
    getPool,
    _calls: calls,
    _exists: existing,
    _reset() {
      calls.length = 0;
      existing.clear();
      existing.add(1);
    },
  };
});

const poolMock = require('../src/db/pool');
const PROVIDER_ABS = path.resolve(
  __dirname, '..', 'src', 'services', 'aiProvider.js'
);

function buildAppWithProvider(providerMockOrFactory) {
  jest.resetModules();
  const factory = typeof providerMockOrFactory === 'function'
    ? providerMockOrFactory
    : () => providerMockOrFactory;
  jest.doMock(PROVIDER_ABS, factory);
  // eslint-disable-next-line global-require
  const { createApp } = require('../src/app');
  return createApp();
}

const okProvider = () => ({
  isEnabled: () => true,
  parseEditRequest: async () => ({ available: true, proposal: {} }),
  explainValidator: async () => ({
    available: true,
    explanation: 'Make sure teacher_abbr matches one defined in the Teachers sheet.',
    // New: validator explanations now also return a separate
    // "board suggestion" — a copy-pasteable Excel/Sheets-level
    // recipe (formula, find/replace, value to type into a specific
    // cell). The route must forward this field unchanged.
    board_suggestion: 'In cell Teachers!B7 type "ZX" — or set the course\'s teacher_abbr to an existing abbreviation.',
  }),
});

const noKeyProvider = () => ({
  isEnabled: () => false,
  parseEditRequest: async () => ({ available: false }),
  explainValidator: async () => ({
    available: false,
    explanation: null,
    reason: 'no_api_key',
  }),
});

const transientProvider = () => ({
  isEnabled: () => true,
  parseEditRequest: async () => ({ available: true, proposal: {} }),
  explainValidator: async () => ({
    available: true,
    explanation: null,
    reason: 'timeout',
  }),
});

const garbageProvider = () => ({
  isEnabled: () => true,
  parseEditRequest: async () => ({ available: true, proposal: {} }),
  explainValidator: async () => ({
    available: true,
    explanation: null,
    reason: 'invalid_json',
  }),
});

const throwingProvider = () => ({
  isEnabled: () => true,
  parseEditRequest: async () => ({ available: true, proposal: {} }),
  explainValidator: async () => { throw new Error('boom'); },
});

// ---------------------------------------------------------------------------

describe('POST /api/batches/:id/explain-error — happy path', () => {
  let app;
  beforeAll(() => { app = buildAppWithProvider(okProvider); });
  beforeEach(() => { poolMock._reset(); });

  test('returns 200 EXPLANATION_PROVIDED with the AI text + diagnostic fields', async () => {
    const issue = {
      rule: 'V1',
      severity: 'error',
      message: 'teacher_abbr "ZX" is not defined in the Teachers sheet',
      sheet: 'Courses',
      row: 12,
      column: 'D',
    };
    const res = await request(app).post('/api/batches/1/explain-error').send({ issue });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.code).toBe('EXPLANATION_PROVIDED');
    expect(res.body.batch_id).toBe(1);
    expect(res.body.severity).toBe('error');
    expect(res.body.rule).toBe('V1');
    expect(res.body.sheet).toBe('Courses');
    expect(res.body.row).toBe(12);
    expect(res.body.column).toBe('D');
    expect(res.body.explanation).toMatch(/teacher_abbr/);
    // New: route must forward the AI's copy-pasteable recipe so the
    // admin UI can render a one-line "do this in Excel" suggestion.
    expect(res.body.board_suggestion).toBe(
      'In cell Teachers!B7 type "ZX" — or set the course\'s teacher_abbr to an existing abbreviation.'
    );
  });

  test('forwards board_suggestion=null when the provider omits it', async () => {
    // Backwards-compat: older provider returns may not include
    // board_suggestion. The route must still serialize the field
    // (as null) so the client can rely on the shape.
    const app = buildAppWithProvider(() => ({
      isEnabled: () => true,
      parseEditRequest: async () => ({ available: true, proposal: {} }),
      explainValidator: async () => ({
        available: true,
        explanation: 'No recipe this time.',
        // no board_suggestion key
      }),
    }));
    const res = await request(app).post('/api/batches/1/explain-error').send({
      issue: { message: 'teacher_abbr missing', severity: 'error' },
    });
    expect(res.status).toBe(200);
    expect(res.body.explanation).toBe('No recipe this time.');
    expect(res.body.board_suggestion).toBeNull();
  });

  test('accepts severity="warning" and surfaces it on the response', async () => {
    const res = await request(app).post('/api/batches/1/explain-error').send({
      issue: {
        rule: 'V5',
        severity: 'warning',
        message: 'Soft constraint: teacher unavailable for one slot',
        sheet: 'TeacherUnavailability',
      },
    });
    expect(res.status).toBe(200);
    expect(res.body.severity).toBe('warning');
    expect(res.body.rule).toBe('V5');
  });

  test('also accepts "code" as the rule key (legacy / validator naming)', async () => {
    const res = await request(app).post('/api/batches/1/explain-error').send({
      issue: {
        code: 'EMPTY',
        severity: 'error',
        message: 'A row had no teacher assignments',
      },
    });
    expect(res.status).toBe(200);
    expect(res.body.rule).toBe('EMPTY');
  });
});

describe('POST /api/batches/:id/explain-error — input validation', () => {
  let app;
  beforeAll(() => { app = buildAppWithProvider(okProvider); });
  beforeEach(() => { poolMock._reset(); });

  test('400 INVALID_BATCH_ID for non-numeric / zero / negative ids', async () => {
    const a = await request(app)
      .post('/api/batches/abc/explain-error')
      .send({ issue: { message: 'x', severity: 'error' } });
    expect(a.status).toBe(400);
    expect(a.body.code).toBe('INVALID_BATCH_ID');

    const b = await request(app)
      .post('/api/batches/0/explain-error')
      .send({ issue: { message: 'x', severity: 'error' } });
    expect(b.status).toBe(400);
    expect(b.body.code).toBe('INVALID_BATCH_ID');

    const c = await request(app)
      .post('/api/batches/-1/explain-error')
      .send({ issue: { message: 'x', severity: 'error' } });
    expect(c.status).toBe(400);
    expect(c.body.code).toBe('INVALID_BATCH_ID');
  });

  test('400 INVALID_ISSUE when issue body is missing', async () => {
    const res = await request(app).post('/api/batches/1/explain-error').send({});
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('INVALID_ISSUE');
  });

  test('400 INVALID_ISSUE when issue.message is empty', async () => {
    const res = await request(app).post('/api/batches/1/explain-error').send({
      issue: { message: '   ', severity: 'error' },
    });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('INVALID_ISSUE');
  });

  test('400 INVALID_ISSUE when severity is not error/warning', async () => {
    const res = await request(app).post('/api/batches/1/explain-error').send({
      issue: { message: 'x', severity: 'INFO' },
    });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('INVALID_ISSUE');
  });

  test('400 INVALID_ISSUE when severity is missing entirely', async () => {
    const res = await request(app).post('/api/batches/1/explain-error').send({
      issue: { message: 'x' },
    });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('INVALID_ISSUE');
  });
});

describe('POST /api/batches/:id/explain-error — batch not found', () => {
  let app;
  beforeAll(() => { app = buildAppWithProvider(okProvider); });
  beforeEach(() => { poolMock._reset(); });

  test('404 BATCH_NOT_FOUND when id is valid but no such batch', async () => {
    // Default mock says id 1 exists; 999 does not.
    const res = await request(app).post('/api/batches/999/explain-error').send({
      issue: { message: 'x', severity: 'error' },
    });
    expect(res.status).toBe(404);
    expect(res.body.code).toBe('BATCH_NOT_FOUND');
  });
});

describe('POST /api/batches/:id/explain-error — AI provider outcomes', () => {
  beforeEach(() => { poolMock._reset(); });

  test('503 AI_UNAVAILABLE when no GROQ_API_KEY is configured', async () => {
    const app = buildAppWithProvider(noKeyProvider);
    const res = await request(app).post('/api/batches/1/explain-error').send({
      issue: { message: 'x', severity: 'error' },
    });
    expect(res.status).toBe(503);
    expect(res.body.code).toBe('AI_UNAVAILABLE');
    expect(res.body.reason).toBe('no_api_key');
  });

  test('503 AI_UNAVAILABLE on transient transport failure (timeout)', async () => {
    const app = buildAppWithProvider(transientProvider);
    const res = await request(app).post('/api/batches/1/explain-error').send({
      issue: { message: 'x', severity: 'error' },
    });
    expect(res.status).toBe(503);
    expect(res.body.code).toBe('AI_UNAVAILABLE');
    expect(res.body.reason).toBe('timeout');
  });

  test('502 AI_INVALID_RESPONSE when the provider returns an unusable explanation', async () => {
    const app = buildAppWithProvider(garbageProvider);
    const res = await request(app).post('/api/batches/1/explain-error').send({
      issue: { message: 'x', severity: 'error' },
    });
    expect(res.status).toBe(502);
    expect(res.body.code).toBe('AI_INVALID_RESPONSE');
    expect(res.body.reason).toBe('invalid_json');
  });

  test('502 AI_INVALID_RESPONSE when the provider throws unexpectedly', async () => {
    const app = buildAppWithProvider(throwingProvider);
    const res = await request(app).post('/api/batches/1/explain-error').send({
      issue: { message: 'x', severity: 'error' },
    });
    expect(res.status).toBe(502);
    expect(res.body.code).toBe('AI_INVALID_RESPONSE');
  });

  test('503 AI_UNAVAILABLE when available=false (top-level)', async () => {
    const app = buildAppWithProvider(() => ({
      isEnabled: () => true,
      parseEditRequest: async () => ({ available: true, proposal: {} }),
      explainValidator: async () => ({
        available: false,
        explanation: null,
        reason: 'call_failed',
      }),
    }));
    const res = await request(app).post('/api/batches/1/explain-error').send({
      issue: { message: 'x', severity: 'error' },
    });
    expect(res.status).toBe(503);
    expect(res.body.code).toBe('AI_UNAVAILABLE');
    expect(res.body.reason).toBe('call_failed');
  });

  // ---- Permission / key-rejection branch ----
  // When Groq rejects the key (HTTP 401/403/404), the route must surface a
  // 503 with reason='permission_denied' rather than a generic 502. This is
  // the user-visible fix for "AI could not explain that issue. Try again".

  test('503 permission_denied when provider returns reason=http_403', async () => {
    const app = buildAppWithProvider(() => ({
      isEnabled: () => true,
      parseEditRequest: async () => ({ available: true, proposal: {} }),
      explainValidator: async () => ({
        available: true,
        explanation: null,
        reason: 'http_403',
      }),
    }));
    const res = await request(app).post('/api/batches/1/explain-error').send({
      issue: { message: 'x', severity: 'error' },
    });
    expect(res.status).toBe(503);
    expect(res.body.code).toBe('AI_UNAVAILABLE');
    expect(res.body.reason).toBe('permission_denied');
    expect(res.body.upstream_reason).toBe('http_403');
    expect(res.body.message).toMatch(/GROQ_API_KEY/i);
    expect(res.body.message).toMatch(/Groq/i);
  });

  test('503 permission_denied when provider returns reason=http_404', async () => {
    const app = buildAppWithProvider(() => ({
      isEnabled: () => true,
      parseEditRequest: async () => ({ available: true, proposal: {} }),
      explainValidator: async () => ({
        available: true,
        explanation: null,
        reason: 'http_404',
      }),
    }));
    const res = await request(app).post('/api/batches/1/explain-error').send({
      issue: { message: 'x', severity: 'error' },
    });
    expect(res.status).toBe(503);
    expect(res.body.reason).toBe('permission_denied');
    expect(res.body.upstream_reason).toBe('http_404');
  });

  test('503 permission_denied when provider already normalizes to reason=permission_denied', async () => {
    const app = buildAppWithProvider(() => ({
      isEnabled: () => true,
      parseEditRequest: async () => ({ available: true, proposal: {} }),
      explainValidator: async () => ({
        available: true,
        explanation: null,
        reason: 'permission_denied',
      }),
    }));
    const res = await request(app).post('/api/batches/1/explain-error').send({
      issue: { message: 'x', severity: 'error' },
    });
    expect(res.status).toBe(503);
    expect(res.body.code).toBe('AI_UNAVAILABLE');
    expect(res.body.reason).toBe('permission_denied');
  });
});
