'use strict';

/**
 * Standalone migration runner. Reads every .sql file in db/migrations/
 * in lexical order and applies any that haven't been recorded in the
 * `_migrations` table yet. Safe to re-run; each file runs in its own
 * implicit transaction via mysql2 (each statement is a single exec).
 *
 * Run with:  npm run migrate
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');

async function main() {
  const dbName = process.env.DB_NAME || 'routine_generator';
  // The migration runner needs privileges that the app's runtime user
  // (DB_USER, typically `routine_app`) may not have — specifically
  // `CREATE DATABASE` on first run. Override via DB_MIGRATE_USER /
  // DB_MIGRATE_PASSWORD; falls back to DB_USER/DB_PASSWORD so the
  // common case (developer runs migrations as the same user they set up
  // the schema with) keeps working.
  const user = process.env.DB_MIGRATE_USER || process.env.DB_USER || 'root';
  const password = process.env.DB_MIGRATE_PASSWORD || process.env.DB_PASSWORD || '';
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST || 'localhost',
    port: Number(process.env.DB_PORT) || 3306,
    user,
    password,
    multipleStatements: true,
  });

  // Create DB if missing (use a separate connection without a database).
  await conn.query(
    `CREATE DATABASE IF NOT EXISTS \`${dbName}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`
  );
  await conn.query(`USE \`${dbName}\``);

  await conn.query(`
    CREATE TABLE IF NOT EXISTS _migrations (
      name VARCHAR(255) NOT NULL PRIMARY KEY,
      applied_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB
  `);

  const dir = path.join(__dirname, 'migrations');
  const files = fs.readdirSync(dir).filter(f => f.endsWith('.sql')).sort();

  for (const file of files) {
    const [rows] = await conn.query(
      'SELECT name FROM _migrations WHERE name = ?', [file]
    );
    if (rows.length > 0) {
      console.log(`  = skip ${file} (already applied)`);
      continue;
    }
    const sql = fs.readFileSync(path.join(dir, file), 'utf8');
    console.log(`  + apply ${file}`);
    await conn.query(sql);
    await conn.query('INSERT INTO _migrations (name) VALUES (?)', [file]);
  }

  await conn.end();
  console.log('Migrations complete.');
}

main().catch(err => {
  console.error('Migration failed:', err);
  process.exit(1);
});
