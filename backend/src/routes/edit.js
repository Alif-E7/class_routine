'use strict';

/**
 * edit.js — POST /api/batches/:id/edit
 *
 * Per build prompt §3.6: the AI provider also exposes an
 * "ask the assistant to draft a manual edit" feature for an
 * already-generated schedule. This route:
 *
 *   1. Loads the batch + its persisted schedule from MySQL.
 *   2. Hands both off to aiProvider.parseEditRequest().
 *   3. Returns the model's structured proposal (or a graceful
 *      "AI_UNAVAILABLE" envelope when no key is configured).
 *
 * This route is ADVISORY ONLY. It does NOT mutate the
 * schedules table. The admin UI shows the proposal and would
 * apply it through a future /apply endpoint (out of scope
 * for Step 8).
 *
 * Response shapes:
 *   200 OK:
 *     {
 *       success: true,
 *       code: 'EDIT_PROPOSED',
 *       batch_id: <int>,
 *       prompt: <echo of input>,
 *       proposal: {
 *         kind: 'proposed_change' | 'clarifying_question' | 'explanation',
 *         summary: '...',
 *         change: { course_code, from:{...}, to:{...} } | null,
 *         question: '...' | null,
 *         concerns: ['...'],
 *       }
 *     }
 *
 *   400 INVALID_PROMPT — missing / too short.
 *   400 INVALID_BATCH_ID — id is not a positive integer.
 *   404 BATCH_NOT_FOUND — no such batch.
 *   409 BATCH_NOT_READY — batch exists but has no generated schedule.
 *   503 AI_UNAVAILABLE — aiProvider returned available:false (e.g.
 *      no GEMINI_API_KEY in env). The admin UI surfaces a clear
 *      "feature requires server-side key" message.
 *   502 AI_INVALID_RESPONSE — AI ran but produced unusable output
 *      (parse failure). The structured error is the source of
 *      truth; the proposal is null.
 */

const express = require('express');
const router = express.Router({ mergeParams: true });

const { getPool } = require('../db/pool');
const { parseEditRequest, isEnabled } = require('../services/aiProvider');

const MIN_PROMPT_LEN = 8;
const MAX_PROMPT_LEN = 500;

router.post('/:id/edit', async (req, res, next) => {
  const batchId = Number.parseInt(req.params.id, 10);
  if (!Number.isInteger(batchId) || batchId <= 0) {
    return res.status(400).json({
      success: false,
      code: 'INVALID_BATCH_ID',
      message: 'batch id must be a positive integer',
    });
  }

  const promptRaw = req.body && req.body.prompt;
  const prompt = typeof promptRaw === 'string' ? promptRaw.trim() : '';
  if (!prompt || prompt.length < MIN_PROMPT_LEN) {
    return res.status(400).json({
      success: false,
      code: 'INVALID_PROMPT',
      message: `prompt must be at least ${MIN_PROMPT_LEN} characters`,
      min_length: MIN_PROMPT_LEN,
    });
  }
  if (prompt.length > MAX_PROMPT_LEN) {
    return res.status(400).json({
      success: false,
      code: 'INVALID_PROMPT',
      message: `prompt must be at most ${MAX_PROMPT_LEN} characters`,
      max_length: MAX_PROMPT_LEN,
    });
  }

  try {
    // 1. Load batch header (so we know the config + ensure it exists).
    const [batchRows] = await getPool().query(
      `SELECT id, university, department, semester,
              status, total_sessions, generated_at
         FROM upload_batches WHERE id = ?`,
      [batchId]
    );
    if (batchRows.length === 0) {
      return res.status(404).json({
        success: false,
        code: 'BATCH_NOT_FOUND',
        message: `No upload batch with id ${batchId}`,
      });
    }
    const batch = batchRows[0];

    // 2. Load the persisted schedule.
    const [scheduleRows] = await getPool().query(
      `SELECT course_code, teacher_abbr, room_id,
              day, slot_start, slot_end, year_sem, session_index
         FROM schedules WHERE batch_id = ?
         ORDER BY year_sem, day, slot_start, course_code`,
      [batchId]
    );
    if (scheduleRows.length === 0) {
      return res.status(409).json({
        success: false,
        code: 'BATCH_NOT_READY',
        message:
          'This batch has no generated schedule yet. Generate one first, ' +
          'then ask the assistant for an edit.',
        status: batch.status || null,
      });
    }

    // 3. Check AI availability up front so we can return a clean
    //    503 instead of calling out and timing out.
    if (!isEnabled()) {
      return res.status(503).json({
        success: false,
        code: 'AI_UNAVAILABLE',
        message:
          'AI assist is not configured on this server (missing ' +
          'GEMINI_API_KEY). Set it in the backend .env and restart.',
        reason: 'no_api_key',
      });
    }

    // 4. Hand off to the provider. It always returns a structured
    //    envelope; parse failures / timeouts are still useful to
    //    surface to the admin so they know the AI ran but could
    //    not produce a usable proposal.
    const config = {
      university: batch.university,
      department: batch.department,
      semester: batch.semester,
    };
    let aiResult;
    try {
      aiResult = await parseEditRequest({
        schedule: scheduleRows,
        config,
        prompt,
      });
    } catch (_aiErr) {
      // Defensive — parseEditRequest should never throw, but if it
      // does we surface 502 rather than 500.
      return res.status(502).json({
        success: false,
        code: 'AI_INVALID_RESPONSE',
        message: 'The AI provider raised an unexpected error. Try again.',
      });
    }

    if (!aiResult.available) {
      return res.status(503).json({
        success: false,
        code: 'AI_UNAVAILABLE',
        message: 'AI provider is not reachable right now.',
        reason: aiResult.reason || 'unknown',
      });
    }
    // available=true with no proposal: distinguish transport-level
    // problems (timeout / network — transient → 503) from parse-level
    // problems (invalid_json — permanent for this request → 502).
    if (!aiResult.proposal) {
      const transient = ['timeout', 'call_failed', 'http_error',
        'http_500', 'http_502', 'http_503', 'http_504', 'empty_response'];
      if (transient.includes(aiResult.reason)) {
        return res.status(503).json({
          success: false,
          code: 'AI_UNAVAILABLE',
          message: 'AI provider is not reachable right now. Try again.',
          reason: aiResult.reason,
        });
      }
      return res.status(502).json({
        success: false,
        code: 'AI_INVALID_RESPONSE',
        message:
          'The AI returned a response we could not parse as a ' +
          'structured edit proposal. Try rewording your request.',
        reason: aiResult.reason || 'invalid_json',
      });
    }

    return res.status(200).json({
      success: true,
      code: 'EDIT_PROPOSED',
      batch_id: batchId,
      prompt,
      proposal: aiResult.proposal,
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;