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

const { getPool, withTransaction } = require('../db/pool');
const { validate } = require('../services/validators');
const { buildLookup, deriveForCourse, DeriveRulesError } = require('../services/deriveRules');

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

// GET /api/batches/:id/workbook — retrieve workbook data
router.get('/:id/workbook', async (req, res, next) => {
  const batchId = Number.parseInt(req.params.id, 10);
  if (!Number.isInteger(batchId) || batchId <= 0) {
    return res.status(400).json({ success: false, code: 'INVALID_BATCH_ID', message: 'batch id must be a positive integer' });
  }
  try {
    const pool = getPool();
    const [batchRows] = await pool.query('SELECT status, error_log FROM upload_batches WHERE id = ?', [batchId]);
    if (batchRows.length === 0) {
      return res.status(404).json({ success: false, code: 'BATCH_NOT_FOUND', message: `No batch with id ${batchId}` });
    }
    const batch = batchRows[0];
    
    if (batch.status === 'needs_review') {
      let errLogObj = null;
      try {
        errLogObj = JSON.parse(batch.error_log);
      } catch (_) {}
      if (errLogObj && errLogObj.workbook) {
        return res.json({ success: true, workbook: errLogObj.workbook });
      }
    }
    
    // Otherwise, reconstruct from database tables.
    // 1. Config
    const [configRows] = await pool.query('SELECT `key`, `value` FROM config WHERE upload_batch_id = ?', [batchId]);
    const config = {};
    for (const r of configRows) {
      config[String(r.key).trim()] = r.value;
    }
    
    // 2. Teachers
    const [teachers] = await pool.query(
      'SELECT full_name, abbreviation, designation, department FROM teachers WHERE upload_batch_id = ? ORDER BY id',
      [batchId]
    );
    
    // 3. Courses
    const [courses] = await pool.query(
      'SELECT course_code, course_name, credit, dept, year_sem, teacher_abbr FROM courses WHERE upload_batch_id = ? ORDER BY id',
      [batchId]
    );
    
    // 4. Rooms
    const [rooms] = await pool.query(
      'SELECT room_id, room_name, type FROM rooms WHERE upload_batch_id = ? ORDER BY id',
      [batchId]
    );
    
    // 5. Credit Rules
    const [credit_rules_raw] = await pool.query(
      'SELECT credit, classes_per_week, duration_minutes FROM credit_rules WHERE upload_batch_id = ? ORDER BY id',
      [batchId]
    );
    const credit_rules = credit_rules_raw.map(c => ({
      ...c,
      credit: Number(c.credit),
    }));
    
    // 6. Room Preference
    const [room_preference_raw] = await pool.query(
      'SELECT room_id, year_group, weight_percent FROM room_preference WHERE upload_batch_id = ? ORDER BY id',
      [batchId]
    );
    const room_preference = room_preference_raw.map(p => ({
      ...p,
      weight_percent: Number(p.weight_percent),
    }));
    
    // 7. Day Preference
    const [day_preference_raw] = await pool.query(
      'SELECT day, class_type, weight_percent, note FROM day_preference WHERE upload_batch_id = ? ORDER BY id',
      [batchId]
    );
    const day_preference = day_preference_raw.map(p => ({
      ...p,
      weight_percent: Number(p.weight_percent),
    }));
    
    // 8. Teacher Unavailability
    const [teacher_unavailability_raw] = await pool.query(
      'SELECT teacher_abbr, day, start_time, end_time FROM teacher_unavailability WHERE upload_batch_id = ? ORDER BY id',
      [batchId]
    );
    const teacher_unavailability = teacher_unavailability_raw.map(u => ({
      ...u,
      start_time: u.start_time ? String(u.start_time).slice(0, 5) : '',
      end_time: u.end_time ? String(u.end_time).slice(0, 5) : '',
    }));
    
    // 9. Year Sem
    const [year_sem_raw] = await pool.query(
      'SELECT year_sem, year, semester, group_code, is_active FROM year_sem WHERE upload_batch_id = ? ORDER BY id',
      [batchId]
    );
    const year_sem = year_sem_raw.map(ys => ({
      ...ys,
      is_active: Number(ys.is_active) === 1 ? 'yes' : 'no',
    }));
    
    const workbook = {
      config,
      teachers,
      courses,
      rooms,
      credit_rules,
      room_preference,
      day_preference,
      teacher_unavailability,
      year_sem
    };
    
    return res.json({ success: true, workbook });
  } catch (err) {
    next(err);
  }
});

