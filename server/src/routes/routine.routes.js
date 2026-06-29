const express = require('express');
const router = express.Router();
const routineController = require('../controllers/routine.controller');

router.get('/', routineController.getRoutine);

module.exports = router;
