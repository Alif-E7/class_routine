'use strict';

/**
 * export.js — GET /api/batches/:id/export.docx and .../export.pdf
 *
 * Per build prompt §3.5:
 *   - Build a Word document (.docx) with the routine grid + teacher
 *     legend via the docxGenerator service.
 *   - For PDF, convert the generated .docx with libreoffice
 *     (`libreoffice --headless --convert-to pdf`) when available.
 *
 * Both routes:
 *   - 400 INVALID_BATCH_ID  (non-numeric / zero / negative)
 *   - 404 BATCH_NOT_FOUND   (no upload batch with that id)
 *   - 409 BATCH_NOT_READY   (status != 'completed')
 *   - 422 NO_SCHEDULE       (batch is ready but has no /api/batches/:id/schedule rows yet)
 *   - 200 application/octet-stream (or the right MIME) with body
 *
 * PDF route additionally returns:
 *   - 501 PDF_UNAVAILABLE   (libreoffice missing on this host — clearly
 *     documented in README §"PDF export")
 */

const express = require('express');
const path = require('path');
const os = require('os');
const fs = require('fs');
const fsp = require('fs/promises');
const childProcess = require('child_process');

const { getPool } = require('../db/pool');
const { generateRoutineDocx } = require('../services/docxGenerator');
const { normalizeSlotValue } = require('../services/scheduler');

const router = express.Router({ mergeParams: true });

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function parseBatchId(raw) {
  const id = Number.parseInt(raw, 10);
  if (!Number.isInteger(id) || id <= 0) return null;
  return id;
}

/**
 * Load the data we need to render the document. We resolve:
 *   - batch (filename, semester, status)
 *   - config rows (university, department, semester, working_days, etc.)
 *   - assignments rows
 *   - teachers rows (for the legend)
 */
async function loadExportData(batchId) {
  const pool = getPool();

  const [[batchRow]] = await pool.query(
    `SELECT id, filename, semester, status FROM upload_batches WHERE id = ?`,
    [batchId]
  );
  if (!batchRow) {
    return { error: { code: 'BATCH_NOT_FOUND', message: `No upload batch with id ${batchId}`, status: 404 } };
  }
  if (batchRow.status !== 'completed') {
    return {
      error: {
        code: 'BATCH_NOT_READY',
        message: `Batch ${batchId} is in status "${batchRow.status}" — only "completed" batches can be exported`,
        status: 409,
        extra: { status: batchRow.status },
      },
    };
  }

  const [configRows] = await pool.query(
    `SELECT \`key\`, \`value\` FROM config WHERE upload_batch_id = ?`,
    [batchId]
  );
  const config = {};
  for (const r of configRows) config[String(r.key).trim()] = r.value;

  const [assignmentRows] = await pool.query(
    `SELECT course_code, teacher_abbr, room_id, day,
            slot_start, slot_end, year_sem, session_index
     FROM schedules WHERE batch_id = ?
     ORDER BY year_sem, day, slot_start, course_code`,
    [batchId]
  );
  // Normalize DB TIME values back to integer minutes — docxGenerator's
  // indexAssignments collects `slot_start` as a Map key for cell lookups,
  // and the rest of the generator assumes numeric slot math.
  for (const r of assignmentRows) {
    r.slot_start = normalizeSlotValue(r.slot_start);
    r.slot_end = normalizeSlotValue(r.slot_end);
  }

  const [teacherRows] = await pool.query(
    `SELECT full_name, abbreviation, designation, department
     FROM teachers WHERE upload_batch_id = ?
     ORDER BY abbreviation`,
    [batchId]
  );

  return {
    batch: batchRow,
    config,
    assignments: assignmentRows,
    teachers: teacherRows,
  };
}

function sanitizeForFilename(s) {
  return String(s || 'routine').replace(/[^a-zA-Z0-9_-]+/g, '_').slice(0, 60);
}

