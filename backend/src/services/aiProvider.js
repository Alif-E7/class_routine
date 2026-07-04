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
 *   1. If GEMINI_API_KEY is unset, all helpers return
 *      { available: false, reason: 'no_api_key' } and no network
 *      call is made.
 *   2. If set, build a short prompt, POST to the Generative Language
 *      API (`generativelanguage.googleapis.com`), with a per-call
 *      AbortController timeout. If the call fails or times out,
 *      return { available: true, reason: 'call_failed'/'timeout',
 *      ... } so the route degrades gracefully.
 *   3. For parseEditRequest, the model is asked to reply with
 *      strict JSON; the response is parsed defensively and validated
 *      against a small schema before being returned.
 *
 * NOTE: model name and endpoint are read from env so they can be
 * updated without code changes:
 *   GEMINI_API_KEY    — required to enable
 *   GEMINI_MODEL      — default 'gemini-2.5-flash'
 *   GEMINI_ENDPOINT   — default Google AI Studio v1beta path
 *   GEMINI_TIMEOUT_MS — per-call timeout, default 6000ms
 */

const DEFAULT_MODEL = 'gemini-2.5-flash';
const DEFAULT_ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models';
const DEFAULT_TIMEOUT_MS = 6000;
// Hard cap on rows included in a prompt — keep tokens bounded.
const MAX_SCHEDULE_ROWS = 800;

function isEnabled() {
  return Boolean(process.env.GEMINI_API_KEY && process.env.GEMINI_API_KEY.trim());
}

function timeoutMs() {
  const v = Number(process.env.GEMINI_TIMEOUT_MS);
  return Number.isFinite(v) && v > 0 ? v : DEFAULT_TIMEOUT_MS;
}

// ---------------------------------------------------------------------------
// Prompt builders
// ---------------------------------------------------------------------------

/**
 * Build the prompt we send to the model for explainFailure. Keep it
 * short — the model is just being asked to rephrase a structured
 * failure into one paragraph of admin-friendly English.
 */
function buildFailurePrompt(schedulingError) {
  const lines = [];
  lines.push('You are helping a university timetable administrator.');
  lines.push('A CSP auto-scheduler reported the following infeasibility:');
  lines.push('');
  lines.push(`Message: ${schedulingError.message || '(none)'}`);
  if (schedulingError.details) {
    lines.push('Details:');
    lines.push(JSON.stringify(schedulingError.details, null, 2));
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
// Low-level call to Gemini
// ---------------------------------------------------------------------------

async function callGemini(promptText, opts = {}) {
  if (!isEnabled()) {
    return { available: false, reason: 'no_api_key', text: null, json: null };
  }
  const apiKey = process.env.GEMINI_API_KEY.trim();
  const model = process.env.GEMINI_MODEL || DEFAULT_MODEL;
  const endpointBase = process.env.GEMINI_ENDPOINT || DEFAULT_ENDPOINT;
  const url = `${endpointBase}/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;

  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), opts.timeoutMs || timeoutMs());

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: promptText }] }],
        generationConfig: {
          temperature: opts.temperature != null ? opts.temperature : 0.4,
          maxOutputTokens: opts.maxOutputTokens != null ? opts.maxOutputTokens : 320,
        },
      }),
    });
    clearTimeout(t);
    if (!res.ok) {
      return { available: true, reason: `http_${res.status}`, text: null, json: null };
    }
    const json = await res.json();
    const candidate = (json && json.candidates && json.candidates[0]) || null;
    const parts = candidate && candidate.content && candidate.content.parts;
    const text = Array.isArray(parts) && parts.length > 0 ? parts[0].text : null;
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
// Public API
// ---------------------------------------------------------------------------

/**
 * @param {Error & {details?:any}} schedulingError
 * @returns {Promise<{available:boolean, friendly_hint:string|null, reason?:string}>}
 */
async function explainFailure(schedulingError) {
  const r = await callGemini(buildFailurePrompt(schedulingError));
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
  const r = await callGemini(buildExplainPrompt({ schedule, config, prompt }));
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
  const r = await callGemini(buildEditPrompt({ schedule, prompt }), {
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

module.exports = {
  // public API
  explainFailure,
  explainRoutine,
  parseEditRequest,
  isEnabled,
  // exposed for tests
  _internal: {
    buildFailurePrompt,
    buildExplainPrompt,
    buildEditPrompt,
    sanitize,
    extractJson,
    normalizeEditProposal,
    MAX_SCHEDULE_ROWS,
    DEFAULT_MODEL,
    DEFAULT_ENDPOINT,
    DEFAULT_TIMEOUT_MS,
  },
};