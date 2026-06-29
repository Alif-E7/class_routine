// Header alias map shared between excel.service.js (server parser) and lint.service.js.
// Kept as its own module so the linter can be imported without dragging in multer/express
// transitively, and so client-side tooling could share it later.

module.exports = {
  // dept_code
  'dept': 'dept_code',
  'dept_code': 'dept_code',
  'department': 'dept_code',
  'department_code': 'dept_code',
  'deptcode': 'dept_code',

  // dept_name
  'dept_name': 'dept_name',
  'department_name': 'dept_name',
  'deptname': 'dept_name',

  // faculty
  'faculty': 'faculty',

  // teacher_code
  'teacher': 'teacher_code',
  'teacher_code': 'teacher_code',
  'teachercode': 'teacher_code',
  'teacher_id': 'teacher_code',
  'teacher_short': 'teacher_code',
  'initial': 'teacher_code',

  // teacher_name
  'teacher_name': 'teacher_name',
  'teachername': 'teacher_name',

  // designation
  'designation': 'designation',
  'rank': 'designation',
  'title': 'designation',

  // course_code
  'course': 'course_code',
  'course_code': 'course_code',
  'coursecode': 'course_code',
  'course_id': 'course_code',
  'subject': 'course_code',
  'subject_code': 'course_code',
  'code': 'course_code',

  // course_name
  'course_name': 'course_name',
  'coursename': 'course_name',
  'subject_name': 'course_name',

  // credit
  'credit': 'credit',
  'credits': 'credit',
  'credit_hour': 'credit',
  'credit_hours': 'credit',

  // room_no
  'room': 'room_no',
  'room_no': 'room_no',
  'roomno': 'room_no',
  'room_number': 'room_no',
  'room_num': 'room_no',
  'classroom': 'room_no',
  'hall': 'room_no',
  'lab': 'room_no',

  // building
  'building': 'building',
  'block': 'building',
  'hall_name': 'building',

  // year
  'year': 'year',
  'yr': 'year',
  'level': 'year',

  // semester
  'semester': 'semester',
  'sem': 'semester',
  'term': 'semester',

  // day
  'day': 'day',
  'weekday': 'day',
  'day_of_week': 'day',

  // start_time
  'start': 'start_time',
  'start_time': 'start_time',
  'starttime': 'start_time',
  'from': 'start_time',
  'time_from': 'start_time',
  'begin': 'start_time',
  'begin_time': 'start_time',
  'class_start': 'start_time',

  // end_time
  'end': 'end_time',
  'end_time': 'end_time',
  'endtime': 'end_time',
  'to': 'end_time',
  'time_to': 'end_time',
  'finish': 'end_time',
  'finish_time': 'end_time',
  'class_end': 'end_time'
};
