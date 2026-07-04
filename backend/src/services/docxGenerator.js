'use strict';

/**
 * docxGenerator.js — build the routine grid as a .docx (Word) document.
 *
 * Per build prompt §3.5:
 *   - rows = working_days; columns = union of distinct slot_start values
 *     actually used in `schedules` for this batch
 *   - day rows + year-sem sub-rows + a merged "BREAK" column
 *   - 3-row university header (university / department / semester)
 *   - teacher legend table below
 *
 * Mirrors the React `RoutineGrid` component so the printed page is
 * visually identical to the on-screen version.
 *
 * The docx package (https://docx.js.org) lets us build the document
 * programmatically — no .docx template binary is required, which keeps
 * the test suite hermetic and avoids fragile template dependencies.
 */

const {
  Document,
  Packer,
  Paragraph,
  TextRun,
  Table,
  TableRow,
  TableCell,
  WidthType,
  AlignmentType,
  BorderStyle,
  ShadingType,
  PageOrientation,
} = require('docx');

// ---------------------------------------------------------------------------
// Time helpers
// ---------------------------------------------------------------------------

/** Convert "HH:MM" or numeric minutes-since-midnight to "H:MMam/pm". */
function fmtTime(t) {
  let m;
  if (typeof t === 'string') {
    const parts = t.split(':');
    if (parts.length < 2) return t;
    m = parseInt(parts[0], 10) * 60 + parseInt(parts[1], 10);
  } else if (typeof t === 'number') {
    m = t;
  } else {
    return String(t);
  }
  const h24 = Math.floor(m / 60);
  const mins = m % 60;
  const ampm = h24 >= 12 ? 'pm' : 'am';
  let h12 = h24 % 12;
  if (h12 === 0) h12 = 12;
  return `${h12}:${String(mins).padStart(2, '0')}${ampm}`;
}

/** "9:00am-9:50am" */
function fmtRange(start, end) {
  return `${fmtTime(start)}-${fmtTime(end)}`;
}

/** Parse "HH:MM" to minutes-since-midnight. */
function hhmmToMin(t) {
  if (typeof t === 'number') return t;
  const parts = String(t).split(':');
  return parseInt(parts[0], 10) * 60 + parseInt(parts[1], 10);
}

// ---------------------------------------------------------------------------
// Layout constants
// ---------------------------------------------------------------------------

/** Day order matches the photo reference (SUN-THU). */
const DEFAULT_DAYS = ['SUN', 'MON', 'TUE', 'WED', 'THU'];

/** Year-sem display order — matches the photo: 4-1, 3-2, 2-2, 2-1, 1-1. */
const DEFAULT_YEAR_SEM_ORDER = ['4-1', '3-2', '2-2', '2-1', '1-1'];

// ---------------------------------------------------------------------------
// Shape derivation
// ---------------------------------------------------------------------------

/**
 * Group an assignment row by (day, slot_start) to a single cell payload
 * with up to 2 entries (lab sessions that span 2 slots) — though in
 * practice `slot_start`/`slot_end` is one slot so each row produces a
 * single cell.
 */
function indexAssignments(assignments) {
  const byKey = new Map(); // "DAY|MIN_START" -> [{course, teacher, room}, ...]
  for (const a of assignments) {
    const key = `${a.day}|${a.slot_start}`;
    if (!byKey.has(key)) byKey.set(key, []);
    byKey.get(key).push(a);
  }
  return byKey;
}

/**
 * Collect the union of distinct slot_start values across all assignments,
 * sorted ascending. These are the column headers.
 */
function collectSlotColumns(assignments) {
  const set = new Set();
  for (const a of assignments) set.add(a.slot_start);
  return Array.from(set).sort((a, b) => a - b);
}

/**
 * Compute slot labels "9:00am-9:50am" by pairing each slot_start with the
 * matching slot_end. If a slot_start has no paired slot_end, fall back
 * to a 50-minute window.
 */
function collectSlotLabels(assignments) {
  const pairs = new Map(); // start -> end
  for (const a of assignments) {
    if (a.slot_start != null && a.slot_end != null) {
      pairs.set(a.slot_start, a.slot_end);
    }
  }
  const starts = collectSlotColumns(assignments);
  return starts.map((s) => {
    const e = pairs.get(s);
    return {
      start: s,
      end: e != null ? e : s + 50,
      label: fmtRange(s, e != null ? e : s + 50),
    };
  });
}

