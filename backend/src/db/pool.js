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
  const dbUrl = process.env.MYSQL_URL || process.env.DATABASE_URL || process.env.MYSQL_PRIVATE_URL;
  if (dbUrl) {
    pool = mysql.createPool(dbUrl);
    return pool;
  }
  pool = mysql.createPool({
    host: process.env.DB_HOST || process.env.MYSQLHOST || 'localhost',
    port: Number(process.env.DB_PORT || process.env.MYSQLPORT) || 3306,
    user: process.env.DB_USER || process.env.MYSQLUSER || 'routine_app',
    password: process.env.DB_PASSWORD || process.env.MYSQLPASSWORD || '',
    database: process.env.DB_NAME || process.env.MYSQLDATABASE || 'routine_generator',
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
    multipleStatements: false,
    dateStrings: true,
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
