// Smoke test for the import pipeline against the new global-masters schema.
// Builds a minimal Excel in memory with only the RoutineEntries sheet populated,
// runs the full upload controller pipeline, and prints the report.
//
//   node scripts/smoke-test-import.js
const ExcelJS = require('exceljs');
const path = require('path');
const fs = require('fs');
const os = require('os');

// We need to bypass multer and call into the controller's logic directly.
const uploadService = require('../src/services/excel.service');
const importService = require('../src/services/import.service');

(async () => {
  // Build a minimal workbook: only RoutineEntries, plus the minimum masters needed
  // by foreign-key validation. CSE 4-1 section already exists from seed.
  const wb = new ExcelJS.Workbook();
  const re = wb.addWorksheet('RoutineEntries');
  re.columns = [
    { header: 'day', key: 'day', width: 10 },
    { header: 'dept_code', key: 'dept_code', width: 12 },
    { header: 'year', key: 'year', width: 8 },
    { header: 'semester', key: 'semester', width: 10 },
    { header: 'course_code', key: 'course_code', width: 14 },
    { header: 'teacher_code', key: 'teacher_code', width: 14 },
    { header: 'room_no', key: 'room_no', width: 10 },
    { header: 'start_time', key: 'start_time', width: 12 },
    { header: 'end_time', key: 'end_time', width: 12 }
  ];
  re.addRow({
    day: 'TUE', dept_code: 'CSE', year: 4, semester: 1,
    course_code: 'CSE302', teacher_code: 'AK', room_no: '412',
    start_time: '11:30', end_time: '12:20'
  });

  const tmp = path.join(os.tmpdir(), `smoke-routine-${Date.now()}.xlsx`);
  await wb.xlsx.writeFile(tmp);

  try {
    const data = await uploadService.parseWorkbook(tmp);
    uploadService.validateSheets(data);
    importService.preprocessExcelData(data, 'CSE');
    const report = await importService.importRoutineData('July-December 2026', 'CSE', data);
    console.log('Import report:', report);
  } finally {
    fs.unlinkSync(tmp);
  }

  process.exit(0);
})().catch((err) => {
  console.error('SMOKE FAILED:', err);
  process.exit(1);
});