/**
 * Find the year-sem in fixed display order intersected with actually-used
 * year-sems. Defensive append for any off-order year-sem at the end.
 */
function deriveYearSemOrder(assignments) {
  const present = new Set(assignments.map((a) => a.year_sem));
  const ordered = DEFAULT_YEAR_SEM_ORDER.filter((ys) => present.has(ys));
  for (const ys of present) {
    if (!ordered.includes(ys)) ordered.push(ys);
  }
  return ordered;
}

/**
 * Locate the BREAK boundary. We define it as the largest gap (>= 30
 * minutes) between consecutive used slots. If no qualifying gap is
 * found we fall back to the configured break_start. If we still have
 * nothing we assume there is no break in this document.
 *
 * Returns the minute mark of the start of the AFTERNOON section
 * (i.e., the first slot after the break). This way, `slot.start < X`
 * cleanly partitions the schedule into morning / afternoon halves.
 */
function findBreakStart(assignments, config) {
  // Build a slot-start -> slot-end map so we can measure slot widths.
  const endOf = new Map();
  for (const a of assignments) {
    if (a.slot_start != null && a.slot_end != null) {
      endOf.set(a.slot_start, a.slot_end);
    }
  }
  const slots = collectSlotColumns(assignments);
  if (slots.length >= 2) {
    let bestGap = 30 - 1; // strictly > this => gap >= 30min
    let bestStart = null;
    for (let i = 0; i < slots.length - 1; i++) {
      const thisEnd = endOf.get(slots[i]) != null ? endOf.get(slots[i]) : slots[i] + 50;
      const gap = slots[i + 1] - thisEnd;
      if (gap > bestGap) {
        bestGap = gap;
        // Afternoon begins at the start of the first slot after the gap.
        bestStart = slots[i + 1];
      }
    }
    if (bestStart != null) return bestStart;
  }
  if (config && config.break_start) {
    const m = hhmmToMin(config.break_start);
    return m;
  }
  return null;
}

/**
 * Build the cell text "CSE101\nABBR\nR101" for a single assignment.
 */
function cellLinesFor(a) {
  const course = String(a.course_code || '').trim();
  const teacher = String(a.teacher_abbr || '').trim();
  const room = String(a.room_id || '').trim();
  return [course, teacher, room].filter(Boolean);
}

/** Render the cell paragraphs (one per line) with bold course / room. */
function buildCellParagraphs(lines, opts = {}) {
  const { boldCourse = true, center = true } = opts;
  return lines.map((line, i) => new Paragraph({
    alignment: center ? AlignmentType.CENTER : AlignmentType.LEFT,
    spacing: { before: 0, after: 0, line: 220 },
    children: [
      new TextRun({
        text: line,
        bold: i === 0 && boldCourse,
        size: 18, // 9pt — matches the small dense look of the reference
      }),
    ],
  }));
}

/** Empty cell placeholder. */
function emptyCellParagraphs() {
  return [new Paragraph({
    alignment: AlignmentType.CENTER,
    children: [new TextRun({ text: '—', size: 18, color: '999999' })],
  })];
}

// ---------------------------------------------------------------------------
// Table cells
// ---------------------------------------------------------------------------

/** A bordered, lightly-shaded cell holding an array of paragraphs. */
function makeCell({
  paragraphs = [],
  fill = null,
  widthPct = null,
  vMerge = null,
  gridSpan = null,
  textDirection = null,
  verticalAlign = 'center',
} = {}) {
  const cellOptions = {
    children: paragraphs,
    verticalAlign,
  };
  if (fill) {
    cellOptions.shading = {
      type: ShadingType.SOLID,
      color: 'auto',
      fill,
    };
  }
  if (widthPct != null) {
    cellOptions.width = { size: widthPct, type: WidthType.PERCENTAGE };
  }
  if (vMerge) cellOptions.vMerge = vMerge;
  if (gridSpan) cellOptions.columnSpan = gridSpan;
  if (textDirection) {
    // The docx package accepts a `textDirection` option on TableCell.
    // For a vertical BREAK label we use 'tbRl' (top-to-bottom, right-to-left).
    cellOptions.textDirection = textDirection;
  }
  return new TableCell(cellOptions);
}

