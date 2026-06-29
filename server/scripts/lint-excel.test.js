// Fixture-driven tests for the Excel linter.
// Run with:   npm run lint:excel:test
// Pure node:assert — no test-runner dependency.
//
// Input shape matches what excel.service.parseWorkbook() returns:
//   {
//     RoutineEntries: [ { day, dept_code, year, semester, course_code, ... }, ... ],
//     Teachers:       [ { teacher_code, teacher_name, dept_code, ... }, ... ],
//     ...
//   }
// i.e. each sheet is an array of normalised row objects with canonical column
// keys already mapped (no `headers`/`rowCount` wrapper).

'use strict';

const assert = require('node:assert/strict');
const { lintWorkbook } = require('../src/services/lint.service');

// ───────────────────────────────────────────────────────────────────────────
// Helpers
// ───────────────────────────────────────────────────────────────────────────

const validEntry = (over = {}) => ({
  day: 'SUN',
  dept_code: '(Auto-filled)',
  year: 4,
  semester: 1,
  course_code: 'CSE404',
  teacher_code: 'MF',
  room_no: '407',
  start_time: '10:40',
  end_time: '11:30',
  ...over,
});

// A workbook where every referenced master is declared in its own sheet AND
// every master belongs to the form's department (CSE). The linter treats any
// explicit dept_code that differs from the form as a warning (R3) and any
// dept_code not declared in Departments as a warning (R8), so a truly "clean"
// fixture must not carry any foreign-dept rows.
function cleanWorkbook(entries = [validEntry()], extra = {}) {
  return {
    Departments: [
      { dept_code: 'CSE', dept_name: 'Computer Science and Engineering', faculty: 'Engineering' }
    ],
    Teachers: [
      { teacher_code: 'MF', teacher_name: 'Md. Ferdous', dept_code: 'CSE' },
      { teacher_code: 'NN', teacher_name: 'Nazia Nazim', dept_code: 'CSE' }
    ],
    Rooms: [{ room_no: '407' }, { room_no: '411A' }, { room_no: 'Lab1' }],
    Courses: [
      { course_code: 'CSE404', course_name: 'Computer Architecture', credit: 3, dept_code: 'CSE' },
      { course_code: 'CSE101', course_name: 'Intro to Programming', credit: 3, dept_code: 'CSE' },
      { course_code: 'CSE302L', course_name: 'Operating Systems Lab', credit: 1.5, dept_code: 'CSE' }
    ],
    Sections: [{ dept_code: 'CSE', year: 4, semester: 1 }, { dept_code: 'CSE', year: 3, semester: 2 }],
    TimeSlots: [
      { start_time: '09:00', end_time: '09:50' },
      { start_time: '10:40', end_time: '11:30' },
      { start_time: '11:31', end_time: '12:20' },
      { start_time: '15:40', end_time: '17:10' }
    ],
    RoutineEntries: entries,
    ...extra,
  };
}

// A clean workbook that ALSO declares a foreign department (MATH) and a
// cross-dept service-course teacher. Use this when a test legitimately needs
// a cross-dept teacher/course referenced from a CSE routine row.
function cleanWorkbookWithCrossDept(entries = [validEntry()], extra = {}) {
  const wb = cleanWorkbook(entries, extra);
  wb.Departments.push({ dept_code: 'MATH', dept_name: 'Mathematics', faculty: 'Science' });
  wb.Teachers.push({ teacher_code: 'SY', teacher_name: 'Sabina Yeasmin', dept_code: 'MATH' });
  wb.Courses.push({ course_code: 'MATH101', course_name: 'Calculus I', credit: 3, dept_code: 'MATH' });
  return wb;
}

function lint(data, deptCode = 'CSE') {
  return lintWorkbook(data, { departmentCode: deptCode });
}

const firstError = (res, rule) => res.errors.find((e) => e.rule === rule);
const hasError = (res, rule) => !!firstError(res, rule);
const hasWarning = (res, rule) => res.warnings.some((w) => w.rule === rule);

// ───────────────────────────────────────────────────────────────────────────
// R1 — RoutineEntries sheet + rows + required fields
// ───────────────────────────────────────────────────────────────────────────

function test_R1_missing_sheet() {
  const res = lint({ RoutineEntries: 'not an array' });
  assert.equal(hasError(res, 'R1'), true, 'R1 must fire when RoutineEntries is missing/malformed');
  assert.match(firstError(res, 'R1').message, /RoutineEntries sheet is missing/i);
  assert.equal(res.isValid, false);
  console.log('  ✓ R1 — missing RoutineEntries sheet');
}

