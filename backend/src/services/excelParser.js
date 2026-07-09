'use strict';

/**
 * Excel → structured JSON parser using SheetJS (`xlsx`).
 *
 * The uploaded .xlsx has exactly 9 data sheets. Real-world files often
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
 *     year_sem:       Row[],                 // NEW: master lookup
 *     rooms:          Row[],
 *     credit_rules:   Row[],
 *     room_preference:Row[],
 *     day_preference: Row[],                 // NEW: day bias weights
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
  // Year_Sem (NEW)
  year:           'year',
  semester:       'semester',
  group_code:     'group_code',
  is_active:      'is_active',
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
  // Day_Preference (NEW)
  day:            'day',
  class_type:     'class_type',
  note:           'note',
  // Teacher_Unavailability
  start_time:     'start_time',
  end_time:       'end_time',
  // Config (key/value)
  key:            'key',
  value:          'value',
};

// Aliases (case-insensitive, whitespace-stripped) → canonical.
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
  map['teacher name']         = 'full_name';
  map['course code']          = 'course_code';
  map['course name']          = 'course_name';
  map['room name']            = 'room_name';
  map['room id']              = 'room_id';
  map['classes per week']     = 'classes_per_week';
  map['duration minutes']     = 'duration_minutes';
  map['weight percent']       = 'weight_percent';
  map['start time']           = 'start_time';
  map['end time']             = 'end_time';
  map['year sem']             = 'year_sem';
  map['year_sem']             = 'year_sem';
  map['year-sem']             = 'year_sem';
  map['group code']           = 'group_code';
  map['is active']            = 'is_active';
  map['isactive']             = 'is_active';
  map['class type']           = 'class_type';
  map['classtype']            = 'class_type';
  map['type (lab | theory)']  = 'class_type';
  map['type (lab|theory)']    = 'class_type';
  return map;
}

function normalizeKey(raw) {
  if (raw == null) return null;
  const k = String(raw).trim().toLowerCase().replace(/\s+/g, ' ');
  return ALIASES[k] || ALIASES[k.replace(/ /g, '_')] || null;
}

// Columns we use to detect the header row of each sheet.
const SHEET_HINTS = {
  Teachers:               ['abbreviation', 'full_name', 'designation'],
  Courses:                ['course_code', 'credit', 'year_sem'],
  Year_Sem:               ['year_sem', 'group_code', 'is_active'],
  Rooms:                  ['room_id', 'room_name', 'type'],
  Credit_Rules:           ['credit', 'classes_per_week', 'duration_minutes'],
  Room_Preference:        ['room_id', 'year_group', 'weight_percent'],
  Day_Preference:         ['day', 'class_type', 'weight_percent'],
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
    let hits = 0;
    for (const hint of hints) {
      if (cells.includes(hint) || cells.includes(hint.replace(/_/g, ' '))) hits++;
    }
    if (hits >= Math.min(2, hints.length)) return i;
  }
  return -1;
}

function isBlankRow(row) {
  if (!row) return true;
  for (const c of row) {
    if (c != null && String(c).trim() !== '') return false;
  }
  return true;
}

function rowsToObjects(rows, headerIndex) {
  const header = (rows[headerIndex] || []).map(c => (c == null ? '' : String(c).trim()));
  const out = [];
  for (let i = headerIndex + 1; i < rows.length; i++) {
    const row = rows[i] || [];
    if (isBlankRow(row)) break;
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
  const out = {};
  for (const r of rows) {
    if (!r.key) continue;
    out[String(r.key).trim()] = r.value == null ? '' : String(r.value).trim();
  }
  return out;
}

/**
 * Auto-complement Day_Preference rows.
 *
 * The Excel file only requires Lab weights as input; Theory = 100 - Lab.
 * This function:
 *   1. Accepts whatever rows came from the sheet (may have both Lab and
 *      Theory rows, or only Lab rows).
 *   2. Ensures every day that has a Lab row also has a Theory row
 *      (derived as 100 - Lab%).
 *   3. Normalises class_type casing to 'Lab' / 'Theory'.
 */
function complementDayPreference(rows) {
  // Normalise casing first.
  const normalised = rows.map(r => ({
    ...r,
    class_type: r.class_type
      ? (String(r.class_type).trim().toLowerCase() === 'lab' ? 'Lab' : 'Theory')
      : null,
    weight_percent: r.weight_percent != null ? String(r.weight_percent).trim() : null,
  }));

  // Index by day → { Lab: row, Theory: row }
  const byDay = new Map();
  for (const r of normalised) {
    if (!r.day || !r.class_type) continue;
    const d = String(r.day).toUpperCase().trim();
    if (!byDay.has(d)) byDay.set(d, {});
    byDay.get(d)[r.class_type] = r;
  }

  // Derive missing Theory rows from Lab rows (and vice versa as fallback).
  const out = [];
  for (const [d, types] of byDay.entries()) {
    const labRow = types['Lab'];
    const theoryRow = types['Theory'];

    if (labRow) {
      out.push(labRow);
      if (!theoryRow) {
        const labW = Number(labRow.weight_percent);
        const derivedW = Number.isFinite(labW) ? 100 - labW : 50;
        out.push({
          ...labRow,
          class_type: 'Theory',
          weight_percent: String(derivedW),
          note: 'auto-complement',
        });
      } else {
        out.push(theoryRow);
      }
    } else if (theoryRow) {
      out.push(theoryRow);
      const thW = Number(theoryRow.weight_percent);
      const derivedW = Number.isFinite(thW) ? 100 - thW : 50;
      out.push({
        ...theoryRow,
        class_type: 'Lab',
        weight_percent: String(derivedW),
        note: 'auto-complement',
      });
    }
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
  const required = [
    'Teachers', 'Courses', 'Year_Sem', 'Rooms', 'Credit_Rules',
    'Room_Preference', 'Day_Preference', 'Teacher_Unavailability', 'Config',
  ];
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
    } else if (sheetName === 'Day_Preference') {
      // Auto-complement Lab ↔ Theory before storing.
      result.day_preference = complementDayPreference(objs);
    } else {
      // Map sheet name → snake_case key on the result object.
      const key = sheetName.toLowerCase();
      result[key] = objs;
    }
  }

  return result;
}

module.exports = {
  parseWorkbook,
  ParseError,
  normalizeKey,
  findHeaderRow,
  CANONICAL,
  complementDayPreference,
};