const BORDER_STYLE = {
  style: BorderStyle.SINGLE,
  size: 4, // 0.5pt
  color: '333333',
};
const cellBorders = {
  top: BORDER_STYLE,
  bottom: BORDER_STYLE,
  left: BORDER_STYLE,
  right: BORDER_STYLE,
};

/** Apply standard borders to a TableCell in place. */
function withBorders(cell) {
  // TableCell in docx 9.x exposes borders on the options object.
  cell.options.borders = cellBorders;
  return cell;
}

// ---------------------------------------------------------------------------
// Header (3-row university block)
// ---------------------------------------------------------------------------

function buildHeaderBlock(header) {
  const rows = [];
  rows.push(
    new TableRow({
      children: [withBorders(new TableCell({
        children: [new Paragraph({
          alignment: AlignmentType.CENTER,
          children: [new TextRun({
            text: header.university || '',
            bold: true,
            size: 32, // 16pt
            color: 'FFFFFF',
          })],
        })],
        shading: { type: ShadingType.SOLID, color: 'auto', fill: '1E3A8A' },
        columnSpan: 1, // overridden by caller via gridSpan
      }))],
    })
  );
  // Two empty placeholder rows are not needed — we return 3 rows that
  // the caller wraps in a separate 1-col table for visual weight.
  return rows;
}

/**
 * Top-of-document table: 3 stacked rows (university / department /
 * semester), each spanning the full width.
 */
function buildUniversityHeaderTable(header) {
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: [
      new TableRow({
        children: [withBorders(new TableCell({
          width: { size: 100, type: WidthType.PERCENTAGE },
          shading: { type: ShadingType.SOLID, color: 'auto', fill: '1E3A8A' },
          children: [new Paragraph({
            alignment: AlignmentType.CENTER,
            spacing: { before: 80, after: 80 },
            children: [new TextRun({
              text: header.university || 'University',
              bold: true,
              size: 32,
              color: 'FFFFFF',
            })],
          })],
        }))],
      }),
      new TableRow({
        children: [withBorders(new TableCell({
          width: { size: 100, type: WidthType.PERCENTAGE },
          shading: { type: ShadingType.SOLID, color: 'auto', fill: '1E40AF' },
          children: [new Paragraph({
            alignment: AlignmentType.CENTER,
            spacing: { before: 60, after: 60 },
            children: [new TextRun({
              text: header.department || 'Department',
              bold: true,
              size: 26,
              color: 'FFFFFF',
            })],
          })],
        }))],
      }),
      new TableRow({
        children: [withBorders(new TableCell({
          width: { size: 100, type: WidthType.PERCENTAGE },
          shading: { type: ShadingType.SOLID, color: 'auto', fill: '2563EB' },
          children: [new Paragraph({
            alignment: AlignmentType.CENTER,
            spacing: { before: 60, after: 60 },
            children: [new TextRun({
              text: header.semester
                ? `Class Routine — ${header.semester}`
                : 'Class Routine',
              italics: true,
              size: 24,
              color: 'FFFFFF',
            })],
          })],
        }))],
      }),
    ],
  });
}

// ---------------------------------------------------------------------------
// Routine grid table
// ---------------------------------------------------------------------------

/**
 * Build the big grid table.
 *
 * Columns:
 *   [Day] [Year-Sem] [slot 1] [slot 2] ... [BREAK] ... [slot N]
 *
 * Header rows:
 *   row 1: empty | empty | morning-slot-1 | ... | morning-slot-K | BREAK | afternoon-slot-1 | ... | afternoon-slot-N
 *   row 2: "Day" | "Year-Sem" | (merged with row 1)
 *
 * For each day, the day label + N year-sem sub-rows are emitted.
 */
