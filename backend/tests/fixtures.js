'use strict';

/**
 * Builds the "intentionally broken" test workbook that the build
 * prompt task 2 requires:
 *   - missing teacher_abbr (V1)
 *   - unknown credit value (V2)
 *   - bad weight sums (V7, warning)
 *   - bad config window order (V8)
 *   - invalid room type (V4)
 *   - duplicate course_code (V5)
 *   - duplicate abbreviation (V6)
 *   - unavailability start_time >= end_time (V9)
 *   - room_id in Room_Preference that doesn't exist (V3)
 *   - course year_sem not in Year_Sem (V11)
 *   - Year_Sem.is_active invalid value (V12)
 *   - Year_Sem.group_code invalid value (V14)
 *
 * Returns the JSON-shaped workbook as excelParser would produce it,
 * suitable for feeding straight into validators.validate().
 */

function buildBrokenWorkbook() {
  return {
    filename: 'broken-sample.xlsx',
    teachers: [
      { full_name: 'Dr. Ayesha Rahman',  abbreviation: 'AYR', designation: 'Associate Professor', department: 'CSE' },
      { full_name: 'Dr. Bikash Chandra', abbreviation: 'BIC', designation: 'Assistant Professor', department: 'CSE' },
      { full_name: 'Dr. Tania Akter',     abbreviation: 'TAN', designation: 'Lecturer',           department: 'CSE' },
      // Duplicate abbreviation (V6) — same as TAN.
      { full_name: 'Dr. Tareq Aziz',     abbreviation: 'TAN', designation: 'Lecturer',           department: 'CSE' },
    ],
    // year_sem — intentionally broken: bad is_active (V12) and bad group_code (V14).
    // CSE104 references year_sem '2-1' which is NOT in this list (V11).
    year_sem: [
      { year_sem: '1-1', year: '1', semester: '1', group_code: '1-2',  is_active: 'Yes' },
      { year_sem: '1-2', year: '1', semester: '2', group_code: '1-2',  is_active: 'Yes' },
      { year_sem: '2-2', year: '2', semester: '2', group_code: 'NOPE', is_active: 'Maybe' }, // V12 + V14
    ],
    courses: [
      { course_code: 'CSE101', course_name: 'Intro to CS',     credit: '3.0', dept: 'CSE', year_sem: '1-1', teacher_abbr: 'AYR' },
      { course_code: 'CSE102', course_name: 'Discrete Math',   credit: '3.0', dept: 'CSE', year_sem: '1-1', teacher_abbr: 'BIC' },
      // V1 — unknown teacher_abbr.
      { course_code: 'CSE103', course_name: 'English',         credit: '2.0', dept: 'CSE', year_sem: '1-2', teacher_abbr: 'XYZ' },
      // V2 — credit 9.9 has no rule. V11 — year_sem '2-1' not in Year_Sem.
      { course_code: 'CSE104', course_name: 'Mystery Course',  credit: '9.9', dept: 'CSE', year_sem: '2-1', teacher_abbr: 'AYR' },
      // V5 — duplicate course_code.
      { course_code: 'CSE101', course_name: 'Intro to CS dup', credit: '3.0', dept: 'CSE', year_sem: '1-1', teacher_abbr: 'BIC' },
    ],
    rooms: [
      { room_id: 'R101', room_name: 'Room 101', type: 'classroom' },
      { room_id: 'R102', room_name: 'Room 102', type: 'lab' },
      // V4 — invalid room type.
      { room_id: 'R103', room_name: 'Room 103', type: 'auditorium' },
    ],
    credit_rules: [
      { credit: '3.0', type: 'theory', classes_per_week: '3', duration_minutes: '50' },
      { credit: '2.0', type: 'theory', classes_per_week: '2', duration_minutes: '50' },
    ],
    room_preference: [
      // V3 — R999 doesn't exist.
      { room_id: 'R999', year_group: '1-2', weight_percent: '40.00' },
      // V7 — weights for (classroom, 1-2) sum to 150, not ≈100.
      { room_id: 'R101', year_group: '1-2', weight_percent: '90.00' },
      { room_id: 'R101', year_group: '1-2', weight_percent: '60.00' },
      // Valid weight row.
      { room_id: 'R102', year_group: '3-4', weight_percent: '100.00' },
    ],
    // V13 — Day_Preference for MON sums to 110, not ≈100 (warning).
    day_preference: [
      { day: 'SUN', class_type: 'Lab',    weight_percent: '30' },
      { day: 'SUN', class_type: 'Theory', weight_percent: '70' },
      { day: 'MON', class_type: 'Lab',    weight_percent: '60' },
      { day: 'MON', class_type: 'Theory', weight_percent: '50' }, // sum = 110 → V13 warning
    ],
    teacher_unavailability: [
      // V9 — start >= end.
      { teacher_abbr: 'AYR', day: 'SUN', start_time: '12:00', end_time: '10:00' },
      // V1 — unknown teacher.
      { teacher_abbr: 'NOPE', day: 'MON', start_time: '09:00', end_time: '10:00' },
      // Valid row.
      { teacher_abbr: 'BIC', day: 'FRI', start_time: '14:00', end_time: '15:00' },
    ],
    config: {
      // V8 — every window-ordering rule fires:
      //   break_start (15:00) > break_end (10:00)    → rule 1
      //   class_start (16:00) > break_start (15:00)  → rule 2
      //   break_end   (10:00) >= class_end (09:00)   → rule 3
      university:    'Gopalganj Science and Technology University',
      department:    'Computer Science and Engineering',
      semester:      '2026 July-December',
      working_days:  'SUN,MON,TUE,WED,THU',
      class_start:   '16:00',
      class_end:     '09:00',
      break_start:   '15:00',
      break_end:     '10:00',
    },
  };
}

