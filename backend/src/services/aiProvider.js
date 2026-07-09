'use strict';

/**
 * aiProvider — optional AI helper for three assistant features:
 *   (a) explainFailure: turn a structured solver failure into a
 *       friendly paragraph for the admin.
 *   (b) explainRoutine: answer natural-language questions about an
 *       already-generated schedule.
 *   (c) parseEditRequest: turn a free-text "please move CSE406 to
 *       Monday at 10am" into a structured JSON proposal that the
 *       admin can review before applying.
 *
 * IMPORTANT (per build prompt §3.1 + §3.4): this is ADVISORY TEXT
 * ONLY. It must NEVER mutate the database, never make HTTP calls
 * that change state, and never be on the critical path of a
 * successful schedule generation. If AI and solver output conflict,
 * the solver wins — the AI layer is a presentation/translation
 * layer only.
 *
 * Implementation strategy:
 *   1. If GROQ_API_KEY is unset, all helpers return
 *      { available: false, reason: 'no_api_key' } and no network
 *      call is made.
 *   2. If set, build a short prompt, POST to Groq's
 *      OpenAI-compatible chat completions endpoint
 *      (`api.groq.com/openai/v1`), with a per-call AbortController
 *      timeout. If the call fails or times out, return
 *      { available: true, reason: 'call_failed'/'timeout', ... }
 *      so the route degrades gracefully.
 *   3. For parseEditRequest, the model is asked to reply with
 *      strict JSON; the response is parsed defensively and validated
 *      against a small schema before being returned.
 *
 * NOTE: model name and endpoint are read from env so they can be
 * updated without code changes:
 *   GROQ_API_KEY      — required to enable
 *   GROQ_MODEL        — default 'llama-3.3-70b-versatile'
 *   GROQ_BASE_URL     — default 'https://api.groq.com/openai/v1'
 *   GROQ_TIMEOUT_MS   — per-call timeout, default 6000ms
 */ 
              
const DEFAULT_MODEL = 'llama-3.3-70b-versatile';
const DEFAULT_BASE_URL = 'https://api.groq.com/openai/v1';
const DEFAULT_TIMEOUT_MS = 6000;
// Hard cap on rows included in a prompt — keep tokens bounded.
const MAX_SCHEDULE_ROWS = 800;

function isEnabled() {
  return Boolean(process.env.GROQ_API_KEY && process.env.GROQ_API_KEY.trim());
}

function timeoutMs() {
  const v = Number(process.env.GROQ_TIMEOUT_MS);
  return Number.isFinite(v) && v > 0 ? v : DEFAULT_TIMEOUT_MS;
}

// ---------------------------------------------------------------------------
// Prompt builders
// ---------------------------------------------------------------------------

/**
 * Build the prompt we send to the model for explainFailure. The
 * caller (generate route) computes capacity-vs-demand diagnostics
 * from the input the solver was given and passes them in; we embed
 * the JSON verbatim so the model can quote exact numbers instead of
 * inventing generic advice.
 *
 * Accepts either:
 *   (a) a SchedulingError directly, OR
 *   (b) { schedulingError, diagnostics } so we can attach the
 *       richer payload without the route having to re-shape.
 *
 * If no diagnostics are provided we fall back to the original
 * "message + details" prompt so legacy callers and tests keep working.
 */