function test_R1_empty_sheet() {
  const res = lint(cleanWorkbook([]));
  assert.equal(hasError(res, 'R1'), true);
  assert.match(firstError(res, 'R1').message, /no data rows/i);
  console.log('  ✓ R1 — empty RoutineEntries sheet');
}

function test_R1_missing_required_field_on_row() {
  const res = lint(cleanWorkbook([validEntry({ course_code: '' })]));
  assert.equal(hasError(res, 'R1'), true);
  assert.match(firstError(res, 'R1').message, /course_code/);
  assert.equal(firstError(res, 'R1').row, 2, 'row 2 = first data row');
  console.log('  ✓ R1 — missing required field on a routine row');
}

// ───────────────────────────────────────────────────────────────────────────
// R2 — Canonical columns
// ───────────────────────────────────────────────────────────────────────────

function test_R2_missing_canonical_column() {
  const data = cleanWorkbook();
  // Strip a required canonical key from the first routine row
  data.RoutineEntries[0] = validEntry();
  delete data.RoutineEntries[0].room_no;
  const res = lint(data);
  assert.equal(hasError(res, 'R2'), true);
  assert.match(firstError(res, 'R2').message, /room_no/);
  console.log('  ✓ R2 — missing canonical column on RoutineEntries');
}

function test_R2_missing_columns_on_optional_sheet() {
  const data = cleanWorkbook();
  data.Teachers = [{ teacher_code: 'XX' }]; // missing teacher_name and dept_code
  const res = lint(data);
  assert.equal(hasError(res, 'R2'), true);
  assert.equal(firstError(res, 'R2').sheet, 'Teachers');
  console.log('  ✓ R2 — missing canonical columns on Teachers sheet');
}

// ───────────────────────────────────────────────────────────────────────────
// R3 — dept_code handling
// ───────────────────────────────────────────────────────────────────────────

function test_R3_no_department_code() {
  const res = lintWorkbook(cleanWorkbook(), { departmentCode: '' });
  assert.equal(hasError(res, 'R3'), true);
  assert.match(firstError(res, 'R3').message, /No departmentCode supplied/i);
  console.log('  ✓ R3 — empty departmentCode in form is an error');
}

function test_R3_autofilled_is_ok() {
  const res = lint(cleanWorkbook([validEntry({ dept_code: '(Auto-filled)' })]));
  // Only the RoutineEntries row's dept_code is the subject of this test.
  const routineR3 = res.warnings.filter(
    (w) => w.rule === 'R3' && w.sheet === 'RoutineEntries'
  );
  assert.equal(routineR3.length, 0, `(Auto-filled) on RoutineEntries must not warn. Got: ${JSON.stringify(routineR3)}`);
  assert.equal(res.isValid, true);
  console.log('  ✓ R3 — (Auto-filled) marker is accepted');
}

function test_R3_blank_dept_code_is_ok() {
  const res = lint(cleanWorkbook([validEntry({ dept_code: '' })]));
  const routineR3 = res.warnings.filter(
    (w) => w.rule === 'R3' && w.sheet === 'RoutineEntries'
  );
  assert.equal(routineR3.length, 0, `blank dept_code on RoutineEntries must not warn. Got: ${JSON.stringify(routineR3)}`);
  console.log('  ✓ R3 — blank dept_code is accepted');
}

function test_R3_mismatching_explicit_dept_code_is_warning() {
  const res = lint(cleanWorkbook([validEntry({ dept_code: 'EEE' })]));
  assert.equal(hasWarning(res, 'R3'), true);
  assert.equal(res.isValid, true, 'R3 mismatches are warnings, not errors');
  assert.match(
    res.warnings.find((w) => w.rule === 'R3').message,
    /will be DROPPED/
  );
  console.log('  ✓ R3 — mismatching dept_code triggers a warning');
}

// ───────────────────────────────────────────────────────────────────────────
// R4 — Day enum
// ───────────────────────────────────────────────────────────────────────────

function test_R4_invalid_day() {
  const res = lint(cleanWorkbook([validEntry({ day: 'FUN' })]));
  assert.equal(hasError(res, 'R4'), true);
  assert.match(firstError(res, 'R4').message, /Invalid day 'FUN'/);
  console.log('  ✓ R4 — invalid day value rejected');
}

