'use strict';

/**
 * Tests for upload route static content serving endpoints:
 * GET /api/upload/template.xlsx
 * GET /api/upload/manual
 * GET /api/upload/manual.md
 */

jest.mock('../src/db/pool', () => {
  const pool = { query: jest.fn() };
  return { getPool: () => pool, withTransaction: jest.fn(), __pool: pool };
});

const request = require('supertest');
const { createApp } = require('../src/app');

const app = createApp();

describe('GET /api/upload/template.xlsx', () => {
  it('serves the static template excel file from backend/contents', async () => {
    const res = await request(app).get('/api/upload/template.xlsx');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    expect(res.headers['content-disposition'].toLowerCase()).toContain('routine_template.xlsx');
    expect(res.body).toBeDefined();
  });
});

describe('GET /api/upload/manual', () => {
  it('serves the markdown manual content as JSON from backend/contents', async () => {
    const res = await request(app).get('/api/upload/manual');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(typeof res.body.content).toBe('string');
    expect(res.body.content).toContain('ক্লাস রুটিন টেমপ্লেট পূরণ করার নিয়ম');
  });
});

describe('GET /api/upload/manual.md', () => {
  it('serves raw markdown manual file from backend/contents', async () => {
    const res = await request(app).get('/api/upload/manual.md');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/markdown');
    expect(res.text).toContain('ক্লাস রুটিন টেমপ্লেট পূরণ করার নিয়ম');
  });
});
