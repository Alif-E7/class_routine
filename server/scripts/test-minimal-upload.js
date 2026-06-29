const ExcelJS = require('exceljs');
const path = require('path');
const fs = require('fs');
const os = require('os');

const uploadService = require('../src/services/excel.service');
const importService = require('../src/services/import.service');
const validationService = require('../src/services/validation.service');

(async () => {
  console.log('Building minimal workbook with only RoutineEntries sheet...');
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

  // Note: CSE302, AK, and 412 already exist in DB from seed / previous smoke tests.
  re.addRow({
    day: 'TUE',
    dept_code: '(Auto-filled)',
    year: 4,
    semester: 1,
    course_code: 'CSE302',
    teacher_code: 'AK',
    room_no: '412',
    start_time: '11:30',
    end_time: '12:20'
  });

  const tmp = path.join(os.tmpdir(), `minimal-routine-${Date.now()}.xlsx`);
  await wb.xlsx.writeFile(tmp);

  try {
    console.log('1. Parsing workbook...');
    const data = await uploadService.parseWorkbook(tmp);

    console.log('2. Preprocessing data (target dept: CSE)...');
    importService.preprocessExcelData(data, 'CSE');

    console.log('3. Validating sheets structure...');
    uploadService.validateSheets(data);

    console.log('4. Merging DB backup data...');
    await importService.mergeDbDataIntoExcel(data);

    console.log('5. Validating Foreign Keys...');
    validationService.validateForeignKeys(data);

    console.log('6. Checking for conflicts...');
    validationService.checkConflicts(data.RoutineEntries);

    console.log('7. Importing into DB...');
    const report = await importService.importRoutineData('July-December 2026', 'CSE', data);
    console.log('Import report:', report);
    console.log('✅ MINIMAL EXCEL IMPORT TEST PASSED SUCCESSFULLY!');
  } catch (err) {
    console.error('❌ MINIMAL EXCEL IMPORT TEST FAILED:', err.message || err);
    if (err.details) {
      console.error('Validation details:', err.details);
    }
    process.exit(1);
  } finally {
    if (fs.existsSync(tmp)) {
      fs.unlinkSync(tmp);
    }
  }

  process.exit(0);
})();
