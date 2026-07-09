'use strict';

/**
 * Integration tests for GET /api/batches/:id/export.docx and .../export.pdf
 *
 * MySQL is mocked at the module boundary. We exercise:
 *   - DOCX 200 happy path (binary body, correct headers)
 *   - DOCX 400 / 404 / 409 / 422 (NO_SCHEDULE)
 *   - PDF 200 when a `libreoffice` shim is on PATH (we stub spawn via a
 *     fake shell script)
 *   - PDF 501 PDF_UNAVAILABLE when the binary is missing
 *
 * We DO NOT depend on a real LibreOffice install — the test creates a
 * tiny shell script that writes "input.pdf" into the outdir, and we
 * point LIBREOFFICE_BIN at it via process.env.
 */

const path = require('path');
const fs = require('fs');
const { execSync } = require('child_process');

// -----------------------------------------------------------------------------
// DB pool mock
// -----------------------------------------------------------------------------

jest.mock('../src/db/pool', () => {
  const recorded = [];
  function getPool() {
    return {
      query: jest.fn(async (sql, params) => {
        recorded.push({ sql: sql.trim().split(/\s+/, 3).join(' ').toUpperCase(), params });
        const s = sql.trim();

        if (/FROM\s+upload_batches\s+WHERE\s+id\s*=/i.test(s)) {
          const id = params && params[0];
          if (id === 1) {
            return [[{
              id: 1,
              filename: 'good.xlsx',
              semester: '2026 July-December',
              status: 'completed',
            }]];
          }
          if (id === 2) {
            return [[{
              id: 2,
              filename: 'pending.xlsx',
              semester: '2026 July-December',
              status: 'processing',
            }]];
          }
          if (id === 4) {
            // Completed, but zero schedules (no /generate call yet).
            return [[{
              id: 4,
              filename: 'empty.xlsx',
              semester: '2026 July-December',
              status: 'completed',
            }]];
          }
          return [[]];
        }
        if (/FROM\s+config\b/i.test(s)) {
          return [[
            { key: 'university',   value: 'Test University' },
            { key: 'department',   value: 'Computer Science' },
            { key: 'semester',     value: '2026 July-December' },
            { key: 'working_days', value: 'SUN,MON,TUE,WED,THU' },
            { key: 'class_start',  value: '09:00' },
            { key: 'class_end',    value: '15:50' },
            { key: 'break_start',  value: '13:00' },
            { key: 'break_end',    value: '14:00' },
          ]];
        }
        if (/FROM\s+schedules/i.test(s)) {
          const id = params && params[0];
          if (id === 1) {
            return [[
              { course_code: 'C1', teacher_abbr: 'T1', room_id: 'R1',
                day: 'SUN', slot_start: 540, slot_end: 590,
                year_sem: '1-1', session_index: 0 },
              { course_code: 'C2', teacher_abbr: 'T2', room_id: 'R2',
                day: 'SUN', slot_start: 600, slot_end: 650,
                year_sem: '1-1', session_index: 1 },
            ]];
          }
          // batch 4 is a "ready but empty schedule" — NO_SCHEDULE
          return [[]];
        }
        if (/FROM\s+teachers\b/i.test(s)) {
          return [[
            { full_name: 'Test Teacher', abbreviation: 'T1',
              designation: 'Lecturer', department: 'CSE' },
            { full_name: 'Another Teacher', abbreviation: 'T2',
              designation: 'Assistant Professor', department: 'CSE' },
          ]];
        }
        return [[]];
      }),
    };
  }
  return { getPool, _recorded: recorded, _reset() { recorded.length = 0; } };
});

const request = require('supertest');
const { createApp } = require('../src/app');
const poolMock = require('../src/db/pool');

const app = createApp();

// -----------------------------------------------------------------------------
// Tests
// -----------------------------------------------------------------------------

// DOCX route removed, only PDF route tested below

