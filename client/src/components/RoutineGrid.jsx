import { useMemo } from 'react';
import { getCourseColorClass } from '../utils/colors';

/**
 * RoutineGrid — photo-faithful rendering of the weekly routine.
 *
 * Visual structure (matches reference image):
 *   ┌────────────────────────── HEADER (university / dept / semester) ──────────────┐
 *   │  Day | Yr-Sm | 09:00..12:20 │ BREAK │ 14:00..15:50                            │
 *   │  SUN | 4-1   | cell cell cell cell 5 │  ⋮  │ cell cell                        │
 *   │  SUN | 3-2   | ...                                                          │
 *   │  SUN | 2-2   | ...                                                          │
 *   │  SUN | 2-1   | ...                                                          │
 *   │  SUN | 1-1   | ...                                                          │
 *   │  MON | 4-1   | ...                                                          │
 *   └───────────────────────────────────────────────────────────────────────────────┘
 *   Teacher legend: name / designation / department
 *
 * The data input is the flat array returned by GET /api/batches/:id/schedule:
 *   [{ course_code, teacher_abbr, room_id, day, slot_start, slot_end,
 *      year_sem, session_index }, ...]
 *
 * Props:
 *   - assignments: array of schedule rows
 *   - header:      { university, department, semester }
 *   - teachers:    array of { abbreviation, full_name, designation, department }
 */

const DAYS = ['SUN', 'MON', 'TUE', 'WED', 'THU'];

// Fixed row order, per reference image
const YEAR_SEM_ORDER = ['4-1', '3-2', '2-2', '2-1', '1-1'];

// Format HH:MM:SS, HH:MM, or numeric minutes-since-midnight as "9:00am" / "1:50pm"
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

// Group slots: morning = before break, afternoon = after.
function partitionByBreak(slots, breakStart) {
  // breakStart is in minutes (e.g. 13*60 = 780). Default to 13:00.
  const cutoff = Number.isFinite(breakStart) ? breakStart : 13 * 60;
  const toMin = (t) => {
    const [h, m] = String(t).split(':').map(Number);
    return h * 60 + m;
  };
  const morning = [];
  const afternoon = [];
  for (const s of slots) {
    const startMin = toMin(s.start);
    if (startMin < cutoff) morning.push(s);
    else afternoon.push(s);
  }
  return { morning, afternoon };
}

// "HH:MM:SS" -> minutes
function hmToMin(t) {
  const [h, m] = String(t).split(':').map(Number);
  return h * 60 + m;
}

