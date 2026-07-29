import { useEffect } from 'react';
import { X, BookOpen, User, Clock, MapPin, Calendar, GraduationCap } from 'lucide-react';

/**
 * CourseDetailModal — shows full details of a course slot when clicked.
 *
 * Props:
 *   entry    — schedule row: { course_code, course_name, teacher_abbr, room_id,
 *               day, slot_start, slot_end, year_sem }
 *   teachers — array of { abbreviation, full_name, designation, department }
 *   onClose  — function to close the modal
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

const DAY_FULL = {
  SUN: 'Sunday',
  MON: 'Monday',
  TUE: 'Tuesday',
  WED: 'Wednesday',
  THU: 'Thursday',
  FRI: 'Friday',
  SAT: 'Saturday',
};

const CourseDetailModal = ({ entry, teachers = [], onClose }) => {
  // Close on Escape key
  useEffect(() => {
    const handleKey = (e) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [onClose]);

  if (!entry) return null;

  // Find teacher full info
  const teacher = teachers.find(
    (t) => t.abbreviation === entry.teacher_abbr
  );

  const timeLabel = `${fmtTime(entry.slot_start)} – ${fmtTime(entry.slot_end)}`;
  const dayFull = DAY_FULL[entry.day] || entry.day;

  // Parse year-sem for display
  const [yearPart, semPart] = String(entry.year_sem || '').split('-');
  const yearLabel = yearPart ? `Year ${yearPart}` : '';
  const semLabel = semPart === '1' ? 'Odd Semester' : semPart === '2' ? 'Even Semester' : semPart ? `Semester ${semPart}` : '';

  return (
    /* Backdrop */
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ backgroundColor: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(4px)' }}
      onClick={onClose}
    >
      {/* Modal card */}
      <div
        className="relative bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden animate-fadeIn"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header band */}
        <div className="bg-blue-900 px-6 pt-6 pb-5 text-white relative">
          <button
            onClick={onClose}
            className="absolute top-4 right-4 p-1.5 rounded-full bg-white/10 hover:bg-white/20 transition-colors"
            title="Close"
          >
            <X className="w-4 h-4" />
          </button>

          <div className="flex items-start gap-3">
            <div className="bg-white/15 rounded-xl p-2.5 mt-0.5">
              <BookOpen className="w-5 h-5 text-sky-300" />
            </div>
            <div>
              <p className="text-sky-300 text-xs font-semibold tracking-widest uppercase mb-1">
                Course Details
              </p>
              <h2 className="text-xl font-bold leading-tight">
                {entry.course_code}
              </h2>
              {entry.course_name && (
                <p className="text-sky-200 text-sm mt-1 leading-snug">
                  {entry.course_name}
                </p>
              )}
            </div>
          </div>
        </div>

        {/* Body */}
        <div className="p-6 space-y-4">

          {/* Teacher */}
          <InfoRow icon={<User className="w-4 h-4 text-blue-600" />} label="Teacher">
            <div>
              <p className="font-semibold text-slate-800">
                {teacher ? teacher.full_name : entry.teacher_abbr}
                <span className="ml-2 text-xs font-normal text-slate-500">
                  ({entry.teacher_abbr})
                </span>
              </p>
              {teacher?.designation && (
                <p className="text-xs text-slate-500 mt-0.5">
                  {teacher.designation}
                  {teacher.department ? ` · ${teacher.department}` : ''}
                </p>
              )}
            </div>
          </InfoRow>

          {/* Year & Semester */}
          <InfoRow icon={<GraduationCap className="w-4 h-4 text-purple-600" />} label="Batch">
            <p className="font-semibold text-slate-800">
              {entry.year_sem}
              {(yearLabel || semLabel) && (
                <span className="ml-2 text-xs font-normal text-slate-500">
                  ({[yearLabel, semLabel].filter(Boolean).join(', ')})
                </span>
              )}
            </p>
          </InfoRow>

          {/* Day */}
          <InfoRow icon={<Calendar className="w-4 h-4 text-emerald-600" />} label="Day">
            <p className="font-semibold text-slate-800">{dayFull}</p>
          </InfoRow>

          {/* Time */}
          <InfoRow icon={<Clock className="w-4 h-4 text-amber-600" />} label="Time">
            <p className="font-semibold text-slate-800">{timeLabel}</p>
          </InfoRow>

          {/* Room */}
          <InfoRow icon={<MapPin className="w-4 h-4 text-red-500" />} label="Room">
            <p className="font-semibold text-slate-800">{entry.room_id || '—'}</p>
          </InfoRow>

        </div>

        {/* Footer */}
        <div className="px-6 pb-5">
          <button
            onClick={onClose}
            className="w-full bg-blue-900 hover:bg-blue-800 text-white font-semibold py-2.5 rounded-xl transition-colors text-sm"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};

function InfoRow({ icon, label, children }) {
  return (
    <div className="flex items-start gap-3">
      <div className="mt-0.5 bg-slate-100 rounded-lg p-1.5 shrink-0">
        {icon}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider mb-0.5">
          {label}
        </p>
        {children}
      </div>
    </div>
  );
}

export default CourseDetailModal;
