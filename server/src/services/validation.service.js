// Validates that the parsed Excel sheets have consistent foreign keys and that
// no teacher / room / section is double-booked in the same time slot.
//
// With the global-masters schema, teachers / courses / rooms are not scoped to a
// single department — a MATH teacher can teach an EEE service course, etc. The
// only per-department piece of identity is the Section, identified by
// (deptCode, year, semester).
const validateForeignKeys = (data) => {
  const errors = [];

  const deptCodes = new Set(
    (data.Departments || []).map((d) => String(d.dept_code).trim().toUpperCase())
  );
  const teacherCodes = new Set(
    (data.Teachers || []).map((t) => String(t.teacher_code).trim())
  );
  const roomNos = new Set(
    (data.Rooms || []).map((r) => String(r.room_no).trim())
  );
  const courseCodes = new Set(
    (data.Courses || []).map((c) => String(c.course_code).trim())
  );

  const timeSlots = new Set();
  const timeRegex = /^([01]\d|2[0-3]):([0-5]\d)$/; // HH:MM
  (data.TimeSlots || []).forEach((t, i) => {
    const start = String(t.start_time).trim();
    const end = String(t.end_time).trim();
    if (!timeRegex.test(start)) {
      errors.push(`TimeSlots row ${i + 2}: Invalid start_time '${start}'. Must be HH:MM.`);
    }
    if (!timeRegex.test(end)) {
      errors.push(`TimeSlots row ${i + 2}: Invalid end_time '${end}'. Must be HH:MM.`);
    }
    timeSlots.add(`${start}-${end}`);
  });

  const sectionKeys = new Set(
    (data.Sections || []).map((s) => {
      const d = String(s.dept_code || '').trim().toUpperCase();
      const y = parseInt(String(s.year).trim(), 10);
      const sm = parseInt(String(s.semester).trim(), 10);
      return `${d}-${y}-${sm}`;
    })
  );

  // Teacher.dept_code must reference an existing Department
  (data.Teachers || []).forEach((t, i) => {
    const d = String(t.dept_code || '').trim().toUpperCase();
    if (d && !deptCodes.has(d)) {
      errors.push(`Teacher row ${i + 2}: Invalid dept_code '${d}'`);
    }
  });

  // Course.dept_code must reference an existing Department
  (data.Courses || []).forEach((c, i) => {
    const d = String(c.dept_code || '').trim().toUpperCase();
    if (d && !deptCodes.has(d)) {
      errors.push(`Course row ${i + 2}: Invalid dept_code '${d}'`);
    }
  });

  // Sections: dept_code + year + semester must be sane
  (data.Sections || []).forEach((s, i) => {
    const d = String(s.dept_code || '').trim().toUpperCase();
    const y = parseInt(String(s.year).trim(), 10);
    const sm = parseInt(String(s.semester).trim(), 10);

    if (!deptCodes.has(d)) {
      errors.push(`Section row ${i + 2}: Invalid dept_code '${d}'`);
    }
    if (!Number.isInteger(y) || y < 1 || y > 4) {
      errors.push(`Section row ${i + 2}: Invalid year '${s.year}' (must be 1-4)`);
    }
    if (!Number.isInteger(sm) || sm < 1 || sm > 2) {
      errors.push(`Section row ${i + 2}: Invalid semester '${s.semester}' (must be 1 or 2)`);
    }
  });

  // RoutineEntries: each must reference existing course/teacher/room/timeslot/section
  (data.RoutineEntries || []).forEach((r, i) => {
    const courseCode = String(r.course_code || '').trim();
    const teacherCode = String(r.teacher_code || '').trim();
    const roomNo = String(r.room_no || '').trim();
    const timeSlotKey = `${String(r.start_time || '').trim()}-${String(r.end_time || '').trim()}`;

    const deptCode = String(r.dept_code || '').trim().toUpperCase();
    const y = parseInt(String(r.year), 10);
    const sm = parseInt(String(r.semester), 10);
    const sectionKey = `${deptCode}-${y}-${sm}`;

    if (!deptCodes.has(deptCode)) {
      errors.push(`RoutineEntry row ${i + 2}: Invalid dept_code '${deptCode}'`);
    }
    if (!Number.isInteger(y) || y < 1 || y > 4) {
      errors.push(`RoutineEntry row ${i + 2}: Invalid year '${r.year}' (must be 1-4)`);
    }
    if (!Number.isInteger(sm) || sm < 1 || sm > 2) {
      errors.push(`RoutineEntry row ${i + 2}: Invalid semester '${r.semester}' (must be 1 or 2)`);
    }
    if (!courseCodes.has(courseCode)) {
      errors.push(`RoutineEntry row ${i + 2}: Invalid course_code '${courseCode}'`);
    }
    if (!teacherCodes.has(teacherCode)) {
      errors.push(`RoutineEntry row ${i + 2}: Invalid teacher_code '${teacherCode}'`);
    }
    if (!roomNos.has(roomNo)) {
      errors.push(`RoutineEntry row ${i + 2}: Invalid room_no '${roomNo}'`);
    }
    if (!timeSlots.has(timeSlotKey)) {
      errors.push(`RoutineEntry row ${i + 2}: Invalid time slot '${timeSlotKey}'`);
    }
    if (deptCode && !sectionKeys.has(sectionKey)) {
      errors.push(`RoutineEntry row ${i + 2}: Section '${sectionKey}' not declared in Sections sheet`);
    }
  });

  if (errors.length > 0) {
    const error = new Error('Foreign Key Validation Failed');
    error.statusCode = 400;
    error.details = errors;
    throw error;
  }

  return true;
};

