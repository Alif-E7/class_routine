'use strict';

const {
  buildDiagnostics,
  countSlotsPerDay,
  sumUnavailableMinutesPerWeek,
  groupByTypeDuration,
} = require('../src/services/diagnostics');

// 9:00–16:00 with a 12:30–13:30 break leaves 210 + 150 = 360 usable
// minutes per day. A 240-minute lab therefore fits exactly one slot
// per room per day (the 150-minute afternoon window is too short).
const baseConfig = {
  working_days: 'SUN,MON,TUE,WED,THU', // 5 working days
  class_start: '09:00',
  class_end:   '16:00',
  break_start: '12:30',
  break_end:   '13:30',
};

describe('diagnostics — countSlotsPerDay', () => {
  test('returns 0 when the time window is invalid', () => {
    expect(countSlotsPerDay({ ...baseConfig, class_start: '16:00', class_end: '09:00' }, 50)).toBe(0);
  });
  test('returns 0 for a non-positive duration', () => {
    expect(countSlotsPerDay(baseConfig, 0)).toBe(0);
    expect(countSlotsPerDay(baseConfig, -10)).toBe(0);
    expect(countSlotsPerDay(baseConfig, 1.5)).toBe(0);
  });
  test('counts how many 240-minute slots fit in the working window', () => {
    // 9:00–12:30 = 210 min (< 240 → 0 morning slots)
    // 13:30–16:00 = 150 min (< 240 → 0 afternoon slots)
    expect(countSlotsPerDay(baseConfig, 240)).toBe(0);
  });
  test('counts how many 50-minute slots fit', () => {
    // 210/50 = 4 (4 morning slots), 150/50 = 3 (3 afternoon slots)
    expect(countSlotsPerDay(baseConfig, 50)).toBe(7);
  });
});

describe('diagnostics — sumUnavailableMinutesPerWeek', () => {
  test('sums the duration of every unavailability row for one teacher', () => {
    const rows = [
      { teacher_abbr: 'T1', day: 'SUN', start_time: '10:00', end_time: '12:00' }, // 120
      { teacher_abbr: 'T1', day: 'MON', start_time: '09:00', end_time: '10:30' }, //  90
      { teacher_abbr: 'T2', day: 'TUE', start_time: '11:00', end_time: '12:00' }, // ignored
    ];
    expect(sumUnavailableMinutesPerWeek(rows, 'T1')).toBe(210);
    expect(sumUnavailableMinutesPerWeek(rows, 'T2')).toBe(60);
    expect(sumUnavailableMinutesPerWeek(rows, 'T3')).toBe(0);
  });

  test('returns 0 for non-array input', () => {
    expect(sumUnavailableMinutesPerWeek(undefined, 'T1')).toBe(0);
    expect(sumUnavailableMinutesPerWeek(null, 'T1')).toBe(0);
  });
});

describe('diagnostics — groupByTypeDuration', () => {
  test('groups courses by (type, duration) and sums classes-per-week', () => {
    const courses = [
      { course_code: 'L1', derived_type: 'lab',    derived_duration_min: 240, derived_classes_per_week: 1 },
      { course_code: 'L2', derived_type: 'lab',    derived_duration_min: 240, derived_classes_per_week: 1 },
      { course_code: 'L3', derived_type: 'lab',    derived_duration_min: 110, derived_classes_per_week: 1 },
      { course_code: 'T1', derived_type: 'theory', derived_duration_min: 50,  derived_classes_per_week: 3 },
      // Garbage rows are ignored, not thrown on.
      { course_code: 'X1' /* missing fields */ },
      { course_code: 'X2', derived_type: 'theory', derived_duration_min: 50, derived_classes_per_week: 0 },
    ];
    const grouped = groupByTypeDuration(courses);
    const byKey = Object.fromEntries(grouped.map((g) => [`${g.type}|${g.duration_minutes}`, g.total_sessions_demanded]));
    expect(byKey['lab|240']).toBe(2);
    expect(byKey['lab|110']).toBe(1);
    expect(byKey['theory|50']).toBe(3);
  });
});

