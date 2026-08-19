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
  // Year_Sem
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
  // Day_Preference
  day:            'day',
  class_type:     'class_type',
  // Teacher_Unavailability
  start_time:     'start_time',
  end_time:       'end_time',
  // Config (key/value)
  key:            'key',
  value:          'value',
  faculty:        'faculty',
  university:     'university',
  working_days:   'working_days',
  class_start:    'class_start',
  class_end:      'class_end',
  break_start:    'break_start',
  break_end:      'break_end',
  // Lists
  department_full:'department_full',
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
  // Friendly aliases
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
  map['department full']      = 'department_full';
  map['department_full']      = 'department_full';
  return map;
}

function cleanHeaderCell(raw) {
  if (raw == null) return '';
  return String(raw)
    .replace(/[*]/g, '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

function normalizeKey(raw) {
  if (raw == null) return null;
  const k = cleanHeaderCell(raw);
  if (!k) return null;
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
  Lists:                  ['config_year', 'config_semester', 'faculty', 'department_full'],
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
    const cells = (rows[i] || []).map(c => cleanHeaderCell(c));
    let hits = 0;
    for (const hint of hints) {
      const hClean = hint.toLowerCase();
      if (cells.includes(hClean) || cells.includes(hClean.replace(/_/g, ' '))) hits++;
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

function normalizeTimeInput(val) {
  if (val == null) return null;
  let s = String(val).trim().toUpperCase();
  if (s === '') return null;

  // 1. Excel decimal day fraction (between 0 and 1)
  if (/^0\.\d+$/.test(s) || s === '0' || s === '1') {
    const num = Number(s);
    if (num >= 0 && num <= 1) {
      const totalMinutes = Math.round(num * 24 * 60);
      const hours = Math.floor(totalMinutes / 60);
      const minutes = totalMinutes % 60;
      return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
    }
  }

  // 2. 12h AM/PM format, e.g. "1:10 PM", "9 AM"
  const ampmMatch = s.match(/^(\d{1,2})(?::(\d{2}))?\s*(AM|PM)$/i);
  if (ampmMatch) {
    let hours = Number(ampmMatch[1]);
    const minutes = ampmMatch[2] ? Number(ampmMatch[2]) : 0;
    const ampm = ampmMatch[3].toUpperCase();
    if (ampm === 'PM' && hours < 12) hours += 12;
    if (ampm === 'AM' && hours === 12) hours = 0;
    return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
  }

  // 3. HH:MM or HH:MM:SS format
  const hhmmMatch = s.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (hhmmMatch) {
    const hours = Number(hhmmMatch[1]);
    const minutes = Number(hhmmMatch[2]);
    return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
  }

  // 4. Plain integer representing hour (e.g. "9" -> "09:00")
  if (/^\d{1,2}$/.test(s)) {
    const hours = Number(s);
    if (hours >= 0 && hours < 24) {
      return `${String(hours).padStart(2, '0')}:00`;
    }
  }

  return s;
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
      if (canon) {
        let val = row[c];
        if (canon === 'start_time' || canon === 'end_time') {
          val = normalizeTimeInput(val);
        }
        obj[canon] = val == null ? null : String(val).trim();
      }
    }
    // For Config sheet, normalize value based on key
    if (obj.key && obj.value != null) {
      const k = String(obj.key).trim().toLowerCase();
      if (k === 'class_start' || k === 'class_end' || k === 'break_start' || k === 'break_end') {
        obj.value = normalizeTimeInput(obj.value);
      }
    }
    if (Object.keys(obj).length > 0) out.push(obj);
  }
  return out;
}

function parseConfigRows(rows) {
  const out = {};
  for (const r of rows) {
    if (!r.key) continue;
    const k = String(r.key).trim();
    out[k] = r.value == null ? '' : String(r.value).trim();
  }
  return out;
}

/**
 * Auto-complement Room_Preference rows.
 *
 * Entries are in pairs for year_group '1-2' <-> '3-4'.
 * If one year_group is present for a room_id and the other is missing/empty,
 * derive the complement as (100 - weight).
 */
function complementRoomPreference(rows) {
  const normalised = rows.map(r => ({
    ...r,
    room_id: r.room_id ? String(r.room_id).trim() : null,
    year_group: r.year_group ? String(r.year_group).trim() : null,
    weight_percent: r.weight_percent != null && String(r.weight_percent).trim() !== ''
      ? String(r.weight_percent).trim()
      : null,
  })).filter(r => r.room_id && r.year_group);

  const byRoom = new Map();
  for (const r of normalised) {
    if (!byRoom.has(r.room_id)) byRoom.set(r.room_id, {});
    byRoom.get(r.room_id)[r.year_group] = r;
  }

  const out = [];
  for (const [roomId, groups] of byRoom.entries()) {
    const junior = groups['1-2'];
    const senior = groups['3-4'];

    const jWeight = junior && junior.weight_percent != null && !Number.isNaN(Number(junior.weight_percent))
      ? Number(junior.weight_percent)
      : null;
    const sWeight = senior && senior.weight_percent != null && !Number.isNaN(Number(senior.weight_percent))
      ? Number(senior.weight_percent)
      : null;

    if (jWeight != null && sWeight != null) {
      out.push(junior);
      out.push(senior);
    } else if (jWeight != null) {
      out.push(junior);
      out.push({
        room_id: roomId,
        year_group: '3-4',
        weight_percent: String(100 - jWeight),
      });
    } else if (sWeight != null) {
      out.push({
        room_id: roomId,
        year_group: '1-2',
        weight_percent: String(100 - sWeight),
      });
      out.push(senior);
    } else {
      if (junior) out.push(junior);
      if (senior) out.push(senior);
    }
  }
  return out;
}

/**
 * Auto-complement Day_Preference rows.
 *
 * Ensures every day that has a Lab row also has a Theory row (100 - Lab%)
 * and vice versa.
 */
function complementDayPreference(rows) {
  const normalised = rows.map(r => ({
    ...r,
    day: r.day ? String(r.day).toUpperCase().trim() : null,
    class_type: r.class_type
      ? (String(r.class_type).trim().toLowerCase() === 'lab' ? 'Lab' : 'Theory')
      : null,
    weight_percent: r.weight_percent != null && String(r.weight_percent).trim() !== ''
      ? String(r.weight_percent).trim()
      : null,
  })).filter(r => r.day && r.class_type);

  const byDay = new Map();
  for (const r of normalised) {
    if (!byDay.has(r.day)) byDay.set(r.day, {});
    byDay.get(r.day)[r.class_type] = r;
  }

  const out = [];
  for (const [d, types] of byDay.entries()) {
    const labRow = types['Lab'];
    const theoryRow = types['Theory'];

    const labW = labRow && labRow.weight_percent != null && !Number.isNaN(Number(labRow.weight_percent))
      ? Number(labRow.weight_percent)
      : null;
    const thW = theoryRow && theoryRow.weight_percent != null && !Number.isNaN(Number(theoryRow.weight_percent))
      ? Number(theoryRow.weight_percent)
      : null;

    if (labW != null && thW != null) {
      out.push(labRow);
      out.push(theoryRow);
    } else if (labW != null) {
      out.push(labRow);
      out.push({
        day: d,
        class_type: 'Theory',
        weight_percent: String(100 - labW),
      });
    } else if (thW != null) {
      out.push({
        day: d,
        class_type: 'Lab',
        weight_percent: String(100 - thW),
      });
      out.push(theoryRow);
    } else {
      if (labRow) out.push(labRow);
      if (theoryRow) out.push(theoryRow);
    }
  }
  return out;
}

/**
 * Parse Lists sheet (dropdown source data).
 * Real headers are directly on Row 1 (0-indexed row 0).
 */
function parseListsSheet(ws) {
  if (!ws) return null;
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null, blankrows: false });
  if (rows.length === 0) return null;

  const headerRow = rows[0] || [];
  const headers = headerRow.map(h => (h == null ? '' : String(h).trim()));

  const colData = {};
  for (let c = 0; c < headers.length; c++) {
    const name = headers[c];
    if (!name) continue;
    colData[name] = [];
    for (let r = 1; r < rows.length; r++) {
      const val = rows[r] ? rows[r][c] : null;
      if (val != null && String(val).trim() !== '') {
        colData[name].push(String(val).trim());
      }
    }
  }

  const faculties = [...new Set(colData['Faculty'] || [])];
  const departmentsFull = [...new Set(colData['Department_Full'] || [])];

  const facultyDepartments = {};
  for (const [key, list] of Object.entries(colData)) {
    if (key.startsWith('dep_')) {
      facultyDepartments[key] = [...new Set(list)];
    }
  }

  // Map each faculty name to its department list
  const facultyDepMap = {};
  for (let i = 0; i < faculties.length; i++) {
    const fac = faculties[i];
    // Check direct dep_ column matches
    const depKey = Object.keys(facultyDepartments).find(
      k => k.toLowerCase().replace(/_/g, '') === `dep${fac.toLowerCase().replace(/[^a-z0-9]/g, '')}`
    );
    if (depKey && facultyDepartments[depKey]) {
      facultyDepMap[fac] = facultyDepartments[depKey];
    }
  }

  // Also read Faculty_Dependent_Name & Faculty_Dependent_Key mapping if present
  if (colData['Faculty_Dependent_Name'] && colData['Faculty_Dependent_Key']) {
    for (let i = 0; i < colData['Faculty_Dependent_Name'].length; i++) {
      const facName = colData['Faculty_Dependent_Name'][i];
      const depKey = colData['Faculty_Dependent_Key'][i];
      if (facName && depKey && facultyDepartments[depKey]) {
        facultyDepMap[facName] = facultyDepartments[depKey];
      }
    }
  }

  return {
    faculties,
    departments: departmentsFull,
    facultyDepartments: facultyDepMap,
    rawColumns: colData,
  };
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
    } else if (sheetName === 'Room_Preference') {
      result.room_preference = complementRoomPreference(objs);
    } else if (sheetName === 'Day_Preference') {
      result.day_preference = complementDayPreference(objs);
    } else {
      // Map sheet name → snake_case key on the result object.
      const key = sheetName.toLowerCase();
      result[key] = objs;
    }
  }

  // Parse Lists sheet if available (for dropdown source validation / mappings)
  if (sheetNames.includes('Lists')) {
    result.lists = parseListsSheet(workbook.Sheets['Lists']);
  }

  return result;
}

module.exports = {
  parseWorkbook,
  ParseError,
  normalizeKey,
  cleanHeaderCell,
  findHeaderRow,
  CANONICAL,
  complementRoomPreference,
  complementDayPreference,
  parseListsSheet,
  normalizeTimeInput,
};

