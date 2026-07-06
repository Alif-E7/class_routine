'use strict';

/**
 * aiProvider.test.js — unit tests for the optional AI helper.
 *
 * The provider has three public helpers (explainFailure,
 * explainRoutine, parseEditRequest) and a private _internal
 * surface we exercise for prompt-building / JSON-extraction
 * correctness. Network calls are not made unless GROQ_API_KEY
 * is set; these tests run cleanly without any key configured.
 */

const ai = require('../src/services/aiProvider');

describe('aiProvider — defaults + capability', () => {
  test('default model name is llama-3.3-70b-versatile', () => {
    expect(ai._internal.DEFAULT_MODEL).toBe('llama-3.3-70b-versatile');
  });

  test('default base URL is the Groq OpenAI-compatible endpoint', () => {
    expect(ai._internal.DEFAULT_BASE_URL).toBe(
      'https://api.groq.com/openai/v1'
    );
  });

  test('MAX_SCHEDULE_ROWS is a positive integer', () => {
    expect(Number.isInteger(ai._internal.MAX_SCHEDULE_ROWS)).toBe(true);
    expect(ai._internal.MAX_SCHEDULE_ROWS).toBeGreaterThan(0);
  });

  test('isEnabled() returns false when GROQ_API_KEY is unset', () => {
    const prev = process.env.GROQ_API_KEY;
    delete process.env.GROQ_API_KEY;
    try {
      expect(ai.isEnabled()).toBe(false);
    } finally {
      if (prev !== undefined) process.env.GROQ_API_KEY = prev;
    }
  });

  test('isEnabled() returns true when GROQ_API_KEY is a non-empty string', () => {
    const prev = process.env.GROQ_API_KEY;
    process.env.GROQ_API_KEY = 'gsk.test_key_for_unit_test_only';
    try {
      expect(ai.isEnabled()).toBe(true);
    } finally {
      if (prev === undefined) delete process.env.GROQ_API_KEY;
      else process.env.GROQ_API_KEY = prev;
    }
  });
});

describe('aiProvider — explainFailure (no key)', () => {
  test('returns available:false with reason no_api_key', async () => {
    const prev = process.env.GROQ_API_KEY;
    delete process.env.GROQ_API_KEY;
    try {
      const r = await ai.explainFailure({ message: 'no slot for CSE406', details: {} });
      expect(r.available).toBe(false);
      expect(r.reason).toBe('no_api_key');
      expect(r.friendly_hint).toBeNull();
    } finally {
      if (prev !== undefined) process.env.GROQ_API_KEY = prev;
    }
  });
});

describe('aiProvider — explainRoutine (no key)', () => {
  test('returns available:false with reason no_api_key', async () => {
    const prev = process.env.GROQ_API_KEY;
    delete process.env.GROQ_API_KEY;
    try {
      const r = await ai.explainRoutine({
        schedule: [{ course_code: 'CSE406', day: 'SUN', slot_start: 540, slot_end: 590 }],
        prompt: 'What room does CSE406 use?',
      });
      expect(r.available).toBe(false);
      expect(r.reason).toBe('no_api_key');
      expect(r.answer).toBeNull();
    } finally {
      if (prev !== undefined) process.env.GROQ_API_KEY = prev;
    }
  });
});

