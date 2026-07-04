'use strict';

const mysql = require('mysql2/promise');

/**
 * Single shared mysql2 connection pool. Reads connection settings from
 * .env (see .env.example). The pool is created lazily on first call and
 * reused across the whole process so we get connection reuse without
 * paying TCP setup cost per query.
 */
let pool = null;

function getPool() {
  if (pool) return pool;
  pool = mysql.createPool({
    host: process.env.DB_HOST || 'localhost',
    port: Number(process.env.DB_PORT) || 3306,
    user: process.env.DB_USER || 'routine_app',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'routine_generator',
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
    multipleStatements: false,
    dateStrings: true,
    // Fail fast instead of hanging the HTTP request for the default ~60s
    // when DB credentials/host are wrong. The global error handler in app.js
    // converts the resulting ECONNREFUSED/ER_ACCESS_DENIED_ERROR into a
    // clean 503 with a useful code.
    connectTimeout: 5_000,
  });
  return pool;
}

/**
 * Run `fn(connection)` inside a transaction. Always commits on success
 * and rolls back on any thrown error. Returns whatever `fn` returns.
 */
async function withTransaction(fn) {
  const conn = await getPool().getConnection();
  try {
    await conn.beginTransaction();
    const out = await fn(conn);
    await conn.commit();
    return out;
  } catch (err) {
    try { await conn.rollback(); } catch (_) { /* ignore */ }
    throw err;
  } finally {
    conn.release();
  }
}

async function closePool() {
  if (pool) {
    await pool.end();
    pool = null;
  }
}

module.exports = { getPool, withTransaction, closePool };
