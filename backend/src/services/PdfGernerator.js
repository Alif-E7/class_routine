'use strict';

/**
 * PdfGernerator.js — build the routine grid as a Word document buffer for PDF conversion.
 *
 * Per build prompt §3.5:
 *   - rows = working_days; columns = union of distinct slot_start values
 *     actually used in `schedules` for this batch
 *   - day rows + year-sem sub-rows + a merged "BREAK" column
 *   - 3-row university header (university / department / semester)
 *   - teacher legend table below in side-by-side format
 *
 * Mirrors the React `RoutineGrid` component so the printed page is
 * visually identical to the on-screen version.
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
 * sorted ascending chronologically using hhmmToMin.
 */
function collectSlotColumns(assignments) {
  const set = new Set();
  for (const a of assignments) {
    if (a.slot_start != null) set.add(a.slot_start);
  }
  return Array.from(set).sort((a, b) => hhmmToMin(a) - hhmmToMin(b));
}

/**
 * Compute slot labels "9:00am-9:50am" by pairing each slot_start with the
 * matching slot_end.
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
 * year-sems.
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
 * Locate the BREAK boundary.
 */
function findBreakStart(assignments, config) {
  const endOf = new Map();
  for (const a of assignments) {
    if (a.slot_start != null && a.slot_end != null) {
      endOf.set(a.slot_start, a.slot_end);
    }
  }
  const slots = collectSlotColumns(assignments);
  if (slots.length >= 2) {
    let bestGap = 30 - 1;
    let bestStart = null;
    for (let i = 0; i < slots.length - 1; i++) {
      const thisEnd = endOf.get(slots[i]) != null ? endOf.get(slots[i]) : slots[i] + 50;
      const gap = hhmmToMin(slots[i + 1]) - hhmmToMin(thisEnd);
      if (gap > bestGap) {
        bestGap = gap;
        bestStart = slots[i + 1];
      }
    }
    if (bestStart != null) return hhmmToMin(bestStart);
  }
  if (config && config.break_start) {
    return hhmmToMin(config.break_start);
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
  
  const line1 = [course, teacher].filter(Boolean).join(', ');
  return [line1, room].filter(Boolean);
}

/** Render the cell paragraphs (one per line) with bold course. */
function buildCellParagraphs(lines, opts = {}) {
  const { boldCourse = true, center = true } = opts;
  return lines.map((line, i) => new Paragraph({
    alignment: center ? AlignmentType.CENTER : AlignmentType.LEFT,
    spacing: { before: 0, after: 0, line: 220 },
    children: [
      new TextRun({
        text: line,
        bold: i === 0 && boldCourse,
        size: 18, // 9pt
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

function withBorders(cell) {
  cell.options.borders = cellBorders;
  return cell;
}

// ---------------------------------------------------------------------------
// Header (3-row university block)
// ---------------------------------------------------------------------------

function buildUniversityHeaderTable(header) {
  const deptText = (header.department ? `Department of ${header.department}` : 'Department') +
    (header.semester ? ` (${header.semester})` : '');
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
              text: deptText,
              bold: true,
              size: 26,
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

function buildRoutineTable({ assignments, config, days }) {
  let slotCols;
  const toMin = (t) => {
    if (typeof t === 'number') return t;
    if (typeof t === 'string' && t.includes(':')) {
      const parts = t.split(':');
      return parseInt(parts[0], 10) * 60 + parseInt(parts[1], 10);
    }
    const parsed = parseInt(String(t), 10);
    return Number.isNaN(parsed) ? 0 : parsed;
  };

  const cs = config ? toMin(config.class_start) : NaN;
  const ce = config ? toMin(config.class_end) : NaN;
  let bs = config ? toMin(config.break_start) : NaN;
  let be = config ? toMin(config.break_end) : NaN;
  const d = 50;

  if (config && !Number.isNaN(cs) && !Number.isNaN(ce) && cs < ce) {
    if (Number.isNaN(bs) || Number.isNaN(be) || bs >= be || bs <= cs || be >= ce) {
      const bd = (be > bs) ? (be - bs) : 60;
      const totalMinutes = ce - cs;
      const N = Math.floor((totalMinutes - bd) / d);
      if (N > 0) {
        let morningSlotsCount = Math.ceil(N / 2);
        bs = cs + morningSlotsCount * d;
        be = bs + bd;
        while (be > ce && morningSlotsCount > 0) {
          morningSlotsCount--;
          bs = cs + morningSlotsCount * d;
          be = bs + bd;
        }
      } else {
        bs = Math.floor((cs + ce) / 2);
        be = bs;
      }
    }

    const temp = [];
    for (let t = cs; t + d <= bs; t += d) {
      temp.push({
        start: t,
        end: t + d,
        label: fmtRange(t, t + d),
      });
    }
    for (let t = be; t + d <= ce; t += d) {
      temp.push({
        start: t,
        end: t + d,
        label: fmtRange(t, t + d),
      });
    }
    slotCols = temp;
  } else {
    slotCols = collectSlotLabels(assignments);
  }
  const breakStart = findBreakStart(assignments, config);
  const yearSemOrder = deriveYearSemOrder(assignments);

  let morningEndIdx = slotCols.length;
  if (breakStart != null) {
    morningEndIdx = slotCols.findIndex((s) => s.start >= breakStart);
    if (morningEndIdx < 0) morningEndIdx = slotCols.length;
  }
  const morningCols = slotCols.slice(0, morningEndIdx);
  const afternoonCols = slotCols.slice(morningEndIdx);
  const hasBreak = morningCols.length > 0 && afternoonCols.length > 0;
  let breakStartStr = '';
  let breakEndStr = '';
  if (hasBreak) {
    breakStartStr = fmtTime(morningCols[morningCols.length - 1].end);
    breakEndStr = fmtTime(afternoonCols[0].start);
  }

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
        children: [new TextRun({ text: `${breakStartStr}-${breakEndStr}`, bold: true, color: 'FFFFFF', size: 18 })],
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

  const spacerCells = [];
  for (let c = 0; c < totalCols - 2; c++) {
    spacerCells.push(withBorders(new TableCell({
      vMerge: 'continue',
      shading: { type: ShadingType.SOLID, color: 'auto', fill: '1E40AF' },
      children: [new Paragraph({ children: [new TextRun({ text: '' })] })],
    })));
  }
  if (totalCols - 2 > 0) {
    rows.push(new TableRow({
      tableHeader: true,
      children: spacerCells,
    }));
  }

  // --- body rows: one block per day ---
  for (const day of days) {
    if (yearSemOrder.length === 0) {
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
      cells.push(withBorders(new TableCell({
        width: { size: 7, type: WidthType.PERCENTAGE },
        shading: { type: ShadingType.SOLID, color: 'auto', fill: 'F8FAFC' },
        children: [new Paragraph({
          alignment: AlignmentType.CENTER,
          children: [new TextRun({ text: ys, bold: true, size: 18 })],
        })],
      })));
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
// Teacher legend (2-column side-by-side)
// ---------------------------------------------------------------------------

function buildTeacherLegendTable(teachers) {
  if (!Array.isArray(teachers) || teachers.length === 0) return null;
  const sorted = [...teachers].sort((a, b) =>
    String(a.abbreviation || '').localeCompare(String(b.abbreviation || ''))
  );

  const half = Math.ceil(sorted.length / 2);
  const leftList = sorted.slice(0, half);
  const rightList = sorted.slice(half);

  const headerCell = (text, widthPct) => withBorders(new TableCell({
    width: { size: widthPct, type: WidthType.PERCENTAGE },
    shading: { type: ShadingType.SOLID, color: 'auto', fill: 'F1F5F9' },
    children: [new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [new TextRun({ text, bold: true, color: '000000', size: 18 })],
    })],
  }));

  const rows = [
    new TableRow({
      tableHeader: true,
      children: [
        headerCell('Name', 25),
        headerCell('Designation', 17),
        headerCell('Department', 8),
        headerCell('Name', 25),
        headerCell('Designation', 17),
        headerCell('Department', 8),
      ],
    }),
  ];

  for (let i = 0; i < half; i++) {
    const left = leftList[i];
    const right = rightList[i];

    const cell = (text, bold, center = false) => withBorders(new TableCell({
      shading: { type: ShadingType.SOLID, color: 'auto', fill: 'FFFFFF' },
      children: [new Paragraph({
        alignment: center ? AlignmentType.CENTER : AlignmentType.LEFT,
        children: [new TextRun({ text: String(text || ''), bold, size: 16 })],
      })],
    }));

    const leftName = left ? `${left.full_name || ''} (${left.abbreviation || ''})` : '';
    const leftDesignation = left ? left.designation : '';
    const leftDept = left ? left.department : '';

    const rightName = right ? `${right.full_name || ''} (${right.abbreviation || ''})` : '';
    const rightDesignation = right ? right.designation : '';
    const rightDept = right ? right.department : '';

    rows.push(new TableRow({
      children: [
        cell(leftName, false),
        cell(leftDesignation, false),
        cell(leftDept, false, true),
        cell(rightName, false),
        cell(rightDesignation, false),
        cell(rightDept, false, true),
      ],
    }));
  }

  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows,
  });
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

async function generateRoutinePdf(input) {
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

  // 3. The routine grid (or empty notice).
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

  const buffer = await Packer.toBuffer(doc);
  return buffer;
}

module.exports = {
  generateRoutinePdf,
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
