require('dotenv').config();
const fs = require('fs');
const { sortByConstraintTightness } = require('./src/services/scheduler');
const { loadBatchForSchedule } = require('./src/services/routineLoader');

const OUT = 'C:\\Class_Routine\\backend\\diag_order2.out';
try { fs.unlinkSync(OUT); } catch (_) {}
const log = (m) => fs.appendFileSync(OUT, m + '\n');

(async () => {
  const loaded = await loadBatchForSchedule(11);
  const unavailMap = new Map();
  for (const u of loaded.teacher_unavailability || []) {
    if (!unavailMap.has(u.teacher_abbr)) unavailMap.set(u.teacher_abbr, []);
    unavailMap.get(u.teacher_abbr).push(u);
  }
  const ordered = sortByConstraintTightness(loaded.courses, loaded.rooms, unavailMap);
  log('=== Sorted courses (first is most constrained) ===');
  let i = 0;
  for (const c of ordered) {
    const weekly = (c.derived_duration_min || 0) * (c.derived_classes_per_week || 1);
    log(`${(i++).toString().padStart(2)} ${c.course_code} [${c.derived_type}] dur=${c.derived_duration_min} cpw=${c.derived_classes_per_week} weekly=${weekly}min teacher=${c.teacher_abbr}`);
  }
  process.exit(0);
})();