// PDF generation service — server-side, uses pdfkit (no client CSS quirks).
// Mirrors the layout of client/src/components/TimetableGrid.jsx.

const PDFDocument = require('pdfkit');

// Same colour palette as client/src/utils/colors.js
const COURSE_FILL = ['#FFFFFF', '#E0F2FE', '#CFFAFE', '#CCFBF1', '#EFF6FF', '#E0E7FF'];
const COURSE_TEXT = '#1F2937';

const DAYS = ['SUN', 'MON', 'TUE', 'WED', 'THR'];

const normalizeDay = (d) => {
  const raw = String(d || '').trim().toUpperCase();
  if (raw === 'THU' || raw === 'THURSDAY' || raw === 'THR') return 'THR';
  return raw;
};

const buildSectionLabel = (year, semester) => {
  const y = parseInt(String(year ?? '').trim(), 10);
  const sm = parseInt(String(semester ?? '').trim(), 10);
  if (!Number.isInteger(y) || !Number.isInteger(sm)) return '';
  return `${y}-${sm}`;
};

const fmtTime = (t) => {
  const [h, m] = String(t || '0:0').split(':').map(Number);
  const ampm = h < 12 ? 'am' : 'pm';
  const hr = h > 12 ? h - 12 : h === 0 ? 12 : h;
  return `${hr}:${String(m).padStart(2, '0')}${ampm}`;
};

const slotLabel = (s) => `${fmtTime(s.start)}-${fmtTime(s.end)}`;

const courseColorIndex = (code) => {
  if (!code) return 0;
  let hash = 0;
  for (let i = 0; i < code.length; i++) {
    hash = code.charCodeAt(i) + ((hash << 5) - hash);
  }
  return Math.abs(hash) % 5 + 1;
};

/**
 * Build the timetable matrix from flat routine entries.
 * Returns: { daysMap, sectionMeta (sorted), sortedSlots, breakIndex, teachers }
 */
const buildMatrix = (entries) => {
  const daysMap = {};
  const sectionMeta = {};
  const teachersMap = new Map();
  const timeSlotsMap = new Map();

  for (const entry of entries) {
    const secKey = `${entry.section.deptCode}__${entry.section.year}__${entry.section.semester}`;
    if (!sectionMeta[secKey]) {
      sectionMeta[secKey] = {
        year: entry.section.year,
        semester: entry.section.semester,
        deptCode: entry.section.deptCode,
        label: buildSectionLabel(entry.section.year, entry.section.semester),
      };
    }

    const t = entry.teacher;
    if (t?.teacherCode && !teachersMap.has(t.teacherCode)) {
      teachersMap.set(t.teacherCode, {
        code: t.teacherCode,
        name: t.teacherName || '',
        designation: t.designation || '',
      });
    }

    const timeKey = `${entry.timeSlot.startTime}-${entry.timeSlot.endTime}`;
    timeSlotsMap.set(timeKey, {
      start: entry.timeSlot.startTime,
      end: entry.timeSlot.endTime,
    });

    const day = normalizeDay(entry.day);
    if (!daysMap[day]) daysMap[day] = {};
    if (!daysMap[day][secKey]) daysMap[day][secKey] = {};
    daysMap[day][secKey][timeKey] = entry;
  }

  const sortedSlots = Array.from(timeSlotsMap.values()).sort((a, b) =>
    a.start.localeCompare(b.start)
  );

  // Detect break — largest gap between consecutive slots
  let breakIndex = -1;
  let maxGap = 0;
  for (let i = 0; i < sortedSlots.length - 1; i++) {
    const end = new Date(`1970-01-01T${sortedSlots[i].end}:00`);
    const start = new Date(`1970-01-01T${sortedSlots[i + 1].start}:00`);
    const diff = (start - end) / 60000;
    if (diff > maxGap) {
      maxGap = diff;
      breakIndex = i;
    }
  }

  const sortedSections = Object.keys(sectionMeta).sort((a, b) => {
    const ma = sectionMeta[a];
    const mb = sectionMeta[b];
    if (ma.year !== mb.year) return ma.year - mb.year;
    return ma.semester - mb.semester;
  });

  const teachersList = Array.from(teachersMap.values()).sort((a, b) =>
    a.code.localeCompare(b.code)
  );

  return { daysMap, sortedSections, sectionMeta, teachersList, sortedSlots, breakIndex };
};

// Page geometry — A4 landscape
const PAGE = {
  width: 842, // A4 landscape width (pt)
  height: 595,
  margin: 28,
};

