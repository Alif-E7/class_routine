'use strict';

/**
 * schedule.js — POST /api/batches/:id/generate
 *
 * Per build prompt §3.4:
 *   1. Load all data for the given batch from MySQL.
 *   2. Run scheduler.solve.
 *   3. On success: bulk-insert into `schedules` inside one transaction.
 *      The three UNIQUE KEYs on `schedules` are a second line of defense —
 *      if a race condition or solver bug ever produces a collision, the
 *      INSERT fails loudly instead of silently corrupting data.
 *   4. On failure (infeasible): do NOT insert anything. Return a
 *      structured error describing which course(s) couldn't be placed
 *      and why. Optionally call `aiProvider.js` to enrich the message
 *      with a friendly admin hint (advisory text only — never alters DB).
 *
 * Response shapes:
 *   Success (200):
 *     {
 *       success: true,
 *       code: 'SCHEDULE_OK',
 *       batch_id: <int>,
 *       assignments_count: <int>,
 *       assignments: [
 *         { course_code, teacher_abbr, room_id, day,
 *           slot_start, slot_end, year_sem, session_index }, ...
 *       ],
 *     }
 *
 *   Failure (422):
 *     {
 *       success: false,
 *       code: 'SCHEDULE_INFEASIBLE',
 *       message: <human readable>,
 *       unplaceable: [<course_code>, ...],   // actually-attempted, but failed
 *       not_attempted: [<course_code>, ...], // never reached (empty if
 *                                            //   every course was tried)
 *       details: {...},
 *       diagnostics: {
 *         unplaceable_courses: [...],
 *         capacity_by_type:    [...],  // per (type, duration) capacity vs demand
 *         teacher_load:        [...],  // only for unplaceable-course teachers
 *       },
 *       friendly_hint: <string|null>,   // optional, only if aiProvider ran
 *     }
 *
 *   Missing batch (404):
 *     { success: false, code: 'BATCH_NOT_FOUND', message: '...' }
 *
 *   Batch not ready (409):
 *     { success: false, code: 'BATCH_NOT_READY', message: '...',
 *       status: 'processing' | 'failed' | 'needs_review' }
 *
 *   Bad input (400): id not an integer, etc.
 */

const express = require('express');
const router = express.Router({ mergeParams: true });

const { withTransaction, getPool } = require('../db/pool');
const { loadBatchForSchedule, LoadError } = require('../services/routineLoader');
const { solve, SchedulingError, formatTime, normalizeSlotValue } = require('../services/scheduler');
const { explainFailure } = require('../services/aiProvider');
const { buildDiagnostics } = require('../services/diagnostics');

// 10-minute ceiling per the build prompt's "long-running" callout.
const SOLVE_BUDGET_DEFAULT = parseInt(process.env.SCHEDULER_BUDGET || '', 10) || 200_000;
// Hard cap on any per-request override so callers can't ask for a
// runaway search. 10M is well above what any sane real dataset needs.
const SOLVE_BUDGET_MAX = 10_000_000;

