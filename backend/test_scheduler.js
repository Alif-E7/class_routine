require('dotenv').config();
const { getPool } = require('./src/db/pool');
const { loadBatchForSchedule } = require('./src/services/routineLoader');
const { solve, SchedulingError } = require('./src/services/scheduler');

async function main() {
  const pool = getPool();
  try {
    const [batches] = await pool.query('SELECT id FROM upload_batches ORDER BY id DESC LIMIT 1');
    if (batches.length === 0) {
      console.log('No batches found');
      return;
    }
    const batchId = batches[0].id;
    console.log('Testing batch:', batchId);
    
    const loaded = await loadBatchForSchedule(batchId);
    console.log('Loaded batch, running solve...');
    
    try {
      const assignments = solve(
        {
          config:                 loaded.config,
          courses:                loaded.courses,
          rooms:                  loaded.rooms,
          room_preference:        loaded.room_preference,
          day_preference:         loaded.day_preference || [],
          teacher_unavailability: loaded.teacher_unavailability,
        },
        {
          rng: Math.random,
          budget: 2000000,
        }
      );
      console.log('Success!', assignments.length, 'assignments');
    } catch (e) {
      console.log('Failed:', e.message);
    }
  } catch (e) {
    console.error(e);
  } finally {
    process.exit(0);
  }
}
main();
