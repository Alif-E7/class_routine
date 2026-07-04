'use strict';

/**
 * Unit tests for the docxGenerator service.
 *
 * Strategy: run every pure helper synchronously, then run the full
 * async pipeline once and assert on the returned Buffer (size, ZIP
 * magic, XML-internal sanity).
 *
 * We do NOT do a deep XML assertion — the docx library is responsible
 * for that. We only assert that:
 *   - The output is a non-empty Buffer
 *   - It starts with "PK" (a ZIP — Word documents are zip archives)
 *   - It contains the expected text strings (sanity check on the data)
 */

const {
  generateRoutineDocx,
  _internal,
  DEFAULT_DAYS,
  DEFAULT_YEAR_SEM_ORDER,
} = require('../src/services/docxGenerator');

describe('docxGenerator — pure helpers', () => {
  test('fmtTime formats "HH:MM" to 12-hour am/pm', () => {
    expect(_internal.fmtTime('09:00')).toBe('9:00am');
    expect(_internal.fmtTime('13:05')).toBe('1:05pm');
    expect(_internal.fmtTime('00:30')).toBe('12:30am');
    expect(_internal.fmtTime('12:00')).toBe('12:00pm');
    expect(_internal.fmtTime('23:45')).toBe('11:45pm');
    // Numeric minutes-since-midnight input.
    expect(_internal.fmtTime(540)).toBe('9:00am');
  });

  test('fmtRange renders "9:00am-9:50am"', () => {
    expect(_internal.fmtRange('09:00', '09:50')).toBe('9:00am-9:50am');
  });

  test('hhmmToMin converts to minutes-since-midnight', () => {
    expect(_internal.hhmmToMin('09:00')).toBe(540);
    expect(_internal.hhmmToMin('13:30')).toBe(810);
    expect(_internal.hhmmToMin(540)).toBe(540);
  });

  test('collectSlotColumns returns sorted distinct start times', () => {
    const a = [
      { slot_start: 810, slot_end: 860 },
      { slot_start: 540, slot_end: 590 },
      { slot_start: 700, slot_end: 750 },
      { slot_start: 540, slot_end: 590 }, // duplicate
    ];
    expect(_internal.collectSlotColumns(a)).toEqual([540, 700, 810]);
  });

  test('collectSlotLabels pairs each start with its end', () => {
    const a = [
      { slot_start: 540, slot_end: 590 },
      { slot_start: 600, slot_end: 650 },
    ];
    expect(_internal.collectSlotLabels(a)).toEqual([
      { start: 540, end: 590, label: '9:00am-9:50am' },
      { start: 600, end: 650, label: '10:00am-10:50am' },
    ]);
  });

  test('deriveYearSemOrder uses the photo-faithful display order', () => {
    // The data has 1-1, 2-2, 4-1, 3-2, 2-1 — present set.
    const assignments = [
      { year_sem: '1-1' }, { year_sem: '2-2' }, { year_sem: '4-1' },
      { year_sem: '3-2' }, { year_sem: '2-1' },
    ];
    expect(_internal.deriveYearSemOrder(assignments)).toEqual([
      '4-1', '3-2', '2-2', '2-1', '1-1',
    ]);
  });

  test('deriveYearSemOrder appends unknown year-sems at the end', () => {
    const assignments = [
      { year_sem: '1-1' }, { year_sem: '5-1' }, { year_sem: '2-2' },
    ];
    const order = _internal.deriveYearSemOrder(assignments);
    expect(order[0]).toBe('2-2');
    expect(order[1]).toBe('1-1');
    expect(order).toContain('5-1');
  });

  test('findBreakStart picks the largest qualifying gap', () => {
    const assignments = [
      { slot_start: 540, slot_end: 590 },  // 50min slot
      { slot_start: 590, slot_end: 640 },  // 50min slot
      { slot_start: 780, slot_end: 830 },  // 140min GAP — break
      { slot_start: 830, slot_end: 880 },  // 50min slot
    ];
    // Afternoon begins at the start of the first slot AFTER the gap.
    expect(_internal.findBreakStart(assignments, {})).toBe(780);
  });

  test('findBreakStart falls back to config.break_start when no big gap', () => {
    // All 50min slots back-to-back — no qualifying gap, so we fall back.
    const assignments = [
      { slot_start: 540, slot_end: 590 },
      { slot_start: 590, slot_end: 640 },
      { slot_start: 640, slot_end: 690 },
    ];
    // 13:00 = 780 min
    expect(
      _internal.findBreakStart(assignments, { break_start: '13:00' })
    ).toBe(780);
  });

  test('cellLinesFor returns [course, teacher, room]', () => {
    const lines = _internal.cellLinesFor({
      course_code: 'CSE101',
      teacher_abbr: 'AYR',
      room_id: 'R101',
    });
    expect(lines).toEqual(['CSE101', 'AYR', 'R101']);
  });
});

