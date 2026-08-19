'use strict';

/**
 * Validation rules for one parsed .xlsx workbook.
 *
 * Implements every rule from the build prompt and collects *all*
 * failures, not just the first. Returns:
 *   {
 *     errors:   ValidationIssue[],   // hard failures — block upload
 *     warnings: ValidationIssue[],   // soft warnings — allow upload but surface
 *     isValid:  boolean              // errors.length === 0
 *   }
 *
 * ValidationIssue = { sheet, row, column, code, message, value }
 *
 * Rules:
 *   V1   Every teacher_abbr in Courses/Teacher_Unavailability exists in
 *        Teachers.abbreviation.
 *   V2   Every credit in Courses exists in Credit_Rules.credit.
 *   V3   Every room_id in Room_Preference exists in Rooms.room_id.
 *   V4   Rooms.type is exactly 'classroom' or 'lab'.
 *   V5   course_code is unique within Courses.
 *   V6   abbreviation is unique within Teachers.
 *   V7   Room_Preference weights per (room_type, year_group) sum to ≈100 (±1) — warn only.
 *   V8   Config windows are ordered: break_start < break_end,
 *        class_start < break_start, break_end < class_end.
 *   V9   Teacher_Unavailability.start_time < end_time.
 *   V10  Feasibility pre-check: every course must have at least one
 *        room of the correct type AND its teacher must have at least
 *        derived_classes_per_week free days outside unavailability — warn if not.
 *   V11  (NEW) Every Courses.year_sem must exist in Year_Sem.year_sem.
 *   V12  (NEW) Year_Sem.is_active must be 'Yes' or 'No' (case-insensitive).
 *   V13  (NEW) Day_Preference weights per day sum to ≈100 (±1) — warn only.
 *   V14  (NEW) Year_Sem.group_code must be '1-2' or '3-4'.
 */

const { normalizeTimeInput } = require('./excelParser');

const VALID_ROOM_TYPES  = ['classroom', 'lab'];
const VALID_DAYS_UNAVAIL = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
const VALID_GROUP_CODES  = ['1-2', '3-4'];
const VALID_IS_ACTIVE    = ['yes', 'no'];
const VALID_CLASS_TYPES  = ['Lab', 'Theory'];

function issue(sheet, row, column, code, message, value) {
  return { sheet, row, column, code, message, value: value == null ? null : String(value) };
}

function timeToMinutes(t) {
  if (!t) return NaN;
  const normalized = normalizeTimeInput(t);
  const m = String(normalized || t).trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return NaN;
  const h = Number(m[1]);
  const mm = Number(m[2]);
  if (mm >= 60) return NaN;
  return h * 60 + mm;
}

function yearGroupFromYearSem(ys) {
  if (!ys) return null;
  const m = String(ys).trim().match(/^(\d)/);
  if (!m) return null;
  const y = Number(m[1]);
  if (y === 1 || y === 2) return '1-2';
  if (y === 3 || y === 4) return '3-4';
  return null;
}

/**
 * Derive group_code from Year_Sem row. Prefers the explicit group_code
 * column; falls back to parsing year_sem if group_code is missing.
 */
function groupCodeFromRow(row) {
  if (row.group_code && VALID_GROUP_CODES.includes(String(row.group_code).trim())) {
    return String(row.group_code).trim();
  }
  return yearGroupFromYearSem(row.year_sem);
}

function indexBy(list, key) {
  const m = new Map();
  for (let i = 0; i < list.length; i++) m.set(String(list[i][key]), i);
  return m;
}

function checkUnique(list, key, sheet, code, issues) {
  const seen = new Map();
  for (let i = 0; i < list.length; i++) {
    const v = list[i][key];
    if (v == null || v === '') continue;
    if (seen.has(String(v))) {
      issues.errors.push(issue(
        sheet, i + 1, key, code,
        `Duplicate value "${v}" for column "${key}" (first occurrence at row ${seen.get(String(v)) + 1})`,
        v
      ));
    } else {
      seen.set(String(v), i);
    }
  }
}