router.post('/:id/generate', async (req, res, next) => {
  const batchId = Number.parseInt(req.params.id, 10);
  if (!Number.isInteger(batchId) || batchId <= 0) {
    return res.status(400).json({
      success: false,
      code: 'INVALID_BATCH_ID',
      message: 'batch id must be a positive integer',
    });
  }

  // Optional deterministic seed for re-runs from the admin UI. Lets the
  // admin click "try a different RNG" without re-uploading data.
  const seedRaw = req.body && req.body.seed;
  let rng = Math.random;
  if (seedRaw !== undefined && seedRaw !== null) {
    const seed = Number(seedRaw);
    if (!Number.isFinite(seed)) {
      return res.status(400).json({
        success: false,
        code: 'INVALID_SEED',
        message: 'seed must be a finite number',
      });
    }
    let s = (seed >>> 0) || 1;
    rng = () => {
      s = (s * 1664525 + 1013904223) >>> 0;
      return s / 0x100000000;
    };
  }

  // Optional per-request budget override. Bounded above by
  // SOLVE_BUDGET_MAX so the API can't be coerced into a runaway
  // search. Falls back to SCHEDULER_BUDGET (or 200k).
  let requestBudget = SOLVE_BUDGET_DEFAULT;
  const budgetRaw = req.body && req.body.budget;
  if (budgetRaw !== undefined && budgetRaw !== null) {
    // Accept either a JSON number OR a string of digits. Reject
    // booleans, floats, negatives, NaN, arrays, objects, etc. — the
    // goal is to forbid accidental / hostile inputs from sending the
    // solver into a degenerate state. Math.min with the cap happens
    // AFTER validation so the cap can't hide a bad value.
    let parsed;
    if (typeof budgetRaw === 'number') {
      parsed = budgetRaw;
    } else if (typeof budgetRaw === 'string' && /^[1-9]\d*$/.test(budgetRaw)) {
      parsed = parseInt(budgetRaw, 10);
    } else {
      parsed = NaN;
    }
    if (!Number.isInteger(parsed) || parsed < 1) {
      return res.status(400).json({
        success: false,
        code: 'INVALID_BUDGET',
        message: 'budget must be a positive integer',
      });
    }
    requestBudget = Math.min(parsed, SOLVE_BUDGET_MAX);
  }

  try {
    // 1. Load everything for this batch.
    const loaded = await loadBatchForSchedule(batchId);

    // 2. Solve.
    let assignments;
    try {
      assignments = solve(
        {
          config: loaded.config,
          courses: loaded.courses,
          rooms: loaded.rooms,
          room_preference: loaded.room_preference,
          teacher_unavailability: loaded.teacher_unavailability,
        },
        {
          rng,
          budget: requestBudget,
        }
      );
    } catch (err) {
      // Infeasibility / budget overrun. Per spec: do NOT insert
      // anything; return structured error. Optionally enrich with an
      // AI-generated friendly hint (advisory only).
      if (err instanceof SchedulingError) {
        // Compute capacity-vs-demand diagnostics BEFORE returning so
        // the client (and the AI layer) can see WHY the solver gave
        // up, not just which courses were left over. The diagnostics
        // itself is pure, non-throwing, and does not touch the DB.
        const unplaceableCodes = (err.details && err.details.unplaceable) || [];
        // `not_attempted` only exists when the scheduler can tell
        // the difference between "tried and failed" and "never
        // reached because an earlier course failed". Older callers
        // of solve() (tests) still get the unplaceable-only shape,
        // so this is optional.
        const notAttemptedCodes = (err.details && err.details.not_attempted) || [];
        const diagnostics = buildDiagnostics(
          {
            config: loaded.config,
            courses: loaded.courses,
            rooms: loaded.rooms,
            room_preference: loaded.room_preference,
            teacher_unavailability: loaded.teacher_unavailability,
          },
          unplaceableCodes
        );

        const baseBody = {
          success: false,
          code: err.code || 'SCHEDULE_INFEASIBLE',
          message: err.message,
          unplaceable: unplaceableCodes || null,
          not_attempted: notAttemptedCodes,
          details: err.details || null,
          diagnostics,
        };
        // Map a couple of specific failures to more helpful codes.
        if (err.message && err.message.includes('budget')) {
          baseBody.code = 'SCHEDULE_BUDGET_EXCEEDED';
        }
        let hint = null;
        try {
          const aiResult = await explainFailure(err, { diagnostics });
          if (aiResult && aiResult.friendly_hint) hint = aiResult.friendly_hint;
          if (aiResult && aiResult.available === false) {
            // No AI configured — that's fine, the structured error
            // is still the source of truth.
          }
        } catch (_aiErr) {
          // AI enrichment must NEVER fail the request — fall through
          // with hint = null.
        }
        baseBody.friendly_hint = hint;
        return res.status(422).json(baseBody);
      }
      throw err;
    }

    // 3. Persist. Single transaction: delete any prior schedules for
    // this batch, then bulk insert the new ones. The schedules table
    // has 3 UNIQUE KEYs that will scream if the solver ever produces
    // a collision despite the IntervalMap checks — a loud failure is
    // better than silent corruption.
    const result = await withTransaction(async (conn) => {
      await conn.query('DELETE FROM schedules WHERE batch_id = ?', [batchId]);

      const rows = assignments.map((a) => [
        batchId,
        a.course_code,
        a.teacher_abbr,
        a.room_id,
        a.day,
        // `schedules.slot_start` / `slot_end` are MySQL TIME columns.
        // MySQL rejects raw integer minutes (≥ 838) with
        // "Incorrect time value: '890'". Convert to zero-padded
        // "HH:MM" strings at the SQL boundary; the in-memory
        // `assignments` array still carries integer minutes so the
        // API response contract is unchanged.
        formatTime(a.slot_start),
        formatTime(a.slot_end),
        a.year_sem,
        a.session_index,
      ]);

      // mysql2 accepts a single multi-row INSERT — far cheaper than
      // one INSERT per assignment (28 calls vs 1).
      await conn.query(
        `INSERT INTO schedules
           (batch_id, course_code, teacher_abbr, room_id,
            day, slot_start, slot_end, year_sem, session_index)
         VALUES ?`,
        [rows]
      );

      // Stamp the batch as having a generated routine (status is
      // already 'completed' from the upload step; we leave it alone
      // so failed/partial runs don't overwrite the upload status).
      return { assignments_count: rows.length };
    });

    return res.status(200).json({
      success: true,
      code: 'SCHEDULE_OK',
      batch_id: batchId,
      assignments_count: result.assignments_count,
      assignments,
    });
  } catch (err) {
    if (err instanceof LoadError) {
      if (err.code === 'BATCH_NOT_FOUND') {
        return res.status(404).json({ success: false, code: err.code, message: err.message });
      }
      if (err.code === 'BATCH_NOT_READY') {
        return res.status(409).json({
          success: false,
          code: err.code,
          message: err.message,
          status: (err.details && err.details.status) || null,
        });
      }
      return res.status(422).json({
        success: false,
        code: err.code,
        message: err.message,
        details: err.details,
      });
    }
    next(err);
  }
});