// POST /api/batches/:id/workbook — save and validate edited workbook data
router.post('/:id/workbook', async (req, res, next) => {
  const batchId = Number.parseInt(req.params.id, 10);
  if (!Number.isInteger(batchId) || batchId <= 0) {
    return res.status(400).json({ success: false, code: 'INVALID_BATCH_ID', message: 'batch id must be a positive integer' });
  }
  
  const workbook = req.body && req.body.workbook;
  if (!workbook || typeof workbook !== 'object') {
    return res.status(400).json({ success: false, message: 'Missing workbook object in body' });
  }
  
  try {
    const report = validate(workbook);
    
    if (!report.isValid) {
      const errorLogObj = {
        errors: report.errors,
        warnings: report.warnings,
        workbook: workbook,
      };
      await getPool().query(
        'UPDATE upload_batches SET status = "needs_review", error_log = ? WHERE id = ?',
        [JSON.stringify(errorLogObj), batchId]
      );
      return res.status(422).json({
        success: false,
        code: 'VALIDATION_FAILED',
        message: 'One or more validation rules failed',
        errors: report.errors,
        warnings: report.warnings,
        is_valid: false,
      });
    }
    
    const counts = await withTransaction(async (conn) => {
      await conn.query('DELETE FROM config WHERE upload_batch_id = ?', [batchId]);
      await conn.query('DELETE FROM teachers WHERE upload_batch_id = ?', [batchId]);
      await conn.query('DELETE FROM rooms WHERE upload_batch_id = ?', [batchId]);
      await conn.query('DELETE FROM credit_rules WHERE upload_batch_id = ?', [batchId]);
      await conn.query('DELETE FROM room_preference WHERE upload_batch_id = ?', [batchId]);
      await conn.query('DELETE FROM day_preference WHERE upload_batch_id = ?', [batchId]);
      await conn.query('DELETE FROM teacher_unavailability WHERE upload_batch_id = ?', [batchId]);
      await conn.query('DELETE FROM year_sem WHERE upload_batch_id = ?', [batchId]);
      await conn.query('DELETE FROM schedules WHERE batch_id = ?', [batchId]);
      
      for (const t of workbook.teachers || []) {
        await conn.query(
          `INSERT INTO teachers (full_name, abbreviation, designation, department, upload_batch_id)
           VALUES (?, ?, ?, ?, ?)`,
          [t.full_name, t.abbreviation, t.designation, t.department, batchId]
        );
      }
      
      for (const ys of workbook.year_sem || []) {
        const isActive = String(ys.is_active || '').trim().toLowerCase() === 'yes' ? 1 : 0;
        await conn.query(
          `INSERT INTO year_sem (year_sem, year, semester, group_code, is_active, upload_batch_id)
           VALUES (?, ?, ?, ?, ?, ?)`,
          [ys.year_sem, ys.year || null, ys.semester || null, ys.group_code, isActive, batchId]
        );
      }
      
      for (const r of workbook.rooms || []) {
        await conn.query(
          `INSERT INTO rooms (room_id, room_name, type, upload_batch_id) VALUES (?, ?, ?, ?)`,
          [r.room_id, r.room_name, r.type, batchId]
        );
      }
      
      for (const cr of workbook.credit_rules || []) {
        await conn.query(
          `INSERT INTO credit_rules (credit, type, classes_per_week, duration_minutes, upload_batch_id)
           VALUES (?, ?, ?, ?, ?)`,
          [cr.credit, cr.type, cr.classes_per_week, cr.duration_minutes, batchId]
        );
      }
      
      for (const rp of workbook.room_preference || []) {
        await conn.query(
          `INSERT INTO room_preference (room_id, year_group, weight_percent, upload_batch_id)
           VALUES (?, ?, ?, ?)`,
          [rp.room_id, rp.year_group, rp.weight_percent, batchId]
        );
      }
      
      for (const dp of workbook.day_preference || []) {
        if (!dp.day || !dp.class_type) continue;
        await conn.query(
          `INSERT INTO day_preference (day, class_type, weight_percent, note, upload_batch_id)
           VALUES (?, ?, ?, ?, ?)
           ON DUPLICATE KEY UPDATE weight_percent = VALUES(weight_percent), note = VALUES(note)`,
          [
            String(dp.day).toUpperCase().trim(),
            dp.class_type,
            dp.weight_percent,
            dp.note || null,
            batchId,
          ]
        );
      }
      
      for (const u of workbook.teacher_unavailability || []) {
        await conn.query(
          `INSERT INTO teacher_unavailability (teacher_abbr, day, start_time, end_time, upload_batch_id)
           VALUES (?, ?, ?, ?, ?)`,
          [u.teacher_abbr, u.day, u.start_time, u.end_time, batchId]
        );
      }
      
      for (const [k, v] of Object.entries(workbook.config || {})) {
        await conn.query(
          `INSERT INTO config (\`key\`, \`value\`, upload_batch_id) VALUES (?, ?, ?)`,
          [k, v, batchId]
        );
      }
      
      const activeYearSems = new Set(
        (workbook.year_sem || [])
          .filter(ys => String(ys.is_active || '').trim().toLowerCase() === 'yes')
          .map(ys => ys.year_sem)
      );
      const creditLookup = buildLookup(workbook.credit_rules || []);
      let skippedCourses = 0;
      for (const c of workbook.courses || []) {
        if (!activeYearSems.has(c.year_sem)) {
          skippedCourses++;
          continue;
        }
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
      
      const errorLogObj = { errors: [], warnings: report.warnings };
      await conn.query(
        `UPDATE upload_batches SET status = 'completed', error_log = ? WHERE id = ?`,
        [JSON.stringify(errorLogObj), batchId]
      );
      
      return {
        batch_id: batchId,
        teachers: (workbook.teachers || []).length,
        courses: (workbook.courses || []).length - skippedCourses,
        courses_skipped_inactive: skippedCourses,
        rooms: (workbook.rooms || []).length,
        year_sem: (workbook.year_sem || []).length,
        active_year_sems: activeYearSems.size,
        credit_rules: (workbook.credit_rules || []).length,
        room_preference: (workbook.room_preference || []).length,
        day_preference: (workbook.day_preference || []).length,
        teacher_unavailability: (workbook.teacher_unavailability || []).length,
        config_keys: Object.keys(workbook.config || {}).length,
      };
    });
    
    return res.status(200).json({
      success: true,
      code: 'UPLOAD_OK',
      message: 'Workbook saved and validated successfully',
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