function validate(workbook) {
  const errors = [];
  const warnings = [];
  if (!workbook || typeof workbook !== 'object') {
    return { errors: [{ sheet: null, row: null, column: null, code: 'EMPTY', message: 'Empty workbook', value: null }], warnings, isValid: false };
  }

  const teachers      = workbook.teachers      || [];
  const courses       = workbook.courses        || [];
  const yearSemRows   = workbook.year_sem       || [];
  const rooms         = workbook.rooms          || [];
  const creditRules   = workbook.credit_rules   || [];
  const roomPref      = workbook.room_preference|| [];
  const dayPref       = workbook.day_preference || [];
  const teacherUnavail= workbook.teacher_unavailability || [];
  const config        = workbook.config         || {};

  // ╔═══════════════════════════════════════════════════════════════╗
  // ║ V1 — teacher_abbr references resolve to Teachers             ║
  // ╚═══════════════════════════════════════════════════════════════╝
  const teacherAbbrSet = new Set(teachers.map(t => String(t.abbreviation || '').trim()).filter(Boolean));
  for (let i = 0; i < courses.length; i++) {
    const c = courses[i];
    const abbr = String(c.teacher_abbr || '').trim();
    if (abbr && !teacherAbbrSet.has(abbr)) {
      errors.push(issue(
        'Courses', i + 1, 'teacher_abbr', 'V1',
        `teacher_abbr "${c.teacher_abbr}" not found in Teachers.abbreviation`,
        c.teacher_abbr
      ));
    }
  }
  for (let i = 0; i < teacherUnavail.length; i++) {
    const u = teacherUnavail[i];
    const abbr = String(u.teacher_abbr || '').trim();
    if (abbr && !teacherAbbrSet.has(abbr)) {
      errors.push(issue(
        'Teacher_Unavailability', i + 1, 'teacher_abbr', 'V1',
        `teacher_abbr "${u.teacher_abbr}" not found in Teachers.abbreviation`,
        u.teacher_abbr
      ));
    }
  }

  // ╔═══════════════════════════════════════════════════════════════╗
  // ║ V2 — credit in Courses exists in Credit_Rules.credit         ║
  // ╚═══════════════════════════════════════════════════════════════╝
  const ruleCreditSet = new Set(creditRules.map(c => String(c.credit || '').trim()).filter(Boolean));
  for (let i = 0; i < courses.length; i++) {
    const c = courses[i];
    if (c.credit == null || c.credit === '') continue;
    const key = String(c.credit).trim();
    if (!ruleCreditSet.has(key)) {
      errors.push(issue(
        'Courses', i + 1, 'credit', 'V2',
        `credit "${key}" has no matching Credit_Rules row`,
        c.credit
      ));
    }
  }

  // ╔═══════════════════════════════════════════════════════════════╗
  // ║ V3 — room_id in Room_Preference exists in Rooms.room_id      ║
  // ╚═══════════════════════════════════════════════════════════════╝
  const roomIdSet = new Set(rooms.map(r => String(r.room_id || '').trim()).filter(Boolean));
  for (let i = 0; i < roomPref.length; i++) {
    const p = roomPref[i];
    const rId = String(p.room_id || '').trim();
    if (rId && !roomIdSet.has(rId)) {
      errors.push(issue(
        'Room_Preference', i + 1, 'room_id', 'V3',
        `room_id "${p.room_id}" not found in Rooms.room_id`,
        p.room_id
      ));
    }
  }

  // ╔═══════════════════════════════════════════════════════════════╗
  // ║ V4 — Rooms.type ∈ {classroom, lab}                           ║
  // ╚═══════════════════════════════════════════════════════════════╝
  for (let i = 0; i < rooms.length; i++) {
    const r = rooms[i];
    if (r.type == null || r.type === '') continue;
    if (!VALID_ROOM_TYPES.includes(String(r.type))) {
      errors.push(issue(
        'Rooms', i + 1, 'type', 'V4',
        `type "${r.type}" must be exactly "classroom" or "lab"`,
        r.type
      ));
    }
  }

  // ╔═══════════════════════════════════════════════════════════════╗
  // ║ V5 — course_code unique                                       ║
  // ║ V6 — abbreviation unique                                      ║
  // ╚═══════════════════════════════════════════════════════════════╝
  checkUnique(courses, 'course_code', 'Courses', 'V5', { errors });
  checkUnique(teachers, 'abbreviation', 'Teachers', 'V6', { errors });

  // ╔═══════════════════════════════════════════════════════════════╗
  // ║ V7 — Room_Preference weights sum to ≈100 per (type, group)   ║
  // ╚═══════════════════════════════════════════════════════════════╝
  const roomTypeById = new Map();
  for (const r of rooms) roomTypeById.set(r.room_id, r.type);
  const weightBuckets = new Map();
  for (const p of roomPref) {
    const type = roomTypeById.get(p.room_id);
    if (!type) continue;
    const group = p.year_group;
    if (!group) continue;
    const k = `${type}|${group}`;
    const w = Number(p.weight_percent);
    if (Number.isNaN(w)) continue;
    weightBuckets.set(k, (weightBuckets.get(k) || 0) + w);
  }
  for (const [k, sum] of weightBuckets) {
    if (Math.abs(sum - 100) > 1) {
      const [type, group] = k.split('|');
      warnings.push(issue(
        'Room_Preference', null, 'weight_percent', 'V7',
        `Weight sum for (type=${type}, year_group=${group}) is ${sum.toFixed(2)} — should be ≈100 (±1)`,
        sum
      ));
    }
  }

  // ╔═══════════════════════════════════════════════════════════════╗
  // ║ V8 — Config windows are ordered                               ║
  // ╚═══════════════════════════════════════════════════════════════╝
  if (config.break_start && config.break_end) {
    const a = timeToMinutes(config.break_start);
    const b = timeToMinutes(config.break_end);
    if (!Number.isNaN(a) && !Number.isNaN(b) && a >= b) {
      errors.push(issue(
        'Config', null, 'break_start/break_end', 'V8',
        `break_start (${config.break_start}) must be < break_end (${config.break_end})`,
        `${config.break_start} vs ${config.break_end}`
      ));
    }
  }
  if (config.class_start && config.break_start) {
    const a = timeToMinutes(config.class_start);
    const b = timeToMinutes(config.break_start);
    if (!Number.isNaN(a) && !Number.isNaN(b) && a >= b) {
      errors.push(issue(
        'Config', null, 'class_start/break_start', 'V8',
        `class_start (${config.class_start}) must be < break_start (${config.break_start})`,
        `${config.class_start} vs ${config.break_start}`
      ));
    }
  }
  if (config.break_end && config.class_end) {
    const a = timeToMinutes(config.break_end);
    const b = timeToMinutes(config.class_end);
    if (!Number.isNaN(a) && !Number.isNaN(b) && a >= b) {
      errors.push(issue(
        'Config', null, 'break_end/class_end', 'V8',
        `break_end (${config.break_end}) must be < class_end (${config.class_end})`,
        `${config.break_end} vs ${config.class_end}`
      ));
    }
  }

  // ╔═══════════════════════════════════════════════════════════════╗
  // ║ V9 — Teacher_Unavailability.start_time < end_time            ║
  // ╚═══════════════════════════════════════════════════════════════╝
  for (let i = 0; i < teacherUnavail.length; i++) {
    const u = teacherUnavail[i];
    const s = timeToMinutes(u.start_time);
    const e = timeToMinutes(u.end_time);
    if (!Number.isNaN(s) && !Number.isNaN(e) && s >= e) {
      errors.push(issue(
        'Teacher_Unavailability', i + 1, 'start_time/end_time', 'V9',
        `start_time (${u.start_time}) must be < end_time (${u.end_time})`,
        `${u.start_time} vs ${u.end_time}`
      ));
    }
  }
  for (let i = 0; i < teacherUnavail.length; i++) {
    const u = teacherUnavail[i];
    if (u.day && !VALID_DAYS_UNAVAIL.includes(String(u.day))) {
      errors.push(issue(
        'Teacher_Unavailability', i + 1, 'day', 'V9b',
        `day "${u.day}" must be one of ${VALID_DAYS_UNAVAIL.join(', ')}`,
        u.day
      ));
    }
  }

  // ╔═══════════════════════════════════════════════════════════════╗
  // ║ V10 — feasibility pre-check (warn only)                      ║
  // ╚═══════════════════════════════════════════════════════════════╝
  const workingDays = String(config.working_days || 'SUN,MON,TUE,WED,THU')
    .split(',').map(d => d.trim()).filter(Boolean);
  for (let i = 0; i < courses.length; i++) {
    const c = courses[i];
    const rule = creditRules.find(r => String(r.credit).trim() === String(c.credit || '').trim());
    const type = rule ? (String(rule.type).toLowerCase().trim() === 'lab' ? 'lab' : 'classroom') : null;
    const sessions = rule ? Number(rule.classes_per_week) : null;
    const cpnDay = type ? rooms.some(r => r.type === type) : false;
    if (type && !cpnDay) {
      warnings.push(issue(
        'Courses', i + 1, null, 'V10',
        `No room of type "${type}" available — course "${c.course_code}" cannot be placed`,
        c.course_code
      ));
      continue;
    }
    if (type && sessions && sessions > workingDays.length) {
      warnings.push(issue(
        'Courses', i + 1, null, 'V10',
        `Course "${c.course_code}" needs ${sessions} sessions/week but only ${workingDays.length} working days are configured`,
        c.course_code
      ));
      continue;
    }
    const teacherUnavailDaysForThis = new Set(
      teacherUnavail.filter(u => u.teacher_abbr === c.teacher_abbr).map(u => u.day)
    );
    const freeDays = workingDays.filter(d => !teacherUnavailDaysForThis.has(d));
    if (type && sessions && sessions > freeDays.length) {
      warnings.push(issue(
        'Courses', i + 1, null, 'V10',
        `Course "${c.course_code}" needs ${sessions} free days but teacher "${c.teacher_abbr}" only has ${freeDays.length} (after unavailability)`,
        c.course_code
      ));
    }
  }

  // ╔═══════════════════════════════════════════════════════════════╗
  // ║ V11 (NEW) — Courses.year_sem must exist in Year_Sem.year_sem ║
  // ╚═══════════════════════════════════════════════════════════════╝
  const yearSemValueSet = new Set(yearSemRows.map(r => String(r.year_sem || '').trim()).filter(Boolean));
  for (let i = 0; i < courses.length; i++) {
    const c = courses[i];
    const ysVal = String(c.year_sem || '').trim();
    if (!ysVal) {
      errors.push(issue(
        'Courses', i + 1, 'year_sem', 'V11',
        `Course "${c.course_code}" is missing a year_sem value`,
        c.year_sem
      ));
    } else if (!yearSemValueSet.has(ysVal)) {
      errors.push(issue(
        'Courses', i + 1, 'year_sem', 'V11',
        `year_sem "${c.year_sem}" for course "${c.course_code}" does not exist in Year_Sem sheet`,
        c.year_sem
      ));
    }
  }

  // ╔═══════════════════════════════════════════════════════════════╗
  // ║ V12 (NEW) — Year_Sem.is_active must be 'Yes' or 'No'        ║
  // ║ V14 (NEW) — Year_Sem.group_code must be '1-2' or '3-4'      ║
  // ╚═══════════════════════════════════════════════════════════════╝
  for (let i = 0; i < yearSemRows.length; i++) {
    const r = yearSemRows[i];
    // V12
    if (r.is_active == null || r.is_active === '') {
      errors.push(issue(
        'Year_Sem', i + 1, 'is_active', 'V12',
        `Row ${i + 1}: is_active is missing — must be "Yes" or "No"`,
        r.is_active
      ));
    } else if (!VALID_IS_ACTIVE.includes(String(r.is_active).trim().toLowerCase())) {
      errors.push(issue(
        'Year_Sem', i + 1, 'is_active', 'V12',
        `is_active "${r.is_active}" must be "Yes" or "No"`,
        r.is_active
      ));
    }
    // V14
    if (r.group_code == null || r.group_code === '') {
      errors.push(issue(
        'Year_Sem', i + 1, 'group_code', 'V14',
        `Row ${i + 1}: group_code is missing — must be "1-2" or "3-4"`,
        r.group_code
      ));
    } else if (!VALID_GROUP_CODES.includes(String(r.group_code).trim())) {
      errors.push(issue(
        'Year_Sem', i + 1, 'group_code', 'V14',
        `group_code "${r.group_code}" must be "1-2" or "3-4"`,
        r.group_code
      ));
    }
  }

  // ╔═══════════════════════════════════════════════════════════════╗
  // ║ V13 — Day_Preference weights per day sum to ≈100 (±1)        ║
  // ╚═══════════════════════════════════════════════════════════════╝
  const dpByDay = new Map();
  for (const dp of dayPref) {
    if (!dp.day) continue;
    const d = String(dp.day).toUpperCase().trim();
    dpByDay.set(d, (dpByDay.get(d) || 0) + Number(dp.weight_percent || 0));
  }
  for (const [d, sum] of dpByDay) {
    if (Math.abs(sum - 100) > 1) {
      warnings.push(issue(
        'Day_Preference', null, 'weight_percent', 'V13',
        `Day_Preference weights for ${d} sum to ${sum.toFixed(2)} — should be ≈100 (±1)`,
        sum
      ));
    }
  }

  // ╔═══════════════════════════════════════════════════════════════╗
  // ║ V15 — Faculty & Department dependency in Config               ║
  // ║ V16 — Year & Semester in Config                              ║
  // ╚═══════════════════════════════════════════════════════════════╝
  const facDeptMap = (workbook.lists && workbook.lists.facultyDepartments && Object.keys(workbook.lists.facultyDepartments).length > 0)
    ? workbook.lists.facultyDepartments
    : AUTHORITATIVE_FACULTY_DEPARTMENTS;

  if (config.faculty) {
    const rawFac = String(config.faculty).trim();
    const resolvedFac = resolveFacultyName(rawFac);
    if (!resolvedFac && !facDeptMap[rawFac]) {
      errors.push(issue(
        'Config', null, 'faculty', 'V15',
        `Unknown faculty "${config.faculty}" — must be one of: ${Object.keys(AUTHORITATIVE_FACULTY_DEPARTMENTS).join(', ')}`,
        config.faculty
      ));
    } else if (config.department) {
      const canonicalFac = resolvedFac || rawFac;
      const validDepts = facDeptMap[canonicalFac] || facDeptMap[rawFac] || [];
      const deptRaw = String(config.department).trim();
      const match = validDepts.some(d => matchDepartment(deptRaw, d));
      if (!match) {
        let correctFaculty = null;
        for (const [fac, depts] of Object.entries(facDeptMap)) {
          if (depts.some(d => matchDepartment(deptRaw, d))) {
            correctFaculty = fac;
            break;
          }
        }
        if (correctFaculty) {
          errors.push(issue(
            'Config', null, 'department', 'V15',
            `Department "${config.department}" belongs to "${correctFaculty}" rather than "${config.faculty}". Please set faculty to "${correctFaculty}" in the Config sheet.`,
            config.department
          ));
        } else {
          errors.push(issue(
            'Config', null, 'department', 'V15',
            `Department "${config.department}" does not belong to faculty "${canonicalFac}"`,
            config.department
          ));
        }
      }
    }
  }

  if (config.year != null && String(config.year).trim() !== '') {
    const yr = Number(config.year);
    if (!Number.isInteger(yr) || yr < 1900 || yr > 2100) {
      errors.push(issue(
        'Config', null, 'year', 'V16',
        `year "${config.year}" must be a 4-digit integer (e.g. 2026)`,
        config.year
      ));
    }
  }

  return {
    errors,
    warnings,
    isValid: errors.length === 0,
  };
}

