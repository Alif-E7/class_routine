import React, { useMemo, useState, useRef, useEffect } from 'react';
import { getCourseColorClass } from '../utils/colors';
import { AlertTriangle, CheckCircle2, GripVertical, Move, X, Ban, ZoomIn, ZoomOut, Maximize2, Minimize2, RotateCcw } from 'lucide-react';
import toast from 'react-hot-toast';

/**
 * RoutineGrid — photo-faithful rendering of the weekly routine with
 * Real-Time Drag & Drop and Conflict Detection.
 */

function fmtTime(t) {
  if (t === null || t === undefined || t === '') return '';
  let m;
  if (typeof t === 'string' && t.includes(':')) {
    const parts = t.split(':');
    m = parseInt(parts[0], 10) * 60 + parseInt(parts[1], 10);
  } else if (typeof t === 'number') {
    m = t;
  } else {
    const parsed = parseInt(String(t), 10);
    if (!Number.isNaN(parsed)) m = parsed;
    else return String(t);
  }
  const h24 = Math.floor(m / 60);
  const mins = m % 60;
  const ampm = h24 >= 12 ? 'pm' : 'am';
  let h12 = h24 % 12;
  if (h12 === 0) h12 = 12;
  return `${h12}:${String(mins).padStart(2, '0')}${ampm}`;
}

function slotLabel(start, end) {
  return `${fmtTime(start)}-${fmtTime(end)}`;
}

export function formatHeaderSemester(year, semester) {
  const semStr = (semester || '').trim();
  const yrStr = year ? String(year).trim() : '';

  if (!semStr && !yrStr) return '';

  if (/^\d{4}-/.test(semStr)) {
    return ` (${semStr})`;
  }

  if (/^\d{4}\s+[A-Za-z]+$/.test(semStr)) {
    return ` (${semStr.replace(/\s+/, '-')})`;
  }

  if (/^\d{4}\s/.test(semStr)) {
    return ` (${semStr})`;
  }

  if (/\b\d{4}\b/.test(semStr)) {
    return ` (${semStr})`;
  }

  if (yrStr && semStr) {
    return ` (${yrStr}-${semStr})`;
  }

  if (yrStr) {
    return ` (${yrStr})`;
  }

  return ` (${semStr})`;
}

function partitionByBreak(slots, breakStart) {
  const cutoff = Number.isFinite(breakStart) ? breakStart : 13 * 60;
  const toMin = hmToMin;
  const morning = [];
  const afternoon = [];
  for (const s of slots) {
    const startMin = toMin(s.start);
    if (startMin < cutoff) morning.push(s);
    else afternoon.push(s);
  }
  return { morning, afternoon };
}

function hmToMin(t) {
  if (t == null) return NaN;
  if (typeof t === 'number') {
    if (t > 0 && t < 1) return Math.round(t * 24 * 60);
    return t;
  }
  const s = String(t).trim();
  if (s.includes(':')) {
    const parts = s.split(':');
    return parseInt(parts[0], 10) * 60 + parseInt(parts[1], 10);
  }
  if (/^0\.\d+$/.test(s)) {
    return Math.round(Number(s) * 24 * 60);
  }
  const parsed = parseInt(s, 10);
  return Number.isNaN(parsed) ? NaN : parsed;
}

const isSameAssignment = (a, b) => {
  if (!a || !b) return false;
  if (a === b) return true;
  return (
    String(a.course_code || '').trim() === String(b.course_code || '').trim() &&
    String(a.year_sem || '').trim() === String(b.year_sem || '').trim() &&
    String(a.day || '').trim().toUpperCase() === String(b.day || '').trim().toUpperCase() &&
    Number(a.slot_start) === Number(b.slot_start)
  );
};

