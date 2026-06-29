const uploadService = require('../services/excel.service');
const validationService = require('../services/validation.service');
const importService = require('../services/import.service');
const fs = require('fs');

const uploadRoutine = async (req, res, next) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, message: 'No file uploaded' });
    }

    const { semesterName, departmentCode } = req.body;
    if (!semesterName) {
      return res.status(400).json({ success: false, message: 'Semester name is required' });
    }
    if (!departmentCode) {
      return res.status(400).json({ success: false, message: 'Department code is required' });
    }

    const filePath = req.file.path;

    // 1. Parse Workbook
    const data = await uploadService.parseWorkbook(filePath);

    // 2. Preprocess Data (Fill blank department codes)
    importService.preprocessExcelData(data, departmentCode);

    // 3. Validate Sheets structure
    uploadService.validateSheets(data);

    // 4. Merge DB backup data (so cross-dept teachers/courses don't fail validation)
    await importService.mergeDbDataIntoExcel(data);

    // 5. Validate Foreign Keys
    validationService.validateForeignKeys(data);

    // 6. Check for Conflicts
    validationService.checkConflicts(data.RoutineEntries);

    // 5. Import into DB
    const report = await importService.importRoutineData(semesterName, departmentCode, data);

    // Clean up uploaded file
    fs.unlinkSync(filePath);

    res.status(200).json({
      success: true,
      message: 'Routine imported successfully',
      data: report
    });
  } catch (error) {
    if (req.file && fs.existsSync(req.file.path)) {
      fs.unlinkSync(req.file.path);
    }
    next(error);
  }
};

module.exports = { uploadRoutine };