const DEPT_ALIAS_GROUPS = [
  ['cse', 'computer science and engineering', 'computer science and engineering (cse)'],
  ['eee', 'electrical and electronic engineering', 'electrical and electronic engineering (eee)'],
  ['ete', 'electronics and telecommunication engineering', 'electronics and telecommunication engineering (ete)'],
  ['acce', 'applied chemistry and chemical engineering', 'applied chemistry and chemical engineering (acce)'],
  ['ce', 'civil engineering', 'civil engineering (ce)'],
  ['food and agroprocess engineering', 'food engineering', 'food engineering (fe)', 'fe', 'fape'],
  ['arch', 'architecture', 'architecture (arch)'],
  ['mathematics', 'math', 'maths'],
  ['statistics', 'stat', 'stats'],
  ['chemistry', 'chem'],
  ['physics', 'phy'],
  ['esdm', 'environmental science and disaster management', 'environmental science & disaster management', 'environmental science and disaster management (esdm)'],
  ['pharmacy', 'pharm'],
  ['bge', 'biotechnology and genetic engineering', 'biotechnology and genetic engineering (bge)'],
  ['bmb', 'biochemistry and molecular biology', 'biochemistry and molecular biology (bmb)'],
  ['botany', 'bot'],
  ['english', 'eng'],
  ['bangla', 'bengali', 'ban'],
  ['history', 'his'],
  ['psychology', 'psy'],
  ['sociology', 'soc'],
  ['pad', 'public administration', 'public administration (pad)'],
  ['ir', 'international relations', 'international relations (ir)'],
  ['economics', 'econ', 'eco'],
  ['ps', 'political science', 'political science (ps)'],
  ['management studies', 'management', 'mgt'],
  ['ais', 'accounting and information systems', 'accounting and information systems (ais)', 'accounting'],
  ['marketing', 'mkt'],
  ['finance and banking', 'finance & banking', 'finance', 'fb'],
  ['thm', 'tourism and hospitality management', 'tourism and hospitality management (thm)'],
  ['law', 'llb'],
  ['asvm', 'animal science and veterinary medicine', 'animal science and veterinary medicine (asvm)', 'dvm'],
  ['agriculture', 'agri'],
  ['fmb', 'fisheries and marine bioscience', 'fisheries and marine bioscience (fmb)', 'fisheries'],
];

