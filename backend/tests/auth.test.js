'use strict';

jest.mock('../src/db/pool', () => {
  const pool = { query: jest.fn() };
  return { getPool: () => pool, withTransaction: jest.fn(), __pool: pool };
});

const request = require('supertest');
const crypto = require('crypto');
const { createApp } = require('../src/app');
const { __pool } = require('../src/db/pool');

const app = createApp();

describe('POST /api/auth/login', () => {
  beforeEach(() => {
    __pool.query.mockReset();
  });

  it('returns 400 when email or password is missing', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'admin_cse@gmail.com' });
    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });

  it('returns 401 when user is not found', async () => {
    __pool.query.mockResolvedValueOnce([[]]);

    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'nonexistent@gmail.com', password: 'password123' });

    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
    expect(res.body.message).toBe('Invalid email or password');
  });

  it('returns 401 when password does not match', async () => {
    const storedHash = crypto.createHash('sha256').update('correct_password').digest('hex');
    __pool.query.mockResolvedValueOnce([[{
      id: 1,
      email: 'admin_cse@gmail.com',
      password_hash: storedHash,
      role: 'ADMIN',
    }]]);

    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'admin_cse@gmail.com', password: 'wrong_password' });

    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
    expect(res.body.message).toBe('Invalid email or password');
  });

  it('returns 200 with token and user details on successful login', async () => {
    const storedHash = crypto.createHash('sha256').update('12345678').digest('hex');
    __pool.query.mockResolvedValueOnce([[{
      id: 1,
      email: 'admin_cse@gmail.com',
      password_hash: storedHash,
      role: 'ADMIN',
    }]]);

    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'admin_cse@gmail.com', password: '12345678' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.token).toBeDefined();
    expect(res.body.user).toEqual({
      id: 1,
      email: 'admin_cse@gmail.com',
      role: 'ADMIN',
    });
  });
});
