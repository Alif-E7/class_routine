require('dotenv').config();
const fs = require('fs');
const { loadBatchForSchedule } = require('./src/services/routineLoader');

const OUT = 'C:\\Class_Routine\\backend\\diag_facts.out';
try { fs.unlinkSync(OUT); } catch (_) {}
const log = (m) => fs.appendFileSync(OUT, m + '\n');

(async () => {
  const loaded = await loadBatchForSchedule(11);
  const { courses, rooms, config } = loaded;

  // teacher_abbr (string) is the actual field
  const teacherDemand = new Map();
  for (const c of courses) {
    const dur = c.derived_duration_min || 0;
    const cpw = c.derived_classes_per_week || 1;
    const weeklyMin = dur * cpw;
    const t = c.teacher_abbr;
    if (!t) { log(`!! ${c.course_code} has NO teacher_abbr`); continue; }
    if (!teacherDemand.has(t)) teacherDemand.set(t, { courses: [], totalWeeklyMin: 0, labMin: 0, theoryMin: 0 });
    const e = teacherDemand.get(t);
    e.courses.push({ code: c.course_code, type: c.derived_type, dur, cpw, weeklyMin });
    e.totalWeeklyMin += weeklyMin;
    if (dur >= 200) e.labMin += weeklyMin; else e.theoryMin += weeklyMin;
  }

  const winStart = parseTime(config.class_start);
  const breakStart = parseTime(config.break_start);
  const breakEnd = parseTime(config.break_end);
  const classEnd = parseTime(config.class_end);
  const preBreak = breakStart - winStart;
  const postBreak = classEnd - breakEnd;
  const workingDays = config.working_days.split(',').length;
  const weeklyWindowMin = (preBreak + postBreak) * workingDays;
  log(`Daily: pre-break=${preBreak}min (${formatMin(winStart)}-${formatMin(breakStart)}), post-break=${postBreak}min (${formatMin(breakEnd)}-${formatMin(classEnd)})`);
  log(`Working days: ${workingDays}, weeklyWindow=${weeklyWindowMin}min`);

  // For 240-min labs: ONLY pre-break fits (240min exactly).
  // For 50-min theory: can fit either pre-break (4 slots/day) or post-break (2 slots/day).
  // For 110-min: can fit pre-break only (2 slots/day, 110min each = 220 min used, 20 min unused). Actually 110*2=220 < 240, leaves 20 min.
  const labRooms = rooms.filter(r => r.type === 'lab');
  const classrooms = rooms.filter(r => r.type === 'classroom');
  log(`Rooms: ${labRooms.length} labs (${labRooms.map(r=>r.room_id).join(',')}), ${classrooms.length} classrooms (${classrooms.map(r=>r.room_id).join(',')})`);

  // Count courses by type
  const labs = courses.filter(c => c.derived_type === 'lab');
  const theories = courses.filter(c => c.derived_type !== 'lab');
  const totalLabSessions = labs.reduce((a, c) => a + (c.derived_classes_per_week || 1), 0);
  const totalTheorySessions = theories.reduce((a, c) => a + (c.derived_classes_per_week || 1), 0);
  log(`\nLab courses: ${labs.length} (total ${totalLabSessions} sessions/week)`);
  log(`Theory courses: ${theories.length} (total ${totalTheorySessions} sessions/week)`);
  log(`Lab durations: ${labs.map(c => c.derived_duration_min).join(',')}`);
  log(`Theory durations: ${[...new Set(theories.map(c => c.derived_duration_min))].join(',')}`);

  // Lab capacity: 4 labs x 5 days = 20 morning blocks. Each lab course needs cpw blocks.
  log(`\nLab block capacity: ${labRooms.length} labs x ${workingDays} days = ${labRooms.length * workingDays} morning blocks`);
  log(`Lab demand: ${totalLabSessions} blocks`);
  log(`Lab surplus/deficit: ${labRooms.length * workingDays - totalLabSessions}`);

  // Per-teacher
  log(`\n=== Per-teacher capacity ===`);
  const teachers = [...teacherDemand.entries()].sort((a, b) => b[1].totalWeeklyMin - a[1].totalWeeklyMin);
  // Pre-break min total = preBreak * workingDays = 1200 (must contain labs AND some theory)
  const preBreakWeeklyMin = preBreak * workingDays;
  const postBreakWeeklyMin = postBreak * workingDays;
  log(`Pre-break weekly min (across all days) = ${preBreakWeeklyMin}`);
  log(`Post-break weekly min (across all days) = ${postBreakWeeklyMin}`);
  for (const [t, d] of teachers) {
    log(`\n${t}: demand=${d.totalWeeklyMin}min (lab=${d.labMin}, theory=${d.theoryMin})`);
    log(`   courses:`);
    for (const c of d.courses) {
      log(`     ${c.code} [${c.type}] dur=${c.dur} cpw=${c.cpw} weekly=${c.weeklyMin}min`);
    }
  }

  // Check: a teacher's lab demand requires N distinct morning slots. Their theory demand may also require morning slots.
  // Sum: if a teacher has L weekly lab-min and T weekly theory-min, they need at least L pre-break minutes
  //      + post-break theory that fits. But theory can use either pre or post.
  // Critical: teacher with L=720min (3 lab sessions x 240) and T=300min (6 theory x 50):
  //   - Needs 720 min of pre-break (3 distinct days fully in pre-break)
  //   - Needs 300 min of theory which can fit in remaining pre/post break on other days
  // Pre-break total = 1200. If teacher has L=720, remaining pre-break = 480 min for them (could be theory or partial).
  log(`\n=== Per-teacher morning requirement (for labs) ===`);
  for (const [t, d] of teachers) {
    if (d.labMin > 0) {
      const labDays = d.labMin / 240; // number of morning blocks needed
      const labSessions = d.courses.filter(c => c.type === 'lab').reduce((a, c) => a + c.cpw, 0);
      log(`${t}: ${labSessions} lab sessions = ${labDays} distinct morning blocks (out of ${workingDays} available)`);
      const remainingPreBreak = (preBreak * workingDays) - d.labMin;
      log(`   remaining pre-break capacity for this teacher = ${remainingPreBreak}min`);
      log(`   theory demand = ${d.theoryMin}min; can use post-break (${postBreak * workingDays}min total)`);
    }
  }

  process.exit(0);
})();

function parseTime(s) {
  const [h, m] = s.split(':').map(Number);
  return h * 60 + m;
}
function formatMin(min) {
  return Math.floor(min / 60).toString().padStart(2, '0') + ':' + (min % 60).toString().padStart(2, '0');
}