function normalizeDeptName(d) {
  if (!d) return '';
  return String(d)
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/\(.*?\)/g, '')
    .replace(/[^a-z0-9]/g, '')
    .trim();
}

function matchDepartment(input, target) {
  if (!input || !target) return false;
  const inRaw = String(input).trim().toLowerCase();
  const tgtRaw = String(target).trim().toLowerCase();
  if (inRaw === tgtRaw) return true;

  const inNorm = normalizeDeptName(input);
  const tgtNorm = normalizeDeptName(target);
  if (inNorm && tgtNorm && inNorm === tgtNorm) return true;

  // Check alias groups
  for (const group of DEPT_ALIAS_GROUPS) {
    const inMatch = group.some(a => a === inRaw || normalizeDeptName(a) === inNorm);
    const tgtMatch = group.some(a => a === tgtRaw || normalizeDeptName(a) === tgtNorm);
    if (inMatch && tgtMatch) return true;
  }

  return false;
}

const AUTHORITATIVE_FACULTY_DEPARTMENTS = {
  'Engineering Faculty': [
    'CSE',
    'EEE',
    'ETE',
    'ACCE',
    'CE',
    'Food and Agroprocess Engineering',
    'ARCH',
  ],
  'Science Faculty': [
    'Mathematics',
    'Statistics',
    'Chemistry',
    'Physics',
    'ESDM',
  ],
  'Life Science Faculty': [
    'Pharmacy',
    'BGE',
    'BMB',
    'Botany',
  ],
  'Humanities Faculty': [
    'English',
    'Bangla',
    'History',
  ],
  'Social Science Faculty': [
    'Psychology',
    'Sociology',
    'PAD',
    'IR',
    'Economics',
    'PS',
  ],
  'Business Studies Faculty': [
    'Management Studies',
    'AIS',
    'Marketing',
    'Finance and Banking',
    'THM',
  ],
  'Law Faculty': [
    'Law',
  ],
  'Animal Science and Veterinary Medicine Faculty': [
    'ASVM',
  ],
  'Faculty of Agriculture': [
    'Agriculture',
    'FMB',
  ],
};

