import toast from 'react-hot-toast';

const DAY_ORDER = {
  SUN: 1,
  MON: 2,
  TUE: 3,
  WED: 4,
  THU: 5,
  FRI: 6,
  SAT: 7,
};

/**
 * Format minutes-since-midnight into standard 24h "HH:mm".
 * E.g., 540 -> "09:00", 780 -> "13:00".
 */
export function formatTime24(minutes) {
  if (minutes == null || Number.isNaN(Number(minutes))) return '';
  const m = Number(minutes);
  const hh = String(Math.floor(m / 60)).padStart(2, '0');
  const mm = String(m % 60).padStart(2, '0');
  return `${hh}:${mm}`;
}

/**
 * Format minutes-since-midnight into 12h format "H:MM AM/PM".
 * E.g., 540 -> "09:00 AM", 780 -> "01:00 PM".
 */
export function formatTime12(minutes) {
  if (minutes == null || Number.isNaN(Number(minutes))) return '';
  const m = Number(minutes);
  const h24 = Math.floor(m / 60);
  const mins = m % 60;
  const ampm = h24 >= 12 ? 'PM' : 'AM';
  let h12 = h24 % 12;
  if (h12 === 0) h12 = 12;
  return `${String(h12).padStart(2, '0')}:${String(mins).padStart(2, '0')} ${ampm}`;
}

/**
 * Escape a CSV field value per RFC 4180.
 */
export function escapeCsvField(val) {
  if (val == null) return '';
  const s = String(val);
  if (s.includes(',') || s.includes('"') || s.includes('\n') || s.includes('\r')) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

/**
 * Clean a string for safe filename generation.
 */
function sanitizeFilename(name) {
  return String(name || 'routine')
    .replace(/[^a-zA-Z0-9_-]+/g, '_')
    .slice(0, 60);
}

/**
 * exportRoutineToCsv — Exports the generated routine assignments into a normalized Tabular CSV file.
 *
 * Header:
 * Day,YearSemester,CourseCode,CourseTitle,Teacher,TeacherFullName,Room,StartTime,EndTime,TimeSlot
 *
 * @param {Object} options
 * @param {Array} options.assignments — Routine schedule assignments array
 * @param {Array} [options.teachers=[]] — Array of teacher objects for name resolution
 * @param {string} [options.filename='routine'] — Base filename
 * @returns {boolean} Success status
 */
export function exportRoutineToCsv({
  assignments = [],
  teachers = [],
  filename = 'routine',
}) {
  if (!assignments || assignments.length === 0) {
    toast.error('No schedule assignments available to export.');
    return false;
  }

  try {
    const teacherMap = new Map();
    for (const t of teachers) {
      if (t.abbreviation) {
        teacherMap.set(t.abbreviation, t.full_name || t.name || '');
      }
    }

    // Sort logically by Day -> Year/Sem -> Start Time -> Course
    const sorted = [...assignments].sort((a, b) => {
      const dA = DAY_ORDER[String(a.day || '').trim().toUpperCase()] || 99;
      const dB = DAY_ORDER[String(b.day || '').trim().toUpperCase()] || 99;
      if (dA !== dB) return dA - dB;

      const ysA = String(a.year_sem || '');
      const ysB = String(b.year_sem || '');
      if (ysA !== ysB) return ysA.localeCompare(ysB);

      const sA = Number(a.slot_start) || 0;
      const sB = Number(b.slot_start) || 0;
      if (sA !== sB) return sA - sB;

      return String(a.course_code || '').localeCompare(String(b.course_code || ''));
    });

    const headers = [
      'Day',
      'YearSemester',
      'CourseCode',
      'CourseTitle',
      'Teacher',
      'TeacherFullName',
      'Room',
      'StartTime',
      'EndTime',
      'TimeSlot',
    ];

    const lines = [headers.join(',')];

    for (const a of sorted) {
      const startTime24 = formatTime24(a.slot_start);
      const endTime24 = formatTime24(a.slot_end);
      const start12 = formatTime12(a.slot_start);
      const end12 = formatTime12(a.slot_end);
      const timeSlot = start12 && end12 ? `${start12} - ${end12}` : '';
      const teacherName = teacherMap.get(a.teacher_abbr) || '';
      const courseTitle = a.course_name || a.course_title || '';

      const row = [
        escapeCsvField(a.day),
        escapeCsvField(a.year_sem),
        escapeCsvField(a.course_code),
        escapeCsvField(courseTitle),
        escapeCsvField(a.teacher_abbr),
        escapeCsvField(teacherName),
        escapeCsvField(a.room_id),
        escapeCsvField(startTime24),
        escapeCsvField(endTime24),
        escapeCsvField(timeSlot),
      ];
      lines.push(row.join(','));
    }

    const csvContent = lines.join('\r\n');
    // Add UTF-8 BOM (\uFEFF) so Microsoft Excel opens unicode characters correctly
    const blob = new Blob(['\uFEFF' + csvContent], { type: 'text/csv;charset=utf-8;' });

    const safeName = sanitizeFilename(filename);
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    link.setAttribute('href', url);
    link.setAttribute('download', `${safeName}_schedule.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);

    toast.success('Tabular CSV downloaded successfully!');
    return true;
  } catch (err) {
    console.error('Failed to export CSV:', err);
    toast.error('Failed to export CSV file.');
    return false;
  }
}
