'use strict';

const { validate } = require('../src/services/validators');
const { buildBrokenWorkbook, buildCleanWorkbook } = require('./fixtures');

describe('validators — clean workbook has no errors', () => {
  test('isValid=true, no errors', () => {
    const report = validate(buildCleanWorkbook());
    expect(report.isValid).toBe(true);
    expect(report.errors).toHaveLength(0);
  });
});

describe('validators — broken workbook fires every rule', () => {
  const report = validate(buildBrokenWorkbook());
  const byCode = new Map();
  for (const e of report.errors) byCode.set(e.code, e);
  for (const w of report.warnings) {
    if (!byCode.has(w.code)) byCode.set(w.code, w);
  }

  test('isValid=false (errors present)', () => {
    expect(report.isValid).toBe(false);
    expect(report.errors.length).toBeGreaterThan(0);
  });

  test('V1 — unknown teacher_abbr in Courses', () => {
    const e = report.errors.find(x => x.code === 'V1' && x.sheet === 'Courses');
    expect(e).toBeDefined();
    expect(e.value).toBe('XYZ');
  });

  test('V1 — unknown teacher_abbr in Teacher_Unavailability', () => {
    const e = report.errors.find(x => x.code === 'V1' && x.sheet === 'Teacher_Unavailability');
    expect(e).toBeDefined();
    expect(e.value).toBe('NOPE');
  });

  test('V2 — credit value not in Credit_Rules', () => {
    const e = report.errors.find(x => x.code === 'V2');
    expect(e).toBeDefined();
    expect(e.value).toBe('9.9');
  });

  test('V3 — room_id in Room_Preference not in Rooms', () => {
    const e = report.errors.find(x => x.code === 'V3');
    expect(e).toBeDefined();
    expect(e.value).toBe('R999');
  });

  test('V4 — invalid room type', () => {
    const e = report.errors.find(x => x.code === 'V4');
    expect(e).toBeDefined();
    expect(e.value).toBe('auditorium');
  });

  test('V5 — duplicate course_code', () => {
    const e = report.errors.find(x => x.code === 'V5');
    expect(e).toBeDefined();
    expect(e.value).toBe('CSE101');
  });

  test('V6 — duplicate teacher abbreviation', () => {
    const e = report.errors.find(x => x.code === 'V6');
    expect(e).toBeDefined();
    expect(e.value).toBe('TAN');
  });

  test('V7 — Room_Preference weight sum warning (not error)', () => {
    const w = report.warnings.find(x => x.code === 'V7');
    expect(w).toBeDefined();
    // The weight sum is 150.00 (90 + 60) for (classroom, 1-2).
    expect(w.value).toBe('150');
  });

  test('V8 — Config window ordering errors', () => {
    const v8s = report.errors.filter(x => x.code === 'V8');
    expect(v8s.length).toBeGreaterThanOrEqual(2);
  });

  test('V9 — Teacher_Unavailability start_time >= end_time', () => {
    const e = report.errors.find(x => x.code === 'V9');
    expect(e).toBeDefined();
    expect(e.value).toBe('12:00 vs 10:00');
  });

  test('all rules collected, not just first', () => {
    // We expect at least 9 distinct error codes (V1..V9).
    const codes = new Set(report.errors.map(e => e.code));
    expect(codes.has('V1')).toBe(true);
    expect(codes.has('V2')).toBe(true);
    expect(codes.has('V3')).toBe(true);
    expect(codes.has('V4')).toBe(true);
    expect(codes.has('V5')).toBe(true);
    expect(codes.has('V6')).toBe(true);
    expect(codes.has('V8')).toBe(true);
    expect(codes.has('V9')).toBe(true);
  });
});

describe('validators — exposes issue shape', () => {
  test('every issue has the required fields', () => {
    const report = validate(buildBrokenWorkbook());
    for (const e of [...report.errors, ...report.warnings]) {
      expect(e).toHaveProperty('code');
      expect(e).toHaveProperty('message');
      expect(typeof e.message).toBe('string');
    }
  });
});