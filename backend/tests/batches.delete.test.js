'use strict';

/**
 * Tests for DELETE /api/batches/:id.
 *
 * The route relies on FK ON DELETE CASCADE; we mock the pool so the
 * DELETE statement is recorded and "schedules.count = 0 after" is
 * asserted via a second mocked query right after the cascade.
 */

jest.mock('../src/db/pool', () => {
  const calls = [];
  const pool = {
    query: jest.fn(async (sql, params) => {
      const s = String(sql).trim();
      calls.push({ sql: s, params });
      // Count snapshot query — returns deterministic totals.
      if (/SELECT[\s\S]*FROM\s+dual/i.test(s) ||
          /\(SELECT COUNT\(\*\) FROM teachers\s+WHERE upload_batch_id/i.test(s)) {
        return [[{
          teachers: 5,
          courses: 7,
          rooms: 4,
          credit_rules: 4,
          room_preference: 6,
          teacher_unavailability: 3,
          config_rows: 1,
          schedule_rows: 21,
        }]];
      }
      // The actual DELETE — return affectedRows=1 for batch 7, 0 otherwise.
      if (/^DELETE\s+FROM\s+upload_batches/i.test(s)) {
        const id = params && params[0];
        if (id === 7) return [{ affectedRows: 1 }];
        return [{ affectedRows: 0 }];
      }
      return [[]];
    }),
  };
  return {
    getPool: () => pool,
    withTransaction: jest.fn(),
    __pool: pool,
    __calls: calls,
    __reset() { calls.length = 0; pool.query.mockClear(); },
  };
});

const request = require('supertest');
const { createApp } = require('../src/app');
const { __pool, __reset } = require('../src/db/pool');

const app = createApp();

describe('DELETE /api/batches/:id', () => {
  beforeEach(() => { __reset(); });

  test('400 INVALID_BATCH_ID for non-numeric / zero ids', async () => {
    const a = await request(app).delete('/api/batches/abc');
    expect(a.status).toBe(400);
    expect(a.body.code).toBe('INVALID_BATCH_ID');

    const b = await request(app).delete('/api/batches/0');
    expect(b.status).toBe(400);
    expect(b.body.code).toBe('INVALID_BATCH_ID');

    const c = await request(app).delete('/api/batches/-3');
    expect(c.status).toBe(400);
    expect(c.body.code).toBe('INVALID_BATCH_ID');
  });

  test('404 BATCH_NOT_FOUND when no row matches the id', async () => {
    const res = await request(app).delete('/api/batches/999');
    expect(res.status).toBe(404);
    expect(res.body.code).toBe('BATCH_NOT_FOUND');
  });

  test('200 success returns the cascade count snapshot and the affected batch id', async () => {
    const res = await request(app).delete('/api/batches/7');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.batch_id).toBe(7);
    expect(res.body.deleted).toEqual({
      teachers: 5, courses: 7, rooms: 4,
      credit_rules: 4, room_preference: 6,
      teacher_unavailability: 3,
      config_rows: 1, schedule_rows: 21,
    });
    // The DELETE statement was actually issued.
    const deleteCall = __pool.query.mock.calls.find(
      (c) => /^DELETE\s+FROM\s+upload_batches/i.test(c[0])
    );
    expect(deleteCall).toBeDefined();
    expect(deleteCall[1][0]).toBe(7);
  });

  test('Snapshot is read BEFORE the DELETE (so the cascade doesn\'t zero it)', async () => {
    await request(app).delete('/api/batches/7');
    const calls = __pool.query.mock.calls.map((c) => String(c[0]).trim());
    const idxCount = calls.findIndex((s) => /\(SELECT COUNT\(\*\) FROM teachers/i.test(s));
    const idxDelete = calls.findIndex((s) => /^DELETE\s+FROM\s+upload_batches/i.test(s));
    expect(idxCount).toBeGreaterThanOrEqual(0);
    expect(idxDelete).toBeGreaterThanOrEqual(0);
    expect(idxCount).toBeLessThan(idxDelete);
  });
});
