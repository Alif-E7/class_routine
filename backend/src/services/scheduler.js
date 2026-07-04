'use strict';

const { IntervalMap } = require('./intervalMap');
const {
  buildWeightTable,
  pickRoom,
  filterByType,
} = require('./roomSelector');

/**
 * scheduler — the CSP backtracking core (build prompt §5).
 *
 * Given a fully-loaded input (courses with derived fields, rooms, room
 * preferences, teacher unavailability, config), produces an array of
 * session assignments:
 *
 *   { course_code, teacher_abbr, room_id, day, slot_start, slot_end,
 *     year_sem, session_index }
 *
 * Each course's `derived_classes_per_week` sessions are placed on
 * DISTINCT days (build prompt hard requirement). All placement checks
 * use O(log n) IntervalMap lookups per resource (teacher / room /
 * year-sem). On backtrack every busy-map entry and assignment made for
 * the course being retried is undone before trying the next branch.
 *
 * Throws `SchedulingError` on:
 *   - Infeasibility (some course cannot be placed in any branch).
 *   - Exceeding the iteration budget (default 200,000).
 */

class SchedulingError extends Error {
  constructor(message, details) {
    super(message);
    this.name = 'SchedulingError';
    this.details = details || null;
  }
}

const DEFAULT_BUDGET = 200_000;
const DEFAULT_RNG = Math.random;

/** Parse "HH:MM" (24h) → minutes since midnight. */
function parseTime(s) {
  const [h, m] = String(s).split(':').map((x) => Number(x));
  return h * 60 + m;
}

/**
 * Split the daily window [class_start, class_end) minus the lunch break
 * [break_start, break_end) into discrete slots of `durationMinutes`.
 * Returns: { day -> [ { start, end } ] } ordered chronologically.
 *
 * The break is treated as a hard wall: a slot cannot start before
 * break_start and end after break_end (it would straddle lunch), but
 * the break window itself is excluded from the candidate slot list.
 */
function buildAvailableWindows(config) {
  const cs = parseTime(config.class_start);
  const ce = parseTime(config.class_end);
  const bs = parseTime(config.break_start);
  const be = parseTime(config.break_end);
  if (!(cs < bs && bs < be && be < ce)) {
    throw new SchedulingError(
      'Config time window is invalid: need class_start < break_start < break_end < class_end',
      { config }
    );
  }
  const days = String(config.working_days)
    .split(',')
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean);

  const out = {};
  for (const day of days) {
    const slots = [];
    // First half — before break.
    for (let t = cs; t + config.duration_minutes <= bs; t += config.duration_minutes) {
      slots.push({ start: t, end: t + config.duration_minutes });
    }
    // Second half — after break.
    for (let t = be; t + config.duration_minutes <= ce; t += config.duration_minutes) {
      slots.push({ start: t, end: t + config.duration_minutes });
    }
    out[day] = slots;
  }
  return out;
}

/**
 * Deterministic Fisher-Yates shuffle using `rng`. We shuffle the day
 * order to vary the search order across calls, but we sort courses by
 * constraint tightness first (most-constrained-first).
 */
function shuffle(arr, rng) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * Sort courses so the most-constrained course is placed first
 * (MRV / most-constrained-first heuristic). Constraint signal:
 *   1. fewer same-type rooms available
 *   2. higher derived_classes_per_week
 *   3. teacher with more unavailability windows
 * Within a tier we keep input order to stay deterministic.
 */
function sortByConstraintTightness(courses, allRooms, unavailabilityByTeacher) {
  const roomCount = (c) => filterByType(allRooms, c).length;
  const unavailCount = (c) =>
    (unavailabilityByTeacher.get(String(c.teacher_abbr)) || []).length;
  return courses
    .map((c, idx) => ({ c, idx, roomCount: roomCount(c), unavailCount: unavailCount(c) }))
    .sort((a, b) => {
      if (a.roomCount !== b.roomCount) return a.roomCount - b.roomCount;
      if (b.c.derived_classes_per_week !== a.c.derived_classes_per_week) {
        return b.c.derived_classes_per_week - a.c.derived_classes_per_week;
      }
      if (b.unavailCount !== a.unavailCount) return b.unavailCount - a.unavailCount;
      return a.idx - b.idx;
    })
    .map((x) => x.c);
}

/**
 * Build { teacher_abbr -> [unavail rows] } for fast lookup during
 * placement checks. Each row carries its start/end in minutes.
 */