function buildFailurePrompt(schedulingErrorOrArg) {
  const schedulingError = schedulingErrorOrArg && schedulingErrorOrArg.schedulingError
    ? schedulingErrorOrArg.schedulingError
    : schedulingErrorOrArg;
  const diagnostics = schedulingErrorOrArg && schedulingErrorOrArg.diagnostics;

  // The solver splits unplaced courses into two buckets so the AI
  // can target root causes (see services/scheduler.js):
  //   - details.unplaceable    — courses backtrack actually tried
  //                              and could not place.
  //   - details.not_attempted  — courses the solver never reached
  //                              because an earlier course failed
  //                              first.
  // We surface the not_attempted list so the model can mention it
  // briefly (so the admin knows these are *not* root causes) instead
  // of silently dropping them.
  const unplaceable = (schedulingError && schedulingError.details
    && Array.isArray(schedulingError.details.unplaceable))
    ? schedulingError.details.unplaceable
    : [];
  const notAttempted = (schedulingError && schedulingError.details
    && Array.isArray(schedulingError.details.not_attempted))
    ? schedulingError.details.not_attempted
    : [];

  const lines = [];
  lines.push('You are helping a university admin debug a scheduling conflict. ');
  lines.push('You are given exact capacity vs demand numbers per course type. ');
  lines.push('Do NOT give generic advice like "add more rooms" -- instead, state ');
  lines.push('the capacity vs demand using the numbers provided (e.g. "X sessions of ');
  lines.push('type Y need Z slots and W are available"), ');
  lines.push('and suggest which specific course_codes have suspiciously high or ');
  lines.push('inconsistent credit/duration values compared to others of the same ');
  lines.push('type, if any stand out.');
  lines.push('');
  lines.push('A CSP auto-scheduler reported the following infeasibility:');
  lines.push('');
  lines.push(`Message: ${(schedulingError && schedulingError.message) || '(none)'}`);
  if (schedulingError && schedulingError.details) {
    lines.push('Raw solver details:');
    lines.push(JSON.stringify(schedulingError.details, null, 2));
  }
  if (unplaceable.length > 0) {
    lines.push('');
    lines.push(`Actually-failing courses (root causes) [${unplaceable.length}]: ` +
      unplaceable.join(', '));
  }
  if (notAttempted.length > 0) {
    lines.push('');
    lines.push(`Courses the solver never reached (consequences, not causes) [${notAttempted.length}]: ` +
      notAttempted.join(', '));
    lines.push('Treat these as downstream effects — they were never placed because');
    lines.push('one of the actually-failing courses above exhausted the search. Do');
    lines.push('NOT recommend fixing them directly; fixing the actually-failing');
    lines.push('course(s) usually fixes them automatically.');
  }
  if (diagnostics) {
    lines.push('');
    lines.push('Computed capacity vs demand (JSON):');
    lines.push(JSON.stringify(diagnostics, null, 2));
  }
  lines.push('');
  lines.push('Write ONE short paragraph (max 4 sentences) suggesting concrete next');
  lines.push('steps the admin can take (e.g. add a second lab room, reduce a');
  lines.push("teacher's unavailability, lower a course's classes-per-week, etc.).");
  lines.push('Plain text only. No markdown. No code blocks.');
  return lines.join('\n');
}

/**
 * Build the prompt for explainRoutine. Includes a compact JSON dump
 * of the schedule so the model can answer concrete questions about
 * "who teaches CSE406 on Sunday?" or "what room does DMKB use?".
 */
function buildExplainPrompt({ schedule, config, prompt }) {
  const lines = [];
  lines.push('You are answering a university timetable administrator\'s question');
  lines.push('about an already-generated schedule. Read the schedule JSON below and');
  lines.push('answer their question in plain text (max 4 sentences). Do not propose');
  lines.push('edits and do not invent classes that are not in the schedule.');
  lines.push('');
  if (config) {
    lines.push('Configuration:');
    lines.push(JSON.stringify(config));
    lines.push('');
  }
  lines.push('Schedule (array of {day, slot_start, slot_end, course_code, teacher_abbr, room_id, year_sem}):');
  const rows = Array.isArray(schedule) ? schedule.slice(0, MAX_SCHEDULE_ROWS) : [];
  lines.push(JSON.stringify(rows, null, 0));
  if (Array.isArray(schedule) && schedule.length > MAX_SCHEDULE_ROWS) {
    lines.push('');
    lines.push(`(Note: schedule has ${schedule.length} rows; only the first ${MAX_SCHEDULE_ROWS} are shown.)`);
  }
  lines.push('');
  lines.push('Question: ' + String(prompt || '').trim());
  return lines.join('\n');
}

/**
 * Build the prompt for parseEditRequest. We instruct the model to
 * reply with strict JSON so we can validate it before showing to the
 * admin.
 */