function test_R4_missing_day() {
  const res = lint(cleanWorkbook([validEntry({ day: '' })]));
  assert.equal(hasError(res, 'R4'), true);
  assert.match(firstError(res, 'R4').message, /Missing day/);
  console.log('  ✓ R4 — missing day rejected');
}

function test_R4_thursday_alias_normalised() {
  // The regex accepts THU/THURSDAY and downstream normalises to THR — no error here.
  const res = lint(cleanWorkbook([validEntry({ day: 'THURSDAY' })]));
  assert.equal(hasError(res, 'R4'), false);
  console.log('  ✓ R4 — THURSDAY alias passes the linter');
}

// ───────────────────────────────────────────────────────────────────────────
// R5 — year ∈ {1..4}
// ───────────────────────────────────────────────────────────────────────────

function test_R5_year_out_of_range() {
  const res = lint(cleanWorkbook([validEntry({ year: 5 })]));
  assert.equal(hasError(res, 'R5'), true);
  assert.match(firstError(res, 'R5').message, /Invalid year '5'/);
  console.log('  ✓ R5 — year > 4 rejected');
}

function test_R5_year_non_numeric() {
  const res = lint(cleanWorkbook([validEntry({ year: 'fourth' })]));
  assert.equal(hasError(res, 'R5'), true);
  console.log('  ✓ R5 — non-numeric year rejected');
}

// ───────────────────────────────────────────────────────────────────────────
// R6 — semester ∈ {1, 2}
// ───────────────────────────────────────────────────────────────────────────

function test_R6_semester_out_of_range() {
  const res = lint(cleanWorkbook([validEntry({ semester: 3 })]));
  assert.equal(hasError(res, 'R6'), true);
  assert.match(firstError(res, 'R6').message, /Invalid semester '3'/);
  console.log('  ✓ R6 — semester > 2 rejected');
}

// ───────────────────────────────────────────────────────────────────────────
// R7 — time format + end > start
// ───────────────────────────────────────────────────────────────────────────

function test_R7_bad_time_format() {
  const res = lint(cleanWorkbook([validEntry({ start_time: '10.40' })]));
  assert.equal(hasError(res, 'R7'), true);
  assert.match(firstError(res, 'R7').message, /Invalid start_time/);
  console.log('  ✓ R7 — bad time format rejected');
}

function test_R7_end_before_start() {
  const res = lint(cleanWorkbook([validEntry({ start_time: '11:30', end_time: '10:40' })]));
  assert.equal(hasError(res, 'R7'), true);
  assert.match(firstError(res, 'R7').message, /strictly after/i);
  console.log('  ✓ R7 — end_time before start_time rejected');
}

function test_R7_end_equal_start() {
  const res = lint(cleanWorkbook([validEntry({ start_time: '10:00', end_time: '10:00' })]));
  assert.equal(hasError(res, 'R7'), true);
  console.log('  ✓ R7 — end_time == start_time rejected');
}

function test_R7_bad_time_format_in_timeslots_sheet() {
  const data = cleanWorkbook();
  data.TimeSlots.push({ start_time: '9am', end_time: '10am' });
  const res = lint(data);
  assert.equal(hasError(res, 'R7'), true);
  assert.equal(firstError(res, 'R7').sheet, 'TimeSlots');
  console.log('  ✓ R7 — bad time format in TimeSlots sheet rejected');
}

// ───────────────────────────────────────────────────────────────────────────
// R8 — master FK references (warnings only)
// ───────────────────────────────────────────────────────────────────────────

function test_R8_missing_course_master_warns() {
  const data = cleanWorkbook([validEntry({ course_code: 'NEW999' })]);
  const res = lint(data);
  assert.equal(hasWarning(res, 'R8'), true);
  assert.equal(res.isValid, true, 'R8 is warning-only');
  console.log('  ✓ R8 — missing course_code master is a warning');
}

function test_R8_missing_teacher_master_warns() {
  const data = cleanWorkbook([validEntry({ teacher_code: 'ZZ' })]);
  const res = lint(data);
  assert.equal(hasWarning(res, 'R8'), true);
  console.log('  ✓ R8 — missing teacher_code master is a warning');
}

function test_R8_missing_room_master_warns() {
  const data = cleanWorkbook([validEntry({ room_no: 'Z999' })]);
  const res = lint(data);
  assert.equal(hasWarning(res, 'R8'), true);
  console.log('  ✓ R8 — missing room_no master is a warning');
}