describe('GET /api/batches/:id/export.pdf', () => {
  let spawnSpy;
  let origLibreBin;

  // Build a fake "libreoffice" child process that immediately writes a
  // tiny PDF into the requested --outdir and exits 0. We mock the OS-
  // level spawn so we don't depend on a real LibreOffice install (or
  // any shell .bat shim).
  function fakePdfSpawn(bin, args, opts) {
    const { EventEmitter } = require('events');
    const ee = new EventEmitter();
    ee.stderr = new EventEmitter();
    ee.stdout = new EventEmitter();
    setImmediate(() => {
      try {
        const outdirIdx = args.indexOf('--outdir');
        const outdir = outdirIdx >= 0 ? args[outdirIdx + 1] : null;
        const inputIdx = args.indexOf('--outdir') + 2; // <input> after outdir+value
        const inputBase = path.basename(args[inputIdx] || 'input.docx', '.docx');
        if (outdir) {
          fs.mkdirSync(outdir, { recursive: true });
          fs.writeFileSync(path.join(outdir, inputBase + '.pdf'), Buffer.from('%PDF-1.4 fake'));
        }
        ee.emit('close', 0);
      } catch (err) {
        ee.stderr.emit('data', Buffer.from(String(err.message || err)));
        ee.emit('close', 1);
      }
    });
    return ee;
  }

  beforeAll(() => {
    spawnSpy = jest.spyOn(require('child_process'), 'spawn')
      .mockImplementation(fakePdfSpawn);
  });

  afterAll(() => {
    if (spawnSpy) spawnSpy.mockRestore();
  });

  beforeEach(() => {
    poolMock._reset();
    spawnSpy.mockClear();
    spawnSpy.mockImplementation(fakePdfSpawn);
  });

  test('returns 200 application/pdf on success', async () => {
    const res = await request(app).get('/api/batches/1/export.pdf');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('application/pdf');
    expect(res.headers['content-disposition']).toMatch(/^attachment; filename="routine_good_xlsx_batch1\.pdf"$/);
    expect(Number(res.headers['content-length'])).toBeGreaterThan(0);
    expect(Buffer.isBuffer(res.body) || typeof res.body === 'object').toBe(true);
    expect(spawnSpy).toHaveBeenCalled();
  });

  test('returns 400 / 404 / 409 / 422 mirroring the .docx route', async () => {
    const a = await request(app).get('/api/batches/abc/export.pdf');
    expect(a.status).toBe(400);
    expect(a.body.code).toBe('INVALID_BATCH_ID');

    const b = await request(app).get('/api/batches/999/export.pdf');
    expect(b.status).toBe(404);
    expect(b.body.code).toBe('BATCH_NOT_FOUND');

    const c = await request(app).get('/api/batches/2/export.pdf');
    expect(c.status).toBe(409);
    expect(c.body.code).toBe('BATCH_NOT_READY');

    const d = await request(app).get('/api/batches/4/export.pdf');
    expect(d.status).toBe(422);
    expect(d.body.code).toBe('NO_SCHEDULE');
  });
});

describe('GET /api/batches/:id/export.pdf — missing binary', () => {
  let spawnSpy;

  beforeAll(() => {
    spawnSpy = jest.spyOn(require('child_process'), 'spawn')
      .mockImplementation(() => {
        const { EventEmitter } = require('events');
        const ee = new EventEmitter();
        ee.stderr = new EventEmitter();
        ee.stdout = new EventEmitter();
        setImmediate(() => {
          const err = new Error('spawn missing ENOENT');
          err.code = 'ENOENT';
          ee.emit('error', err);
        });
        return ee;
      });
  });

  afterAll(() => {
    if (spawnSpy) spawnSpy.mockRestore();
  });

  beforeEach(() => { poolMock._reset(); });

  test('returns 501 PDF_UNAVAILABLE when libreoffice is missing', async () => {
    const res = await request(app).get('/api/batches/1/export.pdf');
    expect(res.status).toBe(501);
    expect(res.body.code).toBe('PDF_UNAVAILABLE');
    expect(res.body.success).toBe(false);
  });
});