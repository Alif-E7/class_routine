'use strict';

/**
 * batches.js — list and inspect upload_batches.
 *
 * Per build prompt §3.4 + §6 page 4 (History):
 *   GET /api/batches          -> list of upload batches (newest first)
 *   GET /api/batches/:id      -> single batch detail with parsed counts
 *
 * Response shape (list):
 *   {
 *     success: true,
 *     batches: [
 *       { id, filename, semester, status, created_at,
 *         counts: { teachers, courses, rooms, assignments },
 *         has_schedule: bool,
 *       }, ...
 *     ]
 *   }
 */

const express = require('express');
const router = express.Router();

const { getPool } = require('../db/pool');

// GET /api/batches
router.get('/', async (_req, res, next) => {
  try {
    const pool = getPool();
    const [rows] = await pool.query(
      `SELECT
         b.id,
         b.filename,
         b.semester,
         b.status,
         b.created_at,
         (SELECT COUNT(*) FROM teachers    WHERE upload_batch_id = b.id) AS teachers_count,
         (SELECT COUNT(*) FROM courses     WHERE upload_batch_id = b.id) AS courses_count,
         (SELECT COUNT(*) FROM rooms       WHERE upload_batch_id = b.id) AS rooms_count,
         (SELECT COUNT(*) FROM schedules   WHERE batch_id        = b.id) AS assignments_count
       FROM upload_batches b
       ORDER BY b.created_at DESC, b.id DESC`
    );

    const batches = rows.map((r) => ({
      id: r.id,
      filename: r.filename,
      semester: r.semester,
      status: r.status,
      created_at: r.created_at,
      counts: {
        teachers: r.teachers_count,
        courses: r.courses_count,
        rooms: r.rooms_count,
        assignments: r.assignments_count,
      },
      has_schedule: r.assignments_count > 0,
    }));

    return res.json({ success: true, batches });
  } catch (err) {
    next(err);
  }
});

// GET /api/batches/:id
router.get('/:id', async (req, res, next) => {
  const batchId = Number.parseInt(req.params.id, 10);
  if (!Number.isInteger(batchId) || batchId <= 0) {
    return res.status(400).json({
      success: false,
      code: 'INVALID_BATCH_ID',
      message: 'batch id must be a positive integer',
    });
  }
  try {
    const pool = getPool();
    const [rows] = await pool.query(
      `SELECT
         b.id, b.filename, b.semester, b.status, b.error_log, b.created_at,
         (SELECT COUNT(*) FROM teachers  WHERE upload_batch_id = b.id) AS teachers_count,
         (SELECT COUNT(*) FROM courses   WHERE upload_batch_id = b.id) AS courses_count,
         (SELECT COUNT(*) FROM rooms     WHERE upload_batch_id = b.id) AS rooms_count,
         (SELECT COUNT(*) FROM schedules WHERE batch_id        = b.id) AS assignments_count
       FROM upload_batches b
       WHERE b.id = ?`,
      [batchId]
    );
    if (rows.length === 0) {
      return res.status(404).json({
        success: false,
        code: 'BATCH_NOT_FOUND',
        message: `No upload batch with id ${batchId}`,
      });
    }
    const r = rows[0];
    let error_log = null;
    if (r.error_log) {
      try { error_log = JSON.parse(r.error_log); } catch (_e) { error_log = r.error_log; }
    }
    return res.json({
      success: true,
      batch: {
        id: r.id,
        filename: r.filename,
        semester: r.semester,
        status: r.status,
        created_at: r.created_at,
        error_log,
        counts: {
          teachers: r.teachers_count,
          courses: r.courses_count,
          rooms: r.rooms_count,
          assignments: r.assignments_count,
        },
        has_schedule: r.assignments_count > 0,
      },
    });
  } catch (err) {
    next(err);
  }
});

// DELETE /api/batches/:id
//
// Hard-delete a batch row. The schema declares ON DELETE CASCADE on
// every child table (teachers, courses, rooms, credit_rules,
// room_preference, teacher_unavailability, config, schedules), so a
// single DELETE clears all derived rows and any generated schedule in
// one shot. Designed to be safe to call from the History page.
//
// Response shapes:
//   200 OK                   — { success: true, batch_id: <int>, deleted: { ... } }
//   400 INVALID_BATCH_ID    — id is not a positive integer
//   404 BATCH_NOT_FOUND    — no such batch (or already deleted)
//   500 DB_ERROR           — unexpected pool failure
router.delete('/:id', async (req, res, next) => {
  const batchId = Number.parseInt(req.params.id, 10);
  if (!Number.isInteger(batchId) || batchId <= 0) {
    return res.status(400).json({
      success: false,
      code: 'INVALID_BATCH_ID',
      message: 'batch id must be a positive integer',
    });
  }
  try {
    const pool = getPool();
    // Snapshot the counts BEFORE the delete so the response can report
    // exactly what was removed (the cascade has already nulled them by
    // the time we'd query again).
    const [counts] = await pool.query(
      `SELECT
         (SELECT COUNT(*) FROM teachers          WHERE upload_batch_id = ?) AS teachers,
         (SELECT COUNT(*) FROM courses           WHERE upload_batch_id = ?) AS courses,
         (SELECT COUNT(*) FROM rooms             WHERE upload_batch_id = ?) AS rooms,
         (SELECT COUNT(*) FROM credit_rules      WHERE upload_batch_id = ?) AS credit_rules,
         (SELECT COUNT(*) FROM room_preference   WHERE upload_batch_id = ?) AS room_preference,
         (SELECT COUNT(*) FROM teacher_unavailability WHERE upload_batch_id = ?) AS teacher_unavailability,
         (SELECT COUNT(*) FROM config            WHERE upload_batch_id = ?) AS config_rows,
         (SELECT COUNT(*) FROM schedules         WHERE batch_id        = ?) AS schedule_rows
       FROM dual`,
      [batchId, batchId, batchId, batchId, batchId, batchId, batchId, batchId]
    );
    const [result] = await pool.query(
      `DELETE FROM upload_batches WHERE id = ?`,
      [batchId]
    );
    if (result.affectedRows === 0) {
      return res.status(404).json({
        success: false,
        code: 'BATCH_NOT_FOUND',
        message: `No upload batch with id ${batchId}`,
      });
    }
    return res.json({
      success: true,
      batch_id: batchId,
      deleted: counts[0] || {},
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/batches/:id/teachers — get teachers for a batch
router.get('/:id/teachers', async (req, res, next) => {
  const batchId = Number.parseInt(req.params.id, 10);
  if (!Number.isInteger(batchId) || batchId <= 0) {
    return res.status(400).json({
      success: false,
      code: 'INVALID_BATCH_ID',
      message: 'batch id must be a positive integer',
    });
  }
  try {
    const pool = getPool();
    const [rows] = await pool.query(
      `SELECT full_name, abbreviation, designation, department
       FROM teachers
       WHERE upload_batch_id = ?
       ORDER BY abbreviation`,
      [batchId]
    );
    return res.json({
      success: true,
      teachers: rows,
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;