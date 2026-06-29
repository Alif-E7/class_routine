const express = require('express');
const router = express.Router();
const semesterController = require('../controllers/semester.controller');
const authMiddleware = require('../middleware/authMiddleware');

router.get('/', semesterController.getSemesters);
router.delete('/:id', authMiddleware, semesterController.deleteSemester);
router.get('/:id/departments/:deptCode/export', authMiddleware, semesterController.exportDepartmentRoutine);
// Public — used by the homepage to download a PDF without requiring admin login.
router.get('/:id/departments/:deptCode/export-pdf', semesterController.exportDepartmentRoutinePdf);
router.get('/:id/departments/:deptCode/data', authMiddleware, semesterController.getDepartmentRoutineData);
router.put('/:id/departments/:deptCode/data', authMiddleware, semesterController.updateDepartmentRoutineData);

module.exports = router;