const drawHeader = (doc, { departmentName, semesterName }) => {
  const { margin } = PAGE;
  let y = margin;

  doc
    .rect(0, 0, PAGE.width, 64)
    .fill('#0c2d52');

  doc
    .fillColor('#FFFFFF')
    .font('Helvetica-Bold')
    .fontSize(20)
    .text('Gopalganj Science and Technology University', margin, 12, {
      width: PAGE.width - margin * 2,
      align: 'center',
    });

  doc
    .font('Helvetica')
    .fontSize(11)
    .fillColor('#BAE6FD')
    .text(
      departmentName ? `Department of ${departmentName}` : 'All Departments',
      margin,
      36,
      { width: PAGE.width - margin * 2, align: 'center' }
    );

  doc
    .font('Helvetica-Oblique')
    .fontSize(9)
    .fillColor('#E0F2FE')
    .text(`Tentative Class Routine: ${semesterName || 'Selected Semester'}`, margin, 50, {
      width: PAGE.width - margin * 2,
      align: 'center',
    });

  y = 78;

  // Decorative bar under header
  doc.rect(0, 64, PAGE.width, 2).fill('#0EA5E9');

  return y;
};

const drawGrid = (doc, matrix, startY) => {
  const { margin, width } = PAGE;
  const hasBreak = matrix.breakIndex >= 0;
  const morningSlots = hasBreak
    ? matrix.sortedSlots.slice(0, matrix.breakIndex + 1)
    : matrix.sortedSlots;
  const afternoonSlots = hasBreak ? matrix.sortedSlots.slice(matrix.breakIndex + 1) : [];

  const usableWidth = width - margin * 2;
  const dayColW = 38;
  const yrSemColW = 36;
  const breakColW = 16;
  const slotCount = morningSlots.length + afternoonSlots.length;
  const slotColW = slotCount > 0
    ? (usableWidth - dayColW - yrSemColW - (hasBreak ? breakColW : 0)) / slotCount
    : 0;

  const headerRowH = 18;
  let y = startY;

  // ── Top header row: Day | Yr-Sm | morning slots | BREAK | afternoon slots ──
  const drawHeaderRow = (yPos) => {
    doc.rect(margin, yPos, usableWidth, headerRowH).fill('#071e38');

    let x = margin;
    doc.fillColor('#FFFFFF').font('Helvetica-Bold').fontSize(9);

    const drawCell = (text, w, align = 'center') => {
      doc.text(text, x, yPos + 5, { width: w, align });
      x += w;
    };

    drawCell('Day', dayColW);
    drawCell('Yr-Sm', yrSemColW);
    morningSlots.forEach((s) => drawCell(slotLabel(s), slotColW));
    if (hasBreak) drawCell('BREAK', breakColW);
    afternoonSlots.forEach((s) => drawCell(slotLabel(s), slotColW));
  };

  drawHeaderRow(y);
  y += headerRowH;

  // ── Body rows ──
  const rowH = 36;
  doc.lineWidth(0.4).strokeColor('#1e3a8a');

  for (const day of DAYS) {
    const activeSections = matrix.sortedSections.filter((sec) => matrix.daysMap[day]?.[sec]);
    if (activeSections.length === 0) continue;

    // Day cell (rowSpan) background
    doc
      .rect(margin, y, dayColW, rowH * activeSections.length)
      .fill('#071e38');
    doc
      .fillColor('#FFFFFF')
      .font('Helvetica-Bold')
      .fontSize(10)
      .text(
        day,
        margin,
        y + (rowH * activeSections.length) / 2 - 6,
        { width: dayColW, align: 'center' }
      );

    let rowY = y;
    activeSections.forEach((secKey, idx) => {
      const rowFill = idx % 2 === 0 ? '#F0F9FF' : '#FFFFFF';
      let x = margin + dayColW;

      // Yr-Sm cell
      doc.rect(x, rowY, yrSemColW, rowH).fill('#E2E8F0');
      doc
        .strokeColor('#1e3a8a')
        .lineWidth(0.4)
        .rect(x, rowY, yrSemColW, rowH)
        .stroke();
      doc
        .fillColor('#0F172A')
        .font('Helvetica-Bold')
        .fontSize(9)
        .text(matrix.sectionMeta[secKey].label, x, rowY + rowH / 2 - 5, {
          width: yrSemColW,
          align: 'center',
        });
      x += yrSemColW;

      // Row background strip (alternating) for remaining columns
      doc.rect(x, rowY, usableWidth - dayColW - yrSemColW, rowH).fill(rowFill);

      const drawSlotCell = (slot) => {
        const key = `${slot.start}-${slot.end}`;
        const entry = matrix.daysMap[day][secKey]?.[key];
        // Cell border
        doc.rect(x, rowY, slotColW, rowH).stroke('#1e3a8a');

        if (entry) {
          const cIdx = courseColorIndex(entry.course.courseCode);
          doc.rect(x + 1, rowY + 1, slotColW - 2, rowH - 2).fill(COURSE_FILL[cIdx]);
          doc
            .fillColor(COURSE_TEXT)
            .font('Helvetica-Bold')
            .fontSize(8)
            .text(entry.course.courseCode || '', x + 2, rowY + 4, {
              width: slotColW - 4,
              align: 'center',
            });
          doc
            .font('Helvetica')
            .fontSize(7)
            .text(entry.teacher?.teacherCode || '', x + 2, rowY + 15, {
              width: slotColW - 4,
              align: 'center',
            });
          doc
            .fillColor('#475569')
            .text(`R:${entry.room?.roomNo || ''}`, x + 2, rowY + 25, {
              width: slotColW - 4,
              align: 'center',
            });
        }
        x += slotColW;
      };

      morningSlots.forEach(drawSlotCell);

      if (hasBreak) {
        doc.rect(x, rowY, breakColW, rowH).fill('#FDE047');
        doc.rect(x, rowY, breakColW, rowH).stroke('#CA8A04');
        x += breakColW;
      }

      afternoonSlots.forEach(drawSlotCell);

      rowY += rowH;
    });

    y = rowY;
  }

  // Vertical grid lines over the entire table area (drawn last so they cover fills)
  let x = margin;
  doc.strokeColor('#1e3a8a').lineWidth(0.4);
  doc.moveTo(x, startY).lineTo(x, y).stroke();
  x += dayColW;
  doc.moveTo(x, startY).lineTo(x, y).stroke();
  x += yrSemColW;
  morningSlots.forEach(() => {
    doc.moveTo(x, startY).lineTo(x, y).stroke();
    x += slotColW;
  });
  if (hasBreak) {
    doc.moveTo(x, startY).lineTo(x, y).stroke();
    x += breakColW;
  }
  afternoonSlots.forEach(() => {
    doc.moveTo(x, startY).lineTo(x, y).stroke();
    x += slotColW;
  });
  doc.moveTo(x, startY).lineTo(x, y).stroke();

  // Horizontal lines
  doc.strokeColor('#1e3a8a').lineWidth(0.4);
  for (let yy = startY; yy <= y; yy += rowH) {
    doc.moveTo(margin, yy).lineTo(margin + usableWidth, yy).stroke();
  }

  return y;
};

