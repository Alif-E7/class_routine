'use strict';

/**
 * Excel → structured JSON parser using SheetJS (`xlsx`).
 *
 * The uploaded .xlsx has exactly 7 data sheets. Real-world files often
 * have one or more title / note rows above the header row, so this
 * parser:
 *   1. For each expected sheet, walks row-by-row and finds the row that
 *      contains a known column header (column alias table below).
 *   2. Treats the row immediately below that as the data block.
 *   3. Normalizes each header to its canonical key so downstream code
 *      can rely on consistent field names.
 *
 * Returns:
 *   {
 *     filename,                              // string
 *     teachers:       Row[],                 // keyed by canonical names
 *     courses:        Row[],
 *     rooms:          Row[],
 *     credit_rules:   Row[],
 *     room_preference:Row[],
 *     teacher_unavailability: Row[],
 *     config:         { key: value, ... }    // Config is a key-value table
 *   }
 *
 * Throws ParseError with a helpful message if a required sheet is
 * missing, no header row can be found, or the file itself is unreadable.
 */

const XLSX = require('xlsx');

// Canonical column names that every parser consumer can rely on.
const CANONICAL = {
  // Teachers
  full_name:      'full_name',
  abbreviation:   'abbreviation',
  designation:    'designation',
  department:     'department',
  // Courses
  course_code:    'course_code',
  course_name:    'course_name',
  credit:         'credit',
  dept:           'dept',
  year_sem:       'year_sem',
  teacher_abbr:   'teacher_abbr',
  // Rooms
  room_id:        'room_id',
  room_name:      'room_name',
  type:           'type',
  // Credit_Rules
  classes_per_week:   'classes_per_week',
  duration_minutes:   'duration_minutes',
  // Room_Preference
  year_group:     'year_group',
  weight_percent: 'weight_percent',
  // Teacher_Unavailability
  day:            'day',
  start_time:     'start_time',
  end_time:       'end_time',
  // Config (key/value)
  key:            'key',
  value:          'value',
};

// Aliases (case-insensitive, whitespace-stripped) → canonical.
// Built so a file with a stray capital letter or different ordering
// still parses correctly.
const ALIASES = buildAliasMap();

function buildAliasMap() {
  const map = {};
  for (const canonical of Object.values(CANONICAL)) {
    map[canonical] = canonical;
    map[canonical.toLowerCase()] = canonical;
    map[canonical.replace(/_/g, ' ')] = canonical;
    map[canonical.replace(/_/g, ' ').toLowerCase()] = canonical;
    map[canonical.toUpperCase()] = canonical;
  }
  // Friendly aliases from the build prompt.
  map['teacher abbreviation'] = 'abbreviation';
  map['teacher name']        = 'full_name';
  map['course code']         = 'course_code';
  map['course name']         = 'course_name';
  map['room name']           = 'room_name';
  map['room id']             = 'room_id';
  map['classes per week']    = 'classes_per_week';
  map['duration minutes']    = 'duration_minutes';
  map['weight percent']      = 'weight_percent';
  map['start time']          = 'start_time';
  map['end time']            = 'end_time';
  map['year sem']            = 'year_sem';
  map['year_sem']            = 'year_sem';
  map['year-sem']            = 'year_sem';
  return map;
}

function normalizeKey(raw) {
  if (raw == null) return null;
  const k = String(raw).trim().toLowerCase().replace(/\s+/g, ' ');
  return ALIASES[k] || ALIASES[k.replace(/ /g, '_')] || null;
}

// Columns we use to detect the header row of each sheet.
// If any of these is present in a row, we treat that row as the header.
const SHEET_HINTS = {
  Teachers:               ['abbreviation', 'full_name', 'designation'],
  Courses:                ['course_code', 'credit', 'year_sem'],
  Rooms:                  ['room_id', 'room_name', 'type'],
  Credit_Rules:           ['credit', 'classes_per_week', 'duration_minutes'],
  Room_Preference:        ['room_id', 'year_group', 'weight_percent'],
  Teacher_Unavailability: ['teacher_abbr', 'start_time', 'end_time'],
  Config:                 ['key', 'value'],
};

class ParseError extends Error {
  constructor(message, details) {
    super(message);
    this.name = 'ParseError';
    this.details = details || null;
  }
}

function findHeaderRow(rows, sheetName) {
  const hints = SHEET_HINTS[sheetName] || [];
  for (let i = 0; i < rows.length; i++) {
    const cells = (rows[i] || []).map(c => (c == null ? '' : String(c).trim().toLowerCase()));
    // Count how many of the sheet's hint columns appear in this row.
    let hits = 0;
    for (const hint of hints) {
      if (cells.includes(hint) || cells.includes(hint.replace(/_/g, ' '))) hits++;
    }
    if (hits >= Math.min(2, hints.length)) return i;
  }
  return -1;
}

function rowsToObjects(rows, headerIndex) {
  const header = (rows[headerIndex] || []).map(c => (c == null ? '' : String(c).trim()));
  const out = [];
  for (let i = headerIndex + 1; i < rows.length; i++) {
    const row = rows[i] || [];
    if (row.every(c => c == null || String(c).trim() === '')) continue; // skip blanks
    const obj = {};
    for (let c = 0; c < header.length; c++) {
      const canon = normalizeKey(header[c]);
      if (canon) obj[canon] = row[c] == null ? null : String(row[c]).trim();
    }
    if (Object.keys(obj).length > 0) out.push(obj);
  }
  return out;
}

function parseConfigRows(rows) {
  // Config can be a 2-column key/value table that has a header row.
  // We accept both layouts: a normal 2-col table (key,value) and a
  // sheet that's just key-value pairs starting at row 0.
  const out = {};
  for (const r of rows) {
    if (!r.key) continue;
    out[String(r.key).trim()] = r.value == null ? '' : String(r.value).trim();
  }
  return out;
}

function parseWorkbook(buffer, filename) {
  let workbook;
  try {
    workbook = XLSX.read(buffer, { type: 'buffer', cellDates: false });
  } catch (err) {
    throw new ParseError(`Could not read .xlsx file: ${err.message}`);
  }

  const sheetNames = workbook.SheetNames;
  const required = ['Teachers', 'Courses', 'Rooms', 'Credit_Rules',
                    'Room_Preference', 'Teacher_Unavailability', 'Config'];
  const missing = required.filter(n => !sheetNames.includes(n));
  if (missing.length > 0) {
    throw new ParseError(
      `Missing required sheet(s): ${missing.join(', ')}`,
      { missingSheets: missing, foundSheets: sheetNames }
    );
  }

  const result = { filename: filename || null };

  for (const sheetName of required) {
    const ws = workbook.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null, blankrows: true });
    const headerIdx = findHeaderRow(rows, sheetName);
    if (headerIdx < 0) {
      throw new ParseError(
        `Sheet "${sheetName}" has no recognizable header row`,
        { sheetName, expectedAnyOf: SHEET_HINTS[sheetName] }
      );
    }
    const objs = rowsToObjects(rows, headerIdx);
    if (sheetName === 'Config') {
      result.config = parseConfigRows(objs);
    } else {
      // Map sheet name → camelCase key on the result object.
      const key = sheetName.toLowerCase();
      result[key] = objs;
    }
  }

  return result;
}

module.exports = { parseWorkbook, ParseError, normalizeKey, findHeaderRow, CANONICAL };
