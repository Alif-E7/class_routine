'use strict';

/**
 * Tests for POST /api/class-routines endpoint.
 */

jest.mock('../src/db/pool', () => {
  const queryFn = jest.fn();
  return {
    getPool: () => ({ query: queryFn }),
    withTransaction: jest.fn(),
    __queryFn: queryFn,
  };
});

const request = require('supertest');
const { createApp } = require('../src/app');
const { __queryFn } = require('../src/db/pool');

const app = createApp();

describe('POST /api/class-routines', () => {
  beforeEach(() => {
    __queryFn.mockReset();
  });

  it('rejects missing required fields', async () => {
    const res = await request(app)
      .post('/api/class-routines')
      .send({ department: 'CSE' });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('MISSING_FIELDS');
  });

  it('accepts batch_id or batchId and creates a class routine entry', async () => {
    // 1. ensureClassRoutinesTable (CREATE TABLE IF NOT EXISTS)
    __queryFn.mockResolvedValueOnce([[]]);
    // 2. SELECT id, semester FROM upload_batches WHERE id = ?
    __queryFn.mockResolvedValueOnce([[{ id: 5, semester: '2026' }]]);
    // 3. SELECT COUNT(*) as cnt FROM schedules WHERE batch_id = ?
    __queryFn.mockResolvedValueOnce([[{ cnt: 10 }]]);
    // 4. SELECT cr.id FROM class_routines (check existing)
    __queryFn.mockResolvedValueOnce([[]]);
    // 5. INSERT INTO class_routines ...
    __queryFn.mockResolvedValueOnce([{ insertId: 1 }]);
    // 6. UPDATE upload_batches ... (touchBatch)
    __queryFn.mockResolvedValueOnce([[]]);

    const res = await request(app)
      .post('/api/class-routines')
      .send({
        batch_id: 5,
        department: 'EEE',
        faculty: 'Engineering',
        year: '2027',
        term: 'Spring',
      });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.department).toBe('EEE');
    expect(res.body.overwritten).toBe(false);
  });

  it('deletes previous routine when adding new routine with same department, faculty, year, term and semester', async () => {
    // 1. ensureClassRoutinesTable
    __queryFn.mockResolvedValueOnce([[]]);
    // 2. SELECT id, semester FROM upload_batches
    __queryFn.mockResolvedValueOnce([[{ id: 6, semester: '2026' }]]);
    // 3. SELECT COUNT(*) as cnt FROM schedules
    __queryFn.mockResolvedValueOnce([[{ cnt: 12 }]]);
    // 4. SELECT cr.id FROM class_routines (existing match found!)
    __queryFn.mockResolvedValueOnce([[{ id: 99 }]]);
    // 5. DELETE FROM class_routines WHERE id IN (?)
    __queryFn.mockResolvedValueOnce([[]]);
    // 6. INSERT INTO class_routines
    __queryFn.mockResolvedValueOnce([{ insertId: 100 }]);
    // 7. touchBatch
    __queryFn.mockResolvedValueOnce([[]]);

    const res = await request(app)
      .post('/api/class-routines')
      .send({
        batch_id: 6,
        department: 'EEE',
        faculty: 'Engineering',
        year: '2027',
        term: 'Spring',
      });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.overwritten).toBe(true);
    expect(res.body.code).toBe('CLASS_ROUTINE_OVERWRITTEN');
  });
});
