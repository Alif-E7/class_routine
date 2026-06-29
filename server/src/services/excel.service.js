const ExcelJS = require('exceljs');
const COLUMN_ALIASES = require('./lint.aliases');

// Only RoutineEntries is mandatory — the rest are optional "add new master" sheets.
const REQUIRED_SHEETS = ['RoutineEntries'];
const OPTIONAL_SHEETS = ['Departments', 'Teachers', 'Rooms', 'Courses', 'Sections', 'TimeSlots'];

// Normalize a raw Excel header to a canonical column name.
// Lowercases, trims, collapses spaces → underscores, then looks up alias.
// (Alias map lives in ./lint.aliases.js — shared with lint.service.js so the
//  parser and the pre-flight linter always agree on what a header means.)
const normalizeHeader = (raw) => {
  const key = String(raw).trim().toLowerCase().replace(/\s+/g, '_');
  return COLUMN_ALIASES[key] || key;
};

// ── parseWorkbook ─────────────────────────────────────────────────────────────
const parseWorkbook = async (filePath) => {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(filePath);
  const data = {};

  for (const sheetName of [...REQUIRED_SHEETS, ...OPTIONAL_SHEETS]) {
    const sheet = workbook.getWorksheet(sheetName);
    if (!sheet) {
      if (REQUIRED_SHEETS.includes(sheetName)) {
        throw new Error(`Missing required sheet: ${sheetName}`);
      }
      data[sheetName] = [];
      continue;
    }
    data[sheetName] = sheetToJson(sheet);
  }
  return data;
};

// ── sheetToJson ───────────────────────────────────────────────────────────────
// Reads an ExcelJS worksheet and returns an array of plain objects.
// Column headers are normalised via COLUMN_ALIASES before being used as keys.
const sheetToJson = (sheet) => {
  const rows = [];

  // Pre-build normalised header map: colNumber → canonical key
  const headers = {};
  sheet.getRow(1).eachCell({ includeEmpty: false }, (cell, colNumber) => {
    if (cell.value) {
      headers[colNumber] = normalizeHeader(String(cell.value));
    }
  });

  sheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    if (rowNumber === 1) return; // skip header row
    const rowObj = {};
    row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
      const header = headers[colNumber];
      if (header) {
        rowObj[header] = cell.value;
      }
    });
    // Skip completely empty rows
    if (Object.keys(rowObj).length > 0) rows.push(rowObj);
  });

  return rows;
};

// ── validateSheets ────────────────────────────────────────────────────────────
// Checks that required canonical columns are present after normalization.
const validateSheets = (data) => {
  const errors = [];

  const validations = {
    Departments:   ['dept_code', 'dept_name', 'faculty'],
    Teachers:      ['teacher_code', 'teacher_name', 'dept_code'],
    Rooms:         ['room_no'],
    Courses:       ['course_code', 'course_name', 'credit', 'dept_code'],
    Sections:      ['dept_code', 'year', 'semester'],
    TimeSlots:     ['start_time', 'end_time'],
    // dept_code is auto-filled from the upload form, so not required in the sheet
    RoutineEntries: ['day', 'year', 'semester', 'course_code', 'teacher_code', 'room_no', 'start_time', 'end_time']
  };

  for (const [sheet, requiredCols] of Object.entries(validations)) {
    const rows = data[sheet];
    if (!rows || rows.length === 0) continue;

    const firstRow = rows[0];
    const missingCols = requiredCols.filter((col) => !(col in firstRow));

    if (missingCols.length > 0) {
      errors.push(`Sheet '${sheet}' is missing required columns: ${missingCols.join(', ')}`);
    }
  }

  if (errors.length > 0) {
    const error = new Error('Excel validation failed');
    error.statusCode = 400;
    error.details = errors;
    throw error;
  }

  return true;
};

module.exports = { parseWorkbook, validateSheets };
