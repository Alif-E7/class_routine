'use strict';
require('dotenv').config();
const mysql = require('mysql2/promise');

(async () => {
  const c = await mysql.createConnection({
    host: process.env.DB_HOST,
    port: process.env.DB_PORT,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    decimalNumbers: true,
  });

  // Find latest batch
  const [batches] = await c.execute('SELECT * FROM upload_batches ORDER BY id DESC LIMIT 1');
  const batchId = batches[0].id;
  console.log('Latest batch id:', batchId, 'status:', batches[0].status);

  const [cfg] = await c.execute('SELECT `key`, `value` FROM config WHERE upload_batch_id=?', [batchId]);
  console.log('\nConfig:');
  for (const r of cfg) console.log(' ', r.key, '=', r.value);

  const [cr] = await c.execute('SELECT * FROM credit_rules WHERE upload_batch_id=?', [batchId]);
  console.log('\nCredit rules:');
  console.log(JSON.stringify(cr, null, 2));

  const [courses] = await c.execute(
    'SELECT course_code, credit, derived_type, derived_duration_min, derived_classes_per_week FROM courses WHERE upload_batch_id=?',
    [batchId]
  );
  console.log('\nCourses with credit=1.5:');
  for (const c2 of courses.filter(x => Number(x.credit) === 1.5)) {
    console.log(` ${c2.course_code}: type=${c2.derived_type} dur=${c2.derived_duration_min} cpw=${c2.derived_classes_per_week}`);
  }

  await c.end();
})().catch(e => console.error('Error:', e.message));