describe('aiProvider — parseEditRequest (no key)', () => {
  test('returns available:false with reason no_api_key', async () => {
    const prev = process.env.GROQ_API_KEY;
    delete process.env.GROQ_API_KEY;
    try {
      const r = await ai.parseEditRequest({
        schedule: [],
        prompt: 'Move CSE406 to Monday at 10am.',
      });
      expect(r.available).toBe(false);
      expect(r.reason).toBe('no_api_key');
      expect(r.proposal).toBeNull();
    } finally {
      if (prev !== undefined) process.env.GROQ_API_KEY = prev;
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

  test('buildFailurePrompt embeds capacity-vs-demand diagnostics when provided', () => {
    const p = buildFailurePrompt({
      schedulingError: { message: 'No feasible schedule', details: { unplaceable: ['X'] } },
      diagnostics: {
        unplaceable_courses: [{ course_code: 'X' }],
        capacity_by_type: [
          {
            type: 'lab',
            duration_minutes: 240,
            total_rooms_of_type: 2,
            slots_per_room_per_day: 0,
            working_days: 5,
            max_weekly_capacity: 0,
            total_sessions_demanded: 16,
          },
        ],
        teacher_load: [{ teacher_abbr: 'T1', total_weekly_sessions: 4, total_unavailable_minutes_per_week: 0 }],
      },
    });
    expect(p).toContain('No feasible schedule');
    expect(p).toContain('"total_sessions_demanded": 16');
    expect(p).toContain('"max_weekly_capacity": 0');
    expect(p).toContain('"teacher_abbr": "T1"');
    // The new richer system prompt should also be present.
    expect(p.toLowerCase()).toContain('capacity vs demand');
    expect(p.toLowerCase()).toContain('do not give generic advice');
  });

  test('buildFailurePrompt still works with a bare SchedulingError (legacy callers)', () => {
    const p = buildFailurePrompt({ message: 'legacy call', details: { unplaceable: ['A'] } });
    expect(p).toContain('legacy call');
    expect(p).toContain('"unplaceable": [\n    "A"\n  ]');
  });

  test('buildFailurePrompt lists actually-failing courses separately from not_attempted', () => {
    // The route now splits unplaced courses into failing (root causes)
    // vs not_attempted (consequences). The prompt must surface both
    // and tell the model NOT to recommend fixing not_attempted
    // courses directly.
    const p = buildFailurePrompt({
      schedulingError: {
        message: 'No feasible schedule found for the given inputs',
        details: {
          unplaceable: ['FAILING'],
          not_attempted: ['CONSEQUENCE_A', 'CONSEQUENCE_B'],
        },
      },
      diagnostics: null,
    });
    expect(p).toContain('Actually-failing courses');
    expect(p).toContain('FAILING');
    expect(p).toContain('never reached');
    expect(p).toContain('CONSEQUENCE_A');
    expect(p).toContain('CONSEQUENCE_B');
    // Explicit instruction: don't recommend fixing the downstream
    // courses directly.
    expect(p.toLowerCase()).toContain('do not');
    expect(p.toLowerCase()).toContain('recommend fixing');
  });

  test('buildFailurePrompt omits not_attempted section when list is empty', () => {
    const p = buildFailurePrompt({
      schedulingError: {
        message: 'No feasible schedule',
        details: { unplaceable: ['ONLY'], not_attempted: [] },
      },
    });
    expect(p).toContain('Actually-failing courses');
    expect(p).not.toContain('never reached');
  });

  test('buildFailurePrompt omits not_attempted section when the field is missing', () => {
    // Backwards compat: legacy SchedulingError payloads have no
    // not_attempted key. The prompt must not crash on undefined.
    const p = buildFailurePrompt({
      message: 'legacy',
      details: { unplaceable: ['X'] },
    });
    expect(p).toContain('"unplaceable"');
    expect(p).not.toContain('never reached');
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

describe('aiProvider._internal.buildValidatorPrompt', () => {
  const { buildValidatorPrompt } = ai._internal;

  test('always surfaces severity, rule, and the validator message', () => {
    const p = buildValidatorPrompt({
      severity: 'error',
      rule: 'V1',
      message: 'teacher_abbr "ZX" is not defined',
    });
    expect(p).toContain('Severity: error');
    expect(p).toContain('Rule:     V1');
    expect(p).toContain('teacher_abbr "ZX" is not defined');
  });

  test('omits optional lines when location/value is missing', () => {
    const p = buildValidatorPrompt({
      severity: 'warning',
      rule: 'V5',
      message: 'soft warning text',
    });
    expect(p).not.toContain('Sheet:');
    expect(p).not.toContain('Column:');
    expect(p).not.toContain('Row:');
    expect(p).not.toContain('Value:');
  });

  test('includes sheet/row/column/value when present', () => {
    const p = buildValidatorPrompt({
      severity: 'error',
      code: 'EMPTY',         // accepts either code or rule
      sheet: 'Courses',
      row: 12,
      column: 'D',
      value: 'ZX',
      message: 'empty cell',
    });
    expect(p).toContain('Sheet:    Courses');
    expect(p).toContain('Row:      12');
    expect(p).toContain('Column:   D');
    expect(p).toContain('Value:    "ZX"');
    expect(p).toContain('Rule:     EMPTY');
  });

  test('soft-warnings include the "may safely ignore" note', () => {
    const p = buildValidatorPrompt({
      severity: 'warning',
      rule: 'V5',
      message: 'soft',
    });
    expect(p).toContain('may safely ignore');
  });

  test('prompts the model to append a trailing "Board suggestion:" line', () => {
    // The admin needs a copy-pasteable Excel/Sheets-level recipe
    // (formula, find/replace, value to type) in addition to the
    // prose explanation. The prompt must instruct the model to
    // emit exactly one trailing line of that form.
    const p = buildValidatorPrompt({
      severity: 'error',
      rule: 'V1',
      message: 'teacher_abbr "ZX" is not defined',
    });
    expect(p).toMatch(/Board suggestion\s*:/i);
    expect(p).toMatch(/trailing line|append/i);
    // Recipe must be concrete enough to paste into Excel/Sheets.
    expect(p).toMatch(/copy[-\s]?pasteable|excel|sheets|spreadsheet/i);
  });
});

describe('aiProvider — explainValidator (no key)', () => {
  test('returns available:false / reason no_api_key without making a network call', async () => {
    const prev = process.env.GROQ_API_KEY;
    delete process.env.GROQ_API_KEY;
    try {
      const r = await ai.explainValidator({
        severity: 'error',
        rule: 'V1',
        message: 'teacher_abbr missing',
      });
      expect(r.available).toBe(false);
      expect(r.reason).toBe('no_api_key');
      expect(r.explanation).toBeNull();
    } finally {
      if (prev !== undefined) process.env.GROQ_API_KEY = prev;
    }
  });

  test('returns reason invalid_issue for an empty message', async () => {
    const r = await ai.explainValidator({ severity: 'error', message: '' });
    expect(r.available).toBe(false);
    expect(r.reason).toBe('invalid_issue');
    expect(r.explanation).toBeNull();
  });
});

describe('aiProvider._internal.splitBoardSuggestion', () => {
  const { splitBoardSuggestion } = ai._internal;

  test('returns nulls for empty input', () => {
    expect(splitBoardSuggestion('')).toEqual({ explanation: null, boardSuggestion: null });
    expect(splitBoardSuggestion(null)).toEqual({ explanation: null, boardSuggestion: null });
    expect(splitBoardSuggestion(undefined)).toEqual({ explanation: null, boardSuggestion: null });
  });

  test('passes text through unchanged when no "Board suggestion:" line is present', () => {
    const prose = 'The teacher_abbr is not registered. Add it on the Teachers sheet.';
    const out = splitBoardSuggestion(prose);
    expect(out.boardSuggestion).toBeNull();
    expect(out.explanation).toBe(prose);
  });

  test('separates a trailing "Board suggestion:" recipe from the prose', () => {
    const text =
      'The teacher_abbr "ZX" is not defined.\n' +
      'Board suggestion: In cell Teachers!B7 type "ZX" — or set the course\'s teacher_abbr to an existing abbreviation.';
    const out = splitBoardSuggestion(text);
    expect(out.boardSuggestion).toBe(
      'In cell Teachers!B7 type "ZX" — or set the course\'s teacher_abbr to an existing abbreviation.'
    );
    expect(out.explanation).toBe('The teacher_abbr "ZX" is not defined.');
  });

  test('tolerates dash variants and extra spaces around the colon', () => {
    const text = 'Cell is blank.\nBoard suggestion   -   Type "ZX" into Teachers!B7.';
    const out = splitBoardSuggestion(text);
    expect(out.boardSuggestion).toBe('Type "ZX" into Teachers!B7.');
    expect(out.explanation).toBe('Cell is blank.');
  });

  test('is case-insensitive on the "Board suggestion:" prefix', () => {
    const text = 'Cell is blank.\nBOARD SUGGESTION: Type "ZX" into Teachers!B7.';
    const out = splitBoardSuggestion(text);
    expect(out.boardSuggestion).toBe('Type "ZX" into Teachers!B7.');
  });
});

describe('aiProvider — explainValidator (happy path with board suggestion)', () => {
  // The validator explanation now returns a separate
  // `board_suggestion` field so the admin UI can render a
  // copy-pasteable Excel/Sheets recipe.
  // We stub the network call so this test is hermetic.

  function mockFetchOnce(body) {
    global.fetch = jest.fn().mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => body,
    });
  }

  afterEach(() => {
    delete global.fetch;
    delete process.env.GROQ_API_KEY;
  });

  test('returns explanation + board_suggestion split from the model output', async () => {
    process.env.GROQ_API_KEY = 'test-key';
    mockFetchOnce({
      choices: [
        {
          message: {
            content:
              'The teacher_abbr "ZX" is not defined.\n' +
              'Board suggestion: In cell Teachers!B7 type "ZX" — or set the course\'s teacher_abbr to an existing abbreviation.',
          },
        },
      ],
    });
    const r = await ai.explainValidator({
      severity: 'error',
      rule: 'V1',
      message: 'teacher_abbr "ZX" is not defined',
      sheet: 'Courses',
      row: 12,
      column: 'D',
    });
    expect(r.available).toBe(true);
    expect(r.explanation).toBe('The teacher_abbr "ZX" is not defined.');
    expect(r.board_suggestion).toBe(
      'In cell Teachers!B7 type "ZX" — or set the course\'s teacher_abbr to an existing abbreviation.'
    );
  });

  test('returns board_suggestion=null when the model output has no recipe line', async () => {
    process.env.GROQ_API_KEY = 'test-key';
    mockFetchOnce({
      choices: [{ message: { content: 'The teacher_abbr "ZX" is not defined.' } }],
    });
    const r = await ai.explainValidator({
      severity: 'error',
      rule: 'V1',
      message: 'teacher_abbr "ZX" is not defined',
    });
    expect(r.available).toBe(true);
    expect(r.explanation).toBe('The teacher_abbr "ZX" is not defined.');
    expect(r.board_suggestion).toBeNull();
  });
});