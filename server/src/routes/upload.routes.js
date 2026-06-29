const express = require('express');
const router = express.Router();
const uploadController = require('../controllers/upload.controller');
const lintController = require('../controllers/lint.controller');
const upload = require('../middleware/upload');
const authMiddleware = require('../middleware/authMiddleware');

// Dry-run validation endpoint — runs the same parser + pre-flight linter
// but does NOT touch the database. Clients should call this before the real
// upload so users see every rule violation up front.
router.post('/lint', authMiddleware, upload.single('file'), lintController.lintRoutine);

router.post('/', authMiddleware, upload.single('file'), uploadController.uploadRoutine);

module.exports = router;
