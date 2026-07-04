'use strict';

/**
 * deriveRules — turn the raw `credit_rules` rows from the upload workbook
 * into a normalized lookup table and expose a single `deriveForCourse`
 * entry point used at insert time (and later, by the scheduler).
 *
 * Each `credit_rule` row has shape:
 *   { credit: number, type: 'theory'|'lab', classes_per_week: int, duration_minutes: int }
 *
 * The derived fields stored on `courses` are:
 *   derived_type, derived_duration_min, derived_classes_per_week
 *
 * Per the build prompt (Task 3), the canonical seed mapping is:
 *   3.0 credit → theory, 50 min × 3 sessions / week
 *   2.0 credit → theory, 50 min × 2 sessions / week
 *   0.5 credit → lab,    110 min × 1 session / week
 *   1.0 credit → lab,    110 min × 1 session / week
 *   1.5 credit → lab,    110 min × 1 session / week
 */

class DeriveRulesError extends Error {
  constructor(message, code, details) {
    super(message);
    this.name = 'DeriveRulesError';
    this.code = code;
    this.details = details;
  }
}

/**
 * Build an in-memory credit → rule map.
 * `rules` is an array of credit_rule rows.
 *
 * The map is keyed by the stringified credit (trimmed) so float
 * equality works consistently (`'3.0'` and `'3'` collapse together).
 */
function canonicalizeCredit(value) {
  // Handles "3", "3.0", 3, 3.0, "3.5 ", etc. — returns the numeric form
  // as a string so both sides always agree on the same Map key.
  const n = Number(String(value ?? '').trim());
  if (!Number.isFinite(n)) return null;
  // Drop trailing zeros so 3.0 and 3 collapse, but keep one decimal for
  // values like 1.5.
  return n.toString();
}

function buildLookup(rules) {
  const map = new Map();
  for (const r of rules) {
    const key = canonicalizeCredit(r.credit);
    if (key === null) {
      throw new DeriveRulesError(
        `Credit rule row missing or non-numeric credit value (${r.credit})`,
        'EMPTY_CREDIT',
        { row: r }
      );
    }
    const classesPerWeek = Number(r.classes_per_week);
    const durationMinutes = Number(r.duration_minutes);
    if (!Number.isFinite(classesPerWeek) || classesPerWeek <= 0) {
      throw new DeriveRulesError(
        `Credit ${key} has invalid classes_per_week (${r.classes_per_week})`,
        'INVALID_CLASSES_PER_WEEK',
        { credit: key, value: r.classes_per_week }
      );
    }
    if (!Number.isFinite(durationMinutes) || durationMinutes <= 0) {
      throw new DeriveRulesError(
        `Credit ${key} has invalid duration_minutes (${r.duration_minutes})`,
        'INVALID_DURATION',
        { credit: key, value: r.duration_minutes }
      );
    }
    const type = String(r.type).toLowerCase().trim();
    if (type !== 'theory' && type !== 'lab') {
      throw new DeriveRulesError(
        `Credit ${key} has invalid type (${r.type}); expected theory|lab`,
        'INVALID_TYPE',
        { credit: key, value: r.type }
      );
    }
    map.set(key, {
      type,
      duration_minutes: durationMinutes,
      classes_per_week: classesPerWeek,
    });
  }
  return map;
}

/**
 * Resolve derived fields for a single course row.
 * Accepts the lookup built by `buildLookup` and a course row containing a
 * `credit` column. Returns `{ type, duration_minutes, classes_per_week }`.
 *
 * Throws `DeriveRulesError` with code `UNKNOWN_CREDIT` if the credit has
 * no matching rule — callers should treat this as a hard failure because
 * validator V2 should already have caught it.
 */
function deriveForCourse(course, lookup) {
  const key = canonicalizeCredit(course.credit);
  const rule = key === null ? undefined : lookup.get(key);
  if (!rule) {
    throw new DeriveRulesError(
      `No credit rule found for credit ${key ?? '<empty>'}`,
      'UNKNOWN_CREDIT',
      { course_code: course.course_code, credit: key }
    );
  }
  return {
    type: rule.type,
    duration_minutes: rule.duration_minutes,
    classes_per_week: rule.classes_per_week,
  };
}

/**
 * Tiny helper: derive derived fields for every course at once.
 * Convenience wrapper used by the upload pipeline.
 */
function deriveAll(courses, rules) {
  const lookup = buildLookup(rules);
  return courses.map((c) => ({ ...c, ...deriveForCourse(c, lookup) }));
}

/**
 * The canonical default seed (used by tests and as a fallback when the
 * admin hasn't customised the credit_rules rows). Matches section 1 of
 * PROJECT_BUILD_PROMPT.md.
 */
const DEFAULT_RULES = Object.freeze([
  { credit: '3.0', type: 'theory', classes_per_week: 3, duration_minutes: 50 },
  { credit: '2.0', type: 'theory', classes_per_week: 2, duration_minutes: 50 },
  { credit: '1.5', type: 'lab',    classes_per_week: 1, duration_minutes: 110 },
  { credit: '1.0', type: 'lab',    classes_per_week: 1, duration_minutes: 110 },
  { credit: '0.5', type: 'lab',    classes_per_week: 1, duration_minutes: 110 },
]);

module.exports = {
  buildLookup,
  deriveForCourse,
  deriveAll,
  DeriveRulesError,
  DEFAULT_RULES,
};
