'use strict';

const XLSX = require('xlsx');
const { parseWorkbook, ParseError, normalizeTimeInput } = require('../src/services/excelParser');

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

  // NEW: Year_Sem master lookup
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
    ['year_sem', 'year', 'semester', 'group_code', 'is_active'],
    ['1-1', 1, 1, '1-2', 'Yes'],
    ['1-2', 1, 2, '1-2', 'No'],
    ['2-1', 2, 1, '1-2', 'No'],
    ['2-2', 2, 2, '1-2', 'No'],
    ['3-1', 3, 1, '3-4', 'No'],
    ['3-2', 3, 2, '3-4', 'No'],
    ['4-1', 4, 1, '3-4', 'No'],
    ['4-2', 4, 2, '3-4', 'No'],
  ]), 'Year_Sem');

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

  // NEW: Day_Preference sheet (Lab weights; Theory auto-complemented by parser)
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
    ['day', 'class_type', 'weight_percent', 'note'],
    ['SUN', 'Lab', 30, null],
    ['MON', 'Lab', 30, null],
    ['TUE', 'Lab', 70, null],
    ['WED', 'Lab', 50, null],
    ['THU', 'Lab', 70, null],
  ]), 'Day_Preference');

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
    // room_preference: parser auto-complements — 2 rooms × 2 groups (1-2 and 3-4) = 4 rows
    expect(wb.room_preference).toHaveLength(4);
    expect(wb.teacher_unavailability).toHaveLength(1);
    // NEW: year_sem and day_preference arrays present
    expect(wb.year_sem).toBeDefined();
    expect(wb.year_sem.length).toBeGreaterThan(0);
    expect(wb.year_sem[0].year_sem).toBe('1-1');
    expect(wb.year_sem[0].is_active).toBe('Yes');
    // day_preference: parser auto-complements — 5 Lab rows → 10 rows (5 Lab + 5 Theory)
    expect(wb.day_preference).toBeDefined();
    expect(wb.day_preference.length).toBe(10);
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

/**
 * Regression: a teacher note row (free-text instructions like
 * "Note: enter periods in HH:MM 24-hour format") that sits below a
 * blank row used to be parsed as a real teacher record, then
 * validation rejected it ("AYR" looked like a teaching day, the note
 * text looked like a teacher_abbr, etc.). The parser must stop at
 * the FIRST fully-blank row and ignore everything after it.
 */