// ---------------------------------------------------------------------------
// Conflict Detector
// ---------------------------------------------------------------------------
const checkConflicts = (dragged, targetDay, targetYearSem, targetSlotStart, assignmentsList) => {
  if (!dragged) return { hasConflict: false, reasons: [] };

  const draggedYs = String(dragged.year_sem || '').trim();
  const targetYs = String(targetYearSem || '').trim();
  const tDay = String(targetDay || '').trim().toUpperCase();
  const tSlot = Number(targetSlotStart);

  // Rule 1: Drag & Drop is strictly restricted to the SAME Year-Sem row
  if (draggedYs !== targetYs) {
    return {
      hasConflict: true,
      isDifferentRow: true,
      reasons: [`ভিন্ন সেমিস্টার সারিতে ড্র্যাগ করা যাবে না (Drag-drop is allowed ONLY within the same "${draggedYs}" Year-Sem row).`]
    };
  }

  // Same exact position check
  if (String(dragged.day || '').trim().toUpperCase() === tDay && Number(dragged.slot_start) === tSlot) {
    return { hasConflict: false, reasons: [], isSame: true };
  }

  const reasons = [];

  // Rule 2: Year-Sem / Section Collision check on the same row
  const sectionConflict = assignmentsList.find(a =>
    String(a.year_sem || '').trim() === targetYs &&
    String(a.day || '').trim().toUpperCase() === tDay &&
    Number(a.slot_start) === tSlot &&
    !isSameAssignment(a, dragged)
  );
  if (sectionConflict) {
    reasons.push(`সেমিস্টার কনফ্লিক্ট (Section Conflict): "${targetYs}" সেমিস্টারে ${tDay} তারিখে ${fmtTime(tSlot)} সময়ে ইতিমধ্যেই ${sectionConflict.course_code} (শিক্ষক: ${sectionConflict.teacher_abbr || 'N/A'}, রুম: ${sectionConflict.room_id || 'N/A'}) ক্লাসটি নির্ধারিত রয়েছে।`);
  }

  // Rule 3: Teacher Conflict (across any year-sem on targetDay & targetSlotStart)
  const teacherConflict = assignmentsList.find(a =>
    String(a.teacher_abbr || '').trim() &&
    String(a.teacher_abbr || '').trim() === String(dragged.teacher_abbr || '').trim() &&
    String(a.day || '').trim().toUpperCase() === tDay &&
    Number(a.slot_start) === tSlot &&
    !isSameAssignment(a, dragged)
  );
  if (teacherConflict) {
    reasons.push(`শিক্ষক কনফ্লিক্ট (Teacher Conflict): শিক্ষক "${dragged.teacher_abbr}" ইতিমধ্যে ${tDay} তারিখে ${fmtTime(tSlot)} সময়ে ${teacherConflict.year_sem} সেমিস্টারের ${teacherConflict.course_code} ক্লাসে নিয়োজিত আছেন।`);
  }

  // Rule 4: Room Conflict (across any year-sem on targetDay & targetSlotStart)
  const roomConflict = assignmentsList.find(a =>
    String(a.room_id || '').trim() &&
    String(a.room_id || '').trim() === String(dragged.room_id || '').trim() &&
    String(a.day || '').trim().toUpperCase() === tDay &&
    Number(a.slot_start) === tSlot &&
    !isSameAssignment(a, dragged)
  );
  if (roomConflict) {
    reasons.push(`রুম কনফ্লিক্ট (Room Conflict): রুম "${dragged.room_id}" ইতিমধ্যে ${tDay} তারিখে ${fmtTime(tSlot)} সময়ে ${roomConflict.year_sem} সেমিস্টারের ${roomConflict.course_code} ক্লাসের দখলে রয়েছে।`);
  }

  return {
    hasConflict: reasons.length > 0,
    isDifferentRow: false,
    reasons,
  };
};

