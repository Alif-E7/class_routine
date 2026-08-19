'use strict';

/**
 * seed.js — One-time admin user seeder.
 *
 * Reads ADMIN_EMAIL and ADMIN_PASSWORD from .env, hashes the password
 * with SHA-256, and upserts the admin user into the `users` table.
 *
 * The plaintext password is NEVER stored — only the hash.
 * After seeding, you can delete ADMIN_PASSWORD from .env if you prefer
 * (keep ADMIN_EMAIL so the app knows who the admin is).
 *
 * Run with:  npm run seed
 */

require('dotenv').config();
const crypto = require('crypto');
const mysql  = require('mysql2/promise');

async function main() {
  const email    = process.env.ADMIN_EMAIL;
  const password = process.env.ADMIN_PASSWORD;

  if (!email || !password) {
    console.error(
      '[seed] ERROR: ADMIN_EMAIL and ADMIN_PASSWORD must be set in backend/.env'
    );
    process.exit(1);
  }

  const passwordHash = crypto
    .createHash('sha256')
    .update(password)
    .digest('hex');

  const dbUrl = process.env.MYSQL_URL || process.env.DATABASE_URL || process.env.MYSQL_PRIVATE_URL;

  const conn = dbUrl
    ? await mysql.createConnection(dbUrl)
    : await mysql.createConnection({
        host:     process.env.DB_HOST     || process.env.MYSQLHOST || 'localhost',
        port:     Number(process.env.DB_PORT || process.env.MYSQLPORT) || 3306,
        user:     process.env.DB_MIGRATE_USER || process.env.DB_USER || process.env.MYSQLUSER || 'root',
        password: process.env.DB_MIGRATE_PASSWORD || process.env.DB_PASSWORD || process.env.MYSQLPASSWORD || '',
        database: process.env.DB_NAME     || process.env.MYSQLDATABASE || 'routine_generator',
      });

  try {
    // Ensure users table exists (migration may not have run yet)
    await conn.query(`
      CREATE TABLE IF NOT EXISTS users (
        id            INT AUTO_INCREMENT PRIMARY KEY,
        email         VARCHAR(100) NOT NULL UNIQUE,
        password_hash VARCHAR(255) NOT NULL,
        role          VARCHAR(20)  NOT NULL DEFAULT 'user',
        created_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      ) ENGINE=InnoDB
    `);

    // Upsert: insert or update hash + role so re-seeding rotates password
    await conn.query(
      `INSERT INTO users (email, password_hash, role)
       VALUES (?, ?, 'admin')
       ON DUPLICATE KEY UPDATE
         password_hash = VALUES(password_hash),
         role          = 'admin'`,
      [email, passwordHash]
    );

    console.log(`[seed] ✓ Admin user seeded successfully`);
    console.log(`       email : ${email}`);
    console.log(`       hash  : ${passwordHash.slice(0, 12)}… (SHA-256, stored in DB)`);
    console.log(`       role  : admin`);
    console.log('');
    console.log('[seed] The plaintext password is NOT stored anywhere in the database.');
    console.log('[seed] To rotate the password: update ADMIN_PASSWORD in .env and re-run `npm run seed`.');
  } finally {
    await conn.end();
  }
}

main().catch(err => {
  console.error('[seed] Failed:', err.message);
  process.exit(1);
});