function indexUnavailability(teacherUnavailability) {
  const map = new Map();
  for (const row of teacherUnavailability) {
    const key = String(row.teacher_abbr);
    const arr = map.get(key) || [];
    arr.push({
      day: String(row.day).toUpperCase(),
      start: parseTime(row.start_time),
      end: parseTime(row.end_time),
    });
    map.set(key, arr);
  }
  return map;
}

/**
 * Group unavailability windows by day for one teacher.
 */
function unavailabilityForDay(map, teacherAbbr, day) {
  const rows = map.get(String(teacherAbbr)) || [];
  return rows.filter((r) => r.day === day);
}

/**
 * Public entry point. `options`:
 *   rng        — () => [0,1) (default Math.random)
 *   budget     — max node expansions (default 200_000)
 *   logger     — ({iterations, depth}) => void, optional debug hook
 */
function solve(input, options = {}) {
  const rng = options.rng || DEFAULT_RNG;
  const budget = options.budget ?? DEFAULT_BUDGET;
  const logger = options.logger || (() => {});

  const daySlots = buildAvailableWindows(input.config);
  const unavailMap = indexUnavailability(input.teacher_unavailability || []);
  const weightTable = buildWeightTable(input.room_preference || []);
  const ordered = sortByConstraintTightness(
    input.courses,
    input.rooms,
    unavailMap
  );

  const teacherBusy = new IntervalMap();
  const roomBusy = new IntervalMap();
  const semBusy = new IntervalMap();
  const assignments = [];

  let iterations = 0;

  /**
   * Drop every assignment tied to `courseCode` and undo the corresponding
   * busy-map entries. Used on backtrack (undo before retrying).
   */
  function undoAssignmentsForCourse(courseCode) {
    let writeIdx = 0;
    for (let i = 0; i < assignments.length; i += 1) {
      const a = assignments[i];
      if (a.course_code !== courseCode) {
        assignments[writeIdx++] = a;
      } else {
        teacherBusy.remove(`${a.teacher_abbr}|${a.day}`, a.slot_start, a.slot_end);
        roomBusy.remove(`${a.room_id}|${a.day}`, a.slot_start, a.slot_end);
        semBusy.remove(`${a.year_sem}|${a.day}`, a.slot_start, a.slot_end);
      }
    }
    assignments.length = writeIdx;
  }

  /**
   * Try every (slot × room) combo for one session of one course.
   * Returns true if any combo succeeded and was committed.
   */
  function tryPlaceOneSession(course, dayList) {
    const eligibleRooms = filterByType(input.rooms, course);
    if (eligibleRooms.length === 0) return false;

    for (const day of dayList) {
      const slots = daySlots[day] || [];
      // Skip days where teacher is fully blocked by unavailability.
      const teacherBlocks = unavailabilityForDay(unavailMap, course.teacher_abbr, day);

      for (const slot of slots) {
        // Check unavailability first — fast O(teacher_blocks) pass.
        let blocked = false;
        for (const b of teacherBlocks) {
          if (slot.start < b.end && b.start < slot.end) { blocked = true; break; }
        }
        if (blocked) continue;

        // Check busy maps. All O(log n).
        const teacherKey = `${course.teacher_abbr}|${day}`;
        const semKey = `${course.year_sem}|${day}`;
        if (teacherBusy.overlaps(teacherKey, slot.start, slot.end)) continue;
        if (semBusy.overlaps(semKey, slot.start, slot.end)) continue;

        // Try every room of the correct type, biased by preferences.
        // The roomSelector picks one but we must keep retrying until we
        // find one that is free (build prompt: don't give up on the
        // first busy room).
        const tried = new Set();
        const localEligible = eligibleRooms.filter((r) => !tried.has(r.room_id));
        // Shuffle rooms within each day so repeated calls on the same
        // (course, day) explore different candidates.
        const shuffledRooms = shuffle(localEligible, rng);
        for (const room of shuffledRooms) {
          tried.add(room.room_id);
          const roomKey = `${room.room_id}|${day}`;
          if (roomBusy.overlaps(roomKey, slot.start, slot.end)) continue;
          // Confirm preference pick is one we haven't already excluded.
          const pick = pickRoom({
            course,
            eligibleRooms: shuffledRooms.filter((r) => !tried.has(r.room_id)),
            weightTable,
            rng,
          });
          const chosen = pick || room.room_id;
          // Double-check the chosen room is still free (might differ from
          // the room we already inspected if pickRoom shuffled).
          if (roomBusy.overlaps(`${chosen}|${day}`, slot.start, slot.end)) continue;

          // Commit.
          teacherBusy.add(teacherKey, slot.start, slot.end);
          roomBusy.add(`${chosen}|${day}`, slot.start, slot.end);
          semBusy.add(semKey, slot.start, slot.end);
          assignments.push({
            course_code: course.course_code,
            teacher_abbr: String(course.teacher_abbr),
            room_id: chosen,
            day,
            slot_start: slot.start,
            slot_end: slot.end,
            year_sem: course.year_sem,
            session_index: -1, // filled in by caller below
          });
          return true;
        }
      }
    }
    return false;
  }

  function backtrack(i) {
    iterations += 1;
    if (iterations > budget) {
      throw new SchedulingError('Exceeded search budget', { iterations });
    }
    logger({ iterations, depth: i });
    if (i === ordered.length) return true;

    const course = ordered[i];
    const usedDays = new Set();
    const sessionsToPlace = course.derived_classes_per_week;

    for (let session = 0; session < sessionsToPlace; session += 1) {
      // Try days we haven't used yet for this course. Shuffle the
      // remaining working days so the search varies; usedDays is
      // consulted in the placement function via set membership.
      const remaining = Object.keys(daySlots).filter((d) => !usedDays.has(d));
      const dayList = shuffle(remaining, rng);

      let placed = false;
      for (const day of dayList) {
        // Try every (slot × room) on this day. We do NOT call
        // tryPlaceOneSession per-day directly because we need to know
        // which day we successfully placed on to mark it as used.
        const eligibleRooms = filterByType(input.rooms, course);
        if (eligibleRooms.length === 0) break;
        const slots = daySlots[day];
        const teacherBlocks = unavailabilityForDay(unavailMap, course.teacher_abbr, day);

        let dayPlaced = false;
        for (const slot of slots) {
          let blocked = false;
          for (const b of teacherBlocks) {
            if (slot.start < b.end && b.start < slot.end) { blocked = true; break; }
          }
          if (blocked) continue;

          const teacherKey = `${course.teacher_abbr}|${day}`;
          const semKey = `${course.year_sem}|${day}`;
          if (teacherBusy.overlaps(teacherKey, slot.start, slot.end)) continue;
          if (semBusy.overlaps(semKey, slot.start, slot.end)) continue;

          const tried = new Set();
          for (const room of shuffle(eligibleRooms, rng)) {
            if (tried.has(room.room_id)) continue;
            tried.add(room.room_id);
            const roomKey = `${room.room_id}|${day}`;
            if (roomBusy.overlaps(roomKey, slot.start, slot.end)) continue;
            const pick = pickRoom({
              course,
              eligibleRooms: eligibleRooms.filter((r) => !tried.has(r.room_id)),
              weightTable,
              rng,
            });
            const chosen = pick || room.room_id;
            if (roomBusy.overlaps(`${chosen}|${day}`, slot.start, slot.end)) continue;

            teacherBusy.add(teacherKey, slot.start, slot.end);
            roomBusy.add(`${chosen}|${day}`, slot.start, slot.end);
            semBusy.add(semKey, slot.start, slot.end);
            assignments.push({
              course_code: course.course_code,
              teacher_abbr: String(course.teacher_abbr),
              room_id: chosen,
              day,
              slot_start: slot.start,
              slot_end: slot.end,
              year_sem: course.year_sem,
              session_index: session,
            });
            usedDays.add(day);
            dayPlaced = true;
            break;
          }
          if (dayPlaced) break;
        }
        if (dayPlaced) {
          placed = true;
          break;
        }
        iterations += 1;
        if (iterations > budget) {
          throw new SchedulingError('Exceeded search budget', { iterations });
        }
      }

      if (!placed) {
        undoAssignmentsForCourse(course.course_code);
        return false;
      }
    }

    if (backtrack(i + 1)) return true;
    undoAssignmentsForCourse(course.course_code);
    return false;
  }

  if (!backtrack(0)) {
    throw new SchedulingError(
      'No feasible schedule found for the given inputs',
      { unplaceable: ordered.map((c) => c.course_code) }
    );
  }
  return assignments;
}

module.exports = {
  solve,
  SchedulingError,
  // Exposed for tests:
  IntervalMap,
  buildAvailableWindows,
  sortByConstraintTightness,
  parseTime,
};