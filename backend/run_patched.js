require('dotenv').config();
const { getPool } = require('./src/db/pool');
const { loadBatchForSchedule } = require('./src/services/routineLoader');
const { solve } = require('./scheduler_debug');

async function main() {
  const pool = getPool();
  try {
    const [batches] = await pool.query('SELECT id FROM upload_batches ORDER BY id DESC LIMIT 1');
    if (batches.length === 0) return;
    const batchId = batches[0].id;
    const loaded = await loadBatchForSchedule(batchId);

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
      console.log("\\n--- RUNNING: " + logName + " ---");
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
          { rng: Math.random, budget: 1000000 }
        );
        console.log("SUCCESS: " + result.length + " assignments");
      } catch (e) {
        console.log("FAILED: " + e.message);
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

    runWithFlags({ disablePreserves: false, disableLookAhead: false, disableDistinctDay: false }, 'BASELINE (ALL PRUNING ON)');
    runWithFlags({ disablePreserves: true, disableLookAhead: false, disableDistinctDay: false }, 'DISABLE preservesFeasibility');
    runWithFlags({ disablePreserves: false, disableLookAhead: true, disableDistinctDay: false }, 'DISABLE Look-Ahead Pruning');
    runWithFlags({ disablePreserves: false, disableLookAhead: false, disableDistinctDay: true }, 'DISABLE Distinct-Day Pruning');
  } catch (e) {
    console.error(e);
  } finally {
    process.exit(0);
  }
}
main();