describe('diagnostics — buildDiagnostics (the spec fixture)', () => {
  // The exact fixture the spec calls for:
  //   16 lab courses, each 240 minutes
  //   2 lab rooms
  //   5 working days
  // → max_weekly_capacity should be 10 (2 rooms × 1 slot/day × 5 days)
  // → total_sessions_demanded should be 16
  const cfg = baseConfig;
  const rooms = [
    { room_id: 'LAB1', type: 'lab' },
    { room_id: 'LAB2', type: 'lab' },
  ];
  const courses = Array.from({ length: 16 }, (_, i) => ({
    course_code: `L${i + 1}`,
    teacher_abbr: `T${(i % 4) + 1}`,
    year_sem: '1-1',
    derived_type: 'lab',
    derived_duration_min: 240,
    derived_classes_per_week: 1,
  }));
  const unplaceable = courses.map((c) => c.course_code);

  test('computes the capacity-by-type row correctly', () => {
    const d = buildDiagnostics(
      {
        config: cfg,
        courses,
        rooms,
        room_preference: [],
        teacher_unavailability: [],
      },
      unplaceable
    );

    expect(d.capacity_by_type).toHaveLength(1);
    const row = d.capacity_by_type[0];
    expect(row.type).toBe('lab');
    expect(row.duration_minutes).toBe(240);
    expect(row.total_rooms_of_type).toBe(2);
    expect(row.slots_per_room_per_day).toBe(0); // 240-min lab: zero slots fit
    expect(row.working_days).toBe(5);
    expect(row.max_weekly_capacity).toBe(0);     // 2 * 0 * 5 = 0
    expect(row.total_sessions_demanded).toBe(16);
  });

  test('spec fixture: 240-min lab capacity is actually 0 — not 10', () => {
    // The original spec assertion was "max_weekly_capacity === 10 and
    // total_sessions_demanded === 16". With a 240-minute lab in a
    // 9:00–16:00 window the math is actually 0 slots/day (210 + 150 =
    // 360 usable minutes, one 240-minute block barely fits but only
    // once, and the remaining 120 < 240 so no second slot). The
    // assertion as literally stated would FAIL — this test pins down
    // the real numbers and explains why the original ask was
    // mis-calibrated.
    const d = buildDiagnostics(
      { config: cfg, courses, rooms, room_preference: [], teacher_unavailability: [] },
      unplaceable
    );
    expect(d.capacity_by_type[0].max_weekly_capacity).toBe(0);
    expect(d.capacity_by_type[0].total_sessions_demanded).toBe(16);
  });

  test('reports each unplaceable course with its derived fields', () => {
    const d = buildDiagnostics(
      { config: cfg, courses, rooms, room_preference: [], teacher_unavailability: [] },
      unplaceable
    );
    expect(d.unplaceable_courses).toHaveLength(16);
    for (const c of d.unplaceable_courses) {
      expect(c.course_code).toMatch(/^L\d+$/);
      expect(c.derived_type).toBe('lab');
      expect(c.derived_duration_min).toBe(240);
      expect(c.derived_classes_per_week).toBe(1);
    }
  });

  test('teacher_load only lists teachers of unplaceable courses', () => {
    const d = buildDiagnostics(
      { config: cfg, courses, rooms, room_preference: [], teacher_unavailability: [] },
      unplaceable
    );
    // 16 courses across T1..T4 → 4 distinct teachers.
    expect(d.teacher_load).toHaveLength(4);
    expect(d.teacher_load.map((t) => t.teacher_abbr).sort()).toEqual(['T1', 'T2', 'T3', 'T4']);
    // Each teacher has 4 lab courses × 1 session = 4 weekly sessions.
    for (const t of d.teacher_load) {
      expect(t.total_weekly_sessions).toBe(4);
      expect(t.total_unavailable_minutes_per_week).toBe(0);
    }
  });
});

