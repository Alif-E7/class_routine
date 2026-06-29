// Generates and serves a blank Excel template for routine uploads.
//
// With the global-masters schema, ONLY the 'RoutineEntries' sheet is mandatory.
// Re-uploading a routine for an existing department only requires that one sheet.
//
// The other sheets are OPTIONAL reference sheets. They are useful when:
//   - Onboarding a brand-new department (declare its dept / teachers / courses / sections)
//   - Adding new rooms or time slots to the institution
//   - First-time setup of the system
//
// Sheets:
//   Departments    [OPTIONAL]  dept_code, dept_name, faculty
//   Teachers       [OPTIONAL]  teacher_code, teacher_name, dept_code, designation
//   Rooms          [OPTIONAL]  room_no, building
//   Courses        [OPTIONAL]  course_code, course_name, credit, dept_code
//   Sections       [OPTIONAL]  dept_code, year, semester
//   TimeSlots      [OPTIONAL]  start_time, end_time
//   RoutineEntries [REQUIRED]  day, dept_code, year, semester,
//                              course_code, teacher_code, room_no,
//                              start_time, end_time
//
// year     ∈ {1, 2, 3, 4}    e.g. 4 means "4th year"
// semester ∈ {1, 2}          e.g. 1 means "odd semester", 2 means "even semester"
//   The combined label rendered in the timetable is "year-semester" (e.g. "4-1").
const ExcelJS = require('exceljs');

// Each entry: { required: bool, rows: [...] }
// dept_code columns may be left as '(Auto-filled)' — the upload controller will
// substitute the uploading department's code at import time.
const SHEET_DEFS = [
  {
    name: 'Departments',
    required: false,
    rows: [
      { dept_code: '(Auto-filled)', dept_name: 'Computer Science and Engineering', faculty: 'Engineering' }
    ]
  },
  {
    name: 'Teachers',
    required: false,
    rows: [
      { teacher_code: 'MF', teacher_name: 'Md. Ferdous', dept_code: '(Auto-filled)', designation: 'Lecturer' },
      { teacher_code: 'SY', teacher_name: 'Sabina Yeasmin', dept_code: 'MATH', designation: 'Assistant Professor' }
    ]
  },
  {
    name: 'Rooms',
    required: false,
    rows: [
      { room_no: '407', building: 'Main Building' },
      { room_no: '411A', building: 'Main Building' }
    ]
  },
  {
    name: 'Courses',
    required: false,
    rows: [
      { course_code: 'CSE404', course_name: 'Computer Architecture', credit: 3, dept_code: '(Auto-filled)' },
      { course_code: 'MATH101', course_name: 'Calculus I', credit: 3, dept_code: 'MATH' }
    ]
  },
  {
    name: 'Sections',
    required: false,
    rows: [
      { dept_code: '(Auto-filled)', year: 4, semester: 1 },
      { dept_code: '(Auto-filled)', year: 3, semester: 2 }
    ]
  },
  {
    name: 'TimeSlots',
    required: false,
    rows: [
      { start_time: '09:00', end_time: '09:50' },
      { start_time: '09:50', end_time: '10:40' },
      { start_time: '10:40', end_time: '11:30' },
      { start_time: '11:30', end_time: '12:20' }
    ]
  },
  {
    name: 'RoutineEntries',
    required: true,
    rows: [
      { day: 'SUN', dept_code: '(Auto-filled)', year: 4, semester: 1, course_code: 'CSE404', teacher_code: 'MF', room_no: '407', start_time: '10:40', end_time: '11:30' },
      { day: 'MON', dept_code: '(Auto-filled)', year: 4, semester: 1, course_code: 'MATH101', teacher_code: 'SY', room_no: '411A', start_time: '09:00', end_time: '09:50' }
    ]
  }
];

const buildTemplate = async () => {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'GSTU Routine System';
  wb.created = new Date();

  for (const def of SHEET_DEFS) {
    const sheet = wb.addWorksheet(def.name);
    if (def.rows.length === 0) continue;

    const columns = Object.keys(def.rows[0]).map((key) => ({
      header: key,
      key,
      width: Math.min(Math.max(key.length + 4, 14), 40)
    }));
    sheet.columns = columns;

    // Style header row: blue fill, white bold text
    const headerRow = sheet.getRow(1);
    headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    headerRow.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FF1E3A8A' }
    };
    headerRow.alignment = { horizontal: 'left', vertical: 'middle' };
    headerRow.commit();

    def.rows.forEach((r) => sheet.addRow(r));
  }

  return await wb.xlsx.writeBuffer();
};

const downloadTemplate = async (req, res) => {
  try {
    const buffer = await buildTemplate();
    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    );
    res.setHeader('Content-Disposition', 'attachment; filename="Routine_Template.xlsx"');
    res.send(Buffer.from(buffer));
  } catch (err) {
    console.error('Template generation failed', err);
    res.status(500).json({ success: false, message: 'Failed to generate template' });
  }
};

module.exports = { downloadTemplate, buildTemplate };
