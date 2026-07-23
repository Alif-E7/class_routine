const fs = require('fs');

let code = fs.readFileSync('./src/services/scheduler.js', 'utf-8');

// Inject global tracking
const preamble = `
global.DEBUG_FLAGS = {
  disablePreserves: false,
  disableMorningOnly: false, // same as preserves? We'll disable preservesFeasibility
  disableLookAhead: false,
  disableDistinctDay: false,
};
global.STATS = {
  nodesExpanded: 0,
  branchesPruned: 0,
  pruneReasons: {},
  totalCandidates: 0,
  candidateCalls: 0,
  maxDepth: 0,
  depth: 0
};
function trackPrune(reason) {
  global.STATS.branchesPruned++;
  global.STATS.pruneReasons[reason] = (global.STATS.pruneReasons[reason] || 0) + 1;
}
function assertState(name, before, after) {
  if (before !== after) throw new Error(\`State leak in \${name}: before=\${before}, after=\${after}\`);
}
`;

// Modify preservesFeasibility
code = code.replace(
  /function preservesFeasibility\(course, day, slots, roomId\) \{/,
  `function preservesFeasibility(course, day, slots, roomId) {
    if (global.DEBUG_FLAGS.disablePreserves || global.DEBUG_FLAGS.disableMorningOnly) return true;
`
);

// Modify lookahead pruning (in placeCourse)
code = code.replace(
  /const remainingDays = workingDays\.length - usedDays\.size;\s*const remainingSessions = course\.derived_classes_per_week;\s*if \(remainingDays < remainingSessions\) \{/g,
  `const remainingDays = workingDays.length - usedDays.size;
    const remainingSessions = course.derived_classes_per_week;
    if (!global.DEBUG_FLAGS.disableLookAhead && remainingDays < remainingSessions) {
      trackPrune('look_ahead');`
);

// Lookahead pruning (in placeSessionsThenRest)
code = code.replace(
  /const remainingDays = workingDays\.length - usedDays\.size;\s*const remainingSessions = total - sessionFrom;\s*if \(remainingDays < remainingSessions\) \{/g,
  `const remainingDays = workingDays.length - usedDays.size;
    const remainingSessions = total - sessionFrom;
    if (!global.DEBUG_FLAGS.disableLookAhead && remainingDays < remainingSessions) {
      trackPrune('look_ahead_session');`
);


// Modify enumerateCandidates distinct-day
code = code.replace(
  /if \(usedDays\.has\(day\)\) continue;/g,
  `if (!global.DEBUG_FLAGS.disableDistinctDay && usedDays.has(day)) continue;`
);

// Instrument placeCourse
code = code.replace(
  /function placeCourse\(idx\) \{/,
  `function placeCourse(idx) {
    global.STATS.nodesExpanded++;
    global.STATS.depth++;
    if (global.STATS.depth > global.STATS.maxDepth) global.STATS.maxDepth = global.STATS.depth;
`
);
code = code.replace(
  /return false;\s*\}/g,
  `global.STATS.depth--; return false; }`
);
code = code.replace(
  /return true;\s*\}/g,
  `global.STATS.depth--; return true; }`
);
// Wait, placeCourse doesn't just return at the end of the block, it has multiple returns.
// Better to just wrap placeCourse and placeSessionsThenRest

fs.writeFileSync('scheduler_instrumented_raw.js', preamble + code);
console.log("Wrote scheduler_instrumented_raw.js");