function test_R8_all_masters_declared_is_clean() {
  const res = lint(cleanWorkbook());
  assert.equal(res.warnings.filter((w) => w.rule === 'R8').length, 0);
  console.log('  ✓ R8 — fully declared masters produces no R8 warnings');
}

// ───────────────────────────────────────────────────────────────────────────
// R9 — Teacher/room double-booking
// ───────────────────────────────────────────────────────────────────────────

function test_R9_teacher_double_booked() {
  const res = lint(
    cleanWorkbook([
      validEntry({ day: 'SUN', start_time: '10:40', end_time: '11:30' }),
      validEntry({ day: 'SUN', start_time: '10:40', end_time: '11:30', room_no: '411A', course_code: 'CSE101' })
    ])
  );
  assert.equal(hasError(res, 'R9'), true);
  assert.match(firstError(res, 'R9').message, /Teacher 'MF' is double-booked/i);
  console.log('  ✓ R9 — teacher double-booking detected');
}

function test_R9_room_double_booked() {
  const res = lint(
    cleanWorkbookWithCrossDept([
      validEntry({ day: 'MON', start_time: '10:40', end_time: '11:30', teacher_code: 'MF' }),
      validEntry({ day: 'MON', start_time: '10:40', end_time: '11:30', teacher_code: 'SY', course_code: 'MATH101' })
    ])
  );
  assert.equal(hasError(res, 'R9'), true);
  assert.match(firstError(res, 'R9').message, /Room '407' is double-booked/i);
  console.log('  ✓ R9 — room double-booking detected');
}

function test_R9_back_to_back_slots_are_ok() {
  const res = lint(
    cleanWorkbook([
      validEntry({ day: 'SUN', start_time: '10:40', end_time: '11:30' }),
      validEntry({ day: 'SUN', start_time: '11:31', end_time: '12:20', course_code: 'CSE101' })
    ])
  );
  assert.equal(hasError(res, 'R9'), false, 'adjacent slots must not conflict');
  console.log('  ✓ R9 — back-to-back slots are fine');
}

function test_R9_parallel_lab_groups_are_ok() {
  // Same section, same slot, DIFFERENT teachers AND DIFFERENT rooms — lab groups.
  const res = lint(
    cleanWorkbookWithCrossDept([
      validEntry({ day: 'TUE', start_time: '15:40', end_time: '17:10', teacher_code: 'MF', room_no: 'Lab1' }),
      validEntry({ day: 'TUE', start_time: '15:40', end_time: '17:10', teacher_code: 'SY', room_no: '407', course_code: 'MATH101' })
    ])
  );
  assert.equal(hasError(res, 'R9'), false, 'parallel groups with different teachers + rooms must not conflict');
  console.log('  ✓ R9 — parallel lab groups (different teacher + room) are fine');
}

// ───────────────────────────────────────────────────────────────────────────
// R10 — faculty enum
// ───────────────────────────────────────────────────────────────────────────

function test_R10_invalid_faculty() {
  const data = cleanWorkbook();
  data.Departments = [{ dept_code: 'CSE', dept_name: 'CSE', faculty: 'NotARealFaculty' }];
  const res = lint(data);
  assert.equal(hasError(res, 'R10'), true);
  assert.match(firstError(res, 'R10').message, /Invalid faculty 'NotARealFaculty'/);
  console.log('  ✓ R10 — invalid faculty value rejected');
}

function test_R10_valid_faculty_accepted() {
  for (const f of ['Engineering', 'Science', 'Life Science', 'Humanities', 'Business', 'Other']) {
    const data = cleanWorkbook();
    data.Departments[0].faculty = f;
    const res = lint(data);
    assert.equal(hasError(res, 'R10'), false, `faculty '${f}' should be accepted`);
  }
  console.log('  ✓ R10 — all six canonical faculty values accepted');
}

function test_R10_missing_faculty() {
  const data = cleanWorkbook();
  data.Departments[0].faculty = '';
  const res = lint(data);
  assert.equal(hasError(res, 'R10'), true);
  assert.match(firstError(res, 'R10').message, /Missing faculty/);
  console.log('  ✓ R10 — missing faculty rejected');
}

// ───────────────────────────────────────────────────────────────────────────
// Bonus: credit must be a number
// ───────────────────────────────────────────────────────────────────────────

