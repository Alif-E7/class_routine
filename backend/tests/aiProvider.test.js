'use strict';

/**
 * aiProvider.test.js — unit tests for the optional AI helper.
 *
 * The provider has three public helpers (explainFailure,
 * explainRoutine, parseEditRequest) and a private _internal
 * surface we exercise for prompt-building / JSON-extraction
 * correctness. Network calls are not made unless GEMINI_API_KEY
 * is set; these tests run cleanly without any key configured.
 */

const ai = require('../src/services/aiProvider');

describe('aiProvider — defaults + capability', () => {
  test('default model name is gemini-2.5-flash', () => {
    expect(ai._internal.DEFAULT_MODEL).toBe('gemini-2.5-flash');
  });

  test('default endpoint is the Google AI Studio v1beta path', () => {
    expect(ai._internal.DEFAULT_ENDPOINT).toBe(
      'https://generativelanguage.googleapis.com/v1beta/models'
    );
  });

  test('MAX_SCHEDULE_ROWS is a positive integer', () => {
    expect(Number.isInteger(ai._internal.MAX_SCHEDULE_ROWS)).toBe(true);
    expect(ai._internal.MAX_SCHEDULE_ROWS).toBeGreaterThan(0);
  });

  test('isEnabled() returns false when GEMINI_API_KEY is unset', () => {
    const prev = process.env.GEMINI_API_KEY;
    delete process.env.GEMINI_API_KEY;
    try {
      expect(ai.isEnabled()).toBe(false);
    } finally {
      if (prev !== undefined) process.env.GEMINI_API_KEY = prev;
    }
  });

  test('isEnabled() returns true when GEMINI_API_KEY is a non-empty string', () => {
    const prev = process.env.GEMINI_API_KEY;
    process.env.GEMINI_API_KEY = 'AQ.test_key_for_unit_test_only';
    try {
      expect(ai.isEnabled()).toBe(true);
    } finally {
      if (prev === undefined) delete process.env.GEMINI_API_KEY;
      else process.env.GEMINI_API_KEY = prev;
    }
  });
});

describe('aiProvider — explainFailure (no key)', () => {
  test('returns available:false with reason no_api_key', async () => {
    const prev = process.env.GEMINI_API_KEY;
    delete process.env.GEMINI_API_KEY;
    try {
      const r = await ai.explainFailure({ message: 'no slot for CSE406', details: {} });
      expect(r.available).toBe(false);
      expect(r.reason).toBe('no_api_key');
      expect(r.friendly_hint).toBeNull();
    } finally {
      if (prev !== undefined) process.env.GEMINI_API_KEY = prev;
    }
  });
});

describe('aiProvider — explainRoutine (no key)', () => {
  test('returns available:false with reason no_api_key', async () => {
    const prev = process.env.GEMINI_API_KEY;
    delete process.env.GEMINI_API_KEY;
    try {
      const r = await ai.explainRoutine({
        schedule: [{ course_code: 'CSE406', day: 'SUN', slot_start: 540, slot_end: 590 }],
        prompt: 'What room does CSE406 use?',
      });
      expect(r.available).toBe(false);
      expect(r.reason).toBe('no_api_key');
      expect(r.answer).toBeNull();
    } finally {
      if (prev !== undefined) process.env.GEMINI_API_KEY = prev;
    }
  });
});

describe('aiProvider — parseEditRequest (no key)', () => {
  test('returns available:false with reason no_api_key', async () => {
    const prev = process.env.GEMINI_API_KEY;
    delete process.env.GEMINI_API_KEY;
    try {
      const r = await ai.parseEditRequest({
        schedule: [],
        prompt: 'Move CSE406 to Monday at 10am.',
      });
      expect(r.available).toBe(false);
      expect(r.reason).toBe('no_api_key');
      expect(r.proposal).toBeNull();
    } finally {
      if (prev !== undefined) process.env.GEMINI_API_KEY = prev;
    }
  });
});

describe('aiProvider._internal.sanitize', () => {
  const { sanitize } = ai._internal;
  test('returns null for empty / nullish input', () => {
    expect(sanitize(null)).toBeNull();
    expect(sanitize(undefined)).toBeNull();
    expect(sanitize('')).toBeNull();
  });

  test('strips markdown code fences', () => {
    expect(sanitize('```\nhello world\n```')).toBe('hello world');
    expect(sanitize('```json\n{"a":1}\n```')).toBe('{"a":1}');
  });

  test('strips leading hash headings and collapses whitespace', () => {
    expect(sanitize('# Title\n\nbody text')).toBe('Title body text');
    expect(sanitize('a\n\n\nb   c')).toBe('a b c');
  });
});

describe('aiProvider._internal.extractJson', () => {
  const { extractJson } = ai._internal;

  test('parses a plain JSON object', () => {
    expect(extractJson('{"a":1,"b":2}')).toEqual({ a: 1, b: 2 });
  });

  test('strips outer markdown fence and parses', () => {
    expect(extractJson('```json\n{"a":1}\n```')).toEqual({ a: 1 });
  });

  test('extracts JSON object from surrounding prose', () => {
    expect(extractJson('Here is the answer: {"a":1,"b":2} hope that helps')).toEqual({ a: 1, b: 2 });
  });

  test('returns null when no JSON object is present', () => {
    expect(extractJson('no json here at all')).toBeNull();
    expect(extractJson(null)).toBeNull();
    expect(extractJson('')).toBeNull();
  });
});

