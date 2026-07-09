'use strict';
/**
 * debug-schedule.js — reproduce a real-dataset solve from the DB.
 *
 * Usage:
 *   node debug-schedule.js              # uses the latest completed/needs_review batch
 *   node debug-schedule.js --batch=17   # uses a specific batch id
 *   node debug-schedule.js --budget=5000000  # override iteration budget
 */
require('dotenv').config();
const mysql = require('mysql2/promise');
const { solve, SchedulingError } = require('./src/services/scheduler');

// ── CLI argument parsing ──────────────────────────────────────────────────────
const args = Object.fromEntries(
  process.argv.slice(2)
    .filter((a) => a.startsWith('--'))
    .map((a) => {
      const [k, v] = a.slice(2).split('=');
      return [k, v ?? true];
    })
);

async function main() {
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST,
    port: process.env.DB_PORT,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    decimalNumbers: true,
  });

  // ── Resolve batch ID ────────────────────────────────────────────────────────
  let batchId;
  if (args.batch) {
    batchId = Number(args.batch);
    if (!Number.isInteger(batchId) || batchId <= 0) {
      console.error(`❌ Invalid --batch value: ${args.batch}`);
      process.exit(1);
    }
    const [rows] = await conn.execute('SELECT id, status FROM upload_batches WHERE id=?', [batchId]);
    if (rows.length === 0) {
      console.error(`❌ Batch id=${batchId} not found in upload_batches`);
      process.exit(1);
    }
    console.log(`Using specified batch id=${batchId} (status: ${rows[0].status})`);
  } else {
    // Auto-detect: pick the latest batch that has data (any status)
    const [rows] = await conn.execute(
      'SELECT id, status FROM upload_batches ORDER BY id DESC LIMIT 1'
    );
    if (rows.length === 0) {
      console.error('❌ No batches found in upload_batches — upload an Excel file first');
      process.exit(1);
    }
    batchId = rows[0].id;
    console.log(`Auto-detected latest batch id=${batchId} (status: ${rows[0].status})`);
  }

  // ── Load data for this batch ────────────────────────────────────────────────
  const [courses] = await conn.execute(
    'SELECT * FROM courses WHERE upload_batch_id = ?', [batchId]
  );
  const [rooms] = await conn.execute(
    'SELECT * FROM rooms WHERE upload_batch_id = ?', [batchId]
  );
  const [roomPref] = await conn.execute(
    'SELECT * FROM room_preference WHERE upload_batch_id = ?', [batchId]
  );
  const [unavail] = await conn.execute(
    'SELECT * FROM teacher_unavailability WHERE upload_batch_id = ?', [batchId]
  );
  // `key` is a MySQL reserved word — must be backtick-quoted.
  const [configRows] = await conn.execute(
    'SELECT `key`, `value` FROM config WHERE upload_batch_id = ?', [batchId]
  );
  const config = {};
  for (const row of configRows) config[row.key] = row.value;

  console.log(`courses: ${courses.length}  rooms: ${rooms.length}  config keys: ${Object.keys(config).length}`);

  if (courses.length === 0 || rooms.length === 0) {
    console.warn('⚠️  No courses or rooms found for this batch. Nothing to solve.');
    await conn.end();
    return;
  }

  // ── Budget ──────────────────────────────────────────────────────────────────
  const budget = args.budget
    ? Number(args.budget)
    : Number(config['SCHEDULER_BUDGET']) || 2_000_000;
  config['SCHEDULER_BUDGET'] = budget;
  console.log(`Search budget: ${budget.toLocaleString()} iterations`);

  // ── Solve ───────────────────────────────────────────────────────────────────
  console.time('solve');
  try {
    const result = solve({
      courses,
      rooms,
      room_preference: roomPref,
      teacher_unavailability: unavail,
      config,
    }, { budget });
    console.timeEnd('solve');
    console.log(`✅ SUCCESS — placed ${result.length} sessions`);

    // Summary by day
    const byDay = {};
    for (const r of result) {
      byDay[r.day] = (byDay[r.day] || 0) + 1;
    }
    console.log('Sessions by day:', byDay);
  } catch (err) {
    console.timeEnd('solve');
    if (err instanceof SchedulingError) {
      console.error(`❌ ${err.message}`);
      if (err.details) {
        console.error('Details:', JSON.stringify(err.details, null, 2));
      }
    } else {
      console.error('❌ Unexpected error:', err);
    }
  }

  await conn.end();
}

main().catch((e) => {
  console.error('Unexpected top-level error:', e);
  process.exit(1);
});