const drawTeacherLegend = (doc, teachers, startY) => {
  if (!teachers || teachers.length === 0) return startY;
  const { margin, width } = PAGE;
  let y = startY + 14;

  // Check if we need a new page
  if (y + 40 > PAGE.height - margin) {
    doc.addPage();
    y = margin;
  }

  doc.rect(margin, y, width - margin * 2, 18).fill('#0c2d52');
  doc
    .fillColor('#FFFFFF')
    .font('Helvetica-Bold')
    .fontSize(11)
    .text('Teacher Legend', margin + 8, y + 4);
  y += 18;

  doc.rect(margin, y, width - margin * 2, teachers.length * 14 + 8).fill('#F8FAFC');
  doc.rect(margin, y, width - margin * 2, teachers.length * 14 + 8).stroke('#CBD5E1');

  teachers.forEach((t, i) => {
    const rowY = y + 6 + i * 14;
    doc
      .font('Helvetica-Bold')
      .fontSize(8)
      .fillColor('#0F172A')
      .text(t.code, margin + 8, rowY, { width: 60 });
    doc
      .font('Helvetica')
      .fillColor('#1F2937')
      .text(t.name || '', margin + 70, rowY, { width: 200 });
    doc
      .font('Helvetica-Oblique')
      .fillColor('#475569')
      .text(t.designation || '', margin + 280, rowY, { width: width - margin * 2 - 290 });
  });

  return y + teachers.length * 14 + 8;
};

/**
 * Stream a PDF of a department's routine directly to the response.
 * @param {object} res - Express response
 * @param {object} data - { entries, departmentName, semesterName }
 */
const streamDepartmentRoutinePdf = (res, { entries, departmentName, semesterName }) => {
  const doc = new PDFDocument({
    size: 'A4',
    layout: 'landscape',
    margins: { top: PAGE.margin, bottom: PAGE.margin, left: PAGE.margin, right: PAGE.margin },
    info: {
      Title: `${departmentName || 'Department'} — ${semesterName || 'Routine'}`,
      Author: 'Gopalganj Science and Technology University',
      Subject: 'Class Routine',
    },
  });

  // Hook up stream BEFORE drawing so we can pipe.
  doc.pipe(res);

  const matrix = buildMatrix(entries || []);
  const y = drawHeader(doc, { departmentName, semesterName });

  if (matrix.sortedSections.length === 0) {
    doc
      .font('Helvetica')
      .fontSize(11)
      .fillColor('#475569')
      .text(
        'No routine data is available for the selected department and semester.',
        PAGE.margin,
        y + 20,
        { width: PAGE.width - PAGE.margin * 2, align: 'center' }
      );
  } else {
    const tableBottom = drawGrid(doc, matrix, y + 8);
    drawTeacherLegend(doc, matrix.teachersList, tableBottom);
  }

  // Footer on last page
  doc
    .font('Helvetica-Oblique')
    .fontSize(7)
    .fillColor('#94A3B8')
    .text(
      `Generated on ${new Date().toLocaleString()}`,
      PAGE.margin,
      PAGE.height - PAGE.margin + 4,
      { width: PAGE.width - PAGE.margin * 2, align: 'center' }
    );

  doc.end();
};

module.exports = {
  streamDepartmentRoutinePdf,
  // exported for tests
  buildMatrix,
};