describe('excelParser — stop at first blank row', () => {
  function buildWithTrailingNotes() {
    const wb = XLSX.utils.book_new();

    const teachers = [
      ['full_name', 'abbreviation', 'designation', 'department'],
      ['Dr. Ayesha Rahman',  'AYR', 'Associate Professor', 'CSE'],
      ['Dr. Bikash Chandra', 'BIC', 'Assistant Professor', 'CSE'],
      [],                                                     // blank row → stop here
      ['Note: enter periods in HH:MM 24-hour format, e.g. 09:00'],
      // Below this line nothing should ever appear in the output.
      ['Mr. Ghost Teacher', 'GHO', 'Lecturer', 'CSE'],
      [null, null, null, null],
    ];
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(teachers), 'Teachers');

    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
      ['course_code', 'course_name', 'credit', 'dept', 'year_sem', 'teacher_abbr'],
      ['CSE101', 'Intro to CS',   '3.0', 'CSE', '1-1', 'AYR'],
      [],
      ['NOTE: course codes must match the syllabus'],
    ]), 'Courses');

    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
      ['room_id', 'room_name', 'type'],
      ['R101', 'Room 101', 'classroom'],
      ['R102', 'Lab 102',  'lab'],
    ]), 'Rooms');

    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
      ['credit', 'type', 'classes_per_week', 'duration_minutes'],
      ['3.0', 'theory', 3, 50],
    ]), 'Credit_Rules');

    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
      ['room_id', 'year_group', 'weight_percent'],
      ['R101', '1-2', 100],
    ]), 'Room_Preference');

    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
      ['year_sem', 'year', 'semester', 'group_code', 'is_active'],
      ['1-1', 1, 1, '1-2', 'Yes'],
    ]), 'Year_Sem');

    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
      ['day', 'class_type', 'weight_percent', 'note'],
      ['SUN', 'Lab', 30, null],
    ]), 'Day_Preference');

    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
      ['teacher_abbr', 'day', 'start_time', 'end_time'],
    ]), 'Teacher_Unavailability');

    // Config: real values, then a blank row, then a note.
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
      ['key',          'value'],
      ['university',   'Gopalganj Science and Technology University'],
      ['working_days', 'SUN,MON,TUE,WED,THU'],
      [],
      ['Note: any future settings will be listed below'],
      ['bogus_key',    'should_be_ignored'],
    ]), 'Config');

    return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  }

  test('Teachers: ignores note + ghost row after first blank row', () => {
    const buf = buildWithTrailingNotes();
    const result = parseWorkbook(buf, 'notes.xlsx');

    expect(result.teachers).toHaveLength(2);
    expect(result.teachers.map(t => t.abbreviation)).toEqual(['AYR', 'BIC']);
    // The note text and the ghost teacher must never appear.
    const flatText = JSON.stringify(result.teachers);
    expect(flatText).not.toMatch(/Note:/);
    expect(flatText).not.toMatch(/Ghost/);
    expect(flatText).not.toMatch(/HH:MM/);
  });

  test('Courses: ignores note row after first blank row', () => {
    const buf = buildWithTrailingNotes();
    const result = parseWorkbook(buf, 'notes.xlsx');
    expect(result.courses).toHaveLength(1);
    expect(result.courses[0].course_code).toBe('CSE101');
    const flatText = JSON.stringify(result.courses);
    expect(flatText).not.toMatch(/NOTE/);
    expect(flatText).not.toMatch(/syllabus/);
  });

  test('Config: ignores bogus key after first blank row', () => {
    const buf = buildWithTrailingNotes();
    const result = parseWorkbook(buf, 'notes.xlsx');
    expect(result.config.university).toBe('Gopalganj Science and Technology University');
    expect(result.config.working_days).toBe('SUN,MON,TUE,WED,THU');
    expect(result.config.bogus_key).toBeUndefined();
    expect(result.config.note).toBeUndefined();
  });

  test('Internal blank row also stops the data block (no rows after reappear)', () => {
    // Even if a real-looking row appears after the first blank, the
    // parser must keep ignoring it. This protects against an edge
    // where data accidentally spans two visual sections.
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
      ['full_name', 'abbreviation', 'designation', 'department'],
      ['Real Teacher', 'REA', 'Lecturer', 'CSE'],
      [],
      ['Should Not Appear', 'SNA', 'Lecturer', 'CSE'],
    ]), 'Teachers');

    // The other sheets must exist or parseWorkbook rejects the file.
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['course_code','course_name','credit','dept','year_sem','teacher_abbr'],['CSE101','Intro','3','CSE','1-1','REA']]), 'Courses');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['year_sem','year','semester','group_code','is_active'],['1-1',1,1,'1-2','Yes']]), 'Year_Sem');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['room_id','room_name','type'],['R101','Room 101','classroom']]), 'Rooms');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['credit','type','classes_per_week','duration_minutes'],['3','theory',3,50]]), 'Credit_Rules');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['room_id','year_group','weight_percent'],['R101','1-2',100]]), 'Room_Preference');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['day','class_type','weight_percent','note'],['SUN','Lab',30,null]]), 'Day_Preference');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['teacher_abbr','day','start_time','end_time']]), 'Teacher_Unavailability');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['key','value'],['working_days','SUN,MON']]), 'Config');

    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    const result = parseWorkbook(buf, 'split.xlsx');
    expect(result.teachers).toHaveLength(1);
    expect(result.teachers[0].abbreviation).toBe('REA');
  });

  test('All-empty sheet body (just header + blanks) returns []', () => {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
      ['full_name', 'abbreviation', 'designation', 'department'],
      [],
      [],
      [],
    ]), 'Teachers');

    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['course_code','course_name','credit','dept','year_sem','teacher_abbr'],['CSE101','Intro','3','CSE','1-1','REA']]), 'Courses');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['year_sem','year','semester','group_code','is_active'],['1-1',1,1,'1-2','Yes']]), 'Year_Sem');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['room_id','room_name','type'],['R101','Room 101','classroom']]), 'Rooms');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['credit','type','classes_per_week','duration_minutes'],['3','theory',3,50]]), 'Credit_Rules');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['room_id','year_group','weight_percent'],['R101','1-2',100]]), 'Room_Preference');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['day','class_type','weight_percent','note'],['SUN','Lab',30,null]]), 'Day_Preference');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['teacher_abbr','day','start_time','end_time']]), 'Teacher_Unavailability');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['key','value'],['working_days','SUN,MON']]), 'Config');

    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    const result = parseWorkbook(buf, 'empty.xlsx');
    expect(result.teachers).toEqual([]);
  });
 
  describe('Template v2 parsing features', () => {
    test('parses workbook with asterisks in headers and extra status/helper columns', () => {
      const wb = XLSX.utils.book_new();
      // Summary sheet - should be skipped
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['Summary Info', 123]]), 'Summary');

      // Teachers with asterisks and trailing status column
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
        ['full_name *', 'abbreviation *', 'designation *', 'department *', 'status'],
        ['Dr. Ayesha Rahman', 'AYR', 'Professor', 'CSE', 'OK'],
      ]), 'Teachers');

      // Courses with asterisks and trailing status
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
        ['course_code *', 'course_name *', 'credit *', 'dept *', 'year_sem *', 'teacher_abbr *', 'status'],
        ['CSE101', 'Intro to CS', '3', 'CSE', '1-1', 'AYR', 'OK'],
      ]), 'Courses');

      // Year_Sem with helpers and status
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
        ['year_sem *', 'year *', 'semester *', 'group_code *', 'is_active *', 'active_year_sem_helper', 'active_sequence_helper', 'status'],
        ['1-1', 1, 1, '1-2', 'Yes', '1-1', 1, 'OK'],
      ]), 'Year_Sem');

      // Rooms
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
        ['room_id *', 'room_name *', 'type *', 'status'],
        ['R407', 'Room 407', 'lab', 'OK'],
      ]), 'Rooms');

      // Credit_Rules
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
        ['credit *', 'type *', 'classes_per_week *', 'duration_minutes *', 'status'],
        ['3', 'Theory', 3, 50, 'OK'],
      ]), 'Credit_Rules');

      // Room_Preference - single row -> should auto-generate complement (3-4 with weight 70)
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
        ['room_id *', 'year_group *', 'weight_percent *', 'status'],
        ['R407', '1-2', 30, 'OK'],
      ]), 'Room_Preference');

      // Day_Preference - single row -> should auto-generate complement (Theory with weight 60)
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
        ['day *', 'class_type *', 'weight_percent *', 'status'],
        ['SUN', 'Lab', 40, 'OK'],
      ]), 'Day_Preference');

      // Teacher_Unavailability
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
        ['teacher_abbr *', 'day *', 'start_time *', 'end_time *', 'status'],
        ['AYR', 'SUN', '09:00', '10:00', 'OK'],
      ]), 'Teacher_Unavailability');

      // Config with 3 columns (key, value, status) and new keys
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
        ['key', 'value', 'status'],
        ['university', 'Gopalganj Science and Technology University', 'OK'],
        ['faculty', 'Engineering Faculty', null],
        ['department', 'CSE', null],
        ['year', 2026, null],
        ['semester', 'Fall', null],
        ['working_days', 'SUN,MON,TUE,WED,THU', null],
        ['class_start', '09:00', null],
        ['class_end', '15:50', null],
      ]), 'Config');

      // Lists sheet with row 1 headers
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
        ['Config_Year', 'Config_Semester', 'Faculty', 'Department_Full', 'dep_Engineering_Faculty'],
        [2026, 'Fall', 'Engineering Faculty', 'CSE', 'CSE'],
      ]), 'Lists');

      const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
      const result = parseWorkbook(buf, 'v2_sample.xlsx');

      expect(result.teachers).toHaveLength(1);
      expect(result.teachers[0].department).toBe('CSE');
      expect(result.teachers[0].status).toBeUndefined();

      expect(result.courses).toHaveLength(1);
      expect(result.courses[0].dept).toBe('CSE');

      expect(result.config.faculty).toBe('Engineering Faculty');
      expect(result.config.department).toBe('CSE');
      expect(result.config.year).toBe('2026');
      expect(result.config.semester).toBe('Fall');

      // Auto-complement room preference
      expect(result.room_preference).toHaveLength(2);
      expect(result.room_preference[0]).toEqual({ room_id: 'R407', year_group: '1-2', weight_percent: '30' });
      expect(result.room_preference[1]).toEqual({ room_id: 'R407', year_group: '3-4', weight_percent: '70' });

      // Auto-complement day preference
      expect(result.day_preference).toHaveLength(2);
      expect(result.day_preference[0]).toEqual({ day: 'SUN', class_type: 'Lab', weight_percent: '40' });
      expect(result.day_preference[1]).toEqual({ day: 'SUN', class_type: 'Theory', weight_percent: '60' });

      // Lists parsed
      expect(result.lists).toBeDefined();
      expect(result.lists.faculties).toContain('Engineering Faculty');
      expect(result.lists.departments).toContain('CSE');
    });

    test('round-trips the actual backend/contents routine template file', () => {
      const fs = require('fs');
      const path = require('path');
      const contentsDir = path.resolve(__dirname, '../contents');
      let filePath = path.join(contentsDir, 'Routine_template.xlsx');
      if (!fs.existsSync(filePath)) {
        filePath = path.join(contentsDir, 'Routine_Template.xlsx');
      }
      if (!fs.existsSync(filePath)) {
        const match = fs.readdirSync(contentsDir).find(f => f.toLowerCase().endsWith('.xlsx') && f.toLowerCase().includes('routine'));
        if (match) filePath = path.join(contentsDir, match);
      }
      if (fs.existsSync(filePath)) {
        const buf = fs.readFileSync(filePath);
        const result = parseWorkbook(buf, path.basename(filePath));

        expect(result.config.faculty).toBe('Engineering Faculty');
        expect(result.config.department).toBeDefined();
        expect(result.config.year).toBe('2026');
        expect(result.config.semester).toBe('Fall');
        expect(result.teachers.length).toBeGreaterThan(0);
        expect(result.courses.length).toBeGreaterThan(0);
        expect(result.rooms.length).toBeGreaterThan(0);
        expect(result.room_preference.length).toBeGreaterThan(0);
        expect(result.day_preference.length).toBeGreaterThan(0);
        expect(result.year_sem.length).toBeGreaterThan(0);
        expect(result.credit_rules.length).toBeGreaterThan(0);
      }
    });
  });

  describe('normalizeTimeInput', () => {
    test('converts Excel day fractions to HH:MM format', () => {
      expect(normalizeTimeInput(0.5486111111111112)).toBe('13:10');
      expect(normalizeTimeInput(0.5902777777777778)).toBe('14:10');
      expect(normalizeTimeInput('0.375')).toBe('09:00');
    });

    test('converts 12h AM/PM format to HH:MM format', () => {
      expect(normalizeTimeInput('1:10 PM')).toBe('13:10');
      expect(normalizeTimeInput('9 AM')).toBe('09:00');
      expect(normalizeTimeInput('12:30 AM')).toBe('00:30');
      expect(normalizeTimeInput('12:00 PM')).toBe('12:00');
    });

    test('normalizes 24h format', () => {
      expect(normalizeTimeInput('13:10')).toBe('13:10');
      expect(normalizeTimeInput('09:00:00')).toBe('09:00');
    });

    test('converts plain integer hour to HH:MM format', () => {
      expect(normalizeTimeInput(9)).toBe('09:00');
      expect(normalizeTimeInput('13')).toBe('13:00');
    });

    test('returns invalid values as-is', () => {
      expect(normalizeTimeInput('INVALID')).toBe('INVALID');
      expect(normalizeTimeInput('')).toBeNull();
      expect(normalizeTimeInput(null)).toBeNull();
    });
  });
});