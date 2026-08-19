'use strict';

const express = require('express');
const router = express.Router();
const { getPool } = require('../db/pool');
const { loadBatchForSchedule } = require('../services/routineLoader');
const { calculateScore, normalizeSlotValue } = require('../services/scheduler');
const { touchBatch } = require('../services/batchCleanup');
const { resolveDepartmentName } = require('../services/validators');

// Faculty options list (both full names from new template Lists and shorthand for backward compatibility)
const FACULTIES = [
  'Engineering Faculty',
  'Science Faculty',
  'Life Science Faculty',
  'Humanities Faculty (Faculty of Arts)',
  'Social Science Faculty',
  'Business Studies Faculty',
  'Law Faculty',
  'Faculty of Agriculture',
  'Animal Science and Veterinary Medicine Faculty',
  'Engineering',
  'Science',
  'Life Science',
  'Humanities',
  'Social Science',
  'Business Studies',
  'Law',
  'Animal Science and Veterinary Medicine',
  'Agriculture',
];

// Helper to auto-create class_routines table if not exists
async function ensureClassRoutinesTable() {
  const pool = getPool();
  await pool.query(`
    CREATE TABLE IF NOT EXISTS class_routines (
      id INT AUTO_INCREMENT PRIMARY KEY,
      batch_id INT NOT NULL,
      department VARCHAR(100) NOT NULL,
      faculty VARCHAR(100) NOT NULL,
      year VARCHAR(20) NOT NULL,
      term VARCHAR(20) NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (batch_id) REFERENCES upload_batches(id) ON DELETE CASCADE
    ) ENGINE=InnoDB;
  `);
}

