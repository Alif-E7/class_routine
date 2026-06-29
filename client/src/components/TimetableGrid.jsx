import { useMemo } from 'react';
import { DAYS } from '../utils/constants';
import { getCourseColorClass } from '../utils/colors';

// Convert any "THU/THURSDAY/THR" → canonical "THR"
const canonicalizeDay = (d) => {
  const raw = String(d || '').trim().toUpperCase();
  if (raw === 'THU' || raw === 'THURSDAY' || raw === 'THR') return 'THR';
  return raw;
};

// Build the left-side section label shown in the Day/Year-Sem column.
const buildSectionLabel = (year, semester) => {
  const y = parseInt(String(year ?? '').trim(), 10);
  const sm = parseInt(String(semester ?? '').trim(), 10);
  if (!Number.isInteger(y) || !Number.isInteger(sm)) return '';
  return `${y}-${sm}`;
};

const TimetableGrid = ({ entries, semesterName, departmentName }) => {
  const processed = useMemo(() => {
    if (!entries || entries.length === 0) return null;

    const daysMap = {}; 
    const sectionMeta = {}; 
    const allTeachers = new Map();
    const timeSlotsMap = new Map();

    entries.forEach((entry) => {
      const secKey = `${entry.section.deptCode}__${entry.section.year}__${entry.section.semester}`;
      if (!sectionMeta[secKey]) {
        sectionMeta[secKey] = {
          year: entry.section.year,
          semester: entry.section.semester,
          deptCode: entry.section.deptCode,
          label: buildSectionLabel(entry.section.year, entry.section.semester),
        };
      }

      const tCode = entry.teacher.teacherCode;
      if (tCode && !allTeachers.has(tCode)) {
        allTeachers.set(tCode, {
          code: tCode,
          name: entry.teacher.teacherName || '',
          designation: entry.teacher.designation || '',
          deptCode: entry.teacher.deptCode || entry.section.deptCode || '',
        });
      }

      const timeKey = `${entry.timeSlot.startTime}-${entry.timeSlot.endTime}`;
      timeSlotsMap.set(timeKey, { 
        start: entry.timeSlot.startTime, 
        end: entry.timeSlot.endTime
      });

      const canonicalDay = canonicalizeDay(entry.day);
      if (!daysMap[canonicalDay]) daysMap[canonicalDay] = {};
      if (!daysMap[canonicalDay][secKey]) daysMap[canonicalDay][secKey] = {};

      if (daysMap[canonicalDay][secKey][timeKey]) {
        const existing = daysMap[canonicalDay][secKey][timeKey];
        existing._merged = existing._merged || [existing];
        existing._merged.push(entry);
      } else {
        daysMap[canonicalDay][secKey][timeKey] = entry;
      }
    });

    const sortedSlots = Array.from(timeSlotsMap.values()).sort((a, b) => 
      a.start.localeCompare(b.start)
    );
    
    // Find break index by looking for the largest gap between consecutive slots
    let breakIndex = -1;
    let maxGap = 0;
    for (let i = 0; i < sortedSlots.length - 1; i++) {
      const end = new Date(`1970-01-01T${sortedSlots[i].end}:00`);
      const start = new Date(`1970-01-01T${sortedSlots[i+1].start}:00`);
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

    const teachersList = Array.from(allTeachers.values()).sort((a, b) => a.code.localeCompare(b.code));

    return { daysMap, sortedSections, sectionMeta, teachersList, sortedSlots, breakIndex };
  }, [entries]);

  if (!processed) {
    return (
      <div className="bg-white p-12 text-center rounded-xl border border-slate-200">
        <p className="text-slate-500">No routine data found for the selected filters.</p>
      </div>
    );
  }

  const { daysMap, sortedSections, sectionMeta, teachersList, sortedSlots, breakIndex } = processed;
  // If no break found (breakIndex === -1), all slots go in the morning section (no break column)
  const hasBreak = breakIndex >= 0;
  const morningSlots = hasBreak ? sortedSlots.slice(0, breakIndex + 1) : sortedSlots;
  const afternoonSlots = hasBreak ? sortedSlots.slice(breakIndex + 1) : [];
  const totalCols = 2 + morningSlots.length + (hasBreak ? 1 : 0) + afternoonSlots.length;

  return (
    <div className="bg-white border border-blue-900 rounded-lg overflow-hidden shadow-md font-sans">
      <table className="w-full border-collapse min-w-[800px]">
        <thead>
          <tr>
            <th colSpan={totalCols} className="bg-blue-900 text-white font-bold text-center py-3 text-2xl tracking-tight border-b-2 border-blue-950">
              Gopalganj Science and Technology University
            </th>
          </tr>
          <tr>
            <th colSpan={totalCols} className="bg-blue-800 text-white font-semibold text-center py-1.5 text-base border-b border-blue-900">
              {departmentName === 'All Departments' || !departmentName ? 'All Departments' : `Department of ${departmentName}`}
            </th>
          </tr>
          <tr>
            <th colSpan={totalCols} className="bg-blue-700 text-blue-50 text-center py-1.5 text-sm italic border-b-2 border-blue-900">
              Tentative Class Routine: {semesterName || 'Selected Semester'}
            </th>
          </tr>
          <tr>
            <th rowSpan={2} className="bg-blue-900 text-white font-bold text-center border-r border-blue-950 w-14 text-sm">Day</th>
            <th rowSpan={2} className="bg-blue-900 text-white font-bold text-center border-r border-blue-950 w-24 text-sm">Yr-Sm</th>
            {morningSlots.map((slot, i) => (
              <th key={`m-${i}`} className="bg-blue-700 text-white font-semibold text-center border-r border-blue-900 px-2 py-1 text-xs whitespace-nowrap">
                {formatSlotLabel(slot)}
              </th>
            ))}
            {hasBreak && (
              <th rowSpan={2} className="bg-yellow-300 text-blue-950 font-extrabold text-center border-l border-r border-yellow-500 w-8 text-xs" style={{ writingMode: 'vertical-rl' }}>BREAK</th>
            )}
            {afternoonSlots.map((slot, i) => (
              <th key={`a-${i}`} className="bg-blue-700 text-white font-semibold text-center border-r border-blue-900 px-2 py-1 text-xs whitespace-nowrap">
                {formatSlotLabel(slot)}
              </th>
            ))}
          </tr>
          <tr aria-hidden="true">
            {sortedSlots.map((_, i) => <th key={`h-${i}`} className="hidden" />)}
          </tr>
        </thead>
        <tbody>
          {DAYS.map((day) => {
            const activeSections = sortedSections.filter((sec) => daysMap[day]?.[sec]);
            if (activeSections.length === 0) return null;
            return activeSections.map((secKey, idx) => (
              <tr key={`${day}-${secKey}`} className={idx % 2 === 0 ? 'bg-sky-50' : 'bg-white'}>
                {idx === 0 && (
                  <td rowSpan={activeSections.length} className="bg-blue-900 text-white font-extrabold text-center border-r border-b border-blue-950 text-xs">
                    {day}
                  </td>
                )}
                <td className="bg-slate-200 text-slate-900 font-bold text-center border-r border-b border-blue-900 text-xs px-2">{sectionMeta[secKey].label}</td>
                {morningSlots.map((slot, i) => (
                  <td key={`m-${i}`} className="border-r border-b border-blue-900 p-0 align-stretch">{renderCell(daysMap[day][secKey]?.[`${slot.start}-${slot.end}`])}</td>
                ))}
                {hasBreak && <td className="bg-yellow-200 border-l border-r border-b border-yellow-500" />}
                {afternoonSlots.map((slot, i) => (
                  <td key={`a-${i}`} className="border-r border-b border-blue-900 p-0 align-stretch">{renderCell(daysMap[day][secKey]?.[`${slot.start}-${slot.end}`])}</td>
                ))}
              </tr>
            ));
          })}
        </tbody>
      </table>

      {teachersList.length > 0 && (
        <div className="border-t-2 border-blue-900 bg-slate-50 p-4">
          <h3 className="font-bold text-sm mb-2">Teacher Legend</h3>
          <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-[10px]">
            {teachersList.map((t) => (
              <div key={t.code} className="flex gap-2">
                <span className="font-bold w-12">{t.code}</span>
                <span>{t.name}</span>
                <span className="text-slate-500 italic ml-auto">{t.designation}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

function renderCell(entry) {
  if (!entry) return <div className="w-full h-12" />;
  if (entry._merged) {
    return <div className="w-full flex flex-col">{entry._merged.map((m, i) => <CellBody key={i} entry={m} />)}</div>;
  }
  return <CellBody entry={entry} />;
}

// Format HH:MM as readable time with am/pm
function formatSlotLabel(slot) {
  const fmt = (t) => {
    const [h, m] = String(t || '0:0').split(':').map(Number);
    const ampm = h < 12 ? 'am' : 'pm';
    const hr = h > 12 ? h - 12 : h === 0 ? 12 : h;
    return `${hr}:${String(m).padStart(2,'0')}${ampm}`;
  };
  return `${fmt(slot.start)}-${fmt(slot.end)}`;
}

function CellBody({ entry }) {
  const colorClass = getCourseColorClass(entry.course.courseCode);
  return (
    <div className={`w-full h-14 ${colorClass} flex flex-col items-center justify-center px-1 py-1 gap-0.5`}>
      <span className="text-[11px] font-bold text-slate-800 leading-tight text-center">{entry.course.courseCode}</span>
      <span className="text-[10px] text-slate-700 font-semibold leading-tight text-center">{entry.teacher.teacherCode}</span>
      <span className="text-[10px] text-slate-600 font-medium leading-tight text-center">R:{entry.room?.roomNo || ''}</span>
    </div>
  );
}

export default TimetableGrid;
