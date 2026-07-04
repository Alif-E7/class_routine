'use strict';

const {
  buildLookup,
  deriveForCourse,
  deriveAll,
  DeriveRulesError,
  DEFAULT_RULES,
} = require('../src/services/deriveRules');

describe('deriveRules — canonical mapping (Task 3)', () => {
  test('3.0 credit maps to theory / 50 min / 3 sessions', () => {
    const lookup = buildLookup(DEFAULT_RULES);
    const r = deriveForCourse({ course_code: 'CSE101', credit: 3.0 }, lookup);
    expect(r).toEqual({ type: 'theory', duration_minutes: 50, classes_per_week: 3 });
  });

  test('2.0 credit maps to theory / 50 min / 2 sessions', () => {
    const lookup = buildLookup(DEFAULT_RULES);
    const r = deriveForCourse({ course_code: 'CSE102', credit: 2.0 }, lookup);
    expect(r).toEqual({ type: 'theory', duration_minutes: 50, classes_per_week: 2 });
  });

  test('1.5 credit maps to lab / 110 min / 1 session', () => {
    const lookup = buildLookup(DEFAULT_RULES);
    const r = deriveForCourse({ course_code: 'CSE103L', credit: 1.5 }, lookup);
    expect(r).toEqual({ type: 'lab', duration_minutes: 110, classes_per_week: 1 });
  });

  test('1.0 and 0.5 credits both map to lab / 110 min / 1 session', () => {
    const lookup = buildLookup(DEFAULT_RULES);
    expect(deriveForCourse({ course_code: 'A', credit: 1.0 }, lookup).type).toBe('lab');
    expect(deriveForCourse({ course_code: 'B', credit: 0.5 }, lookup).type).toBe('lab');
    expect(deriveForCourse({ course_code: 'A', credit: 1.0 }, lookup).duration_minutes).toBe(110);
    expect(deriveForCourse({ course_code: 'B', credit: 0.5 }, lookup).duration_minutes).toBe(110);
  });

  test('credit string forms ("3" vs "3.0") collapse onto the same rule', () => {
    const lookup = buildLookup(DEFAULT_RULES);
    const a = deriveForCourse({ course_code: 'A', credit: '3' }, lookup);
    const b = deriveForCourse({ course_code: 'B', credit: '3.0' }, lookup);
    expect(a).toEqual(b);
  });
});

describe('deriveRules — failures', () => {
  test('throws DeriveRulesError with code UNKNOWN_CREDIT when no rule exists', () => {
    const lookup = buildLookup(DEFAULT_RULES);
    expect(() =>
      deriveForCourse({ course_code: 'CSE999', credit: 4.0 }, lookup)
    ).toThrow(DeriveRulesError);
    try {
      deriveForCourse({ course_code: 'CSE999', credit: 4.0 }, lookup);
    } catch (e) {
      expect(e.code).toBe('UNKNOWN_CREDIT');
      expect(e.details).toMatchObject({ course_code: 'CSE999', credit: '4' });
    }
  });

  test('rejects rules with invalid type', () => {
    expect(() =>
      buildLookup([{ credit: 3.0, type: 'tutorial', classes_per_week: 3, duration_minutes: 50 }])
    ).toThrow(/invalid type/i);
  });

  test('rejects rules with non-positive classes_per_week or duration', () => {
    expect(() =>
      buildLookup([{ credit: 3.0, type: 'theory', classes_per_week: 0, duration_minutes: 50 }])
    ).toThrow(/classes_per_week/);
    expect(() =>
      buildLookup([{ credit: 3.0, type: 'theory', classes_per_week: 3, duration_minutes: -10 }])
    ).toThrow(/duration_minutes/);
  });

  test('deriveAll returns a copy of every course with derived fields merged in', () => {
    const courses = [
      { course_code: 'A', credit: 3.0 },
      { course_code: 'B', credit: 1.5 },
    ];
    const out = deriveAll(courses, DEFAULT_RULES);
    expect(out).toHaveLength(2);
    expect(out[0].type).toBe('theory');
    expect(out[1].type).toBe('lab');
    expect(out[0]).toMatchObject({ course_code: 'A', classes_per_week: 3 });
  });
});