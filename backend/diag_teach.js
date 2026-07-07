require('dotenv').config();
const { loadBatchForSchedule } = require('./src/services/routineLoader');
(async () => {
  const l = await loadBatchForSchedule(11);
  const cs = parseTime(l.config.class_start);
  const ce = parseTime(l.config.class_end);
  const bs = parseTime(l.config.break_start);
  const be = parseTime(l.config.break_end);
  const preBreak = bs - cs;
  const postBreak = ce - be;
  const wd = l.config.working_days.split(',').length;
  const weekly = (preBreak + postBreak) * wd;
  console.log(`weekly window = ${weekly}min`);
  const byT = new Map();
  for (const u of l.teacher_unavailability) {
    if (!byT.has(u.teacher_abbr)) byT.set(u.teacher_abbr, []);
    byT.get(u.teacher_abbr).push(u);
  }
  const teachers = ['NI','MF','FH','MNH','AMA','DSA','DMKB','SY'];
  for (const t of teachers) {
    const u = byT.get(t) || [];
    const uMin = u.reduce((a,w) => a + parseTime(w.end_time) - parseTime(w.start_time), 0);
    // Also compute the DAY-BY-DAY constraint: each morning block is 240 min, can't split.
    // So for NI with 3 lab sessions (each = 1 morning block), NI needs 3 distinct days with morning-free AND each of those days NI has no theory in that morning.
    // Then NI's theory: 6 sessions x 50 min = 300 min. These can be post-break (110/day = 2 slots x 5 days = 10 post-break slots = 500 min) OR pre-break on the 2 days without labs (2 days x 240 = 480 min).
    console.log(`${t}: unavail=${uMin}min, free=${weekly - uMin}min`);
    for (const r of u) console.log(`   ${r.day} ${r.start_time}-${r.end_time}`);
  }
  process.exit(0);
})();
function parseTime(s){const [h,m]=s.split(':').map(Number);return h*60+m;}