function buildEditPrompt({ schedule, prompt }) {
  const lines = [];
  lines.push('You are helping a university timetable administrator draft a manual edit');
  lines.push('to an already-generated schedule.');
  lines.push('');
  lines.push('Reply with ONLY a single JSON object (no markdown, no commentary) shaped like:');
  lines.push('{');
  lines.push('  "kind": "proposed_change" | "clarifying_question" | "explanation",');
  lines.push('  "summary": "<one-line human description of what was understood>",');
  lines.push('  "change": {');
  lines.push('    "course_code": "<e.g. CSE406>",');
  lines.push('    "from": { "day": "SUN", "slot_start": 540, "slot_end": 590 },');
  lines.push('    "to":   { "day": "MON", "slot_start": 600, "slot_end": 650 }');
  lines.push('  } | null,');
  lines.push('  "question": "<if kind=clarifying_question, the question to ask the admin>" | null,');
  lines.push('  "concerns": ["<short notes about conflicts / feasibility>"]');
  lines.push('}');
  lines.push('');
  lines.push('Rules:');
  lines.push('  - slot_start / slot_end are minutes after midnight (e.g. 540 = 9:00).');
  lines.push('  - day must be SUN/MON/TUE/WED/THU/SAT (whichever the config uses).');
  lines.push('  - Only one of (change, question) should be non-null; the other must be null.');
  lines.push('  - concerns is a free-form array of short strings flagging possible');
  lines.push('    conflicts (teacher already busy, room already booked, etc.) — empty if none.');
  lines.push('  - If you cannot understand the request, set kind="clarifying_question" and ask.');
  lines.push('  - NEVER propose a change that violates the schedule\'s constraints without');
  lines.push('    flagging it in concerns.');
  lines.push('');
  lines.push('Current schedule (abridged):');
  const rows = Array.isArray(schedule) ? schedule.slice(0, MAX_SCHEDULE_ROWS) : [];
  lines.push(JSON.stringify(rows, null, 0));
  if (Array.isArray(schedule) && schedule.length > MAX_SCHEDULE_ROWS) {
    lines.push('');
    lines.push(`(schedule has ${schedule.length} rows total; first ${MAX_SCHEDULE_ROWS} shown)`);
  }
  lines.push('');
  lines.push('Admin request: ' + String(prompt || '').trim());
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Response sanitization / parsing
// ---------------------------------------------------------------------------

/**
 * Strip markdown fences and surrounding whitespace from a plain-text
 * model response so it displays cleanly in the admin UI.
 */
function sanitize(text) {
  if (!text) return null;
  return String(text)
    // Strip markdown code fences but KEEP the inner text (matters
    // for prompts like "```json\n{...}\n```" → "{...}").
    .replace(/```(?:json|js|javascript|ts|tsx|jsx|python)?\s*([\s\S]*?)\s*```/gi, '$1')
    .replace(/^#+\s*/gm, '')
    .replace(/\s+/g, ' ')
    .trim() || null;
}

/**
 * Pull a trailing `Board suggestion: <text>` line out of a model
 * response so the explanation and the suggestion can be surfaced
 * separately. Returns { explanation, boardSuggestion }; either may
 * be null if the line is missing or malformed.
 *
 * The model is asked to put the line on its own at the very end;
 * we tolerate surrounding whitespace and a leading dash (some
 * models emit "Board suggestion — ..." instead). We strip the
 * prefix from the suggestion text and leave any prefix on the
 * prose side untouched.
 */
function splitBoardSuggestion(text) {
  if (!text) return { explanation: null, boardSuggestion: null };
  const raw = String(text).trimEnd();
  // Anchor on the LAST occurrence so an explanation that mentions
  // "board suggestion" in prose still gets split correctly.
  const re = /\n\s*Board suggestion\s*[:\-–—]\s*([\s\S]+?)\s*$/i;
  const match = re.exec(raw);
  if (!match) {
    return { explanation: sanitize(raw), boardSuggestion: null };
  }
  const prose = raw.slice(0, match.index).trimEnd();
  const suggestion = String(match[1] || '').trim();
  return {
    explanation: sanitize(prose),
    boardSuggestion: suggestion || null,
  };
}

/**
 * Best-effort JSON extractor: model responses sometimes wrap JSON in
 * ```json ... ``` fences or pad with prose. Try strict parse first,
 * then progressively looser extraction.
 */
function extractJson(text) {
  if (!text) return null;
  const raw = String(text).trim();
  // Strip outer markdown fences if present.
  const fenced = raw.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  const candidate = fenced ? fenced[1].trim() : raw;
  // 1. Strict parse.
  try { return JSON.parse(candidate); } catch (_) { /* fall through */ }
  // 2. Find first '{' and last '}' and parse that substring.
  const first = candidate.indexOf('{');
  const last = candidate.lastIndexOf('}');
  if (first >= 0 && last > first) {
    const slice = candidate.slice(first, last + 1);
    try { return JSON.parse(slice); } catch (_) { /* fall through */ }
  }
  return null;
}

/**
 * Validate the shape of a parsed edit proposal. Returns a normalized
 * object or null if the model returned something unusable.
 */
function normalizeEditProposal(parsed) {
  if (!parsed || typeof parsed !== 'object') return null;
  const kind = String(parsed.kind || '').toLowerCase();
  if (!['proposed_change', 'clarifying_question', 'explanation'].includes(kind)) {
    return null;
  }
  const summary = typeof parsed.summary === 'string' ? parsed.summary.slice(0, 300) : '';
  const concerns = Array.isArray(parsed.concerns)
    ? parsed.concerns.map((c) => String(c).slice(0, 200)).slice(0, 8)
    : [];
  let change = null;
  if (kind === 'proposed_change' && parsed.change && typeof parsed.change === 'object') {
    const c = parsed.change;
    const from = c.from && typeof c.from === 'object' ? c.from : null;
    const to = c.to && typeof c.to === 'object' ? c.to : null;
    if (c.course_code && from && to &&
        typeof from.day === 'string' && typeof to.day === 'string' &&
        Number.isFinite(from.slot_start) && Number.isFinite(from.slot_end) &&
        Number.isFinite(to.slot_start) && Number.isFinite(to.slot_end)) {
      change = {
        course_code: String(c.course_code).slice(0, 32),
        from: {
          day: String(from.day).slice(0, 8).toUpperCase(),
          slot_start: Math.max(0, Math.min(24 * 60, Math.round(from.slot_start))),
          slot_end: Math.max(0, Math.min(24 * 60, Math.round(from.slot_end))),
        },
        to: {
          day: String(to.day).slice(0, 8).toUpperCase(),
          slot_start: Math.max(0, Math.min(24 * 60, Math.round(to.slot_start))),
          slot_end: Math.max(0, Math.min(24 * 60, Math.round(to.slot_end))),
        },
      };
    }
  }
  const question = kind === 'clarifying_question' && typeof parsed.question === 'string'
    ? parsed.question.slice(0, 500)
    : null;
  return { kind, summary, change, question, concerns };
}

// ---------------------------------------------------------------------------
// Low-level call to Groq (OpenAI-compatible chat completions API)
// ---------------------------------------------------------------------------

async function callGroq(promptText, opts = {}) {
  if (!isEnabled()) {
    return { available: false, reason: 'no_api_key', text: null, json: null };
  }
  const apiKey = process.env.GROQ_API_KEY.trim();
  const model = process.env.GROQ_MODEL || DEFAULT_MODEL;
  const baseURL = process.env.GROQ_BASE_URL || DEFAULT_BASE_URL;

  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), opts.timeoutMs || timeoutMs());

  try {
    const res = await fetch(`${baseURL}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      signal: controller.signal,
      body: JSON.stringify({
        model,
        messages: [{ role: 'user', content: promptText }],
        temperature: opts.temperature != null ? opts.temperature : 0.4,
        max_tokens: opts.maxOutputTokens != null ? opts.maxOutputTokens : 320,
      }),
    });
    clearTimeout(t);
    if (!res.ok) {
      return { available: true, reason: `http_${res.status}`, text: null, json: null };
    }
    const json = await res.json();
    const choice = (json && json.choices && json.choices[0]) || null;
    const text = choice && choice.message && typeof choice.message.content === 'string'
      ? choice.message.content
      : null;
    return text
      ? { available: true, reason: null, text, json }
      : { available: true, reason: 'empty_response', text: null, json };
  } catch (err) {
    clearTimeout(t);
    return {
      available: true,
      reason: err && err.name === 'AbortError' ? 'timeout' : 'call_failed',
      text: null,
      json: null,
    };
  }
}

// ---------------------------------------------------------------------------
// Prompt builder for explainValidator
// ---------------------------------------------------------------------------

/**
 * Build the prompt we send to the model for explainValidator. We pass
 * the *exact* rule code, sheet, row, column, and message that the
 * validator already produced — the model's job is only to translate
 * that into 2–3 sentences of plain-English remediation guidance, not
 * to invent facts about the data.
 *
 * In addition to the prose explanation, we ask the model to append a
 * structured "Board suggestion:" line — a one-shot, copy-pasteable
 * recipe an admin can apply directly in Excel/Google Sheets (a
 * formula, a find/replace expression, a value to type into a
 * specific cell, etc.). The model returns this in a stable trailing
 * line so explainValidator can split the explanation from the
 * suggestion without re-parsing JSON.
 */

function buildValidatorPrompt(issue) {
  const lines = [];
  lines.push('You are helping a university timetable administrator fix a single validation issue');
  lines.push('that was flagged during .xlsx import. The rule, location, and the message the');
  lines.push('validator already produced are given below. Your job is to explain in plain English');
  lines.push('(a) what the rule actually checks, (b) the most likely cause of the failure, and');
  lines.push('(c) the concrete fix in the workbook.');
  lines.push('');
  lines.push('Rules:');
  lines.push('  - 2–4 short sentences. No headings. No bullet lists.');
  lines.push('  - Do NOT invent data that was not provided.');
  lines.push('  - If the issue is a "warning" (soft), mention that the upload still succeeded');
  lines.push('    and the admin may safely ignore it if the data is intentional.');
  lines.push('  - Reference the rule code (e.g. V1, V5) and the sheet/cell when relevant.');
  lines.push('  - Append EXACTLY ONE trailing line in this form:');
  lines.push('      Board suggestion: <one short, copy-pasteable recipe>');
  lines.push('    The suggestion should be a concrete Excel/Sheets-level action');
  lines.push('    (a formula, a find/replace expression, a value to type into a');
  lines.push('    specific cell like "Courses!D12", or a 1-2 step checklist).');
  lines.push('    Do NOT wrap the line in markdown. Do NOT use bullets inside it.');
  lines.push('    Do NOT prefix it with a label other than "Board suggestion:".');
  lines.push('');
  lines.push(`Severity: ${issue.severity || 'error'}`);
  lines.push(`Rule:     ${issue.code || issue.rule || '(unknown)'}`);
  if (issue.sheet)   lines.push(`Sheet:    ${issue.sheet}`);
  if (issue.column)  lines.push(`Column:   ${issue.column}`);
  if (issue.row != null) lines.push(`Row:      ${issue.row}`);
  if (issue.value != null && issue.value !== '') lines.push(`Value:    ${JSON.stringify(issue.value)}`);
  lines.push(`Message:  ${issue.message || '(none)'}`);
  return lines.join('\n');
}

/**
 * Build the prompt for explainUploadIssues — a holistic analysis of ALL
 * validation errors and warnings from a single upload attempt.
 * The model is asked to return strict JSON so the route can surface
 * per-rule actionable hints in the UI without re-parsing prose.
 */
function buildUploadIssuesPrompt(errors, warnings) {
  const lines = [];
  lines.push('You are a university timetable assistant helping an administrator fix problems');
  lines.push('found in an uploaded Excel workbook for a class routine generator.');
  lines.push('The workbook has 9 sheets: Teachers, Courses, Year_Sem, Rooms, Credit_Rules,');
  lines.push('Room_Preference, Day_Preference, Teacher_Unavailability, Config.');
  lines.push('');
  lines.push('Working days are SUN, MON, TUE, WED, THU (Sunday–Thursday).');
  lines.push('');
  lines.push('You will be given a JSON array of validation errors and warnings.');
  lines.push('Reply with ONLY a single JSON object (no markdown, no commentary) shaped like:');
  lines.push('{');
  lines.push('  "summary": "<2-3 sentences summarising the main problems and overall fix strategy>",');
  lines.push('  "actionable_hints": [');
  lines.push('    {');
  lines.push('      "rule": "<V1/V2/…>",');
  lines.push('      "severity": "error" | "warning",');
  lines.push('      "fix": "<one concrete sentence: what to open, what to change, exact value>",');
  lines.push('      "excel_action": "<copy-pasteable Excel formula or step, e.g. =VLOOKUP(B2,Teachers!A:A,1,0)>"');
  lines.push('    }');
  lines.push('  ]');
  lines.push('}');
  lines.push('');
  lines.push('Rules:');
  lines.push('  - Group by rule code — one hint object per unique rule code, even if there');
  lines.push('    are many rows with that code. Mention the count of affected rows.');
  lines.push('  - Be specific: reference sheet names, column names, and exact expected values.');
  lines.push('  - Do NOT invent data. Only use what is provided.');
  lines.push('  - Fix errors first, then warnings.');
  lines.push('  - Keep each "fix" under 60 words.');
  lines.push('');

  const allIssues = [
    ...errors.map(e => ({ ...e, severity: 'error' })),
    ...warnings.map(w => ({ ...w, severity: 'warning' })),
  ];
  // Limit to 60 issues to stay within token budget.
  const limited = allIssues.slice(0, 60);
  lines.push(`Validation issues (${allIssues.length} total, showing ${limited.length}):`);
  lines.push(JSON.stringify(limited, null, 2));
  return lines.join('\n');
}


// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * @param {Error & {details?:any}} schedulingError
 * @param {{diagnostics?: object}} [opts]  — capacity-vs-demand
 *   diagnostics computed by the route (see services/diagnostics.js).
 *   When provided, it's embedded into the prompt so the model can
 *   quote exact numbers instead of generic advice.
 * @returns {Promise<{available:boolean, friendly_hint:string|null, reason?:string}>}
 */
async function explainFailure(schedulingError, opts) {
  const r = await callGroq(buildFailurePrompt({
    schedulingError,
    diagnostics: opts && opts.diagnostics,
  }));
  if (!r.available) return { available: false, friendly_hint: null, reason: r.reason };
  if (r.reason) return { available: true, friendly_hint: null, reason: r.reason };
  const friendly = sanitize(r.text);
  return friendly
    ? { available: true, friendly_hint: friendly }
    : { available: true, friendly_hint: null, reason: 'empty_response' };
}

/**
 * Answer a free-text question about a generated schedule.
 *
 * @param {object} args
 * @param {Array}  args.schedule    array of schedule rows
 * @param {object} [args.config]    config block (university/department/semester)
 * @param {string} args.prompt      the admin's question
 * @returns {Promise<{available:boolean, answer:string|null, reason?:string}>}
 */
async function explainRoutine({ schedule, config, prompt }) {
  const r = await callGroq(buildExplainPrompt({ schedule, config, prompt }));
  if (!r.available) return { available: false, answer: null, reason: r.reason };
  if (r.reason) return { available: true, answer: null, reason: r.reason };
  const answer = sanitize(r.text);
  return answer
    ? { available: true, answer }
    : { available: true, answer: null, reason: 'empty_response' };
}

/**
 * Turn a free-text edit request into a structured proposal.
 *
 * @param {object} args
 * @param {Array}  args.schedule    array of schedule rows
 * @param {string} args.prompt      the admin's request
 * @returns {Promise<{
 *   available: boolean,
 *   proposal: object|null,         // normalized proposal, or null on parse failure
 *   reason?: string                // present when available=true but proposal=null,
 *                                  // or when available=false
 * }>}
 */
async function parseEditRequest({ schedule, prompt }) {
  const r = await callGroq(buildEditPrompt({ schedule, prompt }), {
    temperature: 0.2,
    maxOutputTokens: 600,
  });
  if (!r.available) return { available: false, proposal: null, reason: r.reason };
  if (r.reason) return { available: true, proposal: null, reason: r.reason };
  const parsed = extractJson(r.text);
  const proposal = normalizeEditProposal(parsed);
  return proposal
    ? { available: true, proposal }
    : { available: true, proposal: null, reason: 'invalid_json' };
}

/**
 * Explain how to fix a single validator error or warning.
 *
 * Used by the per-row "How do I fix this?" button on the History /
 * Routine pages. Returns a short plain-text paragraph (2-3 sentences)
 * the admin can read inline, plus a `board_suggestion` string — a
 * one-shot Excel/Sheets-level recipe the admin can paste into the
 * workbook (formula, find/replace expression, value-to-type, etc.).
 *
 * @param {{code?:string, rule?:string, sheet?:string|null,
 *          row?:number|string|null, column?:string|null,
 *          message:string, value?:any, severity?:'error'|'warning'}} issue
 * @returns {Promise<{
 *   available:boolean,
 *   explanation:string|null,
 *   board_suggestion:string|null,
 *   reason?:string
 * }>}
 */
async function explainValidator(issue) {
  if (!issue || !issue.message) {
    return { available: false, explanation: null, board_suggestion: null, reason: 'invalid_issue' };
  }
  const r = await callGroq(buildValidatorPrompt(issue), {
    temperature: 0.3,
    maxOutputTokens: 360,
  });
  if (!r.available) return { available: false, explanation: null, board_suggestion: null, reason: r.reason };
  if (r.reason) return { available: true, explanation: null, board_suggestion: null, reason: r.reason };
  const { explanation, boardSuggestion } = splitBoardSuggestion(r.text);
  if (!explanation && !boardSuggestion) {
    return { available: true, explanation: null, board_suggestion: null, reason: 'empty_response' };
  }
  return { available: true, explanation, board_suggestion: boardSuggestion };
}

/**
 * Analyse ALL validation errors and warnings from a single upload attempt
 * using Groq and return structured, per-rule actionable hints.
 *
 * @param {Array} errors   — hard validation failures from validators.validate()
 * @param {Array} warnings — soft warnings from validators.validate()
 * @returns {Promise<{
 *   available: boolean,
 *   summary: string|null,
 *   actionable_hints: Array<{rule,severity,fix,excel_action}>|null,
 *   reason?: string
 * }>}
 */
async function explainUploadIssues(errors, warnings) {
  if ((!errors || errors.length === 0) && (!warnings || warnings.length === 0)) {
    return { available: true, summary: null, actionable_hints: [] };
  }
  const r = await callGroq(buildUploadIssuesPrompt(errors || [], warnings || []), {
    temperature: 0.3,
    maxOutputTokens: 900,
  });
  if (!r.available) return { available: false, summary: null, actionable_hints: null, reason: r.reason };
  if (r.reason)     return { available: true,  summary: null, actionable_hints: null, reason: r.reason };

  const parsed = extractJson(r.text);
  if (!parsed || typeof parsed !== 'object') {
    return { available: true, summary: sanitize(r.text), actionable_hints: null, reason: 'invalid_json' };
  }

  const summary = typeof parsed.summary === 'string' ? parsed.summary.slice(0, 600) : null;
  const rawHints = Array.isArray(parsed.actionable_hints) ? parsed.actionable_hints : [];
  const actionable_hints = rawHints
    .filter(h => h && typeof h === 'object')
    .map(h => ({
      rule:         typeof h.rule         === 'string' ? h.rule.slice(0, 10)  : '?',
      severity:     h.severity === 'warning' ? 'warning' : 'error',
      fix:          typeof h.fix          === 'string' ? h.fix.slice(0, 300)  : '',
      excel_action: typeof h.excel_action === 'string' ? h.excel_action.slice(0, 300) : null,
    }))
    .slice(0, 20);

  return { available: true, summary, actionable_hints };
}

module.exports = {
  // public API
  explainFailure,
  explainRoutine,
  parseEditRequest,
  explainValidator,
  explainUploadIssues,
  isEnabled,
  // exposed for tests
  _internal: {
    buildFailurePrompt,
    buildExplainPrompt,
    buildEditPrompt,
    buildValidatorPrompt,
    buildUploadIssuesPrompt,
    sanitize,
    extractJson,
    normalizeEditProposal,
    splitBoardSuggestion,
    MAX_SCHEDULE_ROWS,
    DEFAULT_MODEL,
    DEFAULT_BASE_URL,
    DEFAULT_TIMEOUT_MS,
  },
};