function buildRoutineTable({ assignments, config, days }) {
  const slotCols = collectSlotLabels(assignments);
  const breakStart = findBreakStart(assignments, config);
  const yearSemOrder = deriveYearSemOrder(assignments);

  // Partition slot columns into morning / afternoon by the break start.
  let morningEndIdx = slotCols.length;
  if (breakStart != null) {
    morningEndIdx = slotCols.findIndex((s) => s.start >= breakStart);
    if (morningEndIdx < 0) morningEndIdx = slotCols.length;
  }
  const morningCols = slotCols.slice(0, morningEndIdx);
  const afternoonCols = slotCols.slice(morningEndIdx);
  const hasBreak = morningCols.length > 0 && afternoonCols.length > 0;

  // Total column count:
  //   1 (Day) + 1 (Year-Sem) + morningCols + (1 if hasBreak else 0) + afternoonCols
  const totalCols = 2 + morningCols.length + (hasBreak ? 1 : 0) + afternoonCols.length;
  const gridIndex = indexAssignments(assignments);

  const rows = [];

  // --- header row 1: slot labels (across) ---
  const headerRow1Cells = [];
  headerRow1Cells.push(withBorders(new TableCell({
    width: { size: 8, type: WidthType.PERCENTAGE },
    shading: { type: ShadingType.SOLID, color: 'auto', fill: '1E3A8A' },
    verticalAlign: 'center',
    rowSpan: 2,
    children: [new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [new TextRun({ text: 'Day', bold: true, color: 'FFFFFF', size: 22 })],
    })],
  })));
  headerRow1Cells.push(withBorders(new TableCell({
    width: { size: 7, type: WidthType.PERCENTAGE },
    shading: { type: ShadingType.SOLID, color: 'auto', fill: '1E3A8A' },
    verticalAlign: 'center',
    rowSpan: 2,
    children: [new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [new TextRun({ text: 'Yr-Sm', bold: true, color: 'FFFFFF', size: 22 })],
    })],
  })));
  for (const s of morningCols) {
    headerRow1Cells.push(withBorders(new TableCell({
      width: { size: 6, type: WidthType.PERCENTAGE },
      shading: { type: ShadingType.SOLID, color: 'auto', fill: '1E40AF' },
      children: [new Paragraph({
        alignment: AlignmentType.CENTER,
        children: [new TextRun({ text: s.label, bold: true, color: 'FFFFFF', size: 18 })],
      })],
    })));
  }
  if (hasBreak) {
    headerRow1Cells.push(withBorders(new TableCell({
      width: { size: 4, type: WidthType.PERCENTAGE },
      shading: { type: ShadingType.SOLID, color: 'auto', fill: '991B1B' },
      rowSpan: 2,
      textDirection: 'tbRl',
      verticalAlign: 'center',
      children: [new Paragraph({
        alignment: AlignmentType.CENTER,
        children: [new TextRun({ text: 'BREAK', bold: true, color: 'FFFFFF', size: 22 })],
      })],
    })));
  }
  for (const s of afternoonCols) {
    headerRow1Cells.push(withBorders(new TableCell({
      width: { size: 6, type: WidthType.PERCENTAGE },
      shading: { type: ShadingType.SOLID, color: 'auto', fill: '1E40AF' },
      children: [new Paragraph({
        alignment: AlignmentType.CENTER,
        children: [new TextRun({ text: s.label, bold: true, color: 'FFFFFF', size: 18 })],
      })],
    })));
  }
  rows.push(new TableRow({
    tableHeader: true,
    children: headerRow1Cells,
  }));

  // --- header row 2: only present when there's no rowSpan on the slot
  //     cells (we kept them as a single row, so this is empty). docx
  //     requires every row to have exactly totalCols cells though, so
  //     emit a hidden spacer row with empty cells.
  const spacerCells = [];
  // Day + Yr-Sm cells are absorbed by rowSpan=2 above, so this row
  // contains only the slot cells. We also need to honor BREAK rowSpan.
  // The cleanest pattern is: build this row with the same per-column
  // entries minus the day/year-sem cells, and set vMerge: continue
  // for the BREAK column (already handled). For slot cells we use
  // vMerge: continue on every column after the first 2.
  // Day + Yr-Sm: rowSpan already covers both header rows.
  for (let c = 0; c < totalCols - 2; c++) {
    spacerCells.push(withBorders(new TableCell({
      vMerge: 'continue',
      shading: { type: ShadingType.SOLID, color: 'auto', fill: '1E40AF' },
      children: [new Paragraph({ children: [new TextRun({ text: '' })] })],
    })));
  }
  // Only push the spacer row if we have at least 1 slot cell; if not,
  // docx will complain about column count.
  if (totalCols - 2 > 0) {
    rows.push(new TableRow({
      tableHeader: true,
      children: spacerCells,
    }));
  }

  // --- body rows: one block per day ---
  for (const day of days) {
    if (yearSemOrder.length === 0) {
      // No year-sem at all — emit a single empty row per day.
      const cells = [];
      cells.push(withBorders(new TableCell({
        width: { size: 8, type: WidthType.PERCENTAGE },
        shading: { type: ShadingType.SOLID, color: 'auto', fill: 'F1F5F9' },
        rowSpan: 1,
        children: [new Paragraph({
          alignment: AlignmentType.CENTER,
          children: [new TextRun({ text: day, bold: true, size: 22 })],
        })],
      })));
      cells.push(withBorders(new TableCell({
        width: { size: 7, type: WidthType.PERCENTAGE },
        children: emptyCellParagraphs(),
      })));
      for (let c = 0; c < totalCols - 2; c++) {
        cells.push(withBorders(new TableCell({ children: emptyCellParagraphs() })));
      }
      rows.push(new TableRow({ children: cells }));
      continue;
    }
    const blockSize = yearSemOrder.length;
    yearSemOrder.forEach((ys, ysIdx) => {
      const cells = [];
      // Day cell — only the first year-sem of the block carries it.
      if (ysIdx === 0) {
        cells.push(withBorders(new TableCell({
          width: { size: 8, type: WidthType.PERCENTAGE },
          shading: { type: ShadingType.SOLID, color: 'auto', fill: 'F1F5F9' },
          rowSpan: blockSize,
          verticalAlign: 'center',
          children: [new Paragraph({
            alignment: AlignmentType.CENTER,
            children: [new TextRun({ text: day, bold: true, size: 22 })],
          })],
        })));
      }
      // Year-sem cell.
      cells.push(withBorders(new TableCell({
        width: { size: 7, type: WidthType.PERCENTAGE },
        shading: { type: ShadingType.SOLID, color: 'auto', fill: 'F8FAFC' },
        children: [new Paragraph({
          alignment: AlignmentType.CENTER,
          children: [new TextRun({ text: ys, bold: true, size: 18 })],
        })],
      })));
      // Morning slot cells.
      for (const s of morningCols) {
        const items = gridIndex.get(`${day}|${s.start}`) || [];
        const match = items.find((it) => it.year_sem === ys);
        if (match) {
          cells.push(withBorders(new TableCell({
            children: buildCellParagraphs(cellLinesFor(match)),
          })));
        } else {
          cells.push(withBorders(new TableCell({
            children: emptyCellParagraphs(),
          })));
        }
      }
      // BREAK cell (vertical, spans all 6 year-sem sub-rows per day).
      if (hasBreak) {
        if (ysIdx === 0) {
          cells.push(withBorders(new TableCell({
            width: { size: 4, type: WidthType.PERCENTAGE },
            shading: { type: ShadingType.SOLID, color: 'auto', fill: 'FEE2E2' },
            rowSpan: blockSize,
            textDirection: 'tbRl',
            verticalAlign: 'center',
            children: [new Paragraph({
              alignment: AlignmentType.CENTER,
              children: [new TextRun({ text: 'BREAK', bold: true, color: '991B1B', size: 20 })],
            })],
          })));
        }
      }
      // Afternoon slot cells.
      for (const s of afternoonCols) {
        const items = gridIndex.get(`${day}|${s.start}`) || [];
        const match = items.find((it) => it.year_sem === ys);
        if (match) {
          cells.push(withBorders(new TableCell({
            children: buildCellParagraphs(cellLinesFor(match)),
          })));
        } else {
          cells.push(withBorders(new TableCell({
            children: emptyCellParagraphs(),
          })));
        }
      }
      rows.push(new TableRow({ children: cells }));
    });
  }

  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows,
  });
}