// GET /api/batches/:id/schedule — read back the persisted routine.
// Useful for the History page and the test suite.
router.get('/:id/schedule', async (req, res, next) => {
  const batchId = Number.parseInt(req.params.id, 10);
  if (!Number.isInteger(batchId) || batchId <= 0) {
    return res.status(400).json({
      success: false,
      code: 'INVALID_BATCH_ID',
      message: 'batch id must be a positive integer',
    });
  }
  try {
    const [batchRows] = await getPool().query(
      'SELECT id FROM upload_batches WHERE id = ?', [batchId]
    );
    if (batchRows.length === 0) {
      return res.status(404).json({
        success: false, code: 'BATCH_NOT_FOUND',
        message: `No upload batch with id ${batchId}`,
      });
    }
    const [rows] = await getPool().query(
      `SELECT course_code, teacher_abbr, room_id, day,
              slot_start, slot_end, year_sem, session_index
       FROM schedules WHERE batch_id = ?
       ORDER BY year_sem, day, slot_start, course_code`,
      [batchId]
    );
    // mysql2 with `dateStrings: true` returns TIME columns as
    // 'HH:MM:SS' strings. Normalize back to integer minutes so the
    // API response shape matches the just-generated POST response
    // (which carries integer minutes from the solver).
    const normalized = rows.map((r) => ({
      ...r,
      slot_start: normalizeSlotValue(r.slot_start),
      slot_end: normalizeSlotValue(r.slot_end),
    }));
    return res.json({
      success: true,
      code: 'SCHEDULE_OK',
      batch_id: batchId,
      assignments_count: normalized.length,
      assignments: normalized,
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;