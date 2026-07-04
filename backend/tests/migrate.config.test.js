'use strict';

/**
 * Unit tests for src/db/migrate.js.
 *
 * Stubs `mysql2/promise` via a global scratch object so we can assert
 * the credentials + SQL the runner issues without needing a real MySQL.
 *
 * Locks in:
 *   1. DB_MIGRATE_USER / DB_MIGRATE_PASSWORD take priority over DB_USER /
 *      DB_PASSWORD when set.
 *   2. CREATE DATABASE IF NOT EXISTS runs against the configured DB_NAME.
 *   3. Each unrecorded .sql file is applied in lexical order and recorded
 *      in `_migrations`.
 *   4. Files already in `_migrations` are skipped (idempotent re-run).
 *   5. Migrations directory is read from src/db/migrations relative to
 *      the script (NOT cwd).
 */

// Shared mutable state, prefixed with `mock` so Jest's hoisting allows
// the mock factory to reference it.
global.mockMigrateState = global.mockMigrateState || {
  connectionOpts: [],
  queryCaptures: [],   // one entry per connection
  // Per-call response for SELECT FROM _migrations; tests set this.
  appliedRows: [],
};

jest.mock('mysql2/promise', () => ({
  createConnection: jest.fn(async (opts) => {
    const capture = [];
    global.mockMigrateState.connectionOpts.push(opts);
    global.mockMigrateState.queryCaptures.push(capture);
    const conn = {
      query: jest.fn(async (sql, params) => {
        capture.push({ sql, params });
        if (/SELECT name FROM _migrations/i.test(sql)) {
          return [global.mockMigrateState.appliedRows];
        }
        return [[]];
      }),
      end: async () => {},
    };
    return conn;
  }),
}));

const fs = require('fs');
const path = require('path');

beforeAll(() => {
  // Silence the runner's chatty console.log during tests.
  global.mockOrigLog = console.log;
  console.log = () => {};
  // Ensure the migrations dir exists. The real 001_initial.sql ships with
  // the repo; we don't create a placeholder — we just look for known
  // content from it in the assertions.
  const dir = path.join(__dirname, '..', 'src', 'db', 'migrations');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

afterAll(() => {
  if (global.mockOrigLog) console.log = global.mockOrigLog;
});

afterEach(() => {
  for (const k of ['DB_HOST','DB_PORT','DB_USER','DB_PASSWORD','DB_NAME',
                   'DB_MIGRATE_USER','DB_MIGRATE_PASSWORD']) {
    delete process.env[k];
  }
  global.mockMigrateState.connectionOpts.length = 0;
  global.mockMigrateState.queryCaptures.length = 0;
  global.mockMigrateState.appliedRows = [];
});

async function runMigrate() {
  jest.resetModules();
  // Stub dotenv so the real backend/.env doesn't leak into the test.
  jest.doMock('dotenv', () => ({ config: () => ({}) }));
  require('../src/db/migrate');
  // Drain microtasks so main() finishes before we assert.
  for (let i = 0; i < 8; i++) {
    // eslint-disable-next-line no-await-in-loop
    await new Promise((r) => setImmediate(r));
  }
}

describe('migrate.js credential priority', () => {
  it('uses DB_MIGRATE_USER / DB_MIGRATE_PASSWORD when both are set', async () => {
    process.env.DB_HOST = 'db.example';
    process.env.DB_PORT = '3307';
    process.env.DB_USER = 'cse_admin';
    process.env.DB_PASSWORD = 'app-pw';
    process.env.DB_NAME = 'routine_generator';
    process.env.DB_MIGRATE_USER = 'root';
    process.env.DB_MIGRATE_PASSWORD = 'root-pw';

    await runMigrate();

    expect(global.mockMigrateState.connectionOpts[0]).toEqual(expect.objectContaining({
      host: 'db.example',
      port: 3307,
      user: 'root',
      password: 'root-pw',
      multipleStatements: true,
    }));
  });

  it('falls back to DB_USER / DB_PASSWORD when DB_MIGRATE_* are unset', async () => {
    process.env.DB_USER = 'cse_admin';
    process.env.DB_PASSWORD = 'app-pw';
    process.env.DB_NAME = 'routine_generator';

    await runMigrate();

    expect(global.mockMigrateState.connectionOpts[0].user).toBe('cse_admin');
    expect(global.mockMigrateState.connectionOpts[0].password).toBe('app-pw');
  });

  it('defaults to root / empty password when nothing is set', async () => {
    process.env.DB_NAME = 'fresh_db';
    await runMigrate();
    expect(global.mockMigrateState.connectionOpts[0].user).toBe('root');
    expect(global.mockMigrateState.connectionOpts[0].password).toBe('');
  });
});

describe('migrate.js behaviour', () => {
  beforeEach(() => {
    process.env.DB_USER = 'root';
    process.env.DB_PASSWORD = '';
    process.env.DB_NAME = 'fresh_db';
  });

  it('issues CREATE DATABASE IF NOT EXISTS for the configured DB_NAME', async () => {
    await runMigrate();
    const queries = global.mockMigrateState.queryCaptures[0];
    const create = queries.find((q) => /CREATE DATABASE IF NOT EXISTS/i.test(q.sql));
    expect(create).toBeDefined();
    expect(create.sql).toMatch(/`fresh_db`/);
  });

  it('applies every .sql file and records it in _migrations', async () => {
    await runMigrate();
    const queries = global.mockMigrateState.queryCaptures[0];
    // Real migration file contains CREATE TABLE upload_batches …
    const apply = queries.find((q) => /CREATE TABLE/i.test(q.sql) && /upload_batches/i.test(q.sql));
    expect(apply).toBeDefined();
    const insert = queries.find(
      (q) => /INSERT INTO _migrations/i.test(q.sql)
        && q.params && q.params[0] === '001_initial.sql'
    );
    expect(insert).toBeDefined();
  });

  it('skips .sql files already present in _migrations (idempotent re-run)', async () => {
    global.mockMigrateState.appliedRows = [{ name: '001_initial.sql' }];
    await runMigrate();
    const queries = global.mockMigrateState.queryCaptures[0];
    const apply = queries.find((q) => /CREATE TABLE/i.test(q.sql) && /upload_batches/i.test(q.sql));
    expect(apply).toBeUndefined();
  });

  it('reads migrations from src/db/migrations, not cwd', async () => {
    const tmp = require('os').tmpdir();
    const orig = process.cwd();
    process.chdir(tmp);
    try {
      await runMigrate();
      const queries = global.mockMigrateState.queryCaptures[0];
      const apply = queries.find((q) => /CREATE TABLE/i.test(q.sql) && /upload_batches/i.test(q.sql));
      expect(apply).toBeDefined();
    } finally {
      process.chdir(orig);
    }
  });
});