const RoutineGrid = ({
  assignments = [],
  header,
  teachers = [],
  config,
  yearSemList = [],
  dayList = [],
  onCellClick,
  onAssignmentMove,
}) => {
  const daysToRender = dayList.length > 0 ? dayList : ['SUN', 'MON', 'TUE', 'WED', 'THU'];
  const yearsToRender = yearSemList.length > 0 ? yearSemList : ['4-1', '3-2', '2-2', '2-1', '1-1'];

  // Drag & Drop state
  const [draggedEntry, setDraggedEntry] = useState(null);
  const [hoverTarget, setHoverTarget] = useState(null); // { day, ys, slotStart, slotEnd }
  const [confirmModal, setConfirmModal] = useState(null); // { isOpen, entry, target, conflicts }

  const { daysPresent, slots, dayMap, yearSemRows, breakStart, breakStartStr, breakEndStr } = useMemo(() => {
    const daySet = new Set();
    const slotMap = new Map();
    const ysSet = new Set();
    const grid = {};

    for (const a of assignments) {
      daySet.add(a.day);
      ysSet.add(a.year_sem);
      const key = a.slot_start;
      if (!slotMap.has(key)) {
        slotMap.set(key, {
          start: a.slot_start,
          end: a.slot_end,
        });
      }
      if (!grid[a.day]) grid[a.day] = {};
      if (!grid[a.day][a.year_sem]) grid[a.day][a.year_sem] = {};
      const prev = grid[a.day][a.year_sem][key];
      if (prev) {
        prev._merged = prev._merged || [prev];
        prev._merged.push(a);
      } else {
        grid[a.day][a.year_sem][key] = a;
      }
    }

    const sorted = Array.from(slotMap.values()).sort(
      (a, b) => hmToMin(a.start) - hmToMin(b.start)
    );

    let biggestGap = 0;
    let gapAfter = -1;
    for (let i = 0; i < sorted.length - 1; i++) {
      const gap = hmToMin(sorted[i + 1].start) - hmToMin(sorted[i].end);
      if (gap > biggestGap) {
        biggestGap = gap;
        gapAfter = i;
      }
    }

    let breakStartMin = null;
    let breakEndMin = null;
    if (config?.break_start) {
      breakStartMin = hmToMin(config.break_start);
      breakEndMin = hmToMin(config.break_end || '14:10');
    } else if (gapAfter >= 0 && biggestGap >= 30) {
      breakStartMin = hmToMin(sorted[gapAfter].end);
      breakEndMin = hmToMin(sorted[gapAfter + 1].start);
    } else {
      breakStartMin = 13 * 60 + 10;
      breakEndMin = 14 * 60 + 10;
    }

    let breakStartStr = '';
    let breakEndStr = '';
    if (breakStartMin !== null) {
      breakStartStr = fmtTime(breakStartMin);
      breakEndStr = breakEndMin ? fmtTime(breakEndMin) : '';
    }

    const sortedDays = daysToRender.filter((d) => daySet.has(d));
    const sortedYearSems = yearsToRender.filter((ys) => ysSet.has(ys));

    for (const ys of ysSet) {
      if (!sortedYearSems.includes(ys)) sortedYearSems.push(ys);
    }

    return {
      daysPresent: sortedDays,
      slots: sorted,
      dayMap: grid,
      yearSemRows: sortedYearSems,
      breakStart: breakStartMin,
      breakStartStr,
      breakEndStr,
    };
  }, [assignments, daysToRender, yearsToRender]);

  // ── Responsive Zoom & Auto-Fit State ──────────────────────────────
  const containerRef = useRef(null);
  const tableRef = useRef(null);
  const [zoomScale, setZoomScale] = useState(1);
  const [fitScale, setFitScale] = useState(1);
  const [tableDimensions, setTableDimensions] = useState({ width: 960, height: 600 });
  const [isMobileDevice, setIsMobileDevice] = useState(false);
  const [isUserZoomed, setIsUserZoomed] = useState(false);

  // Measure container and table dimensions to calculate optimal fitScale
  useEffect(() => {
    const updateDimensions = () => {
      const isMobile = window.innerWidth < 1024;
      setIsMobileDevice(isMobile);

      if (containerRef.current && tableRef.current) {
        const cWidth = containerRef.current.clientWidth;
        const tWidth = tableRef.current.scrollWidth || 960;
        const tHeight = tableRef.current.scrollHeight || 600;
        setTableDimensions({ width: tWidth, height: tHeight });

        if (cWidth > 0 && tWidth > 0) {
          const calculatedFit = Math.min(1, Math.max(0.2, (cWidth - 8) / tWidth));
          setFitScale(calculatedFit);

          // If on mobile and user hasn't manually adjusted zoom, default to fit full view
          if (isMobile && !isUserZoomed) {
            setZoomScale(calculatedFit);
          } else if (!isMobile && !isUserZoomed) {
            setZoomScale(1);
          }
        }
      }
    };

    updateDimensions();
    window.addEventListener('resize', updateDimensions);
    const resizeObserver = new ResizeObserver(updateDimensions);
    if (tableRef.current) resizeObserver.observe(tableRef.current);
    if (containerRef.current) resizeObserver.observe(containerRef.current);

    return () => {
      window.removeEventListener('resize', updateDimensions);
      resizeObserver.disconnect();
    };
  }, [assignments, isUserZoomed]);

  const handleZoomIn = () => {
    setIsUserZoomed(true);
    setZoomScale((prev) => Math.min(2.5, Math.round((prev + 0.15) * 100) / 100));
  };

  const handleZoomOut = () => {
    setIsUserZoomed(true);
    setZoomScale((prev) => Math.max(Math.min(fitScale, 0.25), Math.round((prev - 0.15) * 100) / 100));
  };

  const handleReset100 = () => {
    setIsUserZoomed(true);
    setZoomScale(1.0);
  };

  const handleFitToScreen = () => {
    setIsUserZoomed(false);
    setZoomScale(fitScale);
  };

  // Multi-touch pinch-to-zoom handlers
  const touchStateRef = useRef({ initialDist: null, initialScale: 1 });

  const handleTouchStart = (e) => {
    if (e.touches.length === 2) {
      const dist = Math.hypot(
        e.touches[0].clientX - e.touches[1].clientX,
        e.touches[0].clientY - e.touches[1].clientY
      );
      touchStateRef.current = { initialDist: dist, initialScale: zoomScale };
    }
  };

  const handleTouchMove = (e) => {
    if (e.touches.length === 2 && touchStateRef.current.initialDist) {
      const currentDist = Math.hypot(
        e.touches[0].clientX - e.touches[1].clientX,
        e.touches[0].clientY - e.touches[1].clientY
      );
      const factor = currentDist / touchStateRef.current.initialDist;
      const newScale = Math.max(
        Math.min(fitScale * 0.85, 0.2),
        Math.min(2.5, touchStateRef.current.initialScale * factor)
      );
      setIsUserZoomed(true);
      setZoomScale(Math.round(newScale * 100) / 100);
    }
  };

  const handleTouchEnd = (e) => {
    if (e.touches.length < 2) {
      touchStateRef.current.initialDist = null;
    }
  };

  if (assignments.length === 0 || daysPresent.length === 0) {
    return (
      <div className="bg-white border border-slate-200 rounded-xl p-12 text-center text-slate-500">
        No routine generated yet. Click <span className="font-semibold">Generate Routine</span> to run the scheduler.
      </div>
    );
  }

  const { morning, afternoon } = partitionByBreak(slots, breakStart ?? (13 * 60 + 10));
  const hasBreak = breakStart !== null;
  const totalCols = 2 + morning.length + (hasBreak ? 1 : 0) + afternoon.length;

  const currentConflicts = hoverTarget && draggedEntry
    ? checkConflicts(draggedEntry, hoverTarget.day, hoverTarget.ys, hoverTarget.slotStart, assignments)
    : null;

  const handleDropCell = (target) => {
    if (!draggedEntry) return;
    const conflicts = checkConflicts(draggedEntry, target.day, target.ys, target.slotStart, assignments);
    if (conflicts.isSame) {
      setDraggedEntry(null);
      setHoverTarget(null);
      return;
    }

    if (conflicts.isDifferentRow) {
      toast.error(`ভিন্ন সেমিস্টারে ড্র্যাগ করা যাবে না! শুধু "${draggedEntry.year_sem}" সেমিস্টার সারিতে ড্র্যাগ করুন।`);
      setDraggedEntry(null);
      setHoverTarget(null);
      return;
    }

    if (conflicts.hasConflict) {
      setConfirmModal({
        isOpen: true,
        entry: draggedEntry,
        target,
        conflicts,
      });
    } else {
      if (typeof onAssignmentMove === 'function') {
        onAssignmentMove(draggedEntry, target);
      }
    }

    setDraggedEntry(null);
    setHoverTarget(null);
  };

  return (
    <div className="relative">
      {/* ── Interactive Zoom Toolbar (Excluded from PDF capture) ── */}
      <div
        data-pdf-exclude="true"
        className="routine-zoom-toolbar bg-slate-900/90 backdrop-blur-md text-white rounded-2xl px-3.5 py-2 mb-3 shadow-lg border border-slate-700/60 flex flex-wrap items-center justify-between gap-2.5 transition-all print:hidden"
      >
        <div className="flex items-center gap-2">
          <span className="text-[11px] font-bold text-sky-400 uppercase tracking-wider hidden sm:inline">
            Routine Zoom:
          </span>
          <div className="flex items-center bg-slate-800 border border-slate-700 rounded-xl p-0.5 shadow-inner">
            <button
              type="button"
              onClick={handleFitToScreen}
              className={`px-2.5 py-1 text-xs font-bold rounded-lg transition-all flex items-center gap-1.5 cursor-pointer ${
                Math.abs(zoomScale - fitScale) < 0.02
                  ? 'bg-sky-500 text-white shadow-xs'
                  : 'text-slate-300 hover:text-white hover:bg-slate-700/60'
              }`}
              title="পুরো রুটিন এক নজরে দেখতে ফিট করুন (Fit Full Overview)"
            >
              <Minimize2 className="w-3.5 h-3.5" />
              <span>Fit ({Math.round(fitScale * 100)}%)</span>
            </button>
            <button
              type="button"
              onClick={handleReset100}
              className={`px-2.5 py-1 text-xs font-bold rounded-lg transition-all flex items-center gap-1.5 cursor-pointer ${
                Math.abs(zoomScale - 1) < 0.02
                  ? 'bg-sky-500 text-white shadow-xs'
                  : 'text-slate-300 hover:text-white hover:bg-slate-700/60'
              }`}
              title="১০০% স্বাভাবিক সাইজ (Actual Size 100%)"
            >
              <Maximize2 className="w-3.5 h-3.5" />
              <span>100%</span>
            </button>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <div className="flex items-center bg-slate-800 border border-slate-700 rounded-xl p-0.5 shadow-inner">
            <button
              type="button"
              onClick={handleZoomOut}
              disabled={zoomScale <= Math.min(fitScale * 0.85, 0.25)}
              className="p-1.5 text-slate-300 hover:text-white hover:bg-slate-700/60 rounded-lg transition-all disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer"
              title="জুম আউট (Zoom Out)"
            >
              <ZoomOut className="w-4 h-4" />
            </button>
            <span className="text-xs font-bold font-mono px-2.5 py-1 text-sky-300 select-none min-w-[50px] text-center">
              {Math.round(zoomScale * 100)}%
            </span>
            <button
              type="button"
              onClick={handleZoomIn}
              disabled={zoomScale >= 2.5}
              className="p-1.5 text-slate-300 hover:text-white hover:bg-slate-700/60 rounded-lg transition-all disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer"
              title="জুম ইন (Zoom In)"
            >
              <ZoomIn className="w-4 h-4" />
            </button>
          </div>

          <button
            type="button"
            onClick={() => { setIsUserZoomed(false); setZoomScale(isMobileDevice ? fitScale : 1); }}
            className="p-1.5 text-slate-400 hover:text-white hover:bg-slate-800 rounded-xl border border-slate-700/60 transition-all cursor-pointer"
            title="রিসেট করুন (Reset View)"
          >
            <RotateCcw className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* ── Main Scalable Table Container with Touch Pinch & 2D Pan Support ── */}
      <div
        ref={containerRef}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        className="bg-white border border-blue-900 rounded-2xl overflow-auto shadow-md font-sans select-none mb-4 max-w-full touch-pan-x touch-pan-y"
        style={{ WebkitOverflowScrolling: 'touch' }}
      >
        {/* Mobile Pinch / Pan Hint */}
        {zoomScale > fitScale && (
          <div
            data-pdf-exclude="true"
            className="md:hidden bg-sky-50 text-sky-900 text-xs px-3.5 py-1.5 border-b border-sky-200 flex items-center justify-between font-medium print:hidden"
          >
            <span className="flex items-center gap-1.5 font-semibold text-[11px]">
              <span>↔️↕️ চারদিকে স্ক্রল / দুই আঙুলে পিঞ্চ করে জুম করুন</span>
            </span>
            <span className="text-[10px] text-sky-700 bg-white px-2 py-0.5 rounded-full border border-sky-200 font-bold">
              {Math.round(zoomScale * 100)}%
            </span>
          </div>
        )}

        {/* Resizer wrapper adjusting scroll bounds dynamically to matched scaled dimensions */}
        <div
          style={{
            width: tableDimensions.width ? `${Math.round(tableDimensions.width * zoomScale)}px` : '100%',
            height: tableDimensions.height ? `${Math.round(tableDimensions.height * zoomScale)}px` : 'auto',
            overflow: 'hidden',
            position: 'relative',
          }}
        >
          <div
            ref={tableRef}
            id="routine-capture-target"
            className="bg-white"
            style={{
              transform: `scale(${zoomScale})`,
              transformOrigin: 'top left',
              width: 'max-content',
              minWidth: '960px',
            }}
          >
            <table className="w-full border-collapse min-w-[960px] text-left">
              <thead>
                <tr>
                  <th
                    colSpan={totalCols}
                    className="bg-blue-900 text-white font-bold text-center py-2 sm:py-3 text-lg sm:text-2xl tracking-tight border-b-2 border-blue-950 px-2"
                  >
                    {header?.university || 'University'}
                  </th>
                </tr>
                <tr>
                  <th
                    colSpan={totalCols}
                    className="bg-blue-800 text-white font-semibold text-center py-1 sm:py-1.5 text-xs sm:text-base border-b border-blue-900 px-2"
                  >
                    {(() => {
                      let dept = (header?.department || 'Department').trim();
                      if (dept.includes(' — Faculty of ')) {
                        dept = dept.split(' — Faculty of ')[0].trim();
                      }
                      if (/^Department of\s+/i.test(dept)) {
                        dept = dept.replace(/^Department of\s+/i, '').trim();
                      }
                      return `Department of ${dept}`;
                    })()}
                    {formatHeaderSemester(header?.year, header?.semester)}
                  </th>
                </tr>
                <tr>
                  <th
                    rowSpan={2}
                    className="bg-blue-900 text-white font-bold text-center border-r border-blue-950 w-14 text-sm"
                  >
                    Day
                  </th>
                  <th
                    rowSpan={2}
                    className="bg-blue-900 text-white font-bold text-center border-r border-blue-950 w-24 text-sm"
                  >
                    Yr-Sm
                  </th>
                  {morning.map((slot, i) => (
                    <th
                      key={`m-${i}`}
                      className="bg-blue-700 text-white font-semibold text-center border-r border-blue-900 px-2 py-1 text-xs whitespace-nowrap"
                    >
                      {slotLabel(slot.start, slot.end)}
                    </th>
                  ))}
                  {hasBreak && (
                    <th
                      rowSpan={2}
                      className="bg-yellow-300 text-blue-950 font-bold text-center border-l border-r border-yellow-500 w-8 text-xs"
                      style={{ writingMode: 'vertical-rl' }}
                    >
                      {`${breakStartStr} - ${breakEndStr}`}
                    </th>
                  )}
                  {afternoon.map((slot, i) => (
                    <th
                      key={`a-${i}`}
                      className="bg-blue-700 text-white font-semibold text-center border-r border-blue-900 px-2 py-1 text-xs whitespace-nowrap"
                    >
                      {slotLabel(slot.start, slot.end)}
                    </th>
                  ))}
                </tr>
                <tr aria-hidden="true">
                  {slots.map((_, i) => (
                    <th key={`h-${i}`} className="hidden" />
                  ))}
                </tr>
              </thead>
              <tbody>
                {daysPresent.map((day) => {
                  const activeRows = yearSemRows.filter(
                    (ys) => dayMap[day] && dayMap[day][ys]
                  );
                  if (activeRows.length === 0) return null;
                  return activeRows.map((ys, idx) => {
                    const isDifferentRowFromDragged = draggedEntry && draggedEntry.year_sem !== ys;
                    const isLastRowOfDay = idx === activeRows.length - 1;
                    const borderBottomClass = isLastRowOfDay ? 'border-b-2 border-blue-900' : 'border-b border-blue-900/30';

                    return (
                      <tr
                        key={`${day}-${ys}`}
                        className={`${idx % 2 === 0 ? 'bg-sky-50' : 'bg-white'} ${
                          isDifferentRowFromDragged ? 'opacity-50 grayscale-20' : ''
                        }`}
                      >
                        {idx === 0 && (
                          <td
                            rowSpan={activeRows.length}
                            className="bg-blue-900 text-white font-extrabold text-center border-r border-b-2 border-blue-900 text-xs"
                          >
                            {day}
                          </td>
                        )}
                        <td className={`font-bold text-center border-r ${borderBottomClass} text-xs px-2 ${
                          draggedEntry && draggedEntry.year_sem === ys
                            ? 'bg-amber-300 text-slate-950 ring-2 ring-amber-500 font-extrabold animate-pulse'
                            : 'bg-slate-200 text-slate-900'
                        }`}>
                          {ys}
                        </td>
                        {morning.map((slot) => {
                          const cell = dayMap[day]?.[ys]?.[slot.start];
                          const isHovered = hoverTarget &&
                            hoverTarget.day === day &&
                            hoverTarget.ys === ys &&
                            hoverTarget.slotStart === slot.start;

                          return (
                            <td
                              key={`cell-m-${slot.start}`}
                              onDragOver={(e) => {
                                e.preventDefault();
                                e.dataTransfer.dropEffect = 'move';
                                if (!hoverTarget || hoverTarget.day !== day || hoverTarget.ys !== ys || hoverTarget.slotStart !== slot.start) {
                                  setHoverTarget({ day, ys, slotStart: slot.start });
                                }
                              }}
                              onDragLeave={() => {
                                if (hoverTarget && hoverTarget.day === day && hoverTarget.ys === ys && hoverTarget.slotStart === slot.start) {
                                  setHoverTarget(null);
                                }
                              }}
                              onDrop={(e) => {
                                e.preventDefault();
                                handleDropCell({ day, ys, slotStart: slot.start });
                              }}
                              className={`p-0 border-r ${borderBottomClass} align-middle relative transition-colors ${
                                isHovered
                                  ? currentConflicts?.hasConflict
                                    ? 'bg-red-200/90 ring-2 ring-red-500 z-10'
                                    : 'bg-emerald-200/90 ring-2 ring-emerald-500 z-10'
                                  : ''
                              }`}
                            >
                              {isHovered && currentConflicts && (
                                <div
                                  className={`absolute -top-12 left-1/2 -translate-x-1/2 z-50 pointer-events-none px-3 py-1.5 rounded-lg shadow-xl text-xs font-bold whitespace-nowrap flex items-center gap-1.5 animate-in zoom-in-95 duration-100 ${
                                    currentConflicts.hasConflict
                                      ? 'bg-red-600 text-white ring-2 ring-red-300'
                                      : 'bg-emerald-600 text-white ring-2 ring-emerald-300'
                                  }`}
                                >
                                  {currentConflicts.isDifferentRow ? (
                                    <>
                                      <Ban className="w-4 h-4 shrink-0 text-amber-200" />
                                      <span>❌ শুধুমাত্র একই সেমিস্টার সারিতে ({draggedEntry.year_sem}) ড্র্যাগ করা সম্ভব</span>
                                    </>
                                  ) : currentConflicts.hasConflict ? (
                                    <>
                                      <AlertTriangle className="w-4 h-4 shrink-0 text-amber-200" />
                                      <span>⚠️ কনফ্লিক্ট লাল সতর্কবার্তা ({currentConflicts.reasons.length})</span>
                                    </>
                                  ) : (
                                    <>
                                      <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-200" />
                                      <span>✓ নিরাপদ স্লট (Safe Slot)</span>
                                    </>
                                  )}
                                </div>
                              )}
                              {renderCell(cell, onCellClick, setDraggedEntry)}
                            </td>
                          );
                        })}
                        {hasBreak && idx === 0 && (
                          <td
                            rowSpan={activeRows.length}
                            className="bg-yellow-200 text-blue-950 font-extrabold text-center border-l border-r border-b-2 border-yellow-500 w-8 text-xs tracking-widest select-none align-middle"
                            style={{ writingMode: 'vertical-rl', textOrientation: 'upright' }}
                          >
                            BREAK
                          </td>
                        )}
                        {afternoon.map((slot) => {
                          const cell = dayMap[day]?.[ys]?.[slot.start];
                          const isHovered = hoverTarget &&
                            hoverTarget.day === day &&
                            hoverTarget.ys === ys &&
                            hoverTarget.slotStart === slot.start;

                          return (
                            <td
                              key={`cell-a-${slot.start}`}
                              onDragOver={(e) => {
                                e.preventDefault();
                                e.dataTransfer.dropEffect = 'move';
                                if (!hoverTarget || hoverTarget.day !== day || hoverTarget.ys !== ys || hoverTarget.slotStart !== slot.start) {
                                  setHoverTarget({ day, ys, slotStart: slot.start });
                                }
                              }}
                              onDragLeave={() => {
                                if (hoverTarget && hoverTarget.day === day && hoverTarget.ys === ys && hoverTarget.slotStart === slot.start) {
                                  setHoverTarget(null);
                                }
                              }}
                              onDrop={(e) => {
                                e.preventDefault();
                                handleDropCell({ day, ys, slotStart: slot.start });
                              }}
                              className={`p-0 border-r ${borderBottomClass} align-middle relative transition-colors ${
                                isHovered
                                  ? currentConflicts?.hasConflict
                                    ? 'bg-red-200/90 ring-2 ring-red-500 z-10'
                                    : 'bg-emerald-200/90 ring-2 ring-emerald-500 z-10'
                                  : ''
                              }`}
                            >
                              {isHovered && currentConflicts && (
                                <div
                                  className={`absolute -top-12 left-1/2 -translate-x-1/2 z-50 pointer-events-none px-3 py-1.5 rounded-lg shadow-xl text-xs font-bold whitespace-nowrap flex items-center gap-1.5 animate-in zoom-in-95 duration-100 ${
                                    currentConflicts.hasConflict
                                      ? 'bg-red-600 text-white ring-2 ring-red-300'
                                      : 'bg-emerald-600 text-white ring-2 ring-emerald-300'
                                  }`}
                                >
                                  {currentConflicts.isDifferentRow ? (
                                    <>
                                      <Ban className="w-4 h-4 shrink-0 text-amber-200" />
                                      <span>❌ শুধুমাত্র একই সেমিস্টার সারিতে ({draggedEntry.year_sem}) ড্র্যাগ করা সম্ভব</span>
                                    </>
                                  ) : currentConflicts.hasConflict ? (
                                    <>
                                      <AlertTriangle className="w-4 h-4 shrink-0 text-amber-200" />
                                      <span>⚠️ কনফ্লিক্ট লাল সতর্কবার্তা ({currentConflicts.reasons.length})</span>
                                    </>
                                  ) : (
                                    <>
                                      <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-200" />
                                      <span>✓ নিরাপদ স্লট (Safe Slot)</span>
                                    </>
                                  )}
                                </div>
                              )}
                              {renderCell(cell, onCellClick, setDraggedEntry)}
                            </td>
                          );
                        })}
                      </tr>
                    );
                  });
                })}
              </tbody>
            </table>

            {teachers.length > 0 && <TeacherLegend teachers={teachers} />}
          </div>
        </div>
      </div>

      {/* Force Move Confirmation Modal */}
      {confirmModal && confirmModal.isOpen && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl max-w-lg w-full overflow-hidden border border-red-200 animate-in zoom-in-95 duration-150">
            <div className="bg-red-600 text-white px-6 py-4 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <AlertTriangle className="w-6 h-6 text-amber-200" />
                <h3 className="font-bold text-lg">কনফ্লিক্ট সতর্কবার্তা (Conflict Alert)</h3>
              </div>
              <button
                onClick={() => setConfirmModal(null)}
                className="text-red-200 hover:text-white transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-6 space-y-4">
              <p className="text-sm text-slate-700 leading-relaxed font-medium">
                আপনি <strong className="text-blue-700">{confirmModal.entry?.course_code}</strong> কোর্সটি{' '}
                <strong className="text-slate-900">{confirmModal.target?.day}</strong> দিনে{' '}
                <strong className="text-slate-900">{fmtTime(confirmModal.target?.slotStart)}</strong> স্লটে স্থানান্তর করতে চাচ্ছেন। কিন্তু নিচের কনফ্লিক্টগুলো পাওয়া গেছে:
              </p>

              <div className="bg-red-50 border border-red-200 rounded-xl p-4 space-y-2">
                {confirmModal.conflicts?.reasons.map((r, i) => (
                  <div key={i} className="flex items-start gap-2 text-xs text-red-800 font-semibold leading-relaxed">
                    <span className="shrink-0 mt-0.5">•</span>
                    <span>{r}</span>
                  </div>
                ))}
              </div>

              <p className="text-xs text-slate-500 italic">
                আপনি কি কনফ্লিক্ট থাকা সত্ত্বেও জোরপূর্বক (Force Move) ক্লাসটি নতুন স্লটে স্থানান্তর করতে চান?
              </p>
            </div>

            <div className="px-6 py-3.5 bg-slate-50 border-t border-slate-100 flex items-center justify-end gap-3">
              <button
                onClick={() => setConfirmModal(null)}
                className="px-4 py-2 text-xs font-semibold text-slate-600 hover:text-slate-800 hover:bg-slate-200 rounded-lg transition-colors"
              >
                বাতিল (Cancel)
              </button>
              <button
                onClick={() => {
                  if (typeof onAssignmentMove === 'function') {
                    onAssignmentMove(confirmModal.entry, confirmModal.target);
                  }
                  setConfirmModal(null);
                }}
                className="px-4 py-2 text-xs font-bold bg-red-600 hover:bg-red-700 text-white rounded-lg transition-colors shadow-md flex items-center gap-1.5"
              >
                জোরপূর্বক স্থানান্তর করুন (Force Move)
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

function renderCell(cell, onCellClick, setDraggedEntry) {
  if (!cell) return <div className="w-full h-14" />;
  if (cell._merged) {
    return (
      <div className="w-full flex flex-col">
        {cell._merged.map((m, i) => (
          <CellBody key={i} entry={m} onCellClick={onCellClick} setDraggedEntry={setDraggedEntry} />
        ))}
      </div>
    );
  }
  return <CellBody entry={cell} onCellClick={onCellClick} setDraggedEntry={setDraggedEntry} />;
}

function CellBody({ entry, onCellClick, setDraggedEntry }) {
  const colorClass = getCourseColorClass(entry.course_code);
  const isClickable = typeof onCellClick === 'function';

  return (
    <div
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData('text/plain', JSON.stringify(entry));
        e.dataTransfer.effectAllowed = 'move';
        if (typeof setDraggedEntry === 'function') setDraggedEntry(entry);
      }}
      onDragEnd={() => {
        if (typeof setDraggedEntry === 'function') setDraggedEntry(null);
      }}
      onClick={isClickable ? () => onCellClick(entry) : undefined}
      title={`ড্র্যাগ করে সরান (${entry.year_sem} সারি)`}
      className={`w-full h-14 ${colorClass} flex flex-col items-center justify-center px-1 py-1 gap-1 group relative cursor-grab active:cursor-grabbing hover:ring-2 hover:ring-inset hover:ring-blue-500 hover:brightness-95 transition-all duration-150 select-none`}
    >
      <div className="absolute top-1 left-1 opacity-0 group-hover:opacity-100 transition-opacity">
        <GripVertical className="w-3 h-3 text-slate-500" />
      </div>

      <div className="flex flex-row items-center justify-center gap-1.5 flex-wrap w-full leading-tight">
        <span className="text-[11px] font-bold text-slate-800 text-center whitespace-nowrap">
          {entry.course_code}
        </span>
        <span className="text-[11px] text-slate-700 font-bold text-center whitespace-nowrap">
          -
        </span>
        <span className="text-[10px] text-slate-700 font-semibold text-center whitespace-nowrap">
          {entry.teacher_abbr}
        </span>
      </div>
      <span className="text-[10px] text-slate-600 font-bold leading-tight text-center">
        {entry.room_id}
      </span>
    </div>
  );
}