// ---------------------------------------------------------------------------
// Teacher legend
// ---------------------------------------------------------------------------

function buildTeacherLegendTable(teachers) {
  if (!Array.isArray(teachers) || teachers.length === 0) return null;
  const sorted = [...teachers].sort((a, b) =>
    String(a.abbreviation || '').localeCompare(String(b.abbreviation || ''))
  );
  const headerCell = (text, widthPct) => withBorders(new TableCell({
    width: { size: widthPct, type: WidthType.PERCENTAGE },
    shading: { type: ShadingType.SOLID, color: 'auto', fill: '1E3A8A' },
    children: [new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [new TextRun({ text, bold: true, color: 'FFFFFF', size: 20 })],
    })],
  }));
  const rows = [
    new TableRow({
      tableHeader: true,
      children: [
        headerCell('Abbr', 12),
        headerCell('Full Name', 38),
        headerCell('Designation', 30),
        headerCell('Department', 20),
      ],
    }),
  ];
  sorted.forEach((t, i) => {
    const fill = i % 2 === 0 ? 'FFFFFF' : 'F1F5F9';
    const cell = (text, bold) => withBorders(new TableCell({
      shading: { type: ShadingType.SOLID, color: 'auto', fill },
      children: [new Paragraph({
        children: [new TextRun({ text: String(text || ''), bold, size: 18 })],
      })],
    }));
    rows.push(new TableRow({
      children: [
        cell(t.abbreviation, true),
        cell(t.full_name, false),
        cell(t.designation, false),
        cell(t.department, false),
      ],
    }));
  });
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows,
  });
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Render a routine as a Word document Buffer.
 *
 * @param {Object} input
 * @param {Array}  input.assignments — schedule rows from /api/batches/:id/schedule
 * @param {Object} input.header      — { university, department, semester }
 * @param {Array}  input.teachers    — [{ full_name, abbreviation, designation, department }]
 * @param {Object} [input.config]    — { working_days, class_start, class_end, break_start, break_end }
 * @param {Array}  [input.days]      — override day order (default: SUN-THU)
 * @returns {Promise<Buffer>}
 */
