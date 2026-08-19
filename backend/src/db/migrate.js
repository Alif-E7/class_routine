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
  const dbName = process.env.DB_NAME || process.env.MYSQLDATABASE || 'routine_generator';

  const user =
    process.env.DB_MIGRATE_USER ||
    process.env.DB_USER ||
    process.env.MYSQLUSER ||
    'root';

  const password =
    process.env.DB_MIGRATE_PASSWORD ||
    process.env.DB_PASSWORD ||
    process.env.MYSQLPASSWORD ||
    '';

  const dbUrl = process.env.MYSQL_URL || process.env.DATABASE_URL || process.env.MYSQL_PRIVATE_URL;

  const conn = dbUrl
    ? await mysql.createConnection({ uri: dbUrl, multipleStatements: true })
    : await mysql.createConnection({
        host: process.env.DB_HOST || process.env.MYSQLHOST || 'localhost',
        port: Number(process.env.DB_PORT || process.env.MYSQLPORT) || 3306,
        user,
        password,
        database: dbName,
        multipleStatements: true,
      });

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
