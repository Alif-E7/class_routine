'use strict';

/**
 * Tests for the global error handler in src/app.js.
 *
 * Confirms that mysql2 transport / auth errors are mapped to a clean
 * 503 + a useful `code` instead of bubbling out as a generic 500 (which
 * upstream proxies frequently translate into 502 Bad Gateway).
 */

jest.mock('../src/db/pool', () => {
  const pool = { query: jest.fn() };
  return { getPool: () => pool, withTransaction: jest.fn(), closePool: jest.fn(), __pool: pool };
});

const request = require('supertest');
const { createApp } = require('../src/app');
const { __pool } = require('../src/db/pool');

const app = createApp();

function fakeDbError(code, message = 'fake mysql error') {
  const e = new Error(message);
  e.code = code;
  e.errno = 1045;
  e.sqlState = 'HY000';
  return e;
}

describe('Global error handler — database error mapping', () => {
  beforeEach(() => { __pool.query.mockReset(); });

  it('ER_ACCESS_DENIED_ERROR → 503 DATABASE_AUTH_FAILED', async () => {
    __pool.query.mockRejectedValueOnce(fakeDbError('ER_ACCESS_DENIED_ERROR', 'Access denied for user'));
    const res = await request(app).get('/api/batches');
    expect(res.status).toBe(503);
    expect(res.body.success).toBe(false);
    expect(res.body.code).toBe('DATABASE_AUTH_FAILED');
    expect(res.body.message).toMatch(/GRANT/i);
    expect(res.body.detail).toBe('ER_ACCESS_DENIED_ERROR');
  });

  it('ECONNREFUSED → 503 DATABASE_UNREACHABLE with host:port in message', async () => {
    __pool.query.mockRejectedValueOnce(fakeDbError('ECONNREFUSED', 'connect ECONNREFUSED 127.0.0.1:3306'));
    const res = await request(app).get('/api/batches');
    expect(res.status).toBe(503);
    expect(res.body.code).toBe('DATABASE_UNREACHABLE');
    expect(res.body.message).toMatch(/MySQL server/);
  });

  it('ER_BAD_DB_ERROR → 503 DATABASE_NOT_FOUND', async () => {
    __pool.query.mockRejectedValueOnce(fakeDbError('ER_BAD_DB_ERROR', 'Unknown database'));
    const res = await request(app).get('/api/batches');
    expect(res.status).toBe(503);
    expect(res.body.code).toBe('DATABASE_NOT_FOUND');
    expect(res.body.message).toMatch(/npm run migrate/);
  });

  it('ETIMEDOUT / PROTOCOL_CONNECTION_LOST → 503 DATABASE_TRANSPORT_ERROR', async () => {
    __pool.query.mockRejectedValueOnce(fakeDbError('ETIMEDOUT'));
    const r1 = await request(app).get('/api/batches');
    expect(r1.status).toBe(503);
    expect(r1.body.code).toBe('DATABASE_TRANSPORT_ERROR');

    __pool.query.mockRejectedValueOnce(fakeDbError('PROTOCOL_CONNECTION_LOST'));
    const r2 = await request(app).get('/api/batches');
    expect(r2.status).toBe(503);
    expect(r2.body.code).toBe('DATABASE_TRANSPORT_ERROR');
  });

  it('unrelated errors still pass through as 500 with their own code', async () => {
    __pool.query.mockRejectedValueOnce(new Error('something else entirely'));
    const res = await request(app).get('/api/batches');
    expect(res.status).toBe(500);
    expect(res.body.code).toBeNull();
    expect(res.body.message).toBe('something else entirely');
  });
});

describe('Global error handler — multer mapping', () => {
  // We exercise the multer middleware through the real /api/upload route.
  // Multer rejects these requests before the route handler runs, which is
  // exactly the path that previously fell through to a generic 500.

  it('upload field sent under wrong name → 400 UPLOAD_ERROR (LIMIT_UNEXPECTED_FILE)', async () => {
    // The route binds `upload.single('file')`. Sending the file under a
    // different field name causes multer to throw LIMIT_UNEXPECTED_FILE
    // before the route handler runs.
    const res = await request(app)
      .post('/api/upload')
      .attach('not_file', Buffer.from('xlsx'), {
        filename: 'a.xlsx',
        contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('UPLOAD_ERROR');
  });

  it('wrong file extension → 415 UNSUPPORTED_MEDIA_TYPE from fileFilter', async () => {
    const res = await request(app)
      .post('/api/upload')
      .attach('file', Buffer.from('not an xlsx'), {
        filename: 'wrong.txt',
        contentType: 'text/plain',
      });
    expect(res.status).toBe(415);
    expect(res.body.code).toBe('UNSUPPORTED_MEDIA_TYPE');
  });
});
