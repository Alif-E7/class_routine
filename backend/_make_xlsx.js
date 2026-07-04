// One-shot: rebuild a minimal valid xlsx for the smoke test
const X = require('xlsx');
const wb = X.utils.book_new();

const sheets = {
  Teachers: [
    ['full_name', 'abbreviation', 'designation', 'department'],
    ['Md. Ferdous', 'MF', 'Lecturer', 'CSE'],
  ],
  Courses: [
    ['course_code', 'course_name', 'credit', 'dept', 'year_sem', 'teacher_abbr'],
    ['CSE404', 'Computer Architecture', '3', 'CSE', '4-1', 'MF'],
  ],
  Rooms: [
    ['room_id', 'room_name', 'type'],
    ['407', 'Room 407', 'classroom'],
  ],
  Credit_Rules: [
    ['credit', 'type', 'classes_per_week', 'duration_minutes'],
    ['3', 'theory', '3', '50'],
  ],
  Room_Preference: [
    ['room_id', 'year_group', 'weight_percent'],
    ['407', '4', '100'],
  ],
  Teacher_Unavailability: [
    ['teacher_abbr', 'day', 'start_time', 'end_time'],
  ],
  Config: [
    ['key', 'value'],
    ['working_days', 'SUN,MON,TUE,WED,THR'],
  ],
};

for (const [n, rows] of Object.entries(sheets)) {
  X.utils.book_append_sheet(wb, X.utils.aoa_to_sheet(rows), n);
}

X.writeFile(wb, '_valid.xlsx');
console.log('wrote _valid.xlsx');