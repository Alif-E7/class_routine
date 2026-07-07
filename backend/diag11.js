require('dotenv').config();
const fs = require('fs');
const { solve, SchedulingError } = require('./src/services/scheduler');
const { loadBatchForSchedule } = require('./src/services/routineLoader');

const OUT = 'C:\\Class_Routine\\backend\\diag11.out';
const log = (msg) => fs.appendFileSync(OUT, msg + '\n');

try { fs.unlinkSync(OUT); } catch (_e) {}

(async () => {
  log('loading batch 11...');
  const loaded = await loadBatchForSchedule(11);
  log('LOADED ' + loaded.courses.length + ' courses, ' + loaded.rooms.length + ' rooms');
  log('config: ' + JSON.stringify(loaded.config));

  let seed = parseInt(process.env.SEED || '42', 10);
  let rng = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 0x100000000;
  };

  const budget = parseInt(process.env.BUDGET || '2000000', 10);
  log('STARTING solve with seed=' + (process.env.SEED || '42') + ', budget=' + budget);
  const t0 = Date.now();
  try {
    const r = solve(
      {
        config: loaded.config,
        courses: loaded.courses,
        rooms: loaded.rooms,
        room_preference: loaded.room_preference,
        teacher_unavailability: loaded.teacher_unavailability,
      },
      { budget, rng }
    );
    log('SUCCESS in ' + (Date.now() - t0) + 'ms, sessions: ' + r.length);
  } catch (e) {
    log('FAIL after ' + (Date.now() - t0) + 'ms: ' + e.message);
    if (e.details) log('DETAILS: ' + JSON.stringify(e.details).slice(0, 1000));
  }
  process.exit(0);
})().catch((e) => {
  log('UNCAUGHT: ' + e.message);
  process.exit(1);
});