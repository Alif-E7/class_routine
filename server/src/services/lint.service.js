// Pre-flight linter for routine Excel uploads. Pure function — no DB, no I/O.
// Given a parsed workbook (same shape `excel.service.parseWorkbook` returns) and
// the upload form's `departmentCode`, returns a list of every rule violation.
//
// Each violation has the shape:
//   { rule: 'R1'|'R2'|...|'R10', severity: 'error'|'warning', sheet, row, column?, message }
//
// `row` is the 1-indexed Excel row number INCLUDING the header row, so error messages
// like "RoutineEntry row 17" match what the server's validator reports.
//
// Usage:
//   const { lintWorkbook } = require('./lint.service');
//   const data = await excelService.parseWorkbook(filePath);
//   const { errors, warnings, isValid } = lintWorkbook(data, 'CSE');
//
// This module deliberately does NOT duplicate validation logic from validation.service.js.
// It runs earlier (client-side or pre-import) with a richer error surface so users can
// fix problems before they hit the server.

const COLUMN_ALIASES = require('./lint.aliases');

// Canonical column names per sheet. Mirrors excel.service.js's validateSheets exactly.
const REQUIRED_COLUMNS = {
  Departments:   ['dept_code', 'dept_name', 'faculty'],
  Teachers:      ['teacher_code', 'teacher_name', 'dept_code'],
  Rooms:         ['room_no'],
  Courses:       ['course_code', 'course_name', 'credit', 'dept_code'],
  Sections:      ['dept_code', 'year', 'semester'],
  TimeSlots:     ['start_time', 'end_time'],
  // dept_code is auto-filled from the upload form, so not required in this sheet
  RoutineEntries: ['day', 'year', 'semester', 'course_code', 'teacher_code', 'room_no', 'start_time', 'end_time']
};

const DAY_RE = /^(SUN|MON|TUE|WED|THR|THU|THURSDAY|FRI|SAT)$/i;
const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/; // HH:MM 24-hour
const ALLOWED_FACULTIES = ['Engineering', 'Science', 'Life Science', 'Humanities', 'Business', 'Other'];

// Tracks which alias each header was resolved through (for diagnostics).
const _resolveHeader = (rawHeader) => {
  if (rawHeader === null || rawHeader === undefined) return { canonical: null, alias: null };
  const key = String(rawHeader).trim().toLowerCase().replace(/\s+/g, '_');
  return { canonical: COLUMN_ALIASES[key] || key, alias: key };
};

// Build a row index → { colLetter → canonical column } map for one sheet.
// Assumes sheet is the result of `excel.service.sheetToJson` PLUS the original header row.
// To keep this module pure, the caller must pass `{ rows, headers }` where headers is the
// raw header row (array of strings) and rows is the array of normalised objects.
const _indexColumns = (headers) => {
  const colByCanonical = {};
  const colByRaw = {};
  headers.forEach((raw, idx) => {
    const { canonical, alias } = _resolveHeader(raw);
    if (canonical && !colByCanonical[canonical]) {
      colByCanonical[canonical] = { canonical, raw, alias, colIndex: idx };
      colByRaw[String(raw).trim()] = colByCanonical[canonical];
    }
  });
  return colByCanonical;
};

const _violation = (rule, severity, sheet, row, message, column = null) => ({
  rule, severity, sheet, row, column, message
});

/**
 * Lint a parsed workbook.
 *
 * @param {Object} workbookData - result of excelService.parseWorkbook
 *                               { Departments: [], Teachers: [], ..., RoutineEntries: [] }
 * @param {Object} options
 * @param {string} options.departmentCode  - the dept code from the upload form (R10)
 * @param {Object} [options.headersBySheet] - optional map of sheetName → raw header array,
 *                              used to report column-level errors with exact column names.
 *                              If omitted, only row-level errors are emitted.
 * @returns {{ errors: Array, warnings: Array, isValid: boolean, summary: Object }}
 */