const checkConflicts = (routineEntries) => {
  const errors = [];
  const teacherAllocations = new Set();
  const roomAllocations = new Set();

  // Section-level conflict tracking: maps sectionTimeKey -> list of {teacher, room}
  // A section is only considered double-booked if the SAME teacher or SAME room appears
  // more than once in the same slot. Entries with different teachers AND different rooms
  // are intentional parallel groups (e.g. lab groups A/B running simultaneously).
  const sectionSlotEntries = new Map();

  (routineEntries || []).forEach((r, i) => {
    const day = String(r.day || '').trim();
    const st = String(r.start_time || '').trim();
    const et = String(r.end_time || '').trim();
    const teacher = String(r.teacher_code || '').trim();
    const room = String(r.room_no || '').trim();
    const deptCode = String(r.dept_code || '').trim().toUpperCase();
    const y = parseInt(String(r.year), 10);
    const sm = parseInt(String(r.semester), 10);

    const timeKey = `${day}-${st}-${et}`;

    // Teacher conflict: one teacher cannot be in two places at once
    const teacherKey = `T-${teacher}-${timeKey}`;
    if (teacherAllocations.has(teacherKey)) {
      errors.push(`Conflict at row ${i + 2}: Teacher '${teacher}' is double booked on ${day} at ${st}-${et}`);
    } else {
      teacherAllocations.add(teacherKey);
    }

    // Room conflict: one room cannot hold two classes at once
    const roomKey = `R-${room}-${timeKey}`;
    if (roomAllocations.has(roomKey)) {
      errors.push(`Conflict at row ${i + 2}: Room '${room}' is double booked on ${day} at ${st}-${et}`);
    } else {
      roomAllocations.add(roomKey);
    }

    // Section conflict: only flag if the same teacher OR same room is reused within the section
    // at the same time (i.e. a genuine scheduling mistake, not a parallel group).
    const sectionTimeKey = `S-${deptCode}-${y}-${sm}-${timeKey}`;
    if (!sectionSlotEntries.has(sectionTimeKey)) {
      sectionSlotEntries.set(sectionTimeKey, []);
    }
    const existing = sectionSlotEntries.get(sectionTimeKey);
    const duplicate = existing.find((e) => e.teacher === teacher || e.room === room);
    if (duplicate) {
      if (duplicate.teacher === teacher) {
        errors.push(`Conflict at row ${i + 2}: Teacher '${teacher}' is assigned to section '${deptCode}-${y}-${sm}' twice on ${day} at ${st}-${et}`);
      } else {
        errors.push(`Conflict at row ${i + 2}: Room '${room}' is used by section '${deptCode}-${y}-${sm}' twice on ${day} at ${st}-${et}`);
      }
    }
    existing.push({ teacher, room, row: i + 2 });
  });

  if (errors.length > 0) {
    const error = new Error('Routine Conflicts Detected');
    error.statusCode = 400;
    error.details = errors;
    throw error;
  }

  return true;
};

module.exports = { validateForeignKeys, checkConflicts };