async function generateRoutineDocx(input) {
  const {
    assignments = [],
    header = {},
    teachers = [],
    config = {},
    days = DEFAULT_DAYS,
  } = input || {};

  const sections = [];

  // 1. University header block.
  sections.push(buildUniversityHeaderTable(header));

  // 2. Spacer.
  sections.push(new Paragraph({
    spacing: { before: 200, after: 100 },
    children: [],
  }));

  // 3. The routine grid (or an empty-state notice if no assignments).
  if (assignments.length === 0) {
    sections.push(new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { before: 200, after: 200 },
      children: [new TextRun({
        text: 'No schedule has been generated for this batch yet.',
        italics: true,
        size: 24,
        color: '6B7280',
      })],
    }));
  } else {
    sections.push(buildRoutineTable({ assignments, config, days }));
  }

  // 4. Spacer.
  sections.push(new Paragraph({
    spacing: { before: 200, after: 100 },
    children: [],
  }));

  // 5. Teacher legend.
  const legend = buildTeacherLegendTable(teachers);
  if (legend) {
    sections.push(new Paragraph({
      spacing: { before: 100, after: 100 },
      children: [new TextRun({ text: 'Teacher Legend', bold: true, size: 24 })],
    }));
    sections.push(legend);
  }

  const doc = new Document({
    creator: 'UniRoutine',
    title: 'Class Routine',
    description: 'Generated routine export',
    styles: {
      default: {
        document: { run: { font: 'Calibri' } },
      },
    },
    sections: [{
      properties: {
        page: {
          size: { orientation: PageOrientation.LANDSCAPE },
          margin: { top: 720, right: 720, bottom: 720, left: 720 },
        },
      },
      children: sections,
    }],
  });

  // docx 9.x: Packer.toBuffer returns a Node Buffer.
  const buffer = await Packer.toBuffer(doc);
  return buffer;
}

module.exports = {
  generateRoutineDocx,
  // exported for tests
  _internal: {
    fmtTime,
    fmtRange,
    hhmmToMin,
    collectSlotColumns,
    collectSlotLabels,
    deriveYearSemOrder,
    findBreakStart,
    cellLinesFor,
  },
  DEFAULT_DAYS,
  DEFAULT_YEAR_SEM_ORDER,
};