/**
 * Build a clean (valid) workbook for the "no errors" baseline test.
 * Includes all 9 required sheets.
 */
function buildCleanWorkbook() {
  return {
    filename: 'clean-sample.xlsx',
    teachers: [
      { full_name: 'Dr. Ayesha Rahman',  abbreviation: 'AYR', designation: 'Associate Professor', department: 'CSE' },
      { full_name: 'Dr. Bikash Chandra', abbreviation: 'BIC', designation: 'Assistant Professor', department: 'CSE' },
    ],
    // NEW: Year_Sem master lookup — courses reference '1-1' which must exist here.
    year_sem: [
      { year_sem: '1-1', year: '1', semester: '1', group_code: '1-2', is_active: 'Yes' },
      { year_sem: '1-2', year: '1', semester: '2', group_code: '1-2', is_active: 'No' },
      { year_sem: '2-1', year: '2', semester: '1', group_code: '1-2', is_active: 'No' },
      { year_sem: '2-2', year: '2', semester: '2', group_code: '1-2', is_active: 'No' },
      { year_sem: '3-1', year: '3', semester: '1', group_code: '3-4', is_active: 'No' },
      { year_sem: '3-2', year: '3', semester: '2', group_code: '3-4', is_active: 'No' },
      { year_sem: '4-1', year: '4', semester: '1', group_code: '3-4', is_active: 'No' },
      { year_sem: '4-2', year: '4', semester: '2', group_code: '3-4', is_active: 'No' },
    ],
    courses: [
      { course_code: 'CSE101', course_name: 'Intro to CS',   credit: '3.0', dept: 'CSE', year_sem: '1-1', teacher_abbr: 'AYR' },
      { course_code: 'CSE102', course_name: 'Discrete Math', credit: '2.0', dept: 'CSE', year_sem: '1-1', teacher_abbr: 'BIC' },
    ],
    rooms: [
      { room_id: 'R101', room_name: 'Room 101', type: 'classroom' },
      { room_id: 'R102', room_name: 'Room 102', type: 'lab' },
    ],
    credit_rules: [
      { credit: '3.0', type: 'theory', classes_per_week: '3', duration_minutes: '50' },
      { credit: '2.0', type: 'theory', classes_per_week: '2', duration_minutes: '50' },
    ],
    room_preference: [
      { room_id: 'R101', year_group: '1-2', weight_percent: '100.00' },
      { room_id: 'R102', year_group: '3-4', weight_percent: '100.00' },
    ],
    // NEW: Day_Preference — valid weights per day sum to 100.
    day_preference: [
      { day: 'SUN', class_type: 'Lab',    weight_percent: '30' },
      { day: 'SUN', class_type: 'Theory', weight_percent: '70' },
      { day: 'MON', class_type: 'Lab',    weight_percent: '30' },
      { day: 'MON', class_type: 'Theory', weight_percent: '70' },
      { day: 'TUE', class_type: 'Lab',    weight_percent: '70' },
      { day: 'TUE', class_type: 'Theory', weight_percent: '30' },
      { day: 'WED', class_type: 'Lab',    weight_percent: '50' },
      { day: 'WED', class_type: 'Theory', weight_percent: '50' },
      { day: 'THU', class_type: 'Lab',    weight_percent: '70' },
      { day: 'THU', class_type: 'Theory', weight_percent: '30' },
    ],
    teacher_unavailability: [
      { teacher_abbr: 'AYR', day: 'FRI', start_time: '14:00', end_time: '15:00' },
    ],
    config: {
      university:    'Gopalganj Science and Technology University',
      department:    'Computer Science and Engineering',
      semester:      '2026 July-December',
      working_days:  'SUN,MON,TUE,WED,THU',
      class_start:   '09:00',
      class_end:     '15:50',
      break_start:   '13:00',
      break_end:     '14:00',
    },
  };
}

module.exports = { buildBrokenWorkbook, buildCleanWorkbook };