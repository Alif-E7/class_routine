import { useMemo } from 'react';
import { Filter, X } from 'lucide-react';

/**
 * RoutineFilterBar — filter the displayed routine by teacher / day / time / course.
 *
 * Props:
 *   assignments — full schedule array (unfiltered)
 *   teachers    — array of { abbreviation, full_name }
 *   filters     — { teacher, day, time, course }
 *   onFilter    — (newFilters) => void
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
  const ampm = h24 >= 12 ? 'PM' : 'AM';
  let h12 = h24 % 12;
  if (h12 === 0) h12 = 12;
  return `${h12}:${String(mins).padStart(2, '0')} ${ampm}`;
}

const DAY_ORDER = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];

const RoutineFilterBar = ({ assignments = [], teachers = [], filters = {}, onFilter }) => {
  // Derive distinct values from current assignments (and filter courses by selected teacher)
  const { days, timeSlots, courses } = useMemo(() => {
    const daySet = new Set();
    const timeMap = new Map(); // slot_start -> { start, end }
    const courseMap = new Map(); // course_code -> { code, name }

    for (const a of assignments) {
      if (a.day) daySet.add(a.day);
      if (a.slot_start != null && !timeMap.has(String(a.slot_start))) {
        timeMap.set(String(a.slot_start), { start: a.slot_start, end: a.slot_end });
      }
      if (a.course_code) {
        // If a teacher filter is active, only include courses taught by that selected teacher
        if (!filters.teacher || a.teacher_abbr === filters.teacher) {
          if (!courseMap.has(a.course_code)) {
            courseMap.set(a.course_code, {
              code: a.course_code,
              name: a.course_name || '',
            });
          }
        }
      }
    }

    const days = DAY_ORDER.filter((d) => daySet.has(d));
    const timeSlots = Array.from(timeMap.values()).sort((a, b) => {
      const toMin = (t) => {
        if (typeof t === 'number') return t;
        const parts = String(t).split(':');
        return parseInt(parts[0], 10) * 60 + parseInt(parts[1], 10);
      };
      return toMin(a.start) - toMin(b.start);
    });
    const courses = Array.from(courseMap.values()).sort((a, b) => a.code.localeCompare(b.code));

    return { days, timeSlots, courses };
  }, [assignments, filters.teacher]);

  const hasFilters =
    filters.teacher || filters.day || filters.time || filters.course;

  const handleChange = (key, value) => {
    if (key === 'teacher') {
      // When teacher changes, clear course filter if the course is not taught by the new teacher
      let nextCourse = filters.course || '';
      if (value && nextCourse) {
        const isTaught = assignments.some(
          (a) => a.teacher_abbr === value && a.course_code === nextCourse
        );
        if (!isTaught) nextCourse = '';
      }
      onFilter({ ...filters, teacher: value, course: nextCourse });
    } else {
      onFilter({ ...filters, [key]: value });
    }
  };

  const clearAll = () => {
    onFilter({ teacher: '', day: '', time: '', course: '' });
  };

  const selectClass =
    'w-full bg-white border border-slate-200 rounded-xl px-3 py-2.5 sm:py-2 text-sm sm:text-xs font-semibold text-slate-700 ' +
    'focus:outline-none focus:ring-2 focus:ring-sky-500 focus:border-transparent min-h-[42px] sm:min-h-0 ' +
    'disabled:bg-slate-50 disabled:text-slate-400 transition-colors cursor-pointer';

  return (
    <div className="bg-white border border-slate-200/90 rounded-2xl shadow-xs p-3.5 sm:px-5 sm:py-4">
      <div className="flex items-center gap-2 mb-3">
        <Filter className="w-4 h-4 text-sky-600 shrink-0" />
        <span className="text-xs sm:text-sm font-bold text-slate-800">Filter Routine</span>
        {hasFilters && (
          <button
            onClick={clearAll}
            className="ml-auto flex items-center gap-1 text-xs text-red-600 hover:text-red-800 font-medium bg-red-50 hover:bg-red-100 px-2.5 py-1 rounded-lg transition-colors"
          >
            <X className="w-3 h-3" />
            Clear All
          </button>
        )}
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {/* Teacher filter */}
        <div>
          <label className="block text-[10px] font-semibold text-slate-400 uppercase tracking-wider mb-1">
            Teacher
          </label>
          <select
            className={selectClass}
            value={filters.teacher || ''}
            onChange={(e) => handleChange('teacher', e.target.value)}
            disabled={teachers.length === 0}
          >
            <option value="">All Teachers</option>
            {teachers.map((t) => (
              <option key={t.abbreviation} value={t.abbreviation}>
                {t.full_name ? `${t.full_name} (${t.abbreviation})` : t.abbreviation}
              </option>
            ))}
          </select>
        </div>

        {/* Day filter */}
        <div>
          <label className="block text-[10px] font-semibold text-slate-400 uppercase tracking-wider mb-1">
            Day
          </label>
          <select
            className={selectClass}
            value={filters.day || ''}
            onChange={(e) => handleChange('day', e.target.value)}
            disabled={days.length === 0}
          >
            <option value="">All Days</option>
            {days.map((d) => (
              <option key={d} value={d}>{d}</option>
            ))}
          </select>
        </div>

        {/* Time slot filter */}
        <div>
          <label className="block text-[10px] font-semibold text-slate-400 uppercase tracking-wider mb-1">
            Time Slot
          </label>
          <select
            className={selectClass}
            value={filters.time != null ? String(filters.time) : ''}
            onChange={(e) => handleChange('time', e.target.value)}
            disabled={timeSlots.length === 0}
          >
            <option value="">All Times</option>
            {timeSlots.map((slot) => (
              <option key={String(slot.start)} value={String(slot.start)}>
                {fmtTime(slot.start)} – {fmtTime(slot.end)}
              </option>
            ))}
          </select>
        </div>

        {/* Course filter */}
        <div>
          <label className="block text-[10px] font-semibold text-slate-400 uppercase tracking-wider mb-1">
            Course
          </label>
          <select
            className={selectClass}
            value={filters.course || ''}
            onChange={(e) => handleChange('course', e.target.value)}
            disabled={courses.length === 0}
          >
            <option value="">All Courses</option>
            {courses.map((c) => (
              <option key={c.code} value={c.code}>
                {c.name ? `${c.code} : ${c.name}` : c.code}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Active filter chips */}
      {hasFilters && (
        <div className="flex flex-wrap gap-2 mt-3 pt-3 border-t border-slate-100">
          {filters.teacher && (
            <FilterChip
              label={`Teacher: ${filters.teacher}`}
              onRemove={() => handleChange('teacher', '')}
            />
          )}
          {filters.day && (
            <FilterChip
              label={`Day: ${filters.day}`}
              onRemove={() => handleChange('day', '')}
            />
          )}
          {filters.time && (
            <FilterChip
              label={`Time: ${fmtTime(filters.time)}`}
              onRemove={() => handleChange('time', '')}
            />
          )}
          {filters.course && (() => {
            const match = courses.find((c) => c.code === filters.course);
            const chipLabel = match?.name
              ? `Course: ${match.code} : ${match.name}`
              : `Course: ${filters.course}`;
            return (
              <FilterChip
                label={chipLabel}
                onRemove={() => handleChange('course', '')}
              />
            );
          })()}
        </div>
      )}
    </div>
  );
};

function FilterChip({ label, onRemove }) {
  return (
    <span className="inline-flex items-center gap-1 bg-blue-50 text-blue-800 text-xs font-semibold px-2.5 py-1 rounded-full border border-blue-200">
      {label}
      <button
        onClick={onRemove}
        className="ml-1 hover:text-blue-600 transition-colors"
        title="Remove filter"
      >
        <X className="w-3 h-3" />
      </button>
    </span>
  );
}

export default RoutineFilterBar;
