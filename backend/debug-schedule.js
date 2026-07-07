require('dotenv').config();
const mysql = require('mysql2/promise');
const { solve, SchedulingError } = require('./src/services/scheduler');

const BATCH_ID = 9; // তোমার সর্বশেষ batch id দিয়ে বদলাও (Upload/History page-এ দেখা যাবে)

async function main() {
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST,
    port: process.env.DB_PORT,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    decimalNumbers: true,
  });

  const [courses] = await conn.execute(
    'SELECT * FROM courses WHERE upload_batch_id = ?', [BATCH_ID]
  );
  const [rooms] = await conn.execute(
    'SELECT * FROM rooms WHERE upload_batch_id = ?', [BATCH_ID]
  );
  const [roomPref] = await conn.execute(
    'SELECT * FROM room_preference WHERE upload_batch_id = ?', [BATCH_ID]
  );
  const [unavail] = await conn.execute(
    'SELECT * FROM teacher_unavailability WHERE upload_batch_id = ?', [BATCH_ID]
  );
  const [configRows] = await conn.execute(
    'SELECT `key`, `value` FROM config WHERE upload_batch_id = ?', [BATCH_ID]
  );
  const config = {};
  for (const row of configRows) config[row.key] = row.value;

  console.log('courses:', courses.length, 'rooms:', rooms.length);
// বাজেট ২ লাখ থেকে বাড়িয়ে ১০ লাখ (১ মিলিয়ন) করা হলো
config['SCHEDULER_BUDGET'] = 1000000; 

  console.time('solve');
  try {
    const result = solve({
      courses,
      rooms,
      room_preference: roomPref,
      teacher_unavailability: unavail,
      config,
    });
    console.timeEnd('solve');
    console.log('✅ SUCCESS — placed', result.length, 'sessions');
  } catch (err) {
    console.timeEnd('solve');
    console.error('❌', err.message);
    console.error(JSON.stringify(err.details, null, 2));
  }

  await conn.end();
}

main().catch((e) => console.error('Unexpected:', e));