require('dotenv').config();
const { loadBatchForSchedule } = require('./src/services/routineLoader');

(async () => {
  const l = await loadBatchForSchedule(11);
  console.log('--- course 0 (full schema) ---');
  console.log(JSON.stringify(l.courses[0], null, 2));
  console.log('--- lab-ish course ---');
  const labish = l.courses.find(c => (c.duration_minutes || 50) >= 200) || l.courses[5];
  console.log(JSON.stringify(labish, null, 2));
  console.log('--- teacher_unavailability[0..2] ---');
  console.log(JSON.stringify(l.teacher_unavailability?.slice(0, 3), null, 2));
  console.log('--- room sample ---');
  console.log(JSON.stringify(l.rooms[0], null, 2));
  console.log('--- room_preference sample ---');
  console.log(JSON.stringify(l.room_preference?.slice(0, 3), null, 2));
  console.log('--- key names in course 0 ---');
  console.log(Object.keys(l.courses[0]));
  process.exit(0);
})();