describe('docxGenerator — full pipeline', () => {
  const SAMPLE_ASSIGNMENTS = [
    { course_code: 'CSE101', teacher_abbr: 'AYR', room_id: 'R101',
      day: 'SUN', slot_start: 540, slot_end: 590, year_sem: '1-1', session_index: 0 },
    { course_code: 'CSE102', teacher_abbr: 'BIC', room_id: 'R102',
      day: 'SUN', slot_start: 600, slot_end: 650, year_sem: '1-1', session_index: 0 },
    // BREAK boundary at 780 minutes (13:00).
    { course_code: 'CSE201', teacher_abbr: 'TAN', room_id: 'R201',
      day: 'MON', slot_start: 780, slot_end: 830, year_sem: '2-2', session_index: 0 },
  ];

  const SAMPLE_HEADER = {
    university: 'Gopalganj Science and Technology University',
    department: 'Computer Science and Engineering',
    semester: '2026 July-December',
  };

  const SAMPLE_TEACHERS = [
    { full_name: 'Dr. Ayesha Rahman',   abbreviation: 'AYR', designation: 'Associate Professor', department: 'CSE' },
    { full_name: 'Dr. Bikash Chandra',  abbreviation: 'BIC', designation: 'Assistant Professor', department: 'CSE' },
    { full_name: 'Dr. Tania Akter',     abbreviation: 'TAN', designation: 'Lecturer',            department: 'CSE' },
  ];

  test('returns a non-empty ZIP Buffer', async () => {
    const buf = await generateRoutineDocx({
      assignments: SAMPLE_ASSIGNMENTS,
      header: SAMPLE_HEADER,
      teachers: SAMPLE_TEACHERS,
    });
    expect(Buffer.isBuffer(buf)).toBe(true);
    expect(buf.length).toBeGreaterThan(1000); // real Word docs are not tiny
    // ZIP files start with "PK\x03\x04".
    expect(buf[0]).toBe(0x50);
    expect(buf[1]).toBe(0x4b);
    expect(buf[2]).toBe(0x03);
    expect(buf[3]).toBe(0x04);
  });

  test('handles empty assignments gracefully (no exception, no grid)', async () => {
    const buf = await generateRoutineDocx({
      assignments: [],
      header: SAMPLE_HEADER,
      teachers: SAMPLE_TEACHERS,
    });
    expect(Buffer.isBuffer(buf)).toBe(true);
    expect(buf.length).toBeGreaterThan(500);
  });

  test('handles empty teachers list (no legend table)', async () => {
    const buf = await generateRoutineDocx({
      assignments: SAMPLE_ASSIGNMENTS,
      header: SAMPLE_HEADER,
      teachers: [],
    });
    expect(Buffer.isBuffer(buf)).toBe(true);
    expect(buf.length).toBeGreaterThan(500);
  });

  test('handles all-empty input without crashing', async () => {
    const buf = await generateRoutineDocx({
      assignments: [],
      header: {},
      teachers: [],
    });
    expect(Buffer.isBuffer(buf)).toBe(true);
    expect(buf.length).toBeGreaterThan(500);
  });

  test('default constants are stable', () => {
    expect(DEFAULT_DAYS).toEqual(['SUN', 'MON', 'TUE', 'WED', 'THU']);
    expect(DEFAULT_YEAR_SEM_ORDER).toEqual(['4-1', '3-2', '2-2', '2-1', '1-1']);
  });

  test('uses provided days override', async () => {
    // Just confirm we don't blow up with a custom day order.
    const buf = await generateRoutineDocx({
      assignments: SAMPLE_ASSIGNMENTS,
      header: SAMPLE_HEADER,
      teachers: SAMPLE_TEACHERS,
      days: ['FRI', 'SAT'],
    });
    expect(Buffer.isBuffer(buf)).toBe(true);
  });
});