const ALL_AUTHORITATIVE_DEPARTMENTS = Object.values(AUTHORITATIVE_FACULTY_DEPARTMENTS).flat();

function cleanFacultyToken(name) {
  if (!name) return '';
  return String(name)
    .toLowerCase()
    .replace(/faculty|\(|\)|of|arts/g, '')
    .replace(/[^a-z0-9]/g, '')
    .trim();
}

function resolveFacultyName(name) {
  if (!name) return null;
  const s = String(name).trim().toLowerCase();
  // 1. Exact match on full faculty key
  for (const fac of Object.keys(AUTHORITATIVE_FACULTY_DEPARTMENTS)) {
    if (fac.toLowerCase() === s) return fac;
  }
  // 2. Exact match on cleaned token
  const cleanedInput = cleanFacultyToken(name);
  for (const fac of Object.keys(AUTHORITATIVE_FACULTY_DEPARTMENTS)) {
    if (cleanFacultyToken(fac) === cleanedInput) return fac;
  }
  // 3. Known specific keywords (in strict specificity order)
  if (s.includes('life')) return 'Life Science Faculty';
  if (s.includes('social')) return 'Social Science Faculty';
  if (s.includes('business')) return 'Business Studies Faculty';
  if (s.includes('humanities') || s.includes('arts')) return 'Humanities Faculty';
  if (s.includes('agri')) return 'Faculty of Agriculture';
  if (s.includes('animal') || s.includes('veterinary') || s.includes('asvm')) return 'Animal Science and Veterinary Medicine Faculty';
  if (s.includes('eng')) return 'Engineering Faculty';
  if (s.includes('law')) return 'Law Faculty';
  if (s.includes('science')) return 'Science Faculty';
  return null;
}

function resolveDepartmentName(dept) {
  if (!dept) return '';
  const d = String(dept).trim();
  if (!d) return '';

  for (const [fac, depts] of Object.entries(AUTHORITATIVE_FACULTY_DEPARTMENTS)) {
    for (const canonicalDept of depts) {
      if (matchDepartment(d, canonicalDept)) {
        return canonicalDept;
      }
    }
  }
  return d;
}

module.exports = {
  validate,
  VALID_ROOM_TYPES,
  VALID_DAYS_UNAVAIL,
  VALID_GROUP_CODES,
  VALID_IS_ACTIVE,
  AUTHORITATIVE_FACULTY_DEPARTMENTS,
  ALL_AUTHORITATIVE_DEPARTMENTS,
  resolveFacultyName,
  resolveDepartmentName,
  matchDepartment,
  normalizeDeptName,
  yearGroupFromYearSem,
  groupCodeFromRow,
};