describe('aiProvider._internal.normalizeEditProposal', () => {
  const { normalizeEditProposal } = ai._internal;

  test('returns null for null / non-object input', () => {
    expect(normalizeEditProposal(null)).toBeNull();
    expect(normalizeEditProposal('string')).toBeNull();
    expect(normalizeEditProposal([])).toBeNull();
  });

  test('returns null when kind is missing or invalid', () => {
    expect(normalizeEditProposal({ summary: 'x' })).toBeNull();
    expect(normalizeEditProposal({ kind: 'delete_everything' })).toBeNull();
  });

  test('accepts a well-formed proposed_change', () => {
    const parsed = normalizeEditProposal({
      kind: 'proposed_change',
      summary: 'Move CSE406 from Sunday 9am to Monday 10am',
      change: {
        course_code: 'CSE406',
        from: { day: 'SUN', slot_start: 540, slot_end: 590 },
        to:   { day: 'MON', slot_start: 600, slot_end: 650 },
      },
      concerns: ['Room 101 free at 10am Monday'],
    });
    expect(parsed).not.toBeNull();
    expect(parsed.kind).toBe('proposed_change');
    expect(parsed.change.course_code).toBe('CSE406');
    expect(parsed.change.from.day).toBe('SUN');
    expect(parsed.change.to.slot_start).toBe(600);
    expect(parsed.concerns).toEqual(['Room 101 free at 10am Monday']);
  });

  test('clamps slot_start / slot_end into 0..1440', () => {
    const parsed = normalizeEditProposal({
      kind: 'proposed_change',
      summary: 'clamp test',
      change: {
        course_code: 'X',
        from: { day: 'SUN', slot_start: -50, slot_end: 9999 },
        to:   { day: 'MON', slot_start: 500, slot_end: 600 },
      },
    });
    expect(parsed.change.from.slot_start).toBe(0);
    expect(parsed.change.from.slot_end).toBe(24 * 60);
  });

  test('drops a malformed change object (keeps kind=proposed_change, change=null)', () => {
    const parsed = normalizeEditProposal({
      kind: 'proposed_change',
      summary: 'missing fields',
      change: { course_code: 'X' }, // missing from/to
    });
    expect(parsed).not.toBeNull();
    expect(parsed.kind).toBe('proposed_change');
    expect(parsed.change).toBeNull();
  });

  test('accepts a clarifying_question', () => {
    const parsed = normalizeEditProposal({
      kind: 'clarifying_question',
      summary: 'Need to know which course',
      question: 'Which course do you want moved?',
    });
    expect(parsed.kind).toBe('clarifying_question');
    expect(parsed.question).toContain('Which course');
    expect(parsed.change).toBeNull();
  });

  test('truncates oversized summary / concerns / question strings', () => {
    const long = 'a'.repeat(2000);
    const parsed = normalizeEditProposal({
      kind: 'clarifying_question',
      summary: long,
      question: long,
      concerns: [long, long, long, long, long, long, long, long, long, long],
    });
    expect(parsed.summary.length).toBeLessThanOrEqual(300);
    expect(parsed.question.length).toBeLessThanOrEqual(500);
    expect(parsed.concerns.length).toBeLessThanOrEqual(8);
    parsed.concerns.forEach((c) => expect(c.length).toBeLessThanOrEqual(200));
  });
});

describe('aiProvider._internal — prompt builders', () => {
  const { buildFailurePrompt, buildExplainPrompt, buildEditPrompt } = ai._internal;

  test('buildFailurePrompt embeds the error message and details', () => {
    const p = buildFailurePrompt({ message: 'no slot for CSE406', details: { a: 1 } });
    expect(p).toContain('no slot for CSE406');
    expect(p).toContain('"a": 1');
    expect(p.toLowerCase()).toContain('plain text only');
  });

  test('buildExplainPrompt includes the schedule and the question', () => {
    const p = buildExplainPrompt({
      schedule: [{ day: 'SUN', course_code: 'CSE406', slot_start: 540, slot_end: 590 }],
      config: { university: 'X', department: 'CSE', semester: '1-1' },
      prompt: 'Who teaches CSE406?',
    });
    // JSON.stringify with no indent produces compact form: "university":"X"
    expect(p).toContain('"university":"X"');
    expect(p).toContain('"department":"CSE"');
    expect(p).toContain('"CSE406"');
    expect(p).toContain('Who teaches CSE406?');
  });

  test('buildExplainPrompt truncates and notes truncation when schedule is huge', () => {
    const big = Array.from({ length: 1500 }, (_, i) => ({
      day: 'SUN', course_code: `C${i}`, slot_start: 0, slot_end: 30,
    }));
    const p = buildExplainPrompt({ schedule: big, prompt: 'q?' });
    expect(p).toContain('1500 rows');
    expect(p).toContain('only the first');
  });

  test('buildEditPrompt includes the JSON schema hint', () => {
    const p = buildEditPrompt({ schedule: [], prompt: 'Move X to Monday' });
    expect(p).toContain('"kind": "proposed_change"');
    expect(p).toContain('"clarifying_question"');
    expect(p).toContain('Move X to Monday');
  });
});