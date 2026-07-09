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

const DEFAULT_BUDGET = parseInt(process.env.SCHEDULER_BUDGET, 10) || 2_000_000;
const DEFAULT_RNG = Math.random;

/** Parse "HH:MM" (24h) → minutes since midnight. Also accepts "HH:MM:SS". */
function parseTime(s) {
  const [h, m] = String(s).split(':').map((x) => Number(x));
  return h * 60 + m;
}

/**
 * Format minutes-since-midnight as a zero-padded "HH:MM" string. Inverse of
 * parseTime(). Used at the SQL boundary — the `schedules` table stores
 * `slot_start` / `slot_end` as MySQL TIME columns which require 'HH:MM'
 * (or 'HH:MM:SS') strings; raw integer minutes are rejected ("Incorrect
 * time value: '890'" for any value >= 838).
 *
 * Defensive: clamps to [0, 23:59] so a corrupt input can't cascade into
 * an even-louder DB error. Returns "00:00" for non-finite values rather
 * than throwing — a missing-busy-time error must NOT abort generation.
 */
function formatTime(mins) {
  if (!Number.isFinite(Number(mins))) return '00:00';
  let m = Math.max(0, Math.min(24 * 60 - 1, Math.round(Number(mins))));
  const h = Math.floor(m / 60);
  const mm = m % 60;
  return `${String(h).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}

/**
 * Normalize a slot value read from the DB back to integer minutes.
 * mysql2 with `dateStrings: true` returns TIME columns as 'HH:MM:SS'
 * strings; the in-memory API contract is integer minutes. This helper
 * bridges the two so callers (routes, docxGenerator, RoutineGrid) can
 * treat both the just-generated API response (numbers) and a re-loaded
 * persisted schedule (strings) identically. Already-numeric values
 * pass through.
 */
function normalizeSlotValue(v) {
  if (v == null) return v;
  if (typeof v === 'number') return v;
  const s = String(v);
  if (/^\d+$/.test(s)) return Number(s);
  const parts = s.split(':').map((x) => Number(x));
  if (parts.length >= 2 && parts.every((p) => Number.isFinite(p))) {
    return parts[0] * 60 + (parts[1] || 0);
  }
  return null;
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
  const d = 50; // Always partition in 50-minute slots.
  const days = String(config.working_days)
    .split(',')
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean);

  const out = {};
  for (const day of days) {
    const slots = [];
    // First half — before break.
    for (let t = cs; t + d <= bs; t += d) {
      slots.push({ start: t, end: t + d });
    }
    // Second half — after break.
    for (let t = be; t + d <= ce; t += d) {
      slots.push({ start: t, end: t + d });
    }
    out[day] = slots;
  }
  return out;
}

/**
 * Sort courses so the most-constrained course is placed first
 * (MRV / most-constrained-first heuristic). Constraint signals
 * ranked by importance:
 *   0. MORNING-ONLY MULTI-SLOT COURSES: labs whose required block
 *      duration exceeds the post-break afternoon window (e.g. 150-min
 *      needs 3 slots but post-break only fits 2) have ZERO afternoon
 *      fallback. Placing them absolutely first prevents theory courses
 *      from polluting teacher/year-sem state and forcing 2M+ iterations
 *      of backtracking to recover. This is the primary MRV fix.
 *   1. TOTAL WEEKLY TIME DEMAND: courses that need more weekly
 *      minutes (longer duration × more sessions) are placed first.
 *   2. FEWER SAME-TYPE ROOMS: fewer rooms of the right type
 *      = more constrained.
 *   3. SESSIONS PER WEEK: more sessions = more constrained (tie-break).
 *   4. TEACHER UNAVAILABILITY: teacher with more unavailability
 *      windows (tie-break).
 *   5. INPUT ORDER: deterministic within a tier so tests stay stable.
 *
 * `morningOnlySet` is a pre-computed Set<course_code> passed in by
 * solve() so the sort doesn't need to recompute it.
 */
function sortByConstraintTightness(courses, allRooms, unavailabilityByTeacher, morningOnlySet = new Set()) {
  const roomCount = (c) => filterByType(allRooms, c).length;
  const unavailCount = (c) =>
    (unavailabilityByTeacher.get(String(c.teacher_abbr)) || []).length;
  const weeklyDemand = (c) =>
    Number(c.derived_duration_min || 0) * Number(c.derived_classes_per_week || 0);
  return courses
    .map((c, idx) => ({
      c, idx,
      roomCount: roomCount(c),
      unavailCount: unavailCount(c),
      weeklyDemand: weeklyDemand(c),
      isMorningOnly: morningOnlySet.has(c.course_code) ? 1 : 0,
    }))
    .sort((a, b) => {
      // PRIMARY: morning-only multi-slot labs always first.
      // 150-min labs and 3-credit theory courses both have weeklyDemand=150,
      // but labs have MORE lab rooms (4) than classrooms (3), so the old
      // room-count tiebreak placed theory BEFORE labs — causing 2M+ iterations.
      if (b.isMorningOnly !== a.isMorningOnly) return b.isMorningOnly - a.isMorningOnly;
      // Higher weekly demand first — more constrained courses first.
      if (b.weeklyDemand !== a.weeklyDemand) return b.weeklyDemand - a.weeklyDemand;
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
  const logger = options.logger || (() => { });

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

  // ── [FIX-1] Slot-count diagnostic log ────────────────────────────────
  // Print once per solve() call so operators can verify the slot grid
  // matches expectations without touching the source code.
  {
    const base50 = buildAvailableWindows(input.config, 50);
    const firstDay = workingDays[0];
    if (firstDay && base50[firstDay]) {
      const slots = base50[firstDay];
      const fmt = (m) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
      const morning = slots.filter(s => s.end <= parseTime(input.config.break_start));
      const afternoon = slots.filter(s => s.start >= parseTime(input.config.break_end));
      console.log(
        `[SLOTS] ${slots.length} × 50-min slots/day` +
        ` (morning ${morning.length}: ${morning.map(s => fmt(s.start)).join(', ')}` +
        ` | afternoon ${afternoon.length}: ${afternoon.map(s => fmt(s.start)).join(', ')})` +
        ` × ${workingDays.length} days = ${slots.length * workingDays.length} slots/room/week`
      );
    }
  }

  // ── Day_Preference bias map (Soft Constraint S-2) ─────────────────
  // dayBias[day][classType] = weight_percent (0-100).
  // Used to reorder candidate days so Lab sessions prefer high-Lab days
  // (TUE, THU) and Theory sessions prefer high-Theory days (SUN, MON).
  // This is a SOFT bias only — hard constraints are checked first.
  const dayBias = {};
  for (const dp of (input.day_preference || [])) {
    if (!dp.day || !dp.class_type) continue;
    const d = String(dp.day).toUpperCase().trim();
    const ct = String(dp.class_type).trim(); // 'Lab' | 'Theory'
    if (!dayBias[d]) dayBias[d] = {};
    dayBias[d][ct] = Number(dp.weight_percent) || 0;
  }

  // ── Pre-compute morning-only course set (MUST come before sort) ──────
  // A course is "morning-only multi-slot" when its N consecutive 50-min
  // slots cannot fit into the post-break afternoon window on any day.
  // This drives the PRIMARY sort key so labs always come before theory.
  //
  // Example: 150-min → 3 slots; post-break = 14:00-15:50 = 110 min = 2 slots.
  // 3 > 2 → morning-only. 100-min → 2 slots; 2 ≤ 2 → NOT morning-only.
  const breakEndMin = parseTime(input.config.break_end);
  const breakStartMin = parseTime(input.config.break_start);
  const morningOnlyLabCourseSet = new Set(); // course_codes that MUST use a morning block
  const morningOnlyLabRooms = new Set();     // room_ids used by morning-only courses
  let maxMorningSlotsNeeded = 1;             // largest block size among morning-only courses
  {
    const base50pre = buildAvailableWindows(input.config, 50);
    for (const c of input.courses) {
      const slotsNeeded = Math.round((Number(c.derived_duration_min) || 0) / 50);
      if (slotsNeeded < 2) continue;
      const eligibleRooms = filterByType(input.rooms, c);
      let hasAfternoon = false;
      outerPre: for (const day of workingDays) {
        const aftSlots = (base50pre[day] || []).filter((s) => s.start >= breakEndMin);
        for (let i = 0; i + slotsNeeded <= aftSlots.length; i++) {
          let ok = true;
          for (let k = 1; k < slotsNeeded; k++) {
            if (aftSlots[i + k].start !== aftSlots[i + k - 1].end) { ok = false; break; }
          }
          if (ok) { hasAfternoon = true; break outerPre; }
        }
      }
      if (!hasAfternoon) {
        morningOnlyLabCourseSet.add(c.course_code);
        for (const r of eligibleRooms) morningOnlyLabRooms.add(r.room_id);
        if (slotsNeeded > maxMorningSlotsNeeded) maxMorningSlotsNeeded = slotsNeeded;
      }
    }
  }

  const ordered = sortByConstraintTightness(
    input.courses,
    input.rooms,
    unavailMap,
    morningOnlyLabCourseSet  // PRIMARY sort key: morning-only labs first
  );

  // ── [FIX-2] Bottleneck report for multi-slot (continuous-block) courses ─
  // Courses with derived_duration_min > 50 need N consecutive 50-min slots
  // in the same half of the day. Log how many (day, room, start-slot)
  // combinations are available for each such course BEFORE the solve begins,
  // so the admin can see immediately which course is the real bottleneck.
  {
    const base50 = buildAvailableWindows(input.config, 50);
    const breakStart = parseTime(input.config.break_start);
    const breakEnd = parseTime(input.config.break_end);
    const multiSlotCourses = ordered.filter((c) => {
      const dur = Number(c.derived_duration_min) || 0;
      return Math.round(dur / 50) >= 2; // needs 2+ consecutive slots
    });
    if (multiSlotCourses.length > 0) {
      console.log(`\n[BOTTLENECK] ${multiSlotCourses.length} course(s) need continuous multi-slot blocks:`);
      const fmt = (m) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
      for (const c of multiSlotCourses) {
        const slotsNeeded = Math.round(Number(c.derived_duration_min) / 50);
        const eligibleRooms = filterByType(input.rooms, c);
        let morningCombos = 0;
        let afternoonCombos = 0;
        const sample = []; // collect a few example (day, room, start) combos
        for (const day of workingDays) {
          const daySlots = base50[day] || [];
          const morningSlots = daySlots.filter(s => s.end <= breakStart);
          const afternoonSlots = daySlots.filter(s => s.start >= breakEnd);
          // Morning consecutive blocks
          for (let i = 0; i + slotsNeeded <= morningSlots.length; i++) {
            let ok = true;
            for (let k = 1; k < slotsNeeded; k++) {
              if (morningSlots[i + k].start !== morningSlots[i + k - 1].end) { ok = false; break; }
            }
            if (ok) {
              morningCombos += eligibleRooms.length;
              if (sample.length < 3) sample.push(`${day}@${fmt(morningSlots[i].start)}(morning)`);
            }
          }
          // Afternoon consecutive blocks
          for (let i = 0; i + slotsNeeded <= afternoonSlots.length; i++) {
            let ok = true;
            for (let k = 1; k < slotsNeeded; k++) {
              if (afternoonSlots[i + k].start !== afternoonSlots[i + k - 1].end) { ok = false; break; }
            }
            if (ok) {
              afternoonCombos += eligibleRooms.length;
              if (sample.length < 3) sample.push(`${day}@${fmt(afternoonSlots[i].start)}(afternoon)`);
            }
          }
        }
        const totalCombos = morningCombos + afternoonCombos;
        const morningOnly = afternoonCombos === 0 ? ' [MORNING-ONLY]' : '';
        console.log(
          `  ${c.course_code} (${c.derived_duration_min}min/${slotsNeeded}-slots, ${c.derived_type},` +
          ` ${eligibleRooms.length} room(s), teacher=${c.teacher_abbr})` +
          ` → ${totalCombos} (day×room×start) combos` +
          ` [morning=${morningCombos} afternoon=${afternoonCombos}]${morningOnly}` +
          (sample.length > 0 ? ` e.g. ${sample.join(', ')}` : '')
        );
      }
      console.log();
    }
  }

  // (morningOnlyLabCourseSet, morningOnlyLabRooms, breakEndMin, breakStartMin,
  //  maxMorningSlotsNeeded are pre-computed above before sortByConstraintTightness.)

  // ─────────────────────────────────────────────────────────────────────
  // Pre-flight structural check
  // ─────────────────────────────────────────────────────────────────────
  //
  // Before kicking off the backtracking search (which can burn
  // millions of iterations before admitting defeat), run a cheap
  // structural check on every course. The two cases that GUARANTEE
  // failure no matter how the backtracker orders its decisions:
  //
  //   (a) NO SLOTS EXIST for a course's duration in the daily
  //       window. Example: 240-minute lab sessions in a 09:00-15:50
  //       day with a 13:00-14:00 lunch break. The break splits the
  //       day into a 240-min pre-break window (exactly the slot
  //       length, but it would START at 09:00 and END at 13:00 — the
  //       exact minute lunch begins, so it is rejected as
  //       straddling) and a 110-min post-break window (too short).
  //       buildAvailableWindows returns slots: {} for that duration.
  //       No amount of backtracking can produce a placement.
  //
  //   (b) NO ROOM OF THE RIGHT TYPE exists for a course. Example:
  //       a "theory" course with zero classrooms loaded. Same
  //       guarantee — infeasible from the start.
  //
  // Detecting these up front lets us return a clean
  // SCHEDULE_INFEASIBLE error naming the exact courses and reasons,
  // instead of misleading the admin with "Exceeded search budget"
  // after the search has spun for 2M iterations.
  const structuralUnplaceable = [];
  for (const course of ordered) {
    const dur = course.derived_duration_min;
    if (!Number.isInteger(dur) || dur <= 0) {
      structuralUnplaceable.push({
        course_code: course.course_code,
        reason: 'invalid_duration',
        detail: `derived_duration_min=${dur} (must be a positive integer)`,
      });
      continue;
    }
    const slotsNeeded = Math.max(1, Math.round(dur / 50));
    const slotsBy50 = getDaySlots(50);
    let maxConsecutive = 0;
    for (const day of workingDays) {
      const daySlots = slotsBy50[day] || [];
      let consecutive = 0;
      let maxOnDay = 0;
      for (let i = 0; i < daySlots.length; i++) {
        if (i === 0 || daySlots[i].start === daySlots[i - 1].end) {
          consecutive += 1;
        } else {
          consecutive = 1;
        }
        if (consecutive > maxOnDay) maxOnDay = consecutive;
      }
      if (maxOnDay > maxConsecutive) maxConsecutive = maxOnDay;
    }

    if (maxConsecutive < slotsNeeded) {
      const cs = parseTime(input.config.class_start);
      const ce = parseTime(input.config.class_end);
      const bs = parseTime(input.config.break_start);
      const be = parseTime(input.config.break_end);
      const preBreak = Math.max(0, bs - cs);
      const postBreak = Math.max(0, ce - be);
      structuralUnplaceable.push({
        course_code: course.course_code,
        reason: 'no_slots_for_duration',
        detail:
          `duration_minutes=${dur} (needs ${slotsNeeded} consecutive 50-min slots) ` +
          `does not fit in any continuous daily window segment ` +
          `[${input.config.class_start}-${input.config.class_end}] ` +
          `with break [${input.config.break_start}-${input.config.break_end}]. ` +
          `Pre-break free window=${preBreak} min, post-break free window=${postBreak} min.`,
      });
      continue;
    }
    if (filterByType(input.rooms, course).length === 0) {
      structuralUnplaceable.push({
        course_code: course.course_code,
        reason: 'no_room_of_type',
        detail: `no room of required type for derived_type="${course.derived_type}"`,
      });
    }
  }
  // ─────────────────────────────────────────────────────────────────────
  // Pre-flight teacher-load check
  // ─────────────────────────────────────────────────────────────────────
  //
  // For each teacher, sum the TOTAL contiguous minutes they must
  // teach per week (= Σ sessions × session duration) and compare
  // against the FREE minutes per week in the working-day grid after
  // their declared unavailability is subtracted.
  //
  // If Σ demanded > free minutes, the teacher is physically
  // over-subscribed — no backtracking can fit more sessions into
  // their personal time grid than it has room for. We flag the
  // affected courses up front so the admin sees a clear
  // teacher-overload error instead of a misleading
  // "Exceeded search budget" after 2M wasted iterations.
  //
  // Note: this is a NECESSARY-but-not-SUFFICIENT lower bound — even
  // if every teacher passes this check, the schedule can still be
  // infeasible because of room/year-sem conflicts. That's what the
  // backtracker is for. This check just catches the case the
  // backtracker can't recover from: a teacher who needs more time
  // than exists.
  const teacherLoad = new Map(); // teacher -> { demanded_min, free_min, course_codes }
  const cs = parseTime(input.config.class_start);
  const ce = parseTime(input.config.class_end);
  const bs = parseTime(input.config.break_start);
  const be = parseTime(input.config.break_end);
  const dayWindowMin = Math.max(0, (bs - cs)) + Math.max(0, (ce - be));
  const workingDayCount = String(input.config.working_days || '')
    .split(',').map((s) => s.trim().toUpperCase()).filter(Boolean).length;
  const weeklyWindowMinPerTeacher = dayWindowMin * workingDayCount;
  // Subtract each teacher's declared unavailability windows.
  for (const [teacherAbbr, windows] of unavailMap.entries()) {
    const unavailMin = windows.reduce((sum, w) => sum + Math.max(0, w.end - w.start), 0);
    teacherLoad.set(String(teacherAbbr), {
      demanded_min: 0,
      free_min: Math.max(0, weeklyWindowMinPerTeacher - unavailMin),
      course_codes: [],
    });
  }
  // Make sure every teacher seen in courses is represented even if
  // they had no unavailability rows.
  for (const c of ordered) {
    const key = String(c.teacher_abbr);
    if (!teacherLoad.has(key)) {
      teacherLoad.set(key, {
        demanded_min: 0,
        free_min: weeklyWindowMinPerTeacher,
        course_codes: [],
      });
    }
  }
  for (const c of ordered) {
    const key = String(c.teacher_abbr);
    const entry = teacherLoad.get(key);
    const dur = Number(c.derived_duration_min);
    const cpw = Number(c.derived_classes_per_week);
    if (Number.isInteger(dur) && Number.isInteger(cpw) && dur > 0 && cpw > 0) {
      entry.demanded_min += dur * cpw;
      entry.course_codes.push(c.course_code);
    }
  }
  const teacherOverloads = [];
  for (const [teacherAbbr, entry] of teacherLoad.entries()) {
    if (entry.demanded_min > entry.free_min) {
      teacherOverloads.push({
        teacher_abbr: teacherAbbr,
        demanded_min: entry.demanded_min,
        free_min: entry.free_min,
        weekly_window_min: weeklyWindowMinPerTeacher,
        overshoot_min: entry.demanded_min - entry.free_min,
        affected_courses: entry.course_codes,
      });
    }
  }
  if (teacherOverloads.length > 0) {
    // Map the overloaded teachers back to specific courses so the
    // admin can see WHICH courses are competing for the same
    // over-subscribed teacher's time.
    const overTeacherSet = new Set(teacherOverloads.map((x) => x.teacher_abbr));
    const coursesBlockedByOverload = ordered
      .filter((c) => overTeacherSet.has(String(c.teacher_abbr)))
      .map((c) => c.course_code);
    throw new SchedulingError(
      'No feasible schedule: one or more teachers are over-subscribed',
      {
        unplaceable: coursesBlockedByOverload,
        structural_failures: teacherOverloads.map((o) => ({
          course_code: `(teacher=${o.teacher_abbr})`,
          reason: 'teacher_overload',
          detail:
            `teacher "${o.teacher_abbr}" needs ${o.demanded_min} min/week but ` +
            `only ${o.free_min} min/week are free (weekly window=${o.weekly_window_min} min, ` +
            `overshoot=${o.overshoot_min} min). Affected courses: ${o.affected_courses.join(', ')}.`,
        })),
        teacher_overloads: teacherOverloads,
        not_attempted: [],
      }
    );
  }

  if (structuralUnplaceable.length > 0) {
    throw new SchedulingError(
      'No feasible schedule: one or more courses have no legal placement',
      {
        unplaceable: structuralUnplaceable.map((x) => x.course_code),
        structural_failures: structuralUnplaceable,
        not_attempted: [],
      }
    );
  }

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
  // [FIX-4] Track the course being attempted when budget is hit.
  let lastAttemptedCourse = null;
  let lastAttemptedDepth = 0;
  let lastAttemptedSession = 0;

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

  function commitOne(course, day, slots, roomId, sessionIndex) {
    const teacherKey = `${course.teacher_abbr}|${day}`;
    const semKey = `${course.year_sem}|${day}`;
    const roomKey = `${roomId}|${day}`;
    const start = slots[0].start;
    const end = slots[slots.length - 1].end;
    if (roomBusy.overlaps(roomKey, start, end)) {
      // Defensive: should have been filtered during enumeration.
      throw new Error(
        `commitOne called on a busy room: ${roomKey} ${start}-${end}`
      );
    }
    teacherBusy.add(teacherKey, start, end);
    roomBusy.add(roomKey, start, end);
    semBusy.add(semKey, start, end);

    for (let k = 0; k < slots.length; k++) {
      const slot = slots[k];
      assignments.push({
        course_code: course.course_code,
        teacher_abbr: String(course.teacher_abbr),
        room_id: roomId,
        day,
        slot_start: slot.start,
        slot_end: slot.end,
        year_sem: course.year_sem,
        session_index: sessionIndex,
      });
    }
  }

  /**
   * Undo the most recently committed assignment (and ONLY that one).
   * Used to back out a single bad placement so the next candidate can
   * be tried without leaking state.
   */
  function undoLastAssignment(slotsNeeded = 1) {
    const removed = [];
    for (let k = 0; k < slotsNeeded; k++) {
      const a = assignments.pop();
      if (a) removed.push(a);
    }
    if (removed.length === 0) return;
    const first = removed[removed.length - 1];
    const last = removed[0];
    teacherBusy.remove(`${first.teacher_abbr}|${first.day}`, first.slot_start, last.slot_end);
    roomBusy.remove(`${first.room_id}|${first.day}`, first.slot_start, last.slot_end);
    semBusy.remove(`${first.year_sem}|${first.day}`, first.slot_start, last.slot_end);
  }

  /**
   * Pop ALL assignments belonging to `courseCode` off the global stack
   * and undo each busy-map entry.
   */
  function popCourseAssignments(courseCode) {
    while (
      assignments.length > 0
      && assignments[assignments.length - 1].course_code === courseCode
    ) {
      const a = assignments.pop();
      teacherBusy.remove(`${a.teacher_abbr}|${a.day}`, a.slot_start, a.slot_end);
      roomBusy.remove(`${a.room_id}|${a.day}`, a.slot_start, a.slot_end);
      semBusy.remove(`${a.year_sem}|${a.day}`, a.slot_start, a.slot_end);
    }
  }

  function getConsecutiveSlots(daySlots, startIndex, slotsNeeded) {
    if (startIndex + slotsNeeded > daySlots.length) return null;
    const selected = [];
    for (let k = 0; k < slotsNeeded; k++) {
      const slot = daySlots[startIndex + k];
      if (k > 0) {
        const prev = selected[k - 1];
        if (slot.start !== prev.end) {
          return null;
        }
      }
      selected.push(slot);
    }
    return selected;
  }

  /**
   * Build the candidate list for one (course, usedDays) pair.
   */
  function enumerateCandidates(course, usedDays) {
    const slotsForDayBy50 = getDaySlots(50);
    if (!slotsForDayBy50) return [];
    const eligibleRooms = filterByType(input.rooms, course);
    if (eligibleRooms.length === 0) return [];

    const duration = Number(course.derived_duration_min) || 50;
    const slotsNeeded = Math.max(1, Math.round(duration / 50));

    const perDay = new Map(); // day -> Array<{ slots, freeRoomIds }>
    for (const day of workingDays) {
      if (usedDays.has(day)) continue;
      const daySlots = slotsForDayBy50[day];
      if (!daySlots) continue;
      for (let i = 0; i < daySlots.length; i++) {
        const selectedSlots = getConsecutiveSlots(daySlots, i, slotsNeeded);
        if (!selectedSlots) continue;

        let slotsFree = true;
        for (const slot of selectedSlots) {
          if (!slotIsFree(course, day, slot)) {
            slotsFree = false;
            break;
          }
        }
        if (!slotsFree) continue;

        const start = selectedSlots[0].start;
        const end = selectedSlots[selectedSlots.length - 1].end;
        const freeRoomIds = [];
        for (const room of eligibleRooms) {
          const key = `${room.room_id}|${day}`;
          if (!roomBusy.overlaps(key, start, end)) {
            freeRoomIds.push(room.room_id);
          }
        }
        if (freeRoomIds.length === 0) continue;
        if (!perDay.has(day)) perDay.set(day, []);
        perDay.get(day).push({ slots: selectedSlots, freeRoomIds });
      }
    }

    // ── Day ordering with soft Day_Preference bias (S-2) ──────────────
    // Capitalised course type to match Day_Preference class_type values.
    const courseClassType = course.derived_type === 'lab' ? 'Lab' : 'Theory';
    const days = [...perDay.keys()].sort((a, b) => {
      // Primary: descending bias weight for the course's class type.
      // Days with no bias entry get weight 0 — they sort last.
      const biasA = (dayBias[a] && dayBias[a][courseClassType]) || 0;
      const biasB = (dayBias[b] && dayBias[b][courseClassType]) || 0;
      if (biasB !== biasA) return biasB - biasA; // higher bias first
      // Secondary: more slots → leaves more options for future assignments → earlier (LCV).
      const diff = perDay.get(b).length - perDay.get(a).length;
      if (diff !== 0) return diff;
      // Tertiary: stable working-day order.
      return workingDays.indexOf(a) - workingDays.indexOf(b);
    });

    const out = [];
    for (const day of days) {
      const dayEntries = perDay.get(day);
      for (const { slots, freeRoomIds } of dayEntries) {
        const ranked = rankRoomsByPreference(
          freeRoomIds,
          course,
          weightTable
        );
        const shuffled = rngShuffleTopN(ranked, 2);
        for (const roomId of shuffled) {
          out.push({ day, slots, roomId });
        }
      }
    }
    return out;
  }

  function rngShuffleTopN(arr, n) {
    if (!Array.isArray(arr) || arr.length < 2 || n <= 0) return arr;
    const k = Math.min(n, arr.length - 1);
    const out = arr.slice();
    for (let i = 0; i < k; i += 1) {
      const j = i + Math.floor(rng() * (out.length - i));
      if (j !== i) {
        const tmp = out[i];
        out[i] = out[j];
        out[j] = tmp;
      }
    }
    return out.slice(0, n);
  }

  /**
   * Lightweight feasibility check using live roomBusy queries.
   *
   * For morning-only multi-slot courses (e.g. 150-min labs where the
   * post-break window is too short to fit the block), verify that committing
   * this candidate still leaves ≥ N free morning-block starts across all
   * morning-only lab rooms/days, where N = remaining unplaced morning-only courses.
   *
   * Uses roomBusy directly — correctly accounts for ALL room commits including
   * 2-slot labs that a counter-based approach misses (bug in prior version).
   * Cost: O(labRooms × days × morningStarts) ≈ O(40) per call — fast.
   *
   * `courseUsedDays` is from the outer closure, initialized before placeCourse(0).
   */
  function preservesFeasibility(course, day, slots, roomId) {
    if (morningOnlyLabCourseSet.size === 0) return true; // no morning-only courses
    if (!morningOnlyLabRooms.has(roomId)) return true;   // not a contested room type

    const commitStart = slots[0].start;
    if (commitStart >= breakStartMin) return true;        // afternoon — no morning impact

    // Count how many morning-only courses still need a placement.
    let stillNeeded = 0;
    for (const code of morningOnlyLabCourseSet) {
      const c = ordered.find((cc) => cc.course_code === code);
      if (!c) continue;
      const usedDays = courseUsedDays.get(code);
      if (!usedDays || usedDays.size < c.derived_classes_per_week) stillNeeded++;
    }
    // This commit will place one session of the current course.
    if (morningOnlyLabCourseSet.has(course.course_code)) {
      stillNeeded = Math.max(0, stillNeeded - 1);
    }
    if (stillNeeded === 0) return true; // all morning-only courses already covered

    // Count free consecutive morning-block starts across all morning-only lab
    // rooms/days AFTER this hypothetical commit is applied.
    const commitEnd = slots[slots.length - 1].end;
    const daySlots50 = getDaySlots(50);
    let freeAfterCommit = 0;

    for (const r of morningOnlyLabRooms) {
      for (const d of workingDays) {
        const morn = (daySlots50[d] || []).filter((s) => s.end <= breakStartMin);
        const rKey = `${r}|${d}`;
        for (let i = 0; i + maxMorningSlotsNeeded <= morn.length; i++) {
          const bStart = morn[i].start;
          const bEnd = morn[i + maxMorningSlotsNeeded - 1].end;
          // Verify the N slots are consecutive (no gap across break boundary)
          let consec = true;
          for (let k = 1; k < maxMorningSlotsNeeded; k++) {
            if (morn[i + k].start !== morn[i + k - 1].end) { consec = false; break; }
          }
          if (!consec) continue;
          // Already occupied by a committed assignment?
          if (roomBusy.overlaps(rKey, bStart, bEnd)) continue;
          // Would THIS hypothetical commit occupy it?
          if (r === roomId && d === day && commitStart < bEnd && commitEnd > bStart) continue;
          freeAfterCommit++;
        }
      }
    }

    // Prune: not enough free morning starts left for remaining morning-only courses.
    return freeAfterCommit >= stillNeeded;
  }

  function rankRoomsByPreference(roomIds, course, weightTable) {
    // Fix: look up by year_group ('1-2' or '3-4'), NOT year_sem|course_code.
    // course.year_group is attached by routineLoader from Year_Sem.group_code.
    const yearGroup = course.year_group || null;
    // weightTable is a Map: year_group → [{ room_id, weight_percent }]
    const prefList = (yearGroup && weightTable.get(yearGroup)) || [];
    const prefMap = {};
    for (const p of prefList) prefMap[String(p.room_id)] = Number(p.weight_percent) || 0;
    return [...roomIds].sort((a, b) => {
      const wa = prefMap[a] !== undefined ? prefMap[a] : -1;
      const wb = prefMap[b] !== undefined ? prefMap[b] : -1;
      if (wb !== wa) return wb - wa; // higher preference first
      return String(a).localeCompare(String(b));
    });
  }

  function placeCourse(idx) {
    iterations += 1;
    if (iterations > budget) {
      // [FIX-4] Informative budget-exceeded: name the course we were trying to place.
      const stuckCourse = ordered[idx] ? ordered[idx].course_code : '(unknown)';
      throw new SchedulingError(
        `Exceeded search budget after ${iterations.toLocaleString()} iterations ` +
        `(stuck on course "${stuckCourse}" at depth=${idx}, session=${lastAttemptedSession})`,
        {
          iterations,
          stuck_on_course: stuckCourse,
          stuck_on_depth: idx,
          stuck_on_session: lastAttemptedSession,
          last_attempted_course: lastAttemptedCourse,
        }
      );
    }
    lastAttemptedCourse = ordered[idx] ? ordered[idx].course_code : null;
    lastAttemptedDepth = idx;
    logger({ iterations, depth: idx });
    if (idx >= ordered.length) return true;

    const course = ordered[idx];
    const usedDays = courseUsedDays.get(course.course_code);

    // Lookahead prune for distinct-day constraint
    const remainingDays = workingDays.length - usedDays.size;
    const remainingSessions = course.derived_classes_per_week;
    if (remainingDays < remainingSessions) {
      failingCourses.add(course.course_code);
      return false;
    }

    const eligibleRooms = filterByType(input.rooms, course);
    if (eligibleRooms.length === 0) {
      failingCourses.add(course.course_code);
      return false;
    }

    const candidates = enumerateCandidates(course, usedDays);
    let cIdx = 0;
    if (candidates.length === 0) {
      failingCourses.add(course.course_code);
      return false;
    }

    const duration = Number(course.derived_duration_min) || 50;
    const slotsNeeded = Math.max(1, Math.round(duration / 50));

    while (cIdx < candidates.length) {
      const cand = candidates[cIdx];

      let slotsFree = true;
      for (const slot of cand.slots) {
        if (!slotIsFree(course, cand.day, slot)) {
          slotsFree = false;
          break;
        }
      }
      if (!slotsFree) { cIdx += 1; continue; }

      const start = cand.slots[0].start;
      const end = cand.slots[cand.slots.length - 1].end;
      if (roomBusy.overlaps(
        `${cand.roomId}|${cand.day}`,
        start,
        end
      )) { cIdx += 1; continue; }

      if (!preservesFeasibility(course, cand.day, cand.slots, cand.roomId)) {
        cIdx += 1;
        continue;
      }

      commitOne(course, cand.day, cand.slots, cand.roomId, 0);
      usedDays.add(cand.day);

      const restOk = placeSessionsThenRest(course, idx, 1);
      if (restOk) return true;

      undoLastAssignment(slotsNeeded);
      usedDays.delete(cand.day);
      cIdx += 1;
    }

    failingCourses.add(course.course_code);
    return false;
  }

  function placeSessionsThenRest(course, idx, sessionFrom) {
    iterations += 1;
    if (iterations > budget) {
      // [FIX-4] Informative budget-exceeded: include course and session index.
      throw new SchedulingError(
        `Exceeded search budget after ${iterations.toLocaleString()} iterations ` +
        `(stuck on course "${course.course_code}" at depth=${idx}, session=${sessionFrom})`,
        {
          iterations,
          stuck_on_course: course.course_code,
          stuck_on_depth: idx,
          stuck_on_session: sessionFrom,
          last_attempted_course: lastAttemptedCourse,
        }
      );
    }
    lastAttemptedSession = sessionFrom;
    const usedDays = courseUsedDays.get(course.course_code);
    const total = course.derived_classes_per_week;

    // Lookahead prune for distinct-day constraint
    const remainingDays = workingDays.length - usedDays.size;
    const remainingSessions = total - sessionFrom;
    if (remainingDays < remainingSessions) {
      return false;
    }

    if (sessionFrom >= total) {
      return placeCourse(idx + 1);
    }

    const duration = Number(course.derived_duration_min) || 50;
    const slotsNeeded = Math.max(1, Math.round(duration / 50));

    for (let s = sessionFrom; s < total; s += 1) {
      const candidates = enumerateCandidates(course, usedDays);
      if (candidates.length === 0) return false;
      let cIdx = 0;
      let sessionPlaced = false;
      while (cIdx < candidates.length) {
        const cand = candidates[cIdx];

        let slotsFree = true;
        for (const slot of cand.slots) {
          if (!slotIsFree(course, cand.day, slot)) {
            slotsFree = false;
            break;
          }
        }
        if (!slotsFree) { cIdx += 1; continue; }

        const start = cand.slots[0].start;
        const end = cand.slots[cand.slots.length - 1].end;
        if (roomBusy.overlaps(
          `${cand.roomId}|${cand.day}`,
          start,
          end
        )) { cIdx += 1; continue; }

        if (!preservesFeasibility(course, cand.day, cand.slots, cand.roomId)) {
          cIdx += 1;
          continue;
        }

        commitOne(course, cand.day, cand.slots, cand.roomId, s);
        usedDays.add(cand.day);

        const restOk = (s + 1 < total)
          ? placeSessionsThenRest(course, idx, s + 1)
          : placeCourse(idx + 1);
        if (restOk) { sessionPlaced = true; return true; }

        undoLastAssignment(slotsNeeded);
        usedDays.delete(cand.day);
        cIdx += 1;
      }

      if (!sessionPlaced) {
        return false;
      }
    }
    return true;
  }

  const courseUsedDays = new Map();
  for (const c of ordered) courseUsedDays.set(c.course_code, new Set());

  if (!placeCourse(0)) {
    const placedCodes = new Set(assignments.map((a) => a.course_code));
    const not_attempted = ordered
      .map((c) => c.course_code)
      .filter((code) => !failingCourses.has(code) && !placedCodes.has(code));
    throw new SchedulingError(
      'No feasible schedule found for the given inputs',
      {
        unplaceable: [...failingCourses],
        not_attempted,
      }
    );
  }
  // ── Audit soft constraint overrides ──────────────────────────────────
  const auditLogs = [];
  for (const a of assignments) {
    const course = ordered.find(c => c.course_code === a.course_code);
    if (!course) continue;
    const ct = course.derived_type === 'lab' ? 'Lab' : 'Theory';

    // Day preference audit
    const assignedDayWeight = (dayBias[a.day] && dayBias[a.day][ct]) || 0;
    let maxDayWeight = 0;
    for (const d of workingDays) {
      const w = (dayBias[d] && dayBias[d][ct]) || 0;
      if (w > maxDayWeight) maxDayWeight = w;
    }
    if (assignedDayWeight < maxDayWeight) {
      auditLogs.push(
        `[AUDIT] Course ${a.course_code} (${ct}) day preference override: placed on ${a.day} (weight ${assignedDayWeight}%) instead of a preferred day (max weight ${maxDayWeight}%) because higher-weight days were blocked by teacher unavailability or slot collisions.`
      );
    }

    // Room preference audit
    const prefList = (course.year_group && weightTable.get(course.year_group)) || [];
    const prefMap = {};
    for (const p of prefList) prefMap[String(p.room_id)] = Number(p.weight_percent) || 0;
    const assignedRoomWeight = prefMap[a.room_id] !== undefined ? prefMap[a.room_id] : 0;

    const eligibleRooms = filterByType(input.rooms, course);
    let maxRoomWeight = 0;
    for (const r of eligibleRooms) {
      const w = prefMap[r.room_id] !== undefined ? prefMap[r.room_id] : 0;
      if (w > maxRoomWeight) maxRoomWeight = w;
    }
    if (assignedRoomWeight < maxRoomWeight) {
      auditLogs.push(
        `[AUDIT] Course ${a.course_code} (${ct}) room preference override: placed in room ${a.room_id} (weight ${assignedRoomWeight}%) instead of a preferred room (max weight ${maxRoomWeight}%) because preferred rooms were occupied.`
      );
    }
  }

  if (auditLogs.length > 0) {
    console.log(`\n--- Soft Constraint Audit Log (${auditLogs.length} overrides) ---`);
    for (const logText of auditLogs) {
      console.log(logText);
    }
    console.log(`----------------------------------------------------------\n`);
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
  formatTime,
  normalizeSlotValue,
};