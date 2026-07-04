'use strict';

const XLSX = require('xlsx');
const { parseWorkbook, ParseError } = require('../src/services/excelParser');

/**
 * Build a real .xlsx buffer in-memory using SheetJS. The workbook has
 * a title row before the header on the Teachers sheet to exercise
 * the dynamic header-row detection.
 */
function buildXlsxBuffer({ breakHeaderRow = false } = {}) {
  const wb = XLSX.utils.book_new();

  // Teachers — with optional title row before header.
  const teachersRows = breakHeaderRow
    ? [
        ['CSE Routine Generator — Teacher List'],   // title row
        ['full_name', 'abbreviation', 'designation', 'department'],
        ['Dr. Ayesha Rahman',  'AYR', 'Associate Professor', 'CSE'],
        ['Dr. Bikash Chandra', 'BIC', 'Assistant Professor', 'CSE'],
      ]
    : [
        ['full_name', 'abbreviation', 'designation', 'department'],
        ['Dr. Ayesha Rahman',  'AYR', 'Associate Professor', 'CSE'],
        ['Dr. Bikash Chandra', 'BIC', 'Assistant Professor', 'CSE'],
      ];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(teachersRows), 'Teachers');

  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
    ['course_code', 'course_name', 'credit', 'dept', 'year_sem', 'teacher_abbr'],
    ['CSE101', 'Intro to CS',   '3.0', 'CSE', '1-1', 'AYR'],
    ['CSE102', 'Discrete Math', '2.0', 'CSE', '1-1', 'BIC'],
  ]), 'Courses');

  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
    ['room_id', 'room_name', 'type'],
    ['R101', 'Room 101', 'classroom'],
    ['R102', 'Lab 102',  'lab'],
  ]), 'Rooms');

  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
    ['credit', 'type', 'classes_per_week', 'duration_minutes'],
    ['3.0', 'theory', 3, 50],
    ['2.0', 'theory', 2, 50],
  ]), 'Credit_Rules');

  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
    ['room_id', 'year_group', 'weight_percent'],
    ['R101', '1-2', 100],
    ['R102', '3-4', 100],
  ]), 'Room_Preference');

  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
    ['teacher_abbr', 'day', 'start_time', 'end_time'],
    ['AYR', 'FRI', '14:00', '15:00'],
  ]), 'Teacher_Unavailability');

  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
    ['key',          'value'],
    ['university',   'Gopalganj Science and Technology University'],
    ['working_days', 'SUN,MON,TUE,WED,THU'],
    ['class_start',  '09:00'],
    ['class_end',    '15:50'],
    ['break_start',  '13:00'],
    ['break_end',    '14:00'],
  ]), 'Config');

  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
}

describe('excelParser — round-trip', () => {
  test('parses a standard header-at-row-0 workbook', () => {
    const buf = buildXlsxBuffer();
    const wb = parseWorkbook(buf, 'standard.xlsx');

    expect(wb.filename).toBe('standard.xlsx');
    expect(wb.teachers).toHaveLength(2);
    expect(wb.teachers[0].abbreviation).toBe('AYR');
    expect(wb.courses).toHaveLength(2);
    expect(wb.courses[0].course_code).toBe('CSE101');
    expect(wb.rooms).toHaveLength(2);
    expect(wb.rooms[0].type).toBe('classroom');
    expect(wb.credit_rules).toHaveLength(2);
    expect(wb.room_preference).toHaveLength(2);
    expect(wb.teacher_unavailability).toHaveLength(1);
    expect(wb.config.working_days).toBe('SUN,MON,TUE,WED,THU');
    expect(wb.config.class_start).toBe('09:00');
  });

  test('finds the header row even with a title row above it', () => {
    const buf = buildXlsxBuffer({ breakHeaderRow: true });
    const wb = parseWorkbook(buf, 'titled.xlsx');
    expect(wb.teachers).toHaveLength(2);
    expect(wb.teachers[0].abbreviation).toBe('AYR');
  });

  test('throws ParseError for missing required sheets', () => {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['a','b']]), 'Teachers');
    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    expect(() => parseWorkbook(buf, 'short.xlsx')).toThrow(ParseError);
  });
});