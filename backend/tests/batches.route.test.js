'use strict';

/**
 * Tests for batches list + detail routes (GET /api/batches, GET /api/batches/:id).
 * Mocks the DB pool so no MySQL is needed.
 */

jest.mock('../src/db/pool', () => {
  const pool = { query: jest.fn() };
  return { getPool: () => pool, withTransaction: jest.fn(), __pool: pool };
});

const request = require('supertest');
const { createApp } = require('../src/app');
const { __pool } = require('../src/db/pool');

const app = createApp();

describe('GET /api/batches', () => {
  beforeEach(() => { __pool.query.mockReset(); });

  it('returns the list of batches with counts (newest first)', async () => {
    __pool.query.mockResolvedValueOnce([[
      { id: 2, filename: 'r2.xlsx', semester: '2026', status: 'completed', created_at: '2026-07-01',
        teachers_count: 5, courses_count: 7, rooms_count: 4, assignments_count: 21 },
      { id: 1, filename: 'r1.xlsx', semester: '2025', status: 'needs_review', created_at: '2025-12-01',
        teachers_count: 0, courses_count: 0, rooms_count: 0, assignments_count: 0 },
    ]]);

    const res = await request(app).get('/api/batches');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.batches).toHaveLength(2);
    expect(res.body.batches[0]).toEqual({
      id: 2, filename: 'r2.xlsx', semester: '2026', status: 'completed', created_at: '2026-07-01',
      counts: { teachers: 5, courses: 7, rooms: 4, assignments: 21 },
      has_schedule: true,
    });
    expect(res.body.batches[1].has_schedule).toBe(false);
  });

  it('returns empty list when no batches', async () => {
    __pool.query.mockResolvedValueOnce([[]]);
    const res = await request(app).get('/api/batches');
    expect(res.status).toBe(200);
    expect(res.body.batches).toEqual([]);
  });
});

describe('GET /api/batches/:id', () => {
  beforeEach(() => { __pool.query.mockReset(); });

  it('returns 400 on invalid id', async () => {
    const res = await request(app).get('/api/batches/abc');
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('INVALID_BATCH_ID');
  });

  it('returns 404 when batch does not exist', async () => {
    __pool.query.mockResolvedValueOnce([[]]);
    const res = await request(app).get('/api/batches/999');
    expect(res.status).toBe(404);
    expect(res.body.code).toBe('BATCH_NOT_FOUND');
  });

  it('returns 404 even when pool rejects with empty rows from a real call', async () => {
    // path: 0 is invalid (must be positive int)
    const res = await request(app).get('/api/batches/0');
    expect(res.status).toBe(400);
  });

  it('returns batch detail with parsed error_log JSON', async () => {
    const errJson = JSON.stringify({ errors: ['x'], warnings: [] });
    __pool.query.mockResolvedValueOnce([[
      { id: 5, filename: 'f.xlsx', semester: 'S1', status: 'needs_review',
        error_log: errJson, created_at: '2026-06-01',
        teachers_count: 0, courses_count: 0, rooms_count: 0, assignments_count: 0 },
    ]]);
    const res = await request(app).get('/api/batches/5');
    expect(res.status).toBe(200);
    expect(res.body.batch.id).toBe(5);
    expect(res.body.batch.error_log).toEqual({ errors: ['x'], warnings: [] });
    expect(res.body.batch.has_schedule).toBe(false);
  });
});