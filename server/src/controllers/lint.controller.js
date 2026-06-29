// Controller for the pre-flight lint endpoint.
// Runs the same parser as the real upload but stops before DB writes —
// returns the linter's report so the UI can show every rule violation
// the user would otherwise hit on import.

const fs = require('fs');
const uploadService = require('../services/excel.service');
const importService = require('../services/import.service');
const { lintWorkbook } = require('../services/lint.service');

const lintRoutine = async (req, res, next) => {
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
    try {
      const data = await uploadService.parseWorkbook(filePath);
      // Mirror preprocessExcelData's auto-fill/drop rules so warnings are accurate
      // for what the server would actually try to import.
      importService.preprocessExcelData(data, departmentCode);
      const result = lintWorkbook(data, { departmentCode });
      return res.json({
        success: true,
        file: req.file.originalname,
        semesterName,
        departmentCode: departmentCode.toUpperCase(),
        ...result
      });
    } finally {
      // Always clean up the temp upload
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    }
  } catch (error) {
    if (req.file && fs.existsSync(req.file.path)) {
      fs.unlinkSync(req.file.path);
    }
    next(error);
  }
};

module.exports = { lintRoutine };