const lintWorkbook = (workbookData, options = {}) => {
  const errors = [];
  const warnings = [];
  const departmentCode = options.departmentCode ? String(options.departmentCode).trim().toUpperCase() : '';
  const headersBySheet = options.headersBySheet || {};

  // ── R1: RoutineEntries sheet must exist ─────────────────────────────────
  if (!workbookData || !Array.isArray(workbookData.RoutineEntries)) {
    errors.push(_violation('R1', 'error', 'RoutineEntries', null,
      'RoutineEntries sheet is missing. This is the only mandatory sheet — without it, nothing can be imported.'));
    return { errors, warnings, isValid: false, summary: _summary(errors, warnings) };
  }

  // ── R1: RoutineEntries must have at least one data row ──────────────────
  if (workbookData.RoutineEntries.length === 0) {
    errors.push(_violation('R1', 'error', 'RoutineEntries', 1,
      'RoutineEntries sheet has no data rows. Add at least one class schedule.'));
    return { errors, warnings, isValid: false, summary: _summary(errors, warnings) };
  }

  // ── R2: Required canonical columns must be present after alias resolution ─
  for (const [sheet, required] of Object.entries(REQUIRED_COLUMNS)) {
    const rows = workbookData[sheet];
    if (!rows || rows.length === 0) continue; // optional sheet
    const firstRow = rows[0] || {};
    const missing = required.filter((c) => !(c in firstRow));
    if (missing.length > 0) {
      errors.push(_violation('R2', 'error', sheet, 1,
        `Sheet '${sheet}' is missing required columns: ${missing.join(', ')}. ` +
        `Use the canonical header names — accepted aliases are listed in docs/EXCEL_UPLOAD_MANUAL.md §4.`,
        missing[0]));
    }
  }

  // ── R3: dept_code handling ──────────────────────────────────────────────
  // The form's departmentCode field is the source of truth.
  // (a) If absent → user forgot to type it.
  if (!departmentCode) {
    errors.push(_violation('R3', 'error', 'RoutineEntries', null,
      'No departmentCode supplied in the upload form. The form\'s "Department Code" field is required and is the source of truth for dept_code on every row.'));
  }

  // (b) Rows with explicit dept_code different from the form's value are silently
  //     filtered out by preprocessExcelData — warn the user so they're not surprised.
  ['Departments', 'Teachers', 'Courses', 'Sections', 'RoutineEntries'].forEach((sheet) => {
    const rows = workbookData[sheet];
    if (!rows) return;
    rows.forEach((r, i) => {
      const raw = r.dept_code;
      if (raw === undefined || raw === null || String(raw).trim() === '') return;
      const trimmed = String(raw).trim();
      if (trimmed.toLowerCase().includes('(auto-filled')) return; // OK
      const upper = trimmed.toUpperCase();
      if (upper !== departmentCode && departmentCode) {
        warnings.push(_violation('R3', 'warning', sheet, i + 2,
          `Row's dept_code '${trimmed}' differs from the form's departmentCode '${departmentCode}'. ` +
          `This row will be DROPPED from the import — the form's value wins.`, 'dept_code'));
      }
    });
  });

  // ── R4: day ∈ {SUN MON TUE WED THR FRI SAT} (THU/THURSDAY normalised to THR) ─
  workbookData.RoutineEntries.forEach((r, i) => {
    const day = String(r.day || '').trim().toUpperCase();
    if (!day) {
      errors.push(_violation('R4', 'error', 'RoutineEntries', i + 2,
        `Missing day. Must be one of SUN, MON, TUE, WED, THR, FRI, SAT.`, 'day'));
    } else if (!DAY_RE.test(day)) {
      errors.push(_violation('R4', 'error', 'RoutineEntries', i + 2,
        `Invalid day '${r.day}'. Must be one of SUN, MON, TUE, WED, THR, FRI, SAT (case-insensitive).`, 'day'));
    }
  });

  // ── R5 + R6: year ∈ {1..4}, semester ∈ {1, 2} ──────────────────────────
  workbookData.RoutineEntries.forEach((r, i) => {
    const y = parseInt(String(r.year ?? '').trim(), 10);
    const sm = parseInt(String(r.semester ?? '').trim(), 10);
    if (!Number.isInteger(y) || y < 1 || y > 4) {
      errors.push(_violation('R5', 'error', 'RoutineEntries', i + 2,
        `Invalid year '${r.year}'. Must be an integer 1, 2, 3, or 4.`, 'year'));
    }
    if (!Number.isInteger(sm) || sm < 1 || sm > 2) {
      errors.push(_violation('R6', 'error', 'RoutineEntries', i + 2,
        `Invalid semester '${r.semester}'. Must be 1 (odd) or 2 (even).`, 'semester'));
    }
  });

  // Section sheets get the same numeric checks (R5/R6 apply to them too).
  (workbookData.Sections || []).forEach((s, i) => {
    const y = parseInt(String(s.year ?? '').trim(), 10);
    const sm = parseInt(String(s.semester ?? '').trim(), 10);
    if (!Number.isInteger(y) || y < 1 || y > 4) {
      errors.push(_violation('R5', 'error', 'Sections', i + 2,
        `Invalid year '${s.year}'. Must be 1, 2, 3, or 4.`, 'year'));
    }
    if (!Number.isInteger(sm) || sm < 1 || sm > 2) {
      errors.push(_violation('R6', 'error', 'Sections', i + 2,
        `Invalid semester '${s.semester}'. Must be 1 or 2.`, 'semester'));
    }
  });

  // ── R7: start_time / end_time HH:MM 24-hour ─────────────────────────────
  (workbookData.TimeSlots || []).forEach((t, i) => {
    const s = String(t.start_time || '').trim();
    const e = String(t.end_time || '').trim();
    if (!TIME_RE.test(s)) {
      errors.push(_violation('R7', 'error', 'TimeSlots', i + 2,
        `Invalid start_time '${s}'. Must be HH:MM in 24-hour format (e.g. 09:00, 14:30).`, 'start_time'));
    }
    if (!TIME_RE.test(e)) {
      errors.push(_violation('R7', 'error', 'TimeSlots', i + 2,
        `Invalid end_time '${e}'. Must be HH:MM in 24-hour format.`, 'end_time'));
    }
    if (TIME_RE.test(s) && TIME_RE.test(e)) {
      const sMins = _toMinutes(s);
      const eMins = _toMinutes(e);
      if (eMins <= sMins) {
        errors.push(_violation('R7', 'error', 'TimeSlots', i + 2,
          `end_time '${e}' must be strictly after start_time '${s}'.`));
      }
    }
  });

  workbookData.RoutineEntries.forEach((r, i) => {
    const s = String(r.start_time || '').trim();
    const e = String(r.end_time || '').trim();
    if (s && !TIME_RE.test(s)) {
      errors.push(_violation('R7', 'error', 'RoutineEntries', i + 2,
        `Invalid start_time '${s}'. Must be HH:MM in 24-hour format.`, 'start_time'));
    }
    if (e && !TIME_RE.test(e)) {
      errors.push(_violation('R7', 'error', 'RoutineEntries', i + 2,
        `Invalid end_time '${e}'. Must be HH:MM in 24-hour format.`, 'end_time'));
    }
    if (TIME_RE.test(s) && TIME_RE.test(e)) {
      const sMins = _toMinutes(s);
      const eMins = _toMinutes(e);
      if (eMins <= sMins) {
        errors.push(_violation('R7', 'error', 'RoutineEntries', i + 2,
          `end_time '${e}' must be strictly after start_time '${s}'.`));
      }
    }
  });

  // ── R8: Every course_code / teacher_code / room_no referenced by RoutineEntries
  //      must exist in its sheet (or be left empty so it can be pulled from DB later).
  const courseCodes = new Set((workbookData.Courses || []).map((c) => String(c.course_code || '').trim()).filter(Boolean));
  const teacherCodes = new Set((workbookData.Teachers || []).map((t) => String(t.teacher_code || '').trim()).filter(Boolean));
  const roomNos = new Set((workbookData.Rooms || []).map((rm) => String(rm.room_no || '').trim()).filter(Boolean));

  workbookData.RoutineEntries.forEach((r, i) => {
    const c = String(r.course_code || '').trim();
    const t = String(r.teacher_code || '').trim();
    const rm = String(r.room_no || '').trim();
    if (c && !courseCodes.has(c)) {
      warnings.push(_violation('R8', 'warning', 'RoutineEntries', i + 2,
        `course_code '${c}' not declared in the Courses sheet. It will be auto-created from DB if it already exists there — otherwise this row will fail. Add it to the Courses sheet to be safe.`, 'course_code'));
    }
    if (t && !teacherCodes.has(t)) {
      warnings.push(_violation('R8', 'warning', 'RoutineEntries', i + 2,
        `teacher_code '${t}' not declared in the Teachers sheet. It will be auto-created from DB if it already exists there — otherwise this row will fail.`, 'teacher_code'));
    }
    if (rm && !roomNos.has(rm)) {
      warnings.push(_violation('R8', 'warning', 'RoutineEntries', i + 2,
        `room_no '${rm}' not declared in the Rooms sheet. It will be auto-created from DB if it already exists there — otherwise this row will fail.`, 'room_no'));
    }
  });

  // Cross-dept dept_code consistency: every Teachers/Courses.dept_code must appear
  // either in the Departments sheet or already exist in DB (we can't know DB here,
  // so we just warn if it's missing from the sheet).
  const deptCodes = new Set(
    (workbookData.Departments || []).map((d) => String(d.dept_code || '').trim().toUpperCase()).filter(Boolean)
  );
  (workbookData.Teachers || []).forEach((t, i) => {
    const d = String(t.dept_code || '').trim().toUpperCase();
    if (d && !deptCodes.has(d) && !d.includes('(AUTO-FILLED')) {
      warnings.push(_violation('R8', 'warning', 'Teachers', i + 2,
        `dept_code '${d}' is not declared in the Departments sheet. Add it (or leave dept_code as (Auto-filled)).`, 'dept_code'));
    }
  });
  (workbookData.Courses || []).forEach((c, i) => {
    const d = String(c.dept_code || '').trim().toUpperCase();
    if (d && !deptCodes.has(d) && !d.includes('(AUTO-FILLED')) {
      warnings.push(_violation('R8', 'warning', 'Courses', i + 2,
        `dept_code '${d}' is not declared in the Departments sheet. Add it (or leave dept_code as (Auto-filled)).`, 'dept_code'));
    }
  });

  // ── R9: Teacher/room double-booking inside the sheet ────────────────────
  const teacherSeen = new Set();
  const roomSeen = new Set();
  // Section slot map: sectionTimeKey → [{teacher, room, row}] — only true
  // double-booking when same teacher OR same room is reused within the section.
  const sectionSlots = new Map();

  workbookData.RoutineEntries.forEach((r, i) => {
    const day = String(r.day || '').trim().toUpperCase();
    const s = String(r.start_time || '').trim();
    const e = String(r.end_time || '').trim();
    const t = String(r.teacher_code || '').trim();
    const rm = String(r.room_no || '').trim();
    const dept = String(r.dept_code || departmentCode).trim().toUpperCase();
    const y = parseInt(String(r.year || '').trim(), 10);
    const sm = parseInt(String(r.semester || '').trim(), 10);
    const rowNum = i + 2;

    if (!day || !TIME_RE.test(s) || !TIME_RE.test(e)) return; // already reported

    const timeKey = `${day}-${s}-${e}`;

    // Teacher conflict
    const tKey = `T-${t}-${timeKey}`;
    if (t && teacherSeen.has(tKey)) {
      errors.push(_violation('R9', 'error', 'RoutineEntries', rowNum,
        `Teacher '${t}' is double-booked on ${day} at ${s}-${e}.`, 'teacher_code'));
    } else if (t) {
      teacherSeen.add(tKey);
    }

    // Room conflict
    const rKey = `R-${rm}-${timeKey}`;
    if (rm && roomSeen.has(rKey)) {
      errors.push(_violation('R9', 'error', 'RoutineEntries', rowNum,
        `Room '${rm}' is double-booked on ${day} at ${s}-${e}.`, 'room_no'));
    } else if (rm) {
      roomSeen.add(rKey);
    }

    // Section-level conflict (parallel lab groups are OK; identical teacher+slot is not)
    const stKey = `S-${dept}-${y}-${sm}-${timeKey}`;
    if (!sectionSlots.has(stKey)) sectionSlots.set(stKey, []);
    const existing = sectionSlots.get(stKey);
    const dup = existing.find((x) => x.teacher === t || x.room === rm);
    if (dup) {
      if (dup.teacher === t) {
        errors.push(_violation('R9', 'error', 'RoutineEntries', rowNum,
          `Teacher '${t}' is assigned twice to section ${dept}-${y}-${sm} on ${day} at ${s}-${e}.`, 'teacher_code'));
      } else {
        errors.push(_violation('R9', 'error', 'RoutineEntries', rowNum,
          `Room '${rm}' is used twice by section ${dept}-${y}-${sm} on ${day} at ${s}-${e}.`, 'room_no'));
      }
    }
    existing.push({ teacher: t, room: rm, row: rowNum });
  });

  // ── R10: faculty value sanity (Departments sheet only) ─────────────────
  (workbookData.Departments || []).forEach((d, i) => {
    const f = String(d.faculty || '').trim();
    if (!f) {
      errors.push(_violation('R10', 'error', 'Departments', i + 2,
        `Missing faculty. Must be one of ${ALLOWED_FACULTIES.join(', ')}.`, 'faculty'));
    } else if (!ALLOWED_FACULTIES.includes(f)) {
      errors.push(_violation('R10', 'error', 'Departments', i + 2,
        `Invalid faculty '${f}'. Must be one of ${ALLOWED_FACULTIES.join(', ')}.`, 'faculty'));
    }
  });

  // ── Credit must be a number (Courses) ───────────────────────────────────
  (workbookData.Courses || []).forEach((c, i) => {
    const credit = parseFloat(String(c.credit ?? '').trim());
    if (!Number.isFinite(credit) || credit < 0) {
      errors.push(_violation('R2', 'error', 'Courses', i + 2,
        `Invalid credit '${c.credit}'. Must be a non-negative number.`, 'credit'));
    }
  });

  // ── Routine row must have ALL required fields ───────────────────────────
  workbookData.RoutineEntries.forEach((r, i) => {
    const missing = [];
    ['day', 'year', 'semester', 'course_code', 'teacher_code', 'room_no', 'start_time', 'end_time'].forEach((k) => {
      if (r[k] === undefined || r[k] === null || String(r[k]).trim() === '') missing.push(k);
    });
    if (missing.length > 0) {
      errors.push(_violation('R1', 'error', 'RoutineEntries', i + 2,
        `Missing required field(s): ${missing.join(', ')}.`, missing[0]));
    }
  });

  return {
    errors,
    warnings,
    isValid: errors.length === 0,
    summary: _summary(errors, warnings)
  };
};

const _toMinutes = (hhmm) => {
  const [h, m] = hhmm.split(':').map((x) => parseInt(x, 10));
  return h * 60 + m;
};

const _summary = (errors, warnings) => {
  const byRule = {};
  errors.forEach((e) => { byRule[e.rule] = (byRule[e.rule] || 0) + 1; });
  warnings.forEach((w) => { byRule[w.rule] = (byRule[w.rule] || 0) + 1; });
  return {
    errorCount: errors.length,
    warningCount: warnings.length,
    byRule
  };
};

// Expose internals for tests
module.exports = {
  lintWorkbook,
  REQUIRED_COLUMNS,
  ALLOWED_FACULTIES,
  DAY_RE,
  TIME_RE
};