function buildFilename(batch, ext) {
  return `routine_${sanitizeForFilename(batch.filename)}_batch${batch.id}.${ext}`;
}

// ---------------------------------------------------------------------------
// DOCX endpoint
// ---------------------------------------------------------------------------

router.get('/:id/export.docx', async (req, res, next) => {
  const batchId = parseBatchId(req.params.id);
  if (batchId == null) {
    return res.status(400).json({
      success: false,
      code: 'INVALID_BATCH_ID',
      message: 'batch id must be a positive integer',
    });
  }

  try {
    const loaded = await loadExportData(batchId);
    if (loaded.error) {
      return res.status(loaded.error.status).json({
        success: false,
        code: loaded.error.code,
        message: loaded.error.message,
        ...(loaded.error.extra || {}),
      });
    }

    if (loaded.assignments.length === 0) {
      return res.status(422).json({
        success: false,
        code: 'NO_SCHEDULE',
        message: 'This batch has no generated schedule. Call POST /api/batches/:id/generate first.',
      });
    }

    const days = String(loaded.config.working_days || 'SUN,MON,TUE,WED,THU')
      .split(',').map((s) => s.trim().toUpperCase()).filter(Boolean);

    const buffer = await generateRoutineDocx({
      assignments: loaded.assignments,
      header: {
        university: loaded.config.university || 'University',
        department: loaded.config.department || 'Department',
        semester: loaded.config.semester || loaded.batch.semester || '',
      },
      teachers: loaded.teachers,
      config: loaded.config,
      days,
    });

    const filename = buildFilename(loaded.batch, 'docx');
    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    );
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${filename}"`
    );
    res.setHeader('Content-Length', buffer.length);
    return res.status(200).send(buffer);
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// PDF endpoint
// ---------------------------------------------------------------------------

/**
 * Convert a .docx Buffer to a .pdf Buffer using LibreOffice in headless
 * mode. Returns { pdf } on success, or throws an Error with `.code =
 * 'PDF_UNAVAILABLE'` if LibreOffice is not installed (ENOENT) or fails.
 *
 * Implementation notes:
 *   - Writes the .docx to a temp directory, runs `libreoffice
 *     --headless --convert-to pdf --outdir <tmp> <file.docx>`, reads the
 *     produced PDF back.
 *   - The `--outdir` is a dedicated per-request subdir under the system
 *     tempdir so concurrent requests cannot stomp on each other.
 *   - We set `HOME` on Linux/macOS because LibreOffice creates a profile
 *     dir there. On Windows the OS user profile is used.
 */
function libreofficeToPdf(docxBuffer, tmpDir) {
  return new Promise((resolve, reject) => {
    const inFile = path.join(tmpDir, 'input.docx');
    fs.writeFileSync(inFile, docxBuffer);

    const env = { ...process.env };
    // Best-effort: redirect LibreOffice profile to our tmp dir so two
    // requests can't share the same profile and corrupt each other.
    env.HOME = tmpDir;
    if (process.platform === 'win32') {
      env.USERPROFILE = tmpDir;
      env.APPDATA = path.join(tmpDir, 'AppData', 'Roaming');
      env.LOCALAPPDATA = path.join(tmpDir, 'AppData', 'Local');
      try { fs.mkdirSync(env.APPDATA, { recursive: true }); } catch (_) {}
      try { fs.mkdirSync(env.LOCALAPPDATA, { recursive: true }); } catch (_) {}
    }

    const bin = process.env.LIBREOFFICE_BIN || 'libreoffice';
    const args = ['--headless', '--convert-to', 'pdf', '--outdir', tmpDir, inFile];

    // On Windows, .bat / .cmd files cannot be spawned directly with
    // Node's default argv spawn (libuv returns ENOENT). The simplest
    // reliable approach is `cmd.exe /d /s /c "<bat> <args...>"` with
    // `windowsVerbatimArguments: true`, which makes libuv pass the
    // command line through to cmd.exe without any extra quoting.
    let actualBin = bin;
    let actualArgs = args;
    if (process.platform === 'win32' && /\.(bat|cmd)$/i.test(bin)) {
      // .bat files cannot be spawned directly with Node's argv spawn.
      // We invoke cmd.exe with the bat path as the first quoted token
      // and pass the rest of the args normally. cmd.exe strips the
      // outer pair of quotes and forwards the rest to the script.
      actualBin = process.env.ComSpec || 'cmd.exe';
      const quoted = args.map((a) => (/[\s"]/.test(a) ? `"${String(a).replace(/"/g, '\\"')}"` : a));
      const cmdLine = `"${bin}" ${quoted.join(' ')}`;
      actualArgs = [cmdLine];
    }
    const child = childProcess.spawn(actualBin, actualArgs, { env });
    let stderr = '';
    child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
    child.on('error', (err) => {
      // ENOENT (or EACCES) — the binary isn't installed / runnable.
      reject(Object.assign(
        new Error(`LibreOffice not available: ${err.message}`),
        { code: 'PDF_UNAVAILABLE', cause: err }
      ));
    });
    child.on('close', (code) => {
      if (code !== 0) {
        return reject(Object.assign(
          new Error(`libreoffice exited with code ${code}: ${stderr.slice(0, 500)}`),
          { code: 'PDF_UNAVAILABLE', cause: stderr }
        ));
      }
      const outFile = path.join(tmpDir, 'input.pdf');
      try {
        const pdf = fs.readFileSync(outFile);
        resolve(pdf);
      } catch (err) {
        reject(Object.assign(
          new Error(`PDF not produced: ${err.message}`),
          { code: 'PDF_UNAVAILABLE', cause: err }
        ));
      }
    });
  });
}

router.get('/:id/export.pdf', async (req, res, next) => {
  const batchId = parseBatchId(req.params.id);
  if (batchId == null) {
    return res.status(400).json({
      success: false,
      code: 'INVALID_BATCH_ID',
      message: 'batch id must be a positive integer',
    });
  }

  let tmpDir = null;
  try {
    const loaded = await loadExportData(batchId);
    if (loaded.error) {
      return res.status(loaded.error.status).json({
        success: false,
        code: loaded.error.code,
        message: loaded.error.message,
        ...(loaded.error.extra || {}),
      });
    }

    if (loaded.assignments.length === 0) {
      return res.status(422).json({
        success: false,
        code: 'NO_SCHEDULE',
        message: 'This batch has no generated schedule. Call POST /api/batches/:id/generate first.',
      });
    }

    const days = String(loaded.config.working_days || 'SUN,MON,TUE,WED,THU')
      .split(',').map((s) => s.trim().toUpperCase()).filter(Boolean);

    const docxBuf = await generateRoutineDocx({
      assignments: loaded.assignments,
      header: {
        university: loaded.config.university || 'University',
        department: loaded.config.department || 'Department',
        semester: loaded.config.semester || loaded.batch.semester || '',
      },
      teachers: loaded.teachers,
      config: loaded.config,
      days,
    });

    tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'routine-export-'));
    const pdfBuf = await libreofficeToPdf(docxBuf, tmpDir);

    const filename = buildFilename(loaded.batch, 'pdf');
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${filename}"`
    );
    res.setHeader('Content-Length', pdfBuf.length);
    return res.status(200).send(pdfBuf);
  } catch (err) {
    if (err && err.code === 'PDF_UNAVAILABLE') {
      return res.status(501).json({
        success: false,
        code: 'PDF_UNAVAILABLE',
        message: 'PDF export requires LibreOffice on the server. Install it (or set LIBREOFFICE_BIN) and restart the backend.',
      });
    }
    next(err);
  } finally {
    if (tmpDir) {
      // Best-effort cleanup of the tmp directory.
      fsp.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
    }
  }
});

module.exports = router;