const RoutineGrid = ({ assignments = [], header, teachers = [] }) => {
  // Build slot list from data (union of distinct slot_starts, sorted),
  // and detect break by looking for the largest gap (≥40 min).
  const { daysPresent, slots, dayMap, yearSemSet, breakStart } = useMemo(() => {
    const daySet = new Set();
    const slotMap = new Map(); // key = "HH:MM"
    const ysSet = new Set();
    const grid = {}; // grid[day][yearSem][slotStart] = cellData

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

    // Largest gap between consecutive slots = the break.
    let biggestGap = 0;
    let gapAfter = -1;
    for (let i = 0; i < sorted.length - 1; i++) {
      const gap = hmToMin(sorted[i + 1].start) - hmToMin(sorted[i].end);
      if (gap > biggestGap) {
        biggestGap = gap;
        gapAfter = i;
      }
    }

    // Only treat as a break if gap ≥ 30 minutes.
    let breakStartMin = null;
    if (gapAfter >= 0 && biggestGap >= 30) {
      breakStartMin = hmToMin(sorted[gapAfter].end);
    }

    return {
      daysPresent: DAYS.filter((d) => daySet.has(d)),
      slots: sorted,
      dayMap: grid,
      yearSemSet: ysSet,
      breakStart: breakStartMin,
    };
  }, [assignments]);

  // Fixed year-sem ordering, intersected with what actually exists.
  const yearSemRows = YEAR_SEM_ORDER.filter((ys) => yearSemSet.has(ys));

  // If data has a year-sem outside the canonical order, append it (defensive).
  for (const ys of yearSemSet) {
    if (!yearSemRows.includes(ys)) yearSemRows.push(ys);
  }

  // Empty-state
  if (assignments.length === 0 || daysPresent.length === 0) {
    return (
      <div className="bg-white border border-slate-200 rounded-xl p-12 text-center text-slate-500">
        No routine generated yet. Click <span className="font-semibold">Generate Routine</span> to run the scheduler.
      </div>
    );
  }

  // Partition slots around the detected break.
  const { morning, afternoon } = partitionByBreak(slots, breakStart ?? 13 * 60);
  const hasBreak = breakStart !== null;
  const totalCols = 2 + morning.length + (hasBreak ? 1 : 0) + afternoon.length;

  // Display order: days as columns OR as rows?
  // Reference image: days are ROWS with 6 sub-rows (year-sem) per day.
  // Time slots are COLUMNS. So rows × columns = days × (yearSem × slots).

  return (
    <div className="bg-white border border-blue-900 rounded-lg overflow-hidden shadow-md font-sans">
      <table className="w-full border-collapse min-w-[1000px]">
        <thead>
          <tr>
            <th
              colSpan={totalCols}
              className="bg-blue-900 text-white font-bold text-center py-3 text-2xl tracking-tight border-b-2 border-blue-950"
            >
              {header?.university || 'University'}
            </th>
          </tr>
          <tr>
            <th
              colSpan={totalCols}
              className="bg-blue-800 text-white font-semibold text-center py-1.5 text-base border-b border-blue-900"
            >
              Department of {header?.department || 'Computer Science and Engineering'}
            </th>
          </tr>
          <tr>
            <th
              colSpan={totalCols}
              className="bg-blue-700 text-blue-50 text-center py-1.5 text-sm italic border-b-2 border-blue-900"
            >
              Tentative Class Routine: {header?.semester || ''}
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
                className="bg-yellow-300 text-blue-950 font-extrabold text-center border-l border-r border-yellow-500 w-8 text-xs"
                style={{ writingMode: 'vertical-rl', textOrientation: 'upright' }}
              >
                BREAK
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
            return activeRows.map((ys, idx) => (
              <tr
                key={`${day}-${ys}`}
                className={idx % 2 === 0 ? 'bg-sky-50' : 'bg-white'}
              >
                {idx === 0 && (
                  <td
                    rowSpan={activeRows.length}
                    className="bg-blue-900 text-white font-extrabold text-center border-r border-b border-blue-950 text-xs"
                  >
                    {day}
                  </td>
                )}
                <td className="bg-slate-200 text-slate-900 font-bold text-center border-r border-b border-blue-900 text-xs px-2">
                  {ys}
                </td>
                {morning.map((slot) => {
                  const cell = dayMap[day]?.[ys]?.[slot.start];
                  return (
                    <td
                      key={`m-${slot.start}`}
                      className="border-r border-b border-blue-900 p-0 align-stretch"
                    >
                      {renderCell(cell)}
                    </td>
                  );
                })}
                {hasBreak && (
                  <td className="bg-yellow-200 border-l border-r border-b border-yellow-500" />
                )}
                {afternoon.map((slot) => {
                  const cell = dayMap[day]?.[ys]?.[slot.start];
                  return (
                    <td
                      key={`a-${slot.start}`}
                      className="border-r border-b border-blue-900 p-0 align-stretch"
                    >
                      {renderCell(cell)}
                    </td>
                  );
                })}
              </tr>
            ));
          })}
        </tbody>
      </table>

      {teachers.length > 0 && <TeacherLegend teachers={teachers} />}
    </div>
  );
};

function renderCell(cell) {
  if (!cell) return <div className="w-full h-14" />;
  if (cell._merged) {
    return (
      <div className="w-full flex flex-col">
        {cell._merged.map((m, i) => (
          <CellBody key={i} entry={m} />
        ))}
      </div>
    );
  }
  return <CellBody entry={cell} />;
}

function CellBody({ entry }) {
  const colorClass = getCourseColorClass(entry.course_code);
  return (
    <div
      className={`w-full h-14 ${colorClass} flex flex-col items-center justify-center px-1 py-1 gap-0.5`}
    >
      <span className="text-[11px] font-bold text-slate-800 leading-tight text-center">
        {entry.course_code}
      </span>
      <span className="text-[10px] text-slate-700 font-semibold leading-tight text-center">
        {entry.teacher_abbr}
      </span>
      <span className="text-[10px] text-slate-600 font-medium leading-tight text-center">
        R:{entry.room_id}
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
    <div className="border-t border-slate-300 bg-slate-50 p-4">
      <h3 className="font-bold text-sm mb-3 text-blue-900">Teacher Legend</h3>
      <div className="overflow-x-auto">
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