function test_bonus_invalid_credit() {
  const data = cleanWorkbook();
  data.Courses[0].credit = 'three';
  const res = lint(data);
  assert.equal(hasError(res, 'R2'), true);
  assert.equal(firstError(res, 'R2').column, 'credit');
  console.log('  ✓ R2 — invalid credit on Courses row rejected');
}

// ───────────────────────────────────────────────────────────────────────────
// Happy path
// ───────────────────────────────────────────────────────────────────────────

function test_happy_path_three_clean_rows() {
  const entries = [
    validEntry(),
    validEntry({ day: 'MON', course_code: 'MATH101', teacher_code: 'SY', room_no: '411A', start_time: '09:00', end_time: '09:50' }),
    validEntry({ day: 'TUE', year: 3, semester: 2, course_code: 'CSE302L', room_no: 'Lab1', start_time: '15:40', end_time: '17:10' })
  ];
  const res = lint(cleanWorkbookWithCrossDept(entries));
  assert.equal(res.isValid, true, `happy path must be valid. Got errors: ${JSON.stringify(res.errors, null, 2)}`);
  assert.equal(res.errors.length, 0);
  // R3 warnings are EXPECTED here — the upload form is for CSE, but the file
  // also carries a declared MATH department (used for a cross-dept service
  // course). The linter correctly warns that those MATH master rows will be
  // dropped from the CSE-specific import. We assert that no RoutineEntries
  // row itself triggers R3, and that there are no R8 warnings at all.
  const routineWarnings = res.warnings.filter((w) => w.sheet === 'RoutineEntries');
  assert.equal(routineWarnings.length, 0, `RoutineEntries must carry zero warnings. Got: ${JSON.stringify(routineWarnings)}`);
  assert.equal(
    res.warnings.filter((w) => w.rule === 'R8').length,
    0,
    `No R8 warnings expected when all masters are declared. Got: ${JSON.stringify(res.warnings.filter((w) => w.rule === 'R8'))}`
  );
  console.log('  ✓ happy path — three valid rows produce zero errors and zero RoutineEntries warnings');
}

// ───────────────────────────────────────────────────────────────────────────
// Runner
// ───────────────────────────────────────────────────────────────────────────

function main() {
  const tests = [
    // R1
    test_R1_missing_sheet,
    test_R1_empty_sheet,
    test_R1_missing_required_field_on_row,
    // R2
    test_R2_missing_canonical_column,
    test_R2_missing_columns_on_optional_sheet,
    // R3
    test_R3_no_department_code,
    test_R3_autofilled_is_ok,
    test_R3_blank_dept_code_is_ok,
    test_R3_mismatching_explicit_dept_code_is_warning,
    // R4
    test_R4_invalid_day,
    test_R4_missing_day,
    test_R4_thursday_alias_normalised,
    // R5
    test_R5_year_out_of_range,
    test_R5_year_non_numeric,
    // R6
    test_R6_semester_out_of_range,
    // R7
    test_R7_bad_time_format,
    test_R7_end_before_start,
    test_R7_end_equal_start,
    test_R7_bad_time_format_in_timeslots_sheet,
    // R8
    test_R8_missing_course_master_warns,
    test_R8_missing_teacher_master_warns,
    test_R8_missing_room_master_warns,
    test_R8_all_masters_declared_is_clean,
    // R9
    test_R9_teacher_double_booked,
    test_R9_room_double_booked,
    test_R9_back_to_back_slots_are_ok,
    test_R9_parallel_lab_groups_are_ok,
    // R10
    test_R10_invalid_faculty,
    test_R10_valid_faculty_accepted,
    test_R10_missing_faculty,
    // bonus
    test_bonus_invalid_credit,
    // happy path
    test_happy_path_three_clean_rows
  ];

  let passed = 0;
  let failed = 0;
  const failures = [];

  for (const t of tests) {
    try {
      t();
      passed++;
    } catch (err) {
      failed++;
      failures.push({ name: t.name, message: err.message });
      console.error(`  ✗ ${t.name} — ${err.message}`);
    }
  }

  console.log(`\n${passed} passed, ${failed} failed, ${tests.length} total`);
  if (failed > 0) {
    console.error('\nFailures:');
    failures.forEach((f) => console.error(`  - ${f.name}: ${f.message}`));
    process.exit(1);
  }
  process.exit(0);
}

main();