function TeacherLegend({ teachers }) {
  const sorted = [...teachers].sort((a, b) =>
    String(a.abbreviation || '').localeCompare(String(b.abbreviation || ''))
  );
  const half = Math.ceil(sorted.length / 2);
  const leftList = sorted.slice(0, half);
  const rightList = sorted.slice(half);

  const rows = [];
  for (let i = 0; i < half; i++) {
    rows.push({
      left: leftList[i],
      right: rightList[i],
    });
  }

  return (
    <div className="border-t border-slate-300 bg-slate-50 p-3 sm:p-4">
      <h3 className="font-bold text-xs sm:text-sm mb-2.5 text-blue-900 flex items-center justify-between">
        <span>Teacher Legend</span>
        <span className="text-[10px] font-normal text-slate-500">{teachers.length} teacher{teachers.length !== 1 ? 's' : ''}</span>
      </h3>

      {/* 2-Column Side-by-Side Teacher Table (all devices) */}
      <div className="w-full">
        <table className="w-full text-[11px] border-collapse border border-slate-300 bg-white">
          <thead>
            <tr className="bg-slate-100 text-slate-900 text-center font-bold">
              <th className="px-2 py-1.5 border border-slate-300 w-[25%] text-left">Name</th>
              <th className="px-2 py-1.5 border border-slate-300 w-[17%] text-left">Designation</th>
              <th className="px-2 py-1.5 border border-slate-300 w-[8%] text-center">Department</th>
              <th className="px-2 py-1.5 border border-slate-300 w-[25%] text-left">Name</th>
              <th className="px-2 py-1.5 border border-slate-300 w-[17%] text-left">Designation</th>
              <th className="px-2 py-1.5 border border-slate-300 w-[8%] text-center">Department</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => {
              const leftName = row.left ? `${row.left.full_name} (${row.left.abbreviation})` : '';
              const rightName = row.right ? `${row.right.full_name} (${row.right.abbreviation})` : '';
              return (
                <tr key={i} className="hover:bg-slate-50 text-slate-800">
                  <td className="px-2 py-1 border border-slate-300 font-medium">{leftName}</td>
                  <td className="px-2 py-1 border border-slate-300 text-slate-600">{row.left?.designation || ''}</td>
                  <td className="px-2 py-1 border border-slate-300 text-center text-slate-600 font-semibold">{row.left?.department || ''}</td>
                  <td className="px-2 py-1 border border-slate-300 font-medium">{rightName}</td>
                  <td className="px-2 py-1 border border-slate-300 text-slate-600">{row.right?.designation || ''}</td>
                  <td className="px-2 py-1 border border-slate-300 text-center text-slate-600 font-semibold">{row.right?.department || ''}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default RoutineGrid;