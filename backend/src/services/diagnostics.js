'use strict';

/**
 * diagnostics.js — compute a rich, structured view of a scheduling
 * infeasibility so the admin (and the AI layer) can see WHY the
 * solver gave up, not just WHICH courses were left over.
 *
 * The scheduler's own SchedulingError carries only:
 *   { message, details: { unplaceable: [course_code, ...] } }
 *
 * That's not enough to tell a human (or an LLM) the difference
 * between "this one course has bad credit data" and "there are
 * literally not enough lab rooms in the building to fit 16 sessions
 * of 4-hour labs in a 5-day week". This module computes the
 * capacity-vs-demand picture per (room_type, duration) so the
 * answer can be a single number-driven sentence.
 *
 * Public API:
 *   buildDiagnostics(input, unplaceableCourseCodes) -> object
 *
 *   input                      — the same object passed to solve():
 *                                { config, courses, rooms,
 *                                  room_preference, teacher_unavailability }
 *   unplaceableCourseCodes     — array of course_code strings the
 *                                solver flagged (from err.details.unplaceable)
 *
 * Return shape:
 *   {
 *     unplaceable_courses: [
 *       { course_code, teacher_abbr, year_sem, derived_type,
 *         derived_duration_min, derived_classes_per_week },
 *       ...
 *     ],
 *     capacity_by_type: [
 *       {
 *         type: 'lab' | 'theory' | ...,
 *         duration_minutes: <int>,
 *         total_rooms_of_type: <int>,
 *         slots_per_room_per_day: <int>,    // daily capacity per room
 *         working_days: <int>,
 *         max_weekly_capacity: <int>,       // rooms * slots/day * days
 *         total_sessions_demanded: <int>,   // sum of classes/week for
 *                                           //   every course of this
 *                                           //   (type, duration) combo
 *       },
 *       ...
 *     ],
 *     teacher_load: [
 *       { teacher_abbr, total_weekly_sessions,
 *         total_unavailable_minutes_per_week },
 *       ...
 *     ]
 *   }
 *
 * This module is PURE — no DB, no network. Safe to call from inside
 * a route handler without touching transaction state.
 */

const { parseTime } = require('./scheduler');
const { requiredRoomType } = require('./roomSelector');

/**
 * How many discrete `durationMinutes`-sized slots fit in the daily
 * window [class_start, class_end) excluding the break [break_start,
 * break_end). Mirrors the algorithm in buildAvailableWindows so the
 * numbers here match what the solver actually considered.
 *
 * @returns {number} count of slots per room per day
 */
function countSlotsPerDay(config, durationMinutes) {
  const cs = parseTime(config.class_start);
  const ce = parseTime(config.class_end);
  const bs = parseTime(config.break_start);
  const be = parseTime(config.break_end);
  if (!(cs < bs && bs < be && be < ce)) return 0;
  const d = Number(durationMinutes);
  if (!Number.isInteger(d) || d <= 0) return 0;

  let count = 0;
  // First half — before break.
  for (let t = cs; t + d <= bs; t += d) count += 1;
  // Second half — after break.
  for (let t = be; t + d <= ce; t += d) count += 1;
  return count;
}

/**
 * Sum minutes-per-week a teacher is unavailable across all of their
 * declared windows. Treats each row's (end - start) as the busy
 * duration. Used so the AI can flag teachers whose stated
 * unavailability already consumes a lot of their nominal capacity.
 */
function sumUnavailableMinutesPerWeek(teacherUnavailability, teacherAbbr) {
  if (!Array.isArray(teacherUnavailability)) return 0;
  let total = 0;
  const key = String(teacherAbbr);
  for (const row of teacherUnavailability) {
    if (String(row.teacher_abbr) !== key) continue;
    const s = parseTime(row.start_time);
    const e = parseTime(row.end_time);
    if (Number.isFinite(s) && Number.isFinite(e) && e > s) total += e - s;
  }
  return total;
}

/**
 * Group courses by (derived_type, derived_duration_min) and count
 * their derived_classes_per_week. Excludes courses with missing /
 * non-numeric derived fields — those would have been filtered out
 * by the loader anyway, but we stay defensive.
 */
