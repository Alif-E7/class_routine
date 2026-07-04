'use strict';

const express = require('express');
const multer = require('multer');
const router = express.Router();

const { parseWorkbook, ParseError } = require('../services/excelParser');
const { validate } = require('../services/validators');
const { buildLookup, deriveForCourse, DeriveRulesError } = require('../services/deriveRules');
const { getPool, withTransaction } = require('../db/pool');

// 10 MB memory cap per section 3.3.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter(_req, file, cb) {
    // Accept by extension — many browsers send empty / wrong MIME types.
    const ok = /\.xlsx$/i.test(file.originalname);
    cb(ok ? null : new Error('Only .xlsx files are accepted'), ok);
  },
});

// POST /api/upload
// multipart/form-data:
//   file:        .xlsx workbook (required)
//   semester:    human label, e.g. "2026 July-December" (optional)
//   batch_id:    optional client hint (we ignore — server assigns)
router.post('/', upload.single('file'), async (req, res, next) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, message: 'No file uploaded (field name must be "file")' });
    }
    if (!/\.xlsx$/i.test(req.file.originalname)) {
      return res.status(400).json({ success: false, message: 'Only .xlsx files are accepted' });
    }

    // 1. Parse
    let workbook;
    try {
      workbook = parseWorkbook(req.file.buffer, req.file.originalname);
    } catch (err) {
      if (err instanceof ParseError) {
        return res.status(400).json({
          success: false,
          code: 'PARSE_ERROR',
          message: err.message,
          details: err.details,
        });
      }
      throw err;
    }

    // 2. Validate
    const report = validate(workbook);

    // 3. If validation fails, create a batch row in 'needs_review' so the
    //    history page can show what went wrong. Do NOT persist data.
    if (!report.isValid) {
      const [result] = await getPool().query(
        `INSERT INTO upload_batches (filename, semester, status, error_log)
         VALUES (?, ?, 'needs_review', ?)`,
        [req.file.originalname, req.body.semester || null, JSON.stringify(report)]
      );
      return res.status(422).json({
        success: false,
        batch_id: result.insertId,
        code: 'VALIDATION_FAILED',
        message: 'One or more validation rules failed',
        errors: report.errors,
        warnings: report.warnings,
        is_valid: false,
      });
    }

    // 4. All valid — insert everything in a single transaction.
    const counts = await withTransaction(async (conn) => {
      const [batchResult] = await conn.query(
        `INSERT INTO upload_batches (filename, semester, status) VALUES (?, ?, 'processing')`,
        [req.file.originalname, req.body.semester || null]
      );
      const batchId = batchResult.insertId;

      // Teachers
      for (const t of workbook.teachers) {
        await conn.query(
          `INSERT INTO teachers (full_name, abbreviation, designation, department, upload_batch_id)
           VALUES (?, ?, ?, ?, ?)`,
          [t.full_name, t.abbreviation, t.designation, t.department, batchId]
        );
      }
      // Rooms
      for (const r of workbook.rooms) {
        await conn.query(
          `INSERT INTO rooms (room_id, room_name, type, upload_batch_id) VALUES (?, ?, ?, ?)`,
          [r.room_id, r.room_name, r.type, batchId]
        );
      }
      // Credit_Rules
      for (const cr of workbook.credit_rules) {
        await conn.query(
          `INSERT INTO credit_rules (credit, type, classes_per_week, duration_minutes, upload_batch_id)
           VALUES (?, ?, ?, ?, ?)`,
          [cr.credit, cr.type, cr.classes_per_week, cr.duration_minutes, batchId]
        );
      }
      // Room_Preference
      for (const rp of workbook.room_preference) {
        await conn.query(
          `INSERT INTO room_preference (room_id, year_group, weight_percent, upload_batch_id)
           VALUES (?, ?, ?, ?)`,
          [rp.room_id, rp.year_group, rp.weight_percent, batchId]
        );
      }
      // Teacher_Unavailability
      for (const u of workbook.teacher_unavailability) {
        await conn.query(
          `INSERT INTO teacher_unavailability (teacher_abbr, day, start_time, end_time, upload_batch_id)
           VALUES (?, ?, ?, ?, ?)`,
          [u.teacher_abbr, u.day, u.start_time, u.end_time, batchId]
        );
      }
      // Config (key/value)
      for (const [k, v] of Object.entries(workbook.config || {})) {
        await conn.query(
          `INSERT INTO config (\`key\`, \`value\`, upload_batch_id) VALUES (?, ?, ?)`,
          [k, v, batchId]
        );
      }
      // Courses — derive type/duration/classes_per_week via deriveRules service.
      const creditLookup = buildLookup(workbook.credit_rules);
      for (const c of workbook.courses) {
        const derived = deriveForCourse(c, creditLookup);
        await conn.query(
          `INSERT INTO courses
             (course_code, course_name, credit, dept, year_sem, teacher_abbr,
              derived_type, derived_duration_min, derived_classes_per_week, upload_batch_id)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            c.course_code, c.course_name, c.credit, c.dept, c.year_sem, c.teacher_abbr,
            derived.type, derived.duration_minutes, derived.classes_per_week, batchId,
          ]
        );
      }

      // Mark batch completed
      await conn.query(
        `UPDATE upload_batches SET status = 'completed' WHERE id = ?`,
        [batchId]
      );

      return {
        batch_id: batchId,
        teachers: workbook.teachers.length,
        courses: workbook.courses.length,
        rooms: workbook.rooms.length,
        credit_rules: workbook.credit_rules.length,
        room_preference: workbook.room_preference.length,
        teacher_unavailability: workbook.teacher_unavailability.length,
        config_keys: Object.keys(workbook.config || {}).length,
      };
    });

    return res.status(201).json({
      success: true,
      code: 'UPLOAD_OK',
      message: 'Workbook parsed and persisted successfully',
      data: counts,
      warnings: report.warnings,
    });
  } catch (err) {
    if (err instanceof DeriveRulesError) {
      return res.status(422).json({
        success: false,
        code: err.code,
        message: err.message,
        details: err.details,
      });
    }
    next(err);
  }
});

module.exports = router;