'use strict';

/**
 * routineLoader — fetches a single batch's data from MySQL and shapes
 * it into the exact input shape that `scheduler.solve` expects.
 *
 * Loader output (the `solve` input contract):
 *   {
 *     config:   { working_days, class_start, class_end, break_start,
 *                 break_end, duration_minutes },
 *     courses:  [ { course_code, course_name, teacher_abbr, year_sem,
 *                   derived_type, derived_duration_min,
 *                   derived_classes_per_week, year_group } ],
 *     rooms:    [ { room_id, room_name, type } ],
 *     room_preference:        [ { room_id, year_group, weight_percent } ],
 *     day_preference:         [ { day, class_type, weight_percent } ],  // NEW
 *     year_sem_map:           { year_sem: group_code }                  // NEW
 *     teacher_unavailability: [ { teacher_abbr, day, start_time, end_time } ],
 *   }
 *
 * HC-6: Only courses whose year_sem maps to an active Year_Sem row are
 * returned. Inactive-semester courses are already excluded at upload
 * time (not inserted into the `courses` table), but the loader adds a
 * defensive guard that re-checks against the year_sem table in case
 * is_active was updated after upload.
 */

const { getPool } = require('../db/pool');

function deriveDurationMinutes() {
  // Always partition the day into uniform 50-minute blocks.
  // Lab sessions span multiple consecutive 50-minute blocks.
  return 50;
}

class LoadError extends Error {
  constructor(message, code, details) {
    super(message);
    this.name = 'LoadError';
    this.code = code;
    this.details = details || null;
  }
}

async function loadBatchForSchedule(batchId, conn) {
  const exec = conn || getPool();

  // ── Batch status check ────────────────────────────────────────────
  const [batchRows] = await exec.query(
    'SELECT id, filename, semester, status FROM upload_batches WHERE id = ?',
    [batchId]
  );
  if (batchRows.length === 0) {
    throw new LoadError(`No upload batch with id ${batchId}`, 'BATCH_NOT_FOUND', { batchId });
  }
  const batch = batchRows[0];
  if (batch.status !== 'completed') {
    throw new LoadError(
      `Batch ${batchId} is in status "${batch.status}" — only "completed" batches can be scheduled`,
      'BATCH_NOT_READY',
      { batchId, status: batch.status }
    );
  }

  // ── Config ───────────────────────────────────────────────────────
  const [configRows] = await exec.query(
    'SELECT `key`, `value` FROM config WHERE upload_batch_id = ?',
    [batchId]
  );
  const configRaw = {};
  for (const row of configRows) configRaw[String(row.key).trim()] = row.value;

  const requiredConfigKeys = ['working_days', 'class_start', 'class_end', 'break_start', 'break_end'];
  const missingConfig = requiredConfigKeys.filter((k) => !configRaw[k]);
  if (missingConfig.length > 0) {
    throw new LoadError(
      `Batch ${batchId} config is missing required keys: ${missingConfig.join(', ')}`,
      'CONFIG_INCOMPLETE',
      { batchId, missing: missingConfig }
    );
  }

  // ── Year_Sem — active lookup (HC-6) ──────────────────────────────
  // Load ALL year_sem rows so we can: (a) build the group_code map,
  // (b) filter which year_sems are currently active for scheduling.
  const [yearSemRows] = await exec.query(
    `SELECT year_sem, year, semester, group_code, is_active
     FROM year_sem WHERE upload_batch_id = ?`,
    [batchId]
  );

  // year_sem → group_code map (used to resolve room-preference keys).
  const yearSemMap = {};
  const activeYearSemSet = new Set();
  for (const ys of yearSemRows) {
    yearSemMap[ys.year_sem] = ys.group_code;
    if (Number(ys.is_active) === 1) {
      activeYearSemSet.add(ys.year_sem);
    }
  }

  // ── Courses — active year_sems only ──────────────────────────────
  const [courseRows] = await exec.query(
    `SELECT course_code, course_name, teacher_abbr, year_sem,
            derived_type, derived_duration_min, derived_classes_per_week
     FROM courses WHERE upload_batch_id = ? ORDER BY id`,
    [batchId]
  );
  if (courseRows.length === 0) {
    throw new LoadError(
      `Batch ${batchId} has no courses — cannot generate a schedule`,
      'NO_COURSES',
      { batchId }
    );
  }

  // Defensive HC-6 filter: skip any course whose year_sem is no longer
  // active (covers the edge case where is_active was changed post-upload).
  const activeCourses = courseRows
    .filter(c => {
      // If year_sem table has no rows, fall through without filtering.
      if (yearSemRows.length === 0) return true;
      return activeYearSemSet.has(c.year_sem);
    })
    .map(c => ({
      ...c,
      // Attach year_group directly so the scheduler can look up room
      // preferences without re-parsing year_sem strings.
      year_group: yearSemMap[c.year_sem] || null,
    }));

  if (activeCourses.length === 0) {
    throw new LoadError(
      `Batch ${batchId} has no courses in active year_sems — cannot generate a schedule. ` +
      `Active year_sems: [${[...activeYearSemSet].join(', ')}]`,
      'NO_ACTIVE_COURSES',
      { batchId, active_year_sems: [...activeYearSemSet] }
    );
  }

  // ── Rooms ─────────────────────────────────────────────────────────
  const [roomRows] = await exec.query(
    'SELECT room_id, room_name, type FROM rooms WHERE upload_batch_id = ? ORDER BY room_id',
    [batchId]
  );

  // ── Room_Preference ───────────────────────────────────────────────
  const [prefRows] = await exec.query(
    'SELECT room_id, year_group, weight_percent FROM room_preference WHERE upload_batch_id = ?',
    [batchId]
  );

  // ── Day_Preference (NEW) ──────────────────────────────────────────
  const [dayPrefRows] = await exec.query(
    'SELECT day, class_type, weight_percent FROM day_preference WHERE upload_batch_id = ?',
    [batchId]
  );

  // ── Teacher_Unavailability ─────────────────────────────────────────
  const [unavailRows] = await exec.query(
    `SELECT teacher_abbr, day,
            TIME_FORMAT(start_time, '%H:%i') AS start_time,
            TIME_FORMAT(end_time,   '%H:%i') AS end_time
     FROM teacher_unavailability WHERE upload_batch_id = ?`,
    [batchId]
  );

  const config = {
    working_days:     String(configRaw.working_days).trim(),
    class_start:      String(configRaw.class_start).trim(),
    class_end:        String(configRaw.class_end).trim(),
    break_start:      String(configRaw.break_start).trim(),
    break_end:        String(configRaw.break_end).trim(),
    duration_minutes: deriveDurationMinutes(),
  };

  return {
    batch,
    config,
    courses:                activeCourses,
    rooms:                  roomRows,
    room_preference:        prefRows,
    day_preference:         dayPrefRows,   // NEW — for scheduler day bias
    year_sem_map:           yearSemMap,    // NEW — year_sem → group_code
    teacher_unavailability: unavailRows,
  };
}

module.exports = { loadBatchForSchedule, LoadError, deriveDurationMinutes };