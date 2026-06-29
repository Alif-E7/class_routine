const express = require('express');
const router = express.Router();
const departmentController = require('../controllers/department.controller');

router.get('/', departmentController.getDepartments);
router.get('/sections', departmentController.getSections);
router.get('/teachers', departmentController.getTeachers);
router.get('/rooms', departmentController.getRooms);

module.exports = router;
