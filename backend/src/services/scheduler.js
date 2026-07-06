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
 * year-sem).
 *
 * ── Real backtracking, not one-shot greedy ────────────────────────────────
 * The earlier implementation committed the first (day, slot, room)
 * combo that fit one session, then on a downstream failure gave up
 * for the entire course. That is not backtracking. The current search
 * enumerates a per-session candidate list of (day, slot, room)
 * tuples, sorted MRV-first, tries each one in order, and on a
 * recursive miss undoes ONLY that tuple before trying the next. Only
 * when ALL tuples for a session are exhausted does the call retreat
 * to the previous session / course. This is what makes the solver
 * correct on tight fixtures where greedy first-pick dead-ends (e.g.
 * a precious room that a later course also needs).
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
 * `durationMinutes` is per-course (from courses.derived_duration_min),
 * not a Config column — Config only carries the global daily window
 * and break. We compute one slot map per distinct duration we see,
 * and cache it inside solve() via getDaySlots().
 *
 * The break is treated as a hard wall: a slot cannot start before
 * break_start and end after break_end (it would straddle lunch), but
 * the break window itself is excluded from the candidate slot list.
 */
function buildAvailableWindows(config, durationMinutes) {
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
  if (!Number.isInteger(durationMinutes) || durationMinutes <= 0) {
    throw new SchedulingError(
      'durationMinutes must be a positive integer',
      { durationMinutes }
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
    for (let t = cs; t + durationMinutes <= bs; t += durationMinutes) {
      slots.push({ start: t, end: t + durationMinutes });
    }
    // Second half — after break.
    for (let t = be; t + durationMinutes <= ce; t += durationMinutes) {
      slots.push({ start: t, end: t + durationMinutes });
    }
    out[day] = slots;
  }
  return out;
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

  // Per-duration slot cache. Different courses can have different
  // derived_duration_min (e.g. 50-minute theory vs 110-minute lab),
  // so we build the daily slot map once per distinct duration instead
  // of sharing one map across all courses.
  const daySlotsByDuration = new Map();
  function getDaySlots(duration) {
    if (!daySlotsByDuration.has(duration)) {
      daySlotsByDuration.set(duration, buildAvailableWindows(input.config, duration));
    }
    return daySlotsByDuration.get(duration);
  }
  // Cached working-day order (same for every duration — derived purely
  // from config.working_days) so we don't recompute the key list on
  // every backtrack frame. Per-course distinct-day filtering happens
  // during candidate enumeration.
  const workingDays = String(input.config.working_days)
    .split(',')
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean);
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

  // Failure diagnostics: populated at the moment we exhaust a
  // course's candidates so SchedulingError.details can distinguish
  // courses that actually failed placement (failing) from courses
  // the solver never reached because an earlier course failed
  // (not_attempted).
  const failingCourses = new Set();

  let iterations = 0;

  // ─────────────────────────────────────────────────────────────────────
  // Placement building blocks
  // ─────────────────────────────────────────────────────────────────────

  /**
   * True iff this (course, day, slot) triple is legal RIGHT NOW
   * respecting teacher unavailability + the three busy maps. Does NOT
   * consider room availability (that's per-candidate) or distinct-day
   * (the caller filters usedDays before calling).
   *
   * Pure read — no side effects. Called both during candidate
   * enumeration and inside commitOne (defensive double-check) so the
   * candidate list never contains stale tuples when a higher frame
   * releases a slot.
   */
  function slotIsFree(course, day, slot) {
    const blocks = unavailabilityForDay(unavailMap, course.teacher_abbr, day);
    for (const b of blocks) {
      if (slot.start < b.end && b.start < slot.end) return false;
    }
    if (teacherBusy.overlaps(`${course.teacher_abbr}|${day}`, slot.start, slot.end)) return false;
    if (semBusy.overlaps(`${course.year_sem}|${day}`, slot.start, slot.end)) return false;
    return true;
  }

  /**
   * Commit one (course, day, slot, room) tuple: mutate the three busy
   * maps + push the assignment row. Caller has already proven the
   * tuple's room is free via roomBusy.overlaps; we re-check defensively
   * and throw if it slipped past (programming error, not "infeasible").
   *
   * Returns the pushed assignment row so the caller can keep a
   * handle if it needs to undo later — though the actual undo path
   * uses `undoLastAssignment()` keyed on the global index.
   */
  function commitOne(course, day, slot, roomId, sessionIndex) {
    const teacherKey = `${course.teacher_abbr}|${day}`;
    const semKey = `${course.year_sem}|${day}`;
    const roomKey = `${roomId}|${day}`;
    if (roomBusy.overlaps(roomKey, slot.start, slot.end)) {
      // Defensive: should have been filtered during enumeration.
      throw new Error(
        `commitOne called on a busy room: ${roomKey} ${slot.start}-${slot.end}`
      );
    }
    teacherBusy.add(teacherKey, slot.start, slot.end);
    roomBusy.add(roomKey, slot.start, slot.end);
    semBusy.add(semKey, slot.start, slot.end);
    const row = {
      course_code: course.course_code,
      teacher_abbr: String(course.teacher_abbr),
      room_id: roomId,
      day,
      slot_start: slot.start,
      slot_end: slot.end,
      year_sem: course.year_sem,
      session_index: sessionIndex,
    };
    assignments.push(row);
    return row;
  }

  /**
   * Undo the most recently committed assignment (and ONLY that one).
   * Used to back out a single bad placement so the next candidate can
   * be tried without leaking state. Replaces the old
   * `undoAssignmentsForCourse` sweep approach for the per-session
   * backtrack path — course-level undo is still available for the
   * "course couldn't satisfy any session" failure mode (see
   * `popCourseAssignments`).
   */
  function undoLastAssignment() {
    const a = assignments.pop();
    if (!a) return;
    teacherBusy.remove(`${a.teacher_abbr}|${a.day}`, a.slot_start, a.slot_end);
    roomBusy.remove(`${a.room_id}|${a.day}`, a.slot_start, a.slot_end);
    semBusy.remove(`${a.year_sem}|${a.day}`, a.slot_start, a.slot_end);
  }

  /**
   * Pop ALL assignments belonging to `courseCode` off the global stack
   * and undo each busy-map entry. Used when a course cannot be placed
   * at all so we re-enter the search for the previous course without
   * any of `courseCode`'s partial state in the busy maps.
   */
  function popCourseAssignments(courseCode) {
    while (
      assignments.length > 0
      && assignments[assignments.length - 1].course_code === courseCode
    ) {
      undoLastAssignment();
    }
  }

  /**
   * Build the candidate list for one (course, usedDays) pair.
   *
   * Each candidate is a fully-resolved (day, slot, roomId) triple
   * the backtracker may try. The list is deterministic:
   *   1. days ranked by FEWEST legal slots first (MRV), tie-break
   *      by workingDays input order (so test fixtures stay stable).
   *   2. within each day, rooms preference-weighted descending,
   *      ties broken by room_id string.
   *   3. NO rng-driven reshuffle. Days and rooms are sorted once,
   *      in fixed order. The exact same candidate list is used for
   *      every retry of this (course, usedDays-fingerprint) pair;
   *      the backtracker just advances a pointer.
   *
   * Filtering rules applied during enumeration (NOT just at commit):
   *   - working days only
   *   - distinct-day: skip days in `usedDays`
   *   - room type: `filterByType(input.rooms, course)`
   *   - teacher's daily unavailability (per-slot overlap)
   *   - teacher / year-sem busy maps (so the candidate list never
   *     contains stale tuples that would fail the commit check)
   *
   * Note: room-busy is checked at commit time too (defensive
   * double-check) because another course may free a room between
   * enumeration and commit.
   */
  function enumerateCandidates(course, usedDays) {
    const slotsByDuration = getDaySlots(course.derived_duration_min);
    if (!slotsByDuration) return [];
    const eligibleRooms = filterByType(input.rooms, course);
    if (eligibleRooms.length === 0) return [];

    // Group (day, slot) pairs by day so we can rank days by how
    // constrained they are (MRV). A day with only 1 free slot is
    // tried before a day with 5.
    const perDay = new Map(); // day -> Array<{ slot, freeRoomIds }>
    for (const day of workingDays) {
      if (usedDays.has(day)) continue;
      const daySlots = slotsByDuration[day];
      if (!daySlots) continue;
      for (const slot of daySlots) {
        // Slot-level legality (teacher unavail + teacher busy + sem
        // busy). Room-level legality is decided per-candidate inside
        // the inner loop.
        if (!slotIsFree(course, day, slot)) continue;
        const freeRoomIds = [];
        for (const room of eligibleRooms) {
          const key = `${room.room_id}|${day}`;
          if (!roomBusy.overlaps(key, slot.start, slot.end)) {
            freeRoomIds.push(room.room_id);
          }
        }
        if (freeRoomIds.length === 0) continue;
        if (!perDay.has(day)) perDay.set(day, []);
        perDay.get(day).push({ slot, freeRoomIds });
      }
    }

    // Sort days by ascending slot count (MRV), tie-break by input
    // order of workingDays so the test fixtures stay deterministic.
    const days = [...perDay.keys()].sort((a, b) => {
      const diff = perDay.get(a).length - perDay.get(b).length;
      if (diff !== 0) return diff;
      return workingDays.indexOf(a) - workingDays.indexOf(b);
    });

    const out = [];
    for (const day of days) {
      const dayEntries = perDay.get(day);
      // For each slot on this day, pick the highest-weighted free
      // room (preference table) so the candidate list is ordered
      // by "best" room first within a day.
      for (const { slot, freeRoomIds } of dayEntries) {
        const ranked = rankRoomsByPreference(
          freeRoomIds,
          course,
          weightTable
        );
        for (const roomId of ranked) {
          out.push({ day, slot, roomId });
        }
      }
    }
    return out;
  }

  /**
   * Forward-checking / MRV pruning before commit.
   *
   * Simulates `course`'s pending placement on (day, slot, roomId)
   * by checking — for every OTHER not-yet-fully-placed course —
   * that AT LEAST ONE free (day, slot, room) tuple remains after
   * the simulated busy-map additions.
   *
   * Returns true iff committing this assignment would not
   * dead-end the rest of the schedule. False means "prune NOW,
   * don't even descend": the assignment is rejected here and the
   * backtracker tries the next candidate.
   *
   * Cheapness: we do NOT recursively enumerate candidates of the
   * other courses — we just ask, for each (otherCourse, day, slot)
   * pair NOT already in otherCourse.usedDays, whether at least one
   * eligible room is free in the simulated busy state, and whether
   * otherCourse needs any still-uncommitted slots at all.
   */
  function preservesFeasibility(course, day, slot, roomId) {
    for (const other of ordered) {
      if (other.course_code === course.course_code) continue;
      // Skip courses that this call's frame has already
      // fully placed — they have nothing left to schedule.
      const placedCount = coursePlacedCount.get(other.course_code) || 0;
      if (placedCount >= other.derived_classes_per_week) continue;
      const otherUsedDays = courseUsedDays.get(other.course_code);
      if (!otherUsedDays) continue;
      // Cheap feasibility probe: does at least one
      // (day, slot, room) triple exist for this course under
      // the simulated busy-map state?
      const slotsByDuration = getDaySlots(other.derived_duration_min);
      if (!slotsByDuration) return false;
      const eligibleRooms = filterByType(input.rooms, other);
      if (eligibleRooms.length === 0) return false;
      let found = false;
      outerDayLoop: for (const oDay of workingDays) {
        if (otherUsedDays.has(oDay)) continue;
        const daySlots = slotsByDuration[oDay];
        if (!daySlots) continue;
        for (const oSlot of daySlots) {
          // Teacher unavailability probe.
          const blocks = unavailabilityForDay(unavailMap, other.teacher_abbr, oDay);
          let blockedByUnavail = false;
          for (const b of blocks) {
            if (oSlot.start < b.end && b.start < oSlot.end) {
              blockedByUnavail = true;
              break;
            }
          }
          if (blockedByUnavail) continue;
          // Teacher busy — live state UNION the simulated commit
          // (same teacher + same day + overlapping slot).
          let teacherBusyHere = teacherBusy.overlaps(
            `${other.teacher_abbr}|${oDay}`,
            oSlot.start,
            oSlot.end
          );
          if (
            !teacherBusyHere
            && other.teacher_abbr === course.teacher_abbr
            && oDay === day
            && slot.start < oSlot.end
            && oSlot.start < slot.end
          ) {
            teacherBusyHere = true;
          }
          if (teacherBusyHere) continue;
          // Year-sem busy probe.
          let semBusyHere = semBusy.overlaps(
            `${other.year_sem}|${oDay}`,
            oSlot.start,
            oSlot.end
          );
          if (
            !semBusyHere
            && other.year_sem === course.year_sem
            && oDay === day
            && slot.start < oSlot.end
            && oSlot.start < slot.end
          ) {
            semBusyHere = true;
          }
          if (semBusyHere) continue;
          // Room-busy probe across eligible rooms.
          for (const room of eligibleRooms) {
            let busy = roomBusy.overlaps(
              `${room.room_id}|${oDay}`,
              oSlot.start,
              oSlot.end
            );
            if (
              !busy
              && room.room_id === roomId
              && oDay === day
              && slot.start < oSlot.end
              && oSlot.start < slot.end
            ) {
              busy = true;
            }
            if (!busy) { found = true; break outerDayLoop; }
          }
        }
      }
      if (!found) return false; // this commit would starve `other`
    }
    return true;
  }

  /**
   * Sort `roomIds` by preference weight for `course` (descending).
   * Rooms not in the weight table sort last (uniform tie-break by
   * string so output is deterministic).
   */
  function rankRoomsByPreference(roomIds, course, weightTable) {
    const wKey = `${course.year_sem}|${course.course_code}`;
    const subTable = weightTable[wKey] || {};
    return [...roomIds].sort((a, b) => {
      const wa = subTable[a] === undefined ? -Infinity : subTable[a];
      const wb = subTable[b] === undefined ? -Infinity : subTable[b];
      if (wa !== wb) return wb - wa;
      return String(a).localeCompare(String(b));
    });
  }

  /**
   * Try to place ordered[idx], ordered[idx+1], ... .
   *
   * For each course:
   *   - get (or generate) the deterministic candidate list for its
   *     current `usedDays` fingerprint and walk it via a pointer
   *   - for each candidate, COMMIT only after the forward-check
   *     ("does at least one valid placement remain for every
   *     not-yet-fully-placed OTHER course?") passes — otherwise
   *     prune this branch immediately
   *   - on recursive success, return true
   *   - on recursive failure, undo that one assignment, advance
   *     the pointer, and try the next candidate without
   *     re-shuffling
   *   - if every session-0 candidate is exhausted, mark THIS
   *     course as failing and return false
   *
   * The candidate cache is invalidated whenever `usedDays` changes
   * for a course (and is fingerprint-keyed, so this only happens
   * for the actual changes — not on every iteration).
   */
  function placeCourse(idx) {
    iterations += 1;
    if (iterations > budget) {
      throw new SchedulingError('Exceeded search budget', { iterations });
    }
    logger({ iterations, depth: idx });
    if (idx >= ordered.length) return true;

    const course = ordered[idx];
    const usedDays = courseUsedDays.get(course.course_code);
    const eligibleRooms = filterByType(input.rooms, course);
    if (eligibleRooms.length === 0) {
      // Hard infeasibility: no room of the right type exists.
      failingCourses.add(course.course_code);
      return false;
    }

    // Generate the deterministic candidate list ONCE for THIS call
    // frame. The list is in stable order (MRV day rank, then
    // preference-weighted room rank, then room_id tie-break) — same
    // call signature, same list, no RNG. We walk it with a local
    // pointer so re-entry from a sibling/parent frame gets a fresh
    // list (and thus the search tree is reproducible without
    // pointer-staleness bugs).
    const candidates = enumerateCandidates(course, usedDays);
    let cIdx = 0;
    if (candidates.length === 0) {
      failingCourses.add(course.course_code);
      return false;
    }

    while (cIdx < candidates.length) {
      const cand = candidates[cIdx];

      // Defensive freshness check; the list was built against a
      // snapshot of busy state, but a sibling commit/undo may have
      // landed since. (Generation is cheap; re-checks are O(log n).)
      if (!slotIsFree(course, cand.day, cand.slot)) { cIdx += 1; continue; }
      if (roomBusy.overlaps(
        `${cand.roomId}|${cand.day}`,
        cand.slot.start,
        cand.slot.end
      )) { cIdx += 1; continue; }

      // Forward-check BEFORE commit: skip the assignment entirely
      // if it would starve any other not-yet-fully-placed course.
      if (!preservesFeasibility(course, cand.day, cand.slot, cand.roomId)) {
        cIdx += 1;
        continue;
      }

      commitOne(course, cand.day, cand.slot, cand.roomId, 0);
      bumpPlacedCount(course.course_code, +1);
      usedDays.add(cand.day);

      const restOk = placeSessionsThenRest(course, idx, 1);
      if (restOk) return true;

      // Subtree failed. Undo this one assignment, drop the day,
      // and try the next candidate.
      undoLastAssignment();
      bumpPlacedCount(course.course_code, -1);
      usedDays.delete(cand.day);
      cIdx += 1;
    }

    // Every session-0 candidate has been tried; none led to a full
    // solution. This course is a failing placement.
    failingCourses.add(course.course_code);
    return false;
  }

  /**
   * Given that ordered[idx]'s session 0 is already committed on the
   * stack, place its remaining sessions (sessionFrom .. classes_per_week-1)
   * and then the rest of the schedule.
   *
   * Per session, walk the deterministic candidate list with a LOCAL
   * pointer. On recursive failure, undo ONLY the just-committed
   * tuple and try the next candidate. Only when ALL
   * candidates for this session are exhausted do we unwind back to the
   * previous session's frame.
   */
  function placeSessionsThenRest(course, idx, sessionFrom) {
    const usedDays = courseUsedDays.get(course.course_code);
    const total = course.derived_classes_per_week;

    // Caller (placeCourse) has already committed ordered[idx]'s
    // session 0 on the stack. If THIS course needs no further
    // sessions (total ≤ 1), recurse straight into the next course.
    if (sessionFrom >= total) {
      return placeCourse(idx + 1);
    }

    for (let s = sessionFrom; s < total; s += 1) {
      // Generate the deterministic candidate list for this session.
      // Local pointer — re-entry from above (sibling/parent frames)
      // will see a fresh list against the new busy state.
      const candidates = enumerateCandidates(course, usedDays);
      if (candidates.length === 0) return false; // unwind to previous frame
      let cIdx = 0;
      let sessionPlaced = false;
      while (cIdx < candidates.length) {
        const cand = candidates[cIdx];

        if (!slotIsFree(course, cand.day, cand.slot)) { cIdx += 1; continue; }
        if (roomBusy.overlaps(
          `${cand.roomId}|${cand.day}`,
          cand.slot.start,
          cand.slot.end
        )) { cIdx += 1; continue; }

        // Forward-check before commit: skip if this assignment
        // would starve any not-yet-fully-placed course.
        if (!preservesFeasibility(course, cand.day, cand.slot, cand.roomId)) {
          cIdx += 1;
          continue;
        }

        commitOne(course, cand.day, cand.slot, cand.roomId, s);
        bumpPlacedCount(course.course_code, +1);
        usedDays.add(cand.day);

        const restOk = (s + 1 < total)
          ? placeSessionsThenRest(course, idx, s + 1)
          : placeCourse(idx + 1);
        if (restOk) { sessionPlaced = true; return true; }

        undoLastAssignment();
        bumpPlacedCount(course.course_code, -1);
        usedDays.delete(cand.day);
        cIdx += 1;
      }

      if (!sessionPlaced) {
        return false; // unwind to previous session's frame
      }
    }
    return true;
  }

  // Per-course distinct-day bookkeeping. Mutated across the entire
  // search; on undo we pop the last entry for the affected course
  // only. (Distinct-day is "no two of THIS course's sessions share a
  // day" — it persists across the whole schedule, not just one
  // session.)
  const courseUsedDays = new Map();
  for (const c of ordered) courseUsedDays.set(c.course_code, new Set());

  // Per-course committed-assignment count, used by the forward-check
  // to skip courses that are already fully placed.
  const coursePlacedCount = new Map();
  for (const c of ordered) coursePlacedCount.set(c.course_code, 0);
  function bumpPlacedCount(courseCode, delta) {
    coursePlacedCount.set(courseCode, (coursePlacedCount.get(courseCode) || 0) + delta);
  }

  /**
   * Note on candidate generation: the list is built FRESH at the
   * top of every placeCourse / placeSessionsThenRest call, in a
   * fully deterministic order (no RNG). That means:
   *   - The list is identical for the same (course, usedDays)
   *     input — so the search tree is reproducible.
   *   - We use a LOCAL pointer (not a global cache) so re-entry
   *     from a higher frame with the same (course, usedDays) gets
   *     a freshly-built list reflecting the latest busy state.
   *     No stale-pointer / stale-list bugs across backtracking
   *     boundaries.
   *   - Trade-off: a sibling commit-then-undo sequence may cause
   *     the same (course, usedDays) to be re-enumerated. Cost is
   *     bounded by |candidates| × |workingDays| per re-entry.
   */

  if (!placeCourse(0)) {
    // Split unplaced courses into:
    //   failing         — actually attempted, but their backtrack
    //                     frame exhausted candidates (recorded in
    //                     failingCourses at the moment of failure).
    //   not_attempted   — never reached because an earlier course
    //                     failed first; the search never recursed
    //                     into their frame.
    // Anything that *was* placed is not in either list.
    const placedCodes = new Set(assignments.map((a) => a.course_code));
    const not_attempted = ordered
      .map((c) => c.course_code)
      .filter((code) => !failingCourses.has(code) && !placedCodes.has(code));
    throw new SchedulingError(
      'No feasible schedule found for the given inputs',
      {
        // External contract: `unplaceable` is the admin-visible
        // list of courses the solver could not place. Backwards
        // compat: route + tests still read details.unplaceable.
        unplaceable: [...failingCourses],
        not_attempted,
      }
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