function groupByTypeDuration(courses) {
  const buckets = new Map();
  for (const c of courses || []) {
    const type = c.derived_type;
    const dur = c.derived_duration_min;
    const cpw = c.derived_classes_per_week;
    if (!type || !Number.isInteger(dur) || !Number.isInteger(cpw) || cpw <= 0) continue;
    const key = `${type}|${dur}`;
    const bucket = buckets.get(key) || { type, duration_minutes: dur, total_sessions_demanded: 0 };
    bucket.total_sessions_demanded += cpw;
    buckets.set(key, bucket);
  }
  return Array.from(buckets.values());
}

/**
 * Build the diagnostics payload. Safe to call with empty/missing
 * input fields — returns a structurally-valid object with zeros
 * instead of throwing, so the route can always include it.
 */
function buildDiagnostics(input, unplaceableCourseCodes) {
  const cfg = (input && input.config) || {};
  const courses = (input && input.courses) || [];
  const rooms = (input && input.rooms) || [];
  const teacherUnavailability = (input && input.teacher_unavailability) || [];

  const workingDays = String(cfg.working_days || '')
    .split(',')
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean).length;

  // 1. Per-(type, duration) capacity vs demand.
  const grouped = groupByTypeDuration(courses);
  const capacity_by_type = grouped.map((g) => {
    // Apply the same derived_type -> room.type mapping the solver
    // uses (see roomSelector.requiredRoomType). Otherwise a
    // derived_type="theory" row would never match a
    // room.type="classroom" row and total_rooms_of_type would
    // always be 0.
    const need = requiredRoomType(g.type);
    const total_rooms_of_type = need
      ? rooms.filter((r) => String(r.type) === String(need)).length
      : 0;
    const slots_per_room_per_day = countSlotsPerDay(cfg, g.duration_minutes);
    const max_weekly_capacity =
      total_rooms_of_type * slots_per_room_per_day * workingDays;
    return {
      type: g.type,
      duration_minutes: g.duration_minutes,
      total_rooms_of_type,
      slots_per_room_per_day,
      working_days: workingDays,
      max_weekly_capacity,
      total_sessions_demanded: g.total_sessions_demanded,
    };
  });

  // 2. Detail rows for every unplaceable course so the AI can name
  //    them by code AND give their type/duration.
  const codeSet = new Set((unplaceableCourseCodes || []).map(String));
  const unplaceable_courses = courses
    .filter((c) => codeSet.has(String(c.course_code)))
    .map((c) => ({
      course_code: String(c.course_code),
      teacher_abbr: c.teacher_abbr != null ? String(c.teacher_abbr) : null,
      year_sem: c.year_sem != null ? String(c.year_sem) : null,
      derived_type: c.derived_type || null,
      derived_duration_min: Number.isInteger(c.derived_duration_min)
        ? c.derived_duration_min : null,
      derived_classes_per_week: Number.isInteger(c.derived_classes_per_week)
        ? c.derived_classes_per_week : null,
    }));

  // 3. Teacher load, but only for teachers of unplaceable courses.
  //    Otherwise we'd dump every teacher's data into the prompt.
  const teacherAbbrs = new Set(
    unplaceable_courses
      .map((c) => c.teacher_abbr)
      .filter((x) => x !== null && x !== undefined && x !== '')
  );
  const teacher_load = [];
  for (const t of teacherAbbrs) {
    const total_weekly_sessions = courses
      .filter((c) => String(c.teacher_abbr) === t)
      .reduce((sum, c) => sum + (Number(c.derived_classes_per_week) || 0), 0);
    teacher_load.push({
      teacher_abbr: t,
      total_weekly_sessions,
      total_unavailable_minutes_per_week:
        sumUnavailableMinutesPerWeek(teacherUnavailability, t),
    });
  }
  // Stable order: by teacher_abbr ascending so prompt diffs are
  // deterministic across runs.
  teacher_load.sort((a, b) =>
    a.teacher_abbr < b.teacher_abbr ? -1 : a.teacher_abbr > b.teacher_abbr ? 1 : 0
  );

  return {
    unplaceable_courses,
    capacity_by_type,
    teacher_load,
  };
}

module.exports = {
  buildDiagnostics,
  // exposed for tests:
  countSlotsPerDay,
  sumUnavailableMinutesPerWeek,
  groupByTypeDuration,
};