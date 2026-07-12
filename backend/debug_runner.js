require('dotenv').config();
const fs = require('fs');
const { getPool } = require('./src/db/pool');
const { loadBatchForSchedule } = require('./src/services/routineLoader');
const vm = require('vm');

async function runTests() {
  const pool = getPool();
  let batchId;
  try {
    const [batches] = await pool.query('SELECT id FROM upload_batches ORDER BY id DESC LIMIT 1');
    if (batches.length === 0) {
      console.log('No batches found');
      return;
    }
    batchId = batches[0].id;
  } catch (e) {
    console.error(e);
    return;
  }

  const loaded = await loadBatchForSchedule(batchId);

  let originalCode = fs.readFileSync('./src/services/scheduler.js', 'utf-8');

  // Inject tracking objects
  originalCode = originalCode.replace(
    /const usedDays = courseUsedDays\.get\(course\.course_code\);/g,
    `const usedDays = courseUsedDays.get(course.course_code);
    if (!global.STATS) {
      global.STATS = {
        nodesExpanded: 0,
        branchesPruned: 0,
        pruneReasons: {},
        candidatesCount: 0,
        candidatesGenerated: 0,
        maxRecursionDepth: 0,
        depth: 0
      };
    }`
  );
  
  // Instrument preservesFeasibility
  originalCode = originalCode.replace(
    /function preservesFeasibility\(course, day, slots, roomId\) \{/,
    `function preservesFeasibility(course, day, slots, roomId) {
      if (global.DEBUG_FLAGS && global.DEBUG_FLAGS.disablePreserves) return true;
      const result = (function() {
        if (morningOnlyLabCourseSet.size === 0) return true;
        if (!morningOnlyLabRooms.has(roomId)) return true;
`
  );
  originalCode = originalCode.replace(
    /return freeAfterCommit >= stillNeeded;\s*\}/,
    `return freeAfterCommit >= stillNeeded;
      })();
      if (!result && global.STATS) {
        global.STATS.branchesPruned++;
        global.STATS.pruneReasons['preservesFeasibility'] = (global.STATS.pruneReasons['preservesFeasibility'] || 0) + 1;
      }
      return result;
    }`
  );

  // Look-ahead prune for placeCourse
  originalCode = originalCode.replace(
    /const remainingDays = workingDays\.length - usedDays\.size;\s*const remainingSessions = course\.derived_classes_per_week;\s*if \(remainingDays < remainingSessions\) \{/g,
    `const remainingDays = workingDays.length - usedDays.size;
    const remainingSessions = course.derived_classes_per_week;
    if (!(global.DEBUG_FLAGS && global.DEBUG_FLAGS.disableLookAhead) && remainingDays < remainingSessions) {
      if (global.STATS) { global.STATS.branchesPruned++; global.STATS.pruneReasons['look_ahead_course'] = (global.STATS.pruneReasons['look_ahead_course'] || 0) + 1; }
`
  );
  // Look-ahead prune for placeSessionsThenRest
  originalCode = originalCode.replace(
    /const remainingDays = workingDays\.length - usedDays\.size;\s*const remainingSessions = total - sessionFrom;\s*if \(remainingDays < remainingSessions\) \{/g,
    `const remainingDays = workingDays.length - usedDays.size;
    const remainingSessions = total - sessionFrom;
    if (!(global.DEBUG_FLAGS && global.DEBUG_FLAGS.disableLookAhead) && remainingDays < remainingSessions) {
      if (global.STATS) { global.STATS.branchesPruned++; global.STATS.pruneReasons['look_ahead_session'] = (global.STATS.pruneReasons['look_ahead_session'] || 0) + 1; }
`
  );

  // Distinct day prune in enumerateCandidates
  originalCode = originalCode.replace(
    /if \(usedDays\.has\(day\)\) continue;/g,
    `if (!(global.DEBUG_FLAGS && global.DEBUG_FLAGS.disableDistinctDay) && usedDays.has(day)) {
       if (global.STATS) { global.STATS.branchesPruned++; global.STATS.pruneReasons['distinct_day'] = (global.STATS.pruneReasons['distinct_day'] || 0) + 1; }
       continue;
     }`
  );

  // Hard constraint track inside placeCourse loop (slotIsFree, roomBusy)
  originalCode = originalCode.replace(
    /if \(!slotsFree\) \{ cIdx \+= 1; continue; \}/g,
    `if (!slotsFree) { 
       if (global.STATS) { global.STATS.branchesPruned++; global.STATS.pruneReasons['slot_not_free'] = (global.STATS.pruneReasons['slot_not_free'] || 0) + 1; }
       cIdx += 1; continue; 
     }`
  );
  originalCode = originalCode.replace(
    /if \(roomBusy\.overlaps\([^)]+\)\s*\)\s*\{ cIdx \+= 1; continue; \}/g,
    `if (roomBusy.overlaps(
        \`\${cand.roomId}|\${cand.day}\`,
        start,
        end
      )) { 
       if (global.STATS) { global.STATS.branchesPruned++; global.STATS.pruneReasons['room_busy'] = (global.STATS.pruneReasons['room_busy'] || 0) + 1; }
       cIdx += 1; continue; 
     }`
  );
  
  originalCode = originalCode.replace(
    /if \(\!preservesFeasibility\(course, cand\.day, cand\.slots, cand\.roomId\)\) \{/g,
    `if (!(global.DEBUG_FLAGS && global.DEBUG_FLAGS.disableMorningOnly) && !preservesFeasibility(course, cand.day, cand.slots, cand.roomId)) {`
  );

  // Assertions for undoLastAssignment
  // We need to inject state checking inside the backtracking loops.
  const stateSnapshotCode = `
    const _ss_teacher = teacherBusy.size();
    const _ss_room = roomBusy.size();
    const _ss_sem = semBusy.size();
    const _ss_assign = assignments.length;
    let _ss_used = 0;
    for (const v of courseUsedDays.values()) _ss_used += v.size;
  `;
  const stateAssertCode = `
    const _as_teacher = teacherBusy.size();
    const _as_room = roomBusy.size();
    const _as_sem = semBusy.size();
    const _as_assign = assignments.length;
    let _as_used = 0;
    for (const v of courseUsedDays.values()) _as_used += v.size;
    if (_ss_teacher !== _as_teacher || _ss_room !== _as_room || _ss_sem !== _as_sem || _ss_assign !== _as_assign || _ss_used !== _as_used) {
      console.log('STATE LEAK! BEFORE:', _ss_teacher, _ss_room, _ss_sem, _ss_assign, _ss_used, 'AFTER:', _as_teacher, _as_room, _as_sem, _as_assign, _as_used);
      throw new Error("State leak detected");
    }
  `;

  // Inject into placeCourse
  originalCode = originalCode.replace(
    /commitOne\(course, cand\.day, cand\.slots, cand\.roomId, 0\);/g,
    `${stateSnapshotCode} commitOne(course, cand.day, cand.slots, cand.roomId, 0);`
  );
  originalCode = originalCode.replace(
    /usedDays\.delete\(cand\.day\);\s*cIdx \+= 1;/g,
    `usedDays.delete(cand.day); cIdx += 1; ${stateAssertCode}`
  );
  
  // Inject into placeSessionsThenRest
  originalCode = originalCode.replace(
    /commitOne\(course, cand\.day, cand\.slots, cand\.roomId, s\);/g,
    `${stateSnapshotCode} commitOne(course, cand.day, cand.slots, cand.roomId, s);`
  );

  // Add stats to placeCourse top
  originalCode = originalCode.replace(
    /function placeCourse\(idx\) \{/g,
    `function placeCourse(idx) {
      if (global.STATS) {
        global.STATS.nodesExpanded++;
        global.STATS.depth++;
        if (global.STATS.depth > global.STATS.maxRecursionDepth) global.STATS.maxRecursionDepth = global.STATS.depth;
      }
`
  );
  originalCode = originalCode.replace(
    /function placeSessionsThenRest\(course, idx, sessionFrom\) \{/g,
    `function placeSessionsThenRest(course, idx, sessionFrom) {
      if (global.STATS) {
        global.STATS.nodesExpanded++;
        global.STATS.depth++;
        if (global.STATS.depth > global.STATS.maxRecursionDepth) global.STATS.maxRecursionDepth = global.STATS.depth;
      }
`
  );
  originalCode = originalCode.replace(/return false;/g, `if (global.STATS) global.STATS.depth--; return false;`);
  originalCode = originalCode.replace(/return true;/g, `if (global.STATS) global.STATS.depth--; return true;`);
  originalCode = originalCode.replace(/return placeCourse\(idx \+ 1\);/g, `if (global.STATS) global.STATS.depth--; return placeCourse(idx + 1);`);

  // Count candidates generated
  originalCode = originalCode.replace(
    /const candidates = enumerateCandidates\(course, usedDays\);/g,
    `const candidates = enumerateCandidates(course, usedDays);
     if (global.STATS) {
       global.STATS.candidatesCount++;
       global.STATS.candidatesGenerated += candidates.length;
     }`
  );

  // Fix require paths for VM context
  originalCode = originalCode.replace(
    /require\('\.\/intervalMap'\)/g,
    "require('./src/services/intervalMap')"
  );
  originalCode = originalCode.replace(
    /require\('\.\/roomSelector'\)/g,
    "require('./src/services/roomSelector')"
  );

  // Compile it
  const sandbox = {
    require: require,
    console: console,
    module: { exports: {} },
    process: process,
    global: global,
    Math: Math,
    Number: Number,
    String: String,
    Error: Error,
    Set: Set,
    Map: Map,
    Array: Array
  };
  vm.createContext(sandbox);
  try {
    vm.runInContext(originalCode, sandbox);
  } catch (e) {
    console.error("Compile error", e);
    return;
  }
  const { solve } = sandbox.module.exports;

  const runWithFlags = (flags, logName) => {
    global.DEBUG_FLAGS = flags;
    global.STATS = {
      nodesExpanded: 0,
      branchesPruned: 0,
      pruneReasons: {},
      candidatesCount: 0,
      candidatesGenerated: 0,
      maxRecursionDepth: 0,
      depth: 0
    };
    console.log("\n--- RUNNING: " + logName + " ---");
    try {
      const result = solve(
        {
          config:                 loaded.config,
          courses:                loaded.courses,
          rooms:                  loaded.rooms,
          room_preference:        loaded.room_preference,
          day_preference:         loaded.day_preference || [],
          teacher_unavailability: loaded.teacher_unavailability,
        },
        { rng: Math.random, budget: 1000000 } // using 1M budget to fail faster if needed
      );
      console.log("SUCCESS: " + result.length + " assignments");
      return true;
    } catch (e) {
      console.log("FAILED: " + e.message);
      return false;
    } finally {
      if (global.STATS.candidatesCount > 0) {
        console.log("Average candidates per call: " + (global.STATS.candidatesGenerated / global.STATS.candidatesCount).toFixed(2));
      }
      console.log("Nodes Expanded: " + global.STATS.nodesExpanded);
      console.log("Branches Pruned: " + global.STATS.branchesPruned);
      console.log("Max Recursion Depth: " + global.STATS.maxRecursionDepth);
      console.log("Prune Reasons:");
      const sorted = Object.entries(global.STATS.pruneReasons).sort((a, b) => b[1] - a[1]);
      for (const [reason, count] of sorted.slice(0, 20)) {
        console.log("  " + reason + ": " + count);
      }
    }
  };

  runWithFlags({ disablePreserves: false, disableLookAhead: false, disableDistinctDay: false, disableMorningOnly: false }, 'BASELINE (ALL PRUNING ON)');
  runWithFlags({ disablePreserves: true, disableLookAhead: false, disableDistinctDay: false, disableMorningOnly: false }, 'DISABLE preservesFeasibility');
  runWithFlags({ disablePreserves: false, disableLookAhead: false, disableDistinctDay: false, disableMorningOnly: true }, 'DISABLE Morning-Only Pruning');
  runWithFlags({ disablePreserves: false, disableLookAhead: true, disableDistinctDay: false, disableMorningOnly: false }, 'DISABLE Look-Ahead Pruning');
  runWithFlags({ disablePreserves: false, disableLookAhead: false, disableDistinctDay: true, disableMorningOnly: false }, 'DISABLE Distinct-Day Pruning');
  
  process.exit(0);
}
runTests();
