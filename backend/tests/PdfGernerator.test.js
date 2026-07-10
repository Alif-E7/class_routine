'use strict';

/**
 * Unit tests for the PdfGernerator service.
 */

const {
  generateRoutinePdf,
  _internal,
  DEFAULT_DAYS,
  DEFAULT_YEAR_SEM_ORDER,
} = require('../src/services/PdfGernerator');

describe('PdfGernerator — pure helpers', () => {
  test('fmtTime formats "HH:MM" to 12-hour am/pm', () => {
    expect(_internal.fmtTime('09:00')).toBe('9:00am');
    expect(_internal.fmtTime('13:05')).toBe('1:05pm');
    expect(_internal.fmtTime('00:30')).toBe('12:30am');
    expect(_internal.fmtTime('12:00')).toBe('12:00pm');
    expect(_internal.fmtTime('23:45')).toBe('11:45pm');
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
    // Strings now, sorted by hhmmToMin
    const a = [
      { slot_start: '13:30', slot_end: '14:20' },
      { slot_start: '09:00', slot_end: '09:50' },
      { slot_start: '11:40', slot_end: '12:30' },
      { slot_start: '09:00', slot_end: '09:50' }, // duplicate
    ];
    expect(_internal.collectSlotColumns(a)).toEqual(['09:00', '11:40', '13:30']);
  });

  test('collectSlotLabels pairs each start with its end', () => {
    const a = [
      { slot_start: '09:00', slot_end: '09:50' },
      { slot_start: '10:00', slot_end: '10:50' },
    ];
    expect(_internal.collectSlotLabels(a)).toEqual([
      { start: '09:00', end: '09:50', label: '9:00am-9:50am' },
      { start: '10:00', end: '10:50', label: '10:00am-10:50am' },
    ]);
  });

  test('deriveYearSemOrder uses the photo-faithful display order', () => {
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
      { slot_start: '09:00', slot_end: '09:50' },
      { slot_start: '09:50', slot_end: '10:40' },
      { slot_start: '13:00', slot_end: '13:50' }, // gap is from 10:40 to 13:00 (140 mins)
      { slot_start: '13:50', slot_end: '14:40' },
    ];
    expect(_internal.findBreakStart(assignments, {})).toBe(780); // 13:00 = 780 mins
  });

  test('findBreakStart falls back to config.break_start when no big gap', () => {
    const assignments = [
      { slot_start: '09:00', slot_end: '09:50' },
      { slot_start: '09:50', slot_end: '10:40' },
      { slot_start: '10:40', slot_end: '11:30' },
    ];
    expect(
      _internal.findBreakStart(assignments, { break_start: '13:00' })
    ).toBe(780);
  });

  test('cellLinesFor returns [course_teacher, room]', () => {
    const lines = _internal.cellLinesFor({
      course_code: 'CSE101',
      teacher_abbr: 'AYR',
      room_id: 'R101',
    });
    expect(lines).toEqual(['CSE101, AYR', 'R101']);
  });
});

describe('PdfGernerator — full pipeline', () => {
  const SAMPLE_ASSIGNMENTS = [
    { course_code: 'CSE101', teacher_abbr: 'AYR', room_id: 'R101',
      day: 'SUN', slot_start: '09:00', slot_end: '09:50', year_sem: '1-1', session_index: 0 },
    { course_code: 'CSE102', teacher_abbr: 'BIC', room_id: 'R102',
      day: 'SUN', slot_start: '10:00', slot_end: '10:50', year_sem: '1-1', session_index: 0 },
    { course_code: 'CSE201', teacher_abbr: 'TAN', room_id: 'R201',
      day: 'MON', slot_start: '13:00', slot_end: '13:50', year_sem: '2-2', session_index: 0 },
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
    const buf = await generateRoutinePdf({
      assignments: SAMPLE_ASSIGNMENTS,
      header: SAMPLE_HEADER,
      teachers: SAMPLE_TEACHERS,
    });
    expect(Buffer.isBuffer(buf)).toBe(true);
    expect(buf.length).toBeGreaterThan(1000);
    expect(buf[0]).toBe(0x50);
    expect(buf[1]).toBe(0x4b);
    expect(buf[2]).toBe(0x03);
    expect(buf[3]).toBe(0x04);
  });

  test('handles empty assignments gracefully (no exception, no grid)', async () => {
    const buf = await generateRoutinePdf({
      assignments: [],
      header: SAMPLE_HEADER,
      teachers: SAMPLE_TEACHERS,
    });
    expect(Buffer.isBuffer(buf)).toBe(true);
    expect(buf.length).toBeGreaterThan(500);
  });

  test('handles empty teachers list (no legend table)', async () => {
    const buf = await generateRoutinePdf({
      assignments: SAMPLE_ASSIGNMENTS,
      header: SAMPLE_HEADER,
      teachers: [],
    });
    expect(Buffer.isBuffer(buf)).toBe(true);
    expect(buf.length).toBeGreaterThan(500);
  });

  test('handles all-empty input without crashing', async () => {
    const buf = await generateRoutinePdf({
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
    const buf = await generateRoutinePdf({
      assignments: SAMPLE_ASSIGNMENTS,
      header: SAMPLE_HEADER,
      teachers: SAMPLE_TEACHERS,
      days: ['FRI', 'SAT'],
    });
    expect(Buffer.isBuffer(buf)).toBe(true);
  });
});