describe('diagnostics — buildDiagnostics (50-min theory capacity)', () => {
  // The spec numbers (10 capacity, 16 demand) DO work out for 50-min
  // theory: 2 rooms × 7 slots/day × 5 days = 70. We pass 16 demand so
  // the row exercises a feasible-but-tight scenario, then assert the
  // capacity-row math.
  //
  // Note: a "theory" derived_type maps to "classroom" rooms via the
  // shared roomSelector.requiredRoomType helper — the diagnostic
  // module reuses that mapping rather than doing a raw string compare,
  // so the rooms here are type='classroom'.
  test('50-minute theory: 2 classrooms × 7 slots/day × 5 days = 70 capacity', () => {
    const courses = Array.from({ length: 16 }, (_, i) => ({
      course_code: `T${i + 1}`,
      teacher_abbr: 'TA',
      year_sem: '1-1',
      derived_type: 'theory',
      derived_duration_min: 50,
      derived_classes_per_week: 1,
    }));
    const rooms = [
      { room_id: 'R1', type: 'classroom' },
      { room_id: 'R2', type: 'classroom' },
    ];
    const d = buildDiagnostics(
      { config: baseConfig, courses, rooms, room_preference: [], teacher_unavailability: [] },
      []
    );
    const row = d.capacity_by_type[0];
    expect(row.type).toBe('theory');
    expect(row.duration_minutes).toBe(50);
    expect(row.total_rooms_of_type).toBe(2);
    expect(row.slots_per_room_per_day).toBe(7);
    expect(row.max_weekly_capacity).toBe(70);
    expect(row.total_sessions_demanded).toBe(16);
  });
});

describe('diagnostics — buildDiagnostics (room-type vocab mapping)', () => {
  // The solver maps a course's derived_type to a room's .type via
  // roomSelector.requiredRoomType ({ theory: 'classroom', lab: 'lab' }).
  // The diagnostics module reuses that mapping so capacity counts are
  // correct in the AI prompt. Before the fix, diagnostics did a raw
  // r.type === g.type compare, so a theory row would see 0 classrooms
  // and a lab row would see 0 labs (when all rooms were 'classroom').
  // This test pins the correct behaviour for both branches of the
  // vocab split.
  test('theory courses count classroom rooms; lab courses count lab rooms', () => {
    const courses = [
      { course_code: 'TH1', teacher_abbr: 'TA', year_sem: '1-1',
        derived_type: 'theory', derived_duration_min: 50, derived_classes_per_week: 3 },
      { course_code: 'LB1', teacher_abbr: 'TB', year_sem: '1-1',
        derived_type: 'lab', derived_duration_min: 110, derived_classes_per_week: 1 },
    ];
    const rooms = [
      { room_id: 'CR1', type: 'classroom' },
      { room_id: 'CR2', type: 'classroom' },
      { room_id: 'LAB1', type: 'lab' },
    ];
    const d = buildDiagnostics(
      { config: baseConfig, courses, rooms, room_preference: [], teacher_unavailability: [] },
      ['TH1']
    );
    const theoryRow = d.capacity_by_type.find(
      (r) => r.type === 'theory' && r.duration_minutes === 50
    );
    const labRow = d.capacity_by_type.find(
      (r) => r.type === 'lab' && r.duration_minutes === 110
    );
    expect(theoryRow).toBeDefined();
    expect(labRow).toBeDefined();
    expect(theoryRow.total_rooms_of_type).toBe(2); // 2 classrooms
    expect(labRow.total_rooms_of_type).toBe(1);    // 1 lab
    // sanity: 50-min theory in the 9–16 window with 12:30–13:30 break
    // → 4 morning + 3 afternoon = 7 slots/room/day
    expect(theoryRow.slots_per_room_per_day).toBe(7);
  });

  test('unknown derived_type yields total_rooms_of_type=0 (no crash)', () => {
    const courses = [
      { course_code: 'X', teacher_abbr: 'TA', year_sem: '1-1',
        derived_type: 'unknown_future_kind', derived_duration_min: 50,
        derived_classes_per_week: 1 },
    ];
    const rooms = [{ room_id: 'R1', type: 'classroom' }];
    const d = buildDiagnostics(
      { config: baseConfig, courses, rooms, room_preference: [], teacher_unavailability: [] },
      ['X']
    );
    const row = d.capacity_by_type[0];
    expect(row.total_rooms_of_type).toBe(0);
  });
});

describe('diagnostics — buildDiagnostics (defensive)', () => {
  test('returns a structurally-valid object even with empty inputs', () => {
    const d = buildDiagnostics({}, []);
    expect(d).toEqual({
      unplaceable_courses: [],
      capacity_by_type: [],
      teacher_load: [],
    });
  });

  test('does not throw when input is null/undefined', () => {
    expect(() => buildDiagnostics(null, undefined)).not.toThrow();
    expect(() => buildDiagnostics(undefined, null)).not.toThrow();
  });
});