// Reproduces the exact cross-dept upload failure that was reported:
// CSE routine referencing a MATH teacher (KA) and a MATH course (MATH201).
//
// Before the fix, preprocessExcelData stripped KA and MATH201 from the workbook
// because their dept_code was MATH, not CSE. The validator then reported
// "Invalid teacher_code 'KA'" and "Invalid course_code 'MATH201'".
//
// After the fix, those rows survive preprocessing and validation passes.
const ExcelJS = require('exceljs');
const path = require('path');
const fs = require('fs');
const os = require('os');

const uploadService = require('../src/services/excel.service');
const importService = require('../src/services/import.service');
const validationService = require('../src/services/validation.service');

(async () => {
  const wb = new ExcelJS.Workbook();

  const departments = wb.addWorksheet('Departments');
  departments.columns = [
    { header: 'dept_code', key: 'dept_code', width: 12 },
    { header: 'dept_name', key: 'dept_name', width: 32 },
    { header: 'faculty', key: 'faculty', width: 14 }
  ];
  // Note: MATH deliberately declared so the foreign-key check on Teacher.dept_code passes
  departments.addRow({ dept_code: 'CSE', dept_name: 'Computer Science and Engineering', faculty: 'Engineering' });
  departments.addRow({ dept_code: 'MATH', dept_name: 'Mathematics', faculty: 'Science' });

  const teachers = wb.addWorksheet('Teachers');
  teachers.columns = [
    { header: 'teacher_code', key: 'teacher_code', width: 12 },
    { header: 'teacher_name', key: 'teacher_name', width: 24 },
    { header: 'dept_code', key: 'dept_code', width: 12 },
    { header: 'designation', key: 'designation', width: 20 }
  ];
  // CSE teacher
  teachers.addRow({ teacher_code: 'MF', teacher_name: 'Md. Ferdous', dept_code: '(Auto-filled)', designation: 'Lecturer' });
  // Cross-dept MATH teacher
  teachers.addRow({ teacher_code: 'KA', teacher_name: 'Karim Ahmed', dept_code: 'MATH', designation: 'Assistant Professor' });

  const rooms = wb.addWorksheet('Rooms');
  rooms.columns = [
    { header: 'room_no', key: 'room_no', width: 10 },
    { header: 'building', key: 'building', width: 20 }
  ];
  rooms.addRow({ room_no: '407', building: 'Main Building' });

  const courses = wb.addWorksheet('Courses');
  courses.columns = [
    { header: 'course_code', key: 'course_code', width: 14 },
    { header: 'course_name', key: 'course_name', width: 28 },
    { header: 'credit', key: 'credit', width: 8 },
    { header: 'dept_code', key: 'dept_code', width: 12 }
  ];
  // CSE course
  courses.addRow({ course_code: 'CSE404', course_name: 'Computer Architecture', credit: 3, dept_code: '(Auto-filled)' });
  // Cross-dept MATH course
  courses.addRow({ course_code: 'MATH201', course_name: 'Linear Algebra', credit: 3, dept_code: 'MATH' });

  const sections = wb.addWorksheet('Sections');
  sections.columns = [
    { header: 'dept_code', key: 'dept_code', width: 12 },
    { header: 'year', key: 'year', width: 6 },
    { header: 'semester', key: 'semester', width: 10 }
  ];
  sections.addRow({ dept_code: '(Auto-filled)', year: 4, semester: 1 });

  const timeSlots = wb.addWorksheet('TimeSlots');
  timeSlots.columns = [
    { header: 'start_time', key: 'start_time', width: 12 },
    { header: 'end_time', key: 'end_time', width: 12 }
  ];
  timeSlots.addRow({ start_time: '10:40', end_time: '11:30' });

  const routineEntries = wb.addWorksheet('RoutineEntries');
  routineEntries.columns = [
    { header: 'day', key: 'day', width: 8 },
    { header: 'dept_code', key: 'dept_code', width: 12 },
    { header: 'year', key: 'year', width: 6 },
    { header: 'semester', key: 'semester', width: 10 },
    { header: 'course_code', key: 'course_code', width: 14 },
    { header: 'teacher_code', key: 'teacher_code', width: 14 },
    { header: 'room_no', key: 'room_no', width: 10 },
    { header: 'start_time', key: 'start_time', width: 12 },
    { header: 'end_time', key: 'end_time', width: 12 }
  ];
  // CSE 4-1 attending a MATH course taught by a MATH teacher — the cross-dept case
  routineEntries.addRow({
    day: 'WED',
    dept_code: '(Auto-filled)',
    year: 4,
    semester: 1,
    course_code: 'MATH201',
    teacher_code: 'KA',
    room_no: '407',
    start_time: '10:40',
    end_time: '11:30'
  });

  const tmp = path.join(os.tmpdir(), `cross-dept-${Date.now()}.xlsx`);
  await wb.xlsx.writeFile(tmp);

  try {
    const data = await uploadService.parseWorkbook(tmp);
    uploadService.validateSheets(data);
    importService.preprocessExcelData(data, 'CSE');
    validationService.validateForeignKeys(data);
    validationService.checkConflicts(data.RoutineEntries);

    // Verify the cross-dept rows survived preprocessing
    const teacherCodesAfter = data.Teachers.map((t) => t.teacher_code);
    const courseCodesAfter = data.Courses.map((c) => c.course_code);
    console.log('Teachers kept after preprocess:', teacherCodesAfter);
    console.log('Courses  kept after preprocess:', courseCodesAfter);

    if (!teacherCodesAfter.includes('KA')) {
      throw new Error('REGRESSION: KA was stripped by preprocessExcelData');
    }
    if (!courseCodesAfter.includes('MATH201')) {
      throw new Error('REGRESSION: MATH201 was stripped by preprocessExcelData');
    }

    const report = await importService.importRoutineData('July-December 2026', 'CSE', data);
    console.log('Import report:', report);
    console.log('✅ Cross-dept upload succeeded');
  } finally {
    fs.unlinkSync(tmp);
  }

  process.exit(0);
})().catch((err) => {
  console.error('CROSS-DEPT TEST FAILED:', err.message || err);
  if (err.details) console.error('Validation errors:', err.details);
  process.exit(1);
});