// GET /api/class-routines — list all saved class routines with metadata
router.get('/', async (_req, res, next) => {
  try {
    await ensureClassRoutinesTable();
    const pool = getPool();

    const [rows] = await pool.query(`
      SELECT 
        cr.id,
        cr.batch_id as batchId,
        cr.department,
        cr.faculty,
        cr.year,
        cr.term,
        cr.created_at as createdAt,
        ub.filename,
        ub.semester as semesterName
      FROM class_routines cr
      JOIN upload_batches ub ON cr.batch_id = ub.id
      ORDER BY cr.created_at DESC, cr.id DESC
    `);

    return res.json({
      success: true,
      data: rows,
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/class-routines — add a generated routine to Class Routines
router.post('/', async (req, res, next) => {
  try {
    await ensureClassRoutinesTable();
    const batchId = req.body.batchId || req.body.batch_id;
    const { department, faculty, year, term } = req.body;

    if (!batchId || !department || !faculty || !year || !term) {
      return res.status(400).json({
        success: false,
        code: 'MISSING_FIELDS',
        message: 'batchId, department, faculty, year, and term are required',
      });
    }

    if (!FACULTIES.includes(faculty)) {
      return res.status(400).json({
        success: false,
        code: 'INVALID_FACULTY',
        message: `Faculty must be one of: ${FACULTIES.join(', ')}`,
      });
    }

    const batchIdParsed = Number.parseInt(batchId, 10);
    const pool = getPool();

    // Verify batch exists and has schedule
    const [batchRows] = await pool.query('SELECT id, semester FROM upload_batches WHERE id = ?', [batchIdParsed]);
    if (batchRows.length === 0) {
      return res.status(404).json({
        success: false,
        code: 'BATCH_NOT_FOUND',
        message: `No batch found with id ${batchIdParsed}`,
      });
    }

    const currentSemester = (batchRows[0].semester || '').trim().toLowerCase();

    const [schedRows] = await pool.query('SELECT COUNT(*) as cnt FROM schedules WHERE batch_id = ?', [batchIdParsed]);
    if (schedRows[0].cnt === 0) {
      return res.status(400).json({
        success: false,
        code: 'NO_SCHEDULE',
        message: 'This batch has no generated routine schedule yet. Generate the routine first.',
      });
    }

    const deptClean = resolveDepartmentName(department);
    const yearClean = year.trim();

    // Check for previous class_routines entry with matching department, faculty, year, term, and semester
    const [existingMatches] = await pool.query(
      `SELECT cr.id
       FROM class_routines cr
       LEFT JOIN upload_batches ub ON cr.batch_id = ub.id
       WHERE LOWER(TRIM(cr.department)) = LOWER(TRIM(?))
         AND LOWER(TRIM(cr.faculty)) = LOWER(TRIM(?))
         AND LOWER(TRIM(cr.year)) = LOWER(TRIM(?))
         AND LOWER(TRIM(cr.term)) = LOWER(TRIM(?))
         AND (
           ? = ''
           OR LOWER(TRIM(COALESCE(ub.semester, ''))) = ?
           OR LOWER(TRIM(COALESCE(ub.semester, ''))) = ''
         )`,
      [deptClean, faculty, yearClean, term, currentSemester, currentSemester]
    );

    let overwritten = false;
    if (existingMatches.length > 0) {
      const idsToDelete = existingMatches.map((r) => r.id);
      await pool.query('DELETE FROM class_routines WHERE id IN (?)', [idsToDelete]);
      overwritten = true;
    }

    // Insert class_routines entry
    const [insertRes] = await pool.query(
      `INSERT INTO class_routines (batch_id, department, faculty, year, term)
       VALUES (?, ?, ?, ?, ?)`,
      [batchIdParsed, deptClean, faculty, yearClean, term]
    );

    // Refresh batch timestamp to reset 10-day retention countdown
    await touchBatch(batchIdParsed);

    const createdId = insertRes.insertId;

    return res.status(201).json({
      success: true,
      code: overwritten ? 'CLASS_ROUTINE_OVERWRITTEN' : 'CLASS_ROUTINE_ADDED',
      message: overwritten
        ? 'Previous routine overwritten and updated in Class Routines'
        : 'Routine successfully added to Class Routines',
      overwritten,
      data: {
        id: createdId,
        batchId: batchIdParsed,
        department: deptClean,
        faculty,
        year: yearClean,
        term,
      },
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/class-routines/:id — fetch full detail for a single class routine
router.get('/:id', async (req, res, next) => {
  try {
    await ensureClassRoutinesTable();
    const id = Number.parseInt(req.params.id, 10);
    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({
        success: false,
        code: 'INVALID_ID',
        message: 'ID must be a positive integer',
      });
    }

    const pool = getPool();
    const [metaRows] = await pool.query(
      `SELECT cr.*, ub.filename, ub.semester 
       FROM class_routines cr
       JOIN upload_batches ub ON cr.batch_id = ub.id
       WHERE cr.id = ?`,
      [id]
    );

    if (metaRows.length === 0) {
      return res.status(404).json({
        success: false,
        code: 'NOT_FOUND',
        message: `No class routine found with id ${id}`,
      });
    }

    const routineMeta = metaRows[0];
    const loaded = await loadBatchForSchedule(routineMeta.batch_id);

    const [schedRows] = await pool.query(
      `SELECT
         s.id, s.course_code, s.teacher_abbr, s.room_id,
         s.day, s.slot_start, s.slot_end, s.year_sem, s.session_index,
         c.course_name, c.credit, c.dept,
         c.derived_type, c.derived_duration_min, c.derived_classes_per_week,
         t.full_name as teacher_name, t.designation as teacher_designation,
         r.room_name, r.type as room_type
       FROM schedules s
       JOIN courses c ON c.upload_batch_id = s.batch_id AND c.course_code = s.course_code
       LEFT JOIN teachers t ON t.upload_batch_id = s.batch_id AND t.abbreviation = s.teacher_abbr
       LEFT JOIN rooms r ON r.upload_batch_id = s.batch_id AND r.room_id = s.room_id
       WHERE s.batch_id = ?
       ORDER BY s.day, s.slot_start, s.year_sem`,
      [routineMeta.batch_id]
    );

    const assignments = schedRows.map((r) => ({
      course_code: r.course_code,
      teacher_abbr: r.teacher_abbr,
      room_id: r.room_id,
      day: r.day,
      slot_start: normalizeSlotValue(r.slot_start),
      slot_end: normalizeSlotValue(r.slot_end),
      year_sem: r.year_sem,
      session_index: r.session_index,
      course_name: r.course_name,
      credit: r.credit,
      dept: r.dept,
      teacher_name: r.teacher_name,
      room_name: r.room_name,
    }));

    const score = calculateScore(assignments, loaded);

    return res.json({
      success: true,
      data: {
        meta: {
          id: routineMeta.id,
          batchId: routineMeta.batch_id,
          department: routineMeta.department,
          faculty: routineMeta.faculty,
          year: routineMeta.year,
          term: routineMeta.term,
          createdAt: routineMeta.created_at,
          filename: routineMeta.filename,
          semesterName: routineMeta.semester,
        },
        assignments,
        teachers: loaded.teachers,
        courses: loaded.courses,
        rooms: loaded.rooms,
        config: loaded.config,
        yearSemList: loaded.yearSemList,
        dayList: loaded.dayList,
        score,
      },
    });
  } catch (err) {
    next(err);
  }
});

// DELETE /api/class-routines/:id — remove a class routine entry
router.delete('/:id', async (req, res, next) => {
  try {
    await ensureClassRoutinesTable();
    const id = Number.parseInt(req.params.id, 10);
    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({
        success: false,
        code: 'INVALID_ID',
        message: 'ID must be a positive integer',
      });
    }

    const pool = getPool();
    const [resDelete] = await pool.query('DELETE FROM class_routines WHERE id = ?', [id]);

    if (resDelete.affectedRows === 0) {
      return res.status(404).json({
        success: false,
        code: 'NOT_FOUND',
        message: `Class routine with id ${id} not found`,
      });
    }

    return res.json({
      success: true,
      code: 'DELETED',
      message: `Deleted class routine #${id}`,
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
