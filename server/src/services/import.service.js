const prisma = require('../utils/prisma');

const preprocessExcelData = (data, departmentCode) => {
  const targetDeptCode = String(departmentCode).trim().toUpperCase();

  const shouldAutoFill = (code) => {
    if (!code) return true;
    const str = String(code).trim().toLowerCase();
    return str === '' || str.includes('(auto-filled');
  };

  // Auto-fill dept_code on master sheets for the uploading department
  const sheetsWithDept = ['Departments', 'Teachers', 'Courses', 'Sections'];

  sheetsWithDept.forEach((sheetName) => {
    if (data[sheetName]) {
      data[sheetName].forEach((row) => {
        if (shouldAutoFill(row.dept_code)) {
          row.dept_code = targetDeptCode;
        }
      });
    }
  });

  // RoutineEntries may leave dept_code blank; if so, default it to the uploading department
  if (data.RoutineEntries) {
    data.RoutineEntries.forEach((r) => {
      if (shouldAutoFill(r.dept_code)) {
        r.dept_code = targetDeptCode;
      }
    });

    // Drop routine rows belonging to other departments — uploading for EEE should
    // never touch MATH's classes.
    data.RoutineEntries = data.RoutineEntries.filter(
      (r) => String(r.dept_code || '').trim().toUpperCase() === targetDeptCode
    );
  }

  // Build the set of master codes actually referenced by routine entries, plus the
  // uploading department itself, so we can drop unrelated master rows the user may
  // have left over from a previous template.
  const usedTeacherCodes = new Set();
  const usedCourseCodes = new Set();
  const usedRoomNos = new Set();
  const usedSectionKeys = new Set();

  if (data.RoutineEntries) {
    data.RoutineEntries.forEach((r) => {
      usedTeacherCodes.add(String(r.teacher_code || '').trim());
      usedCourseCodes.add(String(r.course_code || '').trim());
      usedRoomNos.add(String(r.room_no || '').trim());
      const d = String(r.dept_code || '').trim().toUpperCase();
      const y = String(r.year || '').trim();
      const sm = String(r.semester || '').trim();
      usedSectionKeys.add(`${d}-${y}-${sm}`);
    });
  }

  const keepByDept = (row, deptKey = 'dept_code') => {
    const code = String(row[deptKey] || '').trim().toUpperCase();
    return code === targetDeptCode;
  };

  // Sections: keep only those belonging to the target dept AND referenced by entries
  // (or any section for this dept, in case the user re-declares them).
  if (data.Sections) {
    data.Sections = data.Sections.filter((s) => {
      const d = String(s.dept_code || '').trim().toUpperCase();
      const y = String(s.year || '').trim();
      const sm = String(s.semester || '').trim();
      const key = `${d}-${y}-${sm}`;
      return d === targetDeptCode && (usedSectionKeys.has(key) || true);
    });
  }

  // Courses and Teachers are GLOBAL — a CSE routine can legitimately reference
  // a MATH teacher teaching MATH101 to a CSE section (service-course pattern).
  // Keep any row whose code is referenced by RoutineEntries, regardless of dept.
  // dept_code validity is re-checked in validation.service.js against the Departments sheet.
  if (data.Courses) {
    data.Courses = data.Courses.filter((c) =>
      usedCourseCodes.has(String(c.course_code || '').trim())
    );
  }

  if (data.Teachers) {
    data.Teachers = data.Teachers.filter((t) =>
      usedTeacherCodes.has(String(t.teacher_code || '').trim())
    );
  }

  // Rooms are global (no dept_code), so we keep only rooms actually referenced.
  if (data.Rooms) {
    data.Rooms = data.Rooms.filter((r) =>
      usedRoomNos.has(String(r.room_no || '').trim())
    );
  }

  // Departments sheet: keep the uploading department + any cross-dept department
  // referenced by a Teacher or Course row (so dept_code FK checks pass during validation).
  const referencedDeptCodes = new Set();
  (data.Teachers || []).forEach((t) => referencedDeptCodes.add(String(t.dept_code || '').trim().toUpperCase()));
  (data.Courses || []).forEach((c) => referencedDeptCodes.add(String(c.dept_code || '').trim().toUpperCase()));
  referencedDeptCodes.delete('');

  if (data.Departments) {
    data.Departments = data.Departments.filter((d) => {
      const code = String(d.dept_code || '').trim().toUpperCase();
      return code === targetDeptCode || referencedDeptCodes.has(code);
    });
  }

  // Implicit TimeSlot generation: multi-period entries (e.g. Labs 12:20-14:00)
  // may not appear in the explicit TimeSlots sheet. Add them so they can validate.
  if (data.RoutineEntries && data.TimeSlots) {
    const existingTS = new Set(
      data.TimeSlots.map((t) => `${String(t.start_time || '').trim()}-${String(t.end_time || '').trim()}`)
    );
    data.RoutineEntries.forEach((r) => {
      const s = String(r.start_time || '').trim();
      const e = String(r.end_time || '').trim();
      if (s && e) {
        const key = `${s}-${e}`;
        if (!existingTS.has(key)) {
          existingTS.add(key);
          data.TimeSlots.push({ start_time: s, end_time: e });
        }
      }
    });
  }

  // Implicit Section generation: sections referenced in RoutineEntries should automatically
  // exist in the Sections sheet (similar to TimeSlots).
  if (data.RoutineEntries && data.Sections) {
    const existingSections = new Set(
      data.Sections.map((s) => `${String(s.dept_code || '').trim().toUpperCase()}-${String(s.year || '').trim()}-${String(s.semester || '').trim()}`)
    );
    data.RoutineEntries.forEach((r) => {
      const d = String(r.dept_code || targetDeptCode).trim().toUpperCase();
      const y = String(r.year || '').trim();
      const sm = String(r.semester || '').trim();
      if (d && y && sm) {
        const key = `${d}-${y}-${sm}`;
        if (!existingSections.has(key)) {
          existingSections.add(key);
          data.Sections.push({ dept_code: d, year: parseInt(y, 10), semester: parseInt(sm, 10) });
        }
      }
    });
  }
};

const mergeDbDataIntoExcel = async (data) => {
  const referencedTeacherCodes = new Set(
    (data.Teachers || []).map((t) => String(t.teacher_code || '').trim())
  );
  const referencedCourseCodes = new Set(
    (data.Courses || []).map((c) => String(c.course_code || '').trim())
  );
  const referencedRoomNos = new Set(
    (data.Rooms || []).map((r) => String(r.room_no || '').trim())
  );
  const referencedTimeKeys = new Set(
    (data.TimeSlots || []).map((t) => `${String(t.start_time || '').trim()}-${String(t.end_time || '').trim()}`)
  );

  // For RoutineEntries, gather referenced codes too
  (data.RoutineEntries || []).forEach((r) => {
    referencedTeacherCodes.add(String(r.teacher_code || '').trim());
    referencedCourseCodes.add(String(r.course_code || '').trim());
    referencedRoomNos.add(String(r.room_no || '').trim());
    referencedTimeKeys.add(`${String(r.start_time || '').trim()}-${String(r.end_time || '').trim()}`);
  });

  const [dbTeachers, dbCourses, dbRooms, dbTimeSlots] = await Promise.all([
    referencedTeacherCodes.size > 0
      ? prisma.teacher.findMany({ where: { teacherCode: { in: [...referencedTeacherCodes] } } })
      : Promise.resolve([]),
    referencedCourseCodes.size > 0
      ? prisma.course.findMany({ where: { courseCode: { in: [...referencedCourseCodes] } } })
      : Promise.resolve([]),
    referencedRoomNos.size > 0
      ? prisma.room.findMany({ where: { roomNo: { in: [...referencedRoomNos] } } })
      : Promise.resolve([]),
    referencedTimeKeys.size > 0
      ? prisma.timeSlot.findMany({
        where: {
          OR: [...referencedTimeKeys].map((k) => {
            const [s, e] = k.split('-');
            return { startTime: s, endTime: e };
          })
        }
      })
      : Promise.resolve([])
  ]);

  // Merge DB-only rows into the in-memory workbook so validation sees them.
  // Handles key mapping between DB camelCase fields and Excel snake_case fields.
  const mergeByCode = (existing, dbRows, camelKey, snakeKey) => {
    const have = new Set(
      existing.map((r) => String(r[camelKey] || r[snakeKey] || '').trim().toUpperCase())
    );
    dbRows.forEach((r) => {
      const val = String(r[camelKey] || '').trim();
      const valUpper = val.toUpperCase();
      if (valUpper && !have.has(valUpper)) {
        have.add(valUpper);
        // Create an object with both key formats to satisfy validation and import steps
        const mergedObj = {
          [snakeKey]: val,
          [camelKey]: val,
        };
        // Map other properties if they exist
        if (r.deptCode) {
          mergedObj.dept_code = r.deptCode;
          mergedObj.deptCode = r.deptCode;
        }
        if (r.teacherName) {
          mergedObj.teacher_name = r.teacherName;
          mergedObj.teacherName = r.teacherName;
        }
        if (r.designation) mergedObj.designation = r.designation;
        if (r.courseName) {
          mergedObj.course_name = r.courseName;
          mergedObj.courseName = r.courseName;
        }
        if (r.credit !== undefined) mergedObj.credit = r.credit;
        if (r.building) mergedObj.building = r.building;
        if (r.deptName) {
          mergedObj.dept_name = r.deptName;
          mergedObj.deptName = r.deptName;
        }
        if (r.faculty) mergedObj.faculty = r.faculty;

        existing.push(mergedObj);
      }
    });
  };

  mergeByCode(data.Teachers || (data.Teachers = []), dbTeachers, 'teacherCode', 'teacher_code');
  mergeByCode(data.Courses || (data.Courses = []), dbCourses, 'courseCode', 'course_code');
  mergeByCode(data.Rooms || (data.Rooms = []), dbRooms, 'roomNo', 'room_no');

  // TimeSlots uses startTime+endTime composite key, not a single codeKey
  const haveTS = new Set(
    (data.TimeSlots || []).map((t) => `${t.startTime || t.start_time}-${t.endTime || t.end_time}`)
  );
  (dbTimeSlots || []).forEach((ts) => {
    const k = `${ts.startTime}-${ts.endTime}`;
    if (!haveTS.has(k)) {
      haveTS.add(k);
      data.TimeSlots = data.TimeSlots || [];
      data.TimeSlots.push({ start_time: ts.startTime, end_time: ts.endTime });
    }
  });

  // Now collect all referenced department codes from teachers, courses, routine entries, and sections
  const referencedDeptCodes = new Set();
  (data.Teachers || []).forEach((t) => {
    if (t.dept_code) referencedDeptCodes.add(String(t.dept_code).trim().toUpperCase());
    if (t.deptCode) referencedDeptCodes.add(String(t.deptCode).trim().toUpperCase());
  });
  (data.Courses || []).forEach((c) => {
    if (c.dept_code) referencedDeptCodes.add(String(c.dept_code).trim().toUpperCase());
    if (c.deptCode) referencedDeptCodes.add(String(c.deptCode).trim().toUpperCase());
  });
  (data.RoutineEntries || []).forEach((r) => {
    if (r.dept_code) referencedDeptCodes.add(String(r.dept_code).trim().toUpperCase());
    if (r.deptCode) referencedDeptCodes.add(String(r.deptCode).trim().toUpperCase());
  });
  (data.Sections || []).forEach((s) => {
    if (s.dept_code) referencedDeptCodes.add(String(s.dept_code).trim().toUpperCase());
    if (s.deptCode) referencedDeptCodes.add(String(s.deptCode).trim().toUpperCase());
  });
  referencedDeptCodes.delete('');
  referencedDeptCodes.delete('UNDEFINED');
  referencedDeptCodes.delete('NULL');

  const dbDepartments = referencedDeptCodes.size > 0
    ? await prisma.department.findMany({ where: { deptCode: { in: [...referencedDeptCodes] } } })
    : [];

  mergeByCode(data.Departments || (data.Departments = []), dbDepartments, 'deptCode', 'dept_code');
};

const importRoutineData = async (semesterName, departmentCode, data) => {
  const report = {
    departments: 0,
    teachers: 0,
    rooms: 0,
    courses: 0,
    sections: 0,
    timeSlots: 0,
    routineEntries: 0
  };

  // Ensure DB data is merged before executing the import (if not already merged)
  await mergeDbDataIntoExcel(data);

  await prisma.$transaction(async (tx) => {
    const targetDeptCode = String(departmentCode).trim().toUpperCase();
    const semesterYear = new Date().getFullYear();

    // 1. Find or create Semester (idempotent on name)
    let semester = await tx.semester.findFirst({ where: { name: semesterName } });
    if (!semester) {
      semester = await tx.semester.create({
        data: { name: semesterName, year: semesterYear }
      });
    }
    const sId = semester.id;

    // 2. Upsert global Departments (target dept only — others are not touched)
    for (const d of data.Departments || []) {
      const dCode = String(d.dept_code).trim().toUpperCase();
      await tx.department.upsert({
        where: { deptCode: dCode },
        update: {
          deptName: String(d.dept_name || dCode).trim(),
          faculty: d.faculty ? String(d.faculty).trim() : 'Other'
        },
        create: {
          deptCode: dCode,
          deptName: String(d.dept_name || dCode).trim(),
          faculty: d.faculty ? String(d.faculty).trim() : 'Other'
        }
      });
      report.departments += 1;
    }

    // 3. Upsert global Rooms (rooms are global; create if missing)
    for (const r of data.Rooms || []) {
      const rNo = String(r.room_no).trim();
      await tx.room.upsert({
        where: { roomNo: rNo },
        update: {
          building: r.building ? String(r.building).trim() : null
        },
        create: {
          roomNo: rNo,
          building: r.building ? String(r.building).trim() : null
        }
      });
      report.rooms += 1;
    }

    // 4. Upsert global Teachers (must belong to target dept for this upload)
    for (const t of data.Teachers || []) {
      const tCode = String(t.teacher_code).trim();
      const dCode = String(t.dept_code).trim().toUpperCase();
      await tx.teacher.upsert({
        where: { teacherCode: tCode },
        update: {
          teacherName: String(t.teacher_name || tCode).trim(),
          deptCode: dCode,
          designation: t.designation ? String(t.designation).trim() : null
        },
        create: {
          teacherCode: tCode,
          teacherName: String(t.teacher_name || tCode).trim(),
          deptCode: dCode,
          designation: t.designation ? String(t.designation).trim() : null
        }
      });
      report.teachers += 1;
    }

    // 5. Upsert global Courses (must belong to target dept for this upload)
    for (const c of data.Courses || []) {
      const cCode = String(c.course_code).trim();
      const dCode = String(c.dept_code).trim().toUpperCase();
      const credit = parseFloat(c.credit);
      await tx.course.upsert({
        where: { courseCode: cCode },
        update: {
          courseName: String(c.course_name || cCode).trim(),
          credit: Number.isFinite(credit) ? credit : 0,
          deptCode: dCode
        },
        create: {
          courseCode: cCode,
          courseName: String(c.course_name || cCode).trim(),
          credit: Number.isFinite(credit) ? credit : 0,
          deptCode: dCode
        }
      });
      report.courses += 1;
    }

    // 6. Upsert Sections (unique on deptCode+year+semester)
    for (const s of data.Sections || []) {
      const dCode = String(s.dept_code).trim().toUpperCase();
      const yr = parseInt(String(s.year).trim(), 10);
      const sm = parseInt(String(s.semester).trim(), 10);
      const uniq = `${dCode}-${yr}-${sm}`;
      await tx.section.upsert({
        where: {
          deptCode_year_semester: { deptCode: dCode, year: yr, semester: sm }
        },
        update: {},
        create: { deptCode: dCode, year: yr, semester: sm }
      });
      report.sections += 1;
    }

    // 7. Upsert TimeSlots (unique on startTime+endTime, global)
    for (const t of data.TimeSlots || []) {
      const start = String(t.start_time).trim();
      const end = String(t.end_time).trim();
      await tx.timeSlot.upsert({
        where: {
          startTime_endTime: { startTime: start, endTime: end }
        },
        update: {},
        create: { startTime: start, endTime: end }
      });
      report.timeSlots += 1;
    }

    // 8. Resolve IDs for the joining step.
    //    Sections: only those belonging to the target dept in this semester context
    //    (Sections are global; we filter to the target dept to find which sectionIds
    //    we're about to wipe).
    const targetSections = await tx.section.findMany({
      where: { deptCode: targetDeptCode }
    });
    const targetSectionIds = targetSections.map((s) => s.id);

    // 9. Delete only this semester's RoutineEntries for the target dept's sections.
    //    This is the ONLY destructive step. Other departments' routines, and other
    //    semesters' routines, are untouched.
    if (targetSectionIds.length > 0) {
      await tx.routineEntry.deleteMany({
        where: {
          semesterId: sId,
          sectionId: { in: targetSectionIds }
        }
      });
    }

    // 10. Build a single batch of RoutineEntry rows
    const routineRows = (data.RoutineEntries || []).map((r) => {
      const cCode = String(r.course_code).trim();
      const tCode = String(r.teacher_code).trim();
      const roomNo = String(r.room_no).trim();
      const sTime = String(r.start_time).trim();
      const eTime = String(r.end_time).trim();
      const dCode = String(r.dept_code || targetDeptCode).trim().toUpperCase();
      const y = parseInt(String(r.year).trim(), 10);
      const sm = parseInt(String(r.semester).trim(), 10);

      const rawDay = String(r.day).trim().toUpperCase();
      const normalizedDay = rawDay === 'THU' || rawDay === 'THURSDAY' ? 'THR' : rawDay;

      return {
        day: normalizedDay,
        deptCode: dCode,
        year: y,
        semester: sm,
        courseCode: cCode,
        teacherCode: tCode,
        roomNo,
        startTime: sTime,
        endTime: eTime,
        semesterId: sId
      };
    });

    // 11. Resolve FKs in JS, then bulk-insert with real IDs
    const [courseRows, teacherRows, roomRows, tsRows] = await Promise.all([
      tx.course.findMany({ where: { courseCode: { in: routineRows.map((r) => r.courseCode) } } }),
      tx.teacher.findMany({ where: { teacherCode: { in: routineRows.map((r) => r.teacherCode) } } }),
      tx.room.findMany({ where: { roomNo: { in: routineRows.map((r) => r.roomNo) } } }),
      tx.timeSlot.findMany({
        where: {
          OR: routineRows.map((r) => ({
            startTime: r.startTime,
            endTime: r.endTime
          }))
        }
      })
    ]);

    const courseByCode = new Map(courseRows.map((c) => [c.courseCode, c]));
    const teacherByCode = new Map(teacherRows.map((t) => [t.teacherCode, t]));
    const roomByNo = new Map(roomRows.map((rm) => [rm.roomNo, rm]));
    const tsByKey = new Map(tsRows.map((ts) => [`${ts.startTime}-${ts.endTime}`, ts]));
    const sectionByKey = new Map(
      targetSections.map((s) => [`${s.deptCode}-${s.year}-${s.semester}`, s])
    );

    const finalRoutineRows = routineRows.map((r) => {
      const course = courseByCode.get(r.courseCode);
      const teacher = teacherByCode.get(r.teacherCode);
      const room = roomByNo.get(r.roomNo);
      const ts = tsByKey.get(`${r.startTime}-${r.endTime}`);
      const section = sectionByKey.get(`${r.deptCode}-${r.year}-${r.semester}`);

      if (!course || !teacher || !room || !ts || !section) {
        const missing = [];
        if (!course) missing.push(`course: "${r.courseCode}"`);
        if (!teacher) missing.push(`teacher: "${r.teacherCode}"`);
        if (!room) missing.push(`room: "${r.roomNo}"`);
        if (!ts) missing.push(`timeSlot: "${r.startTime}-${r.endTime}"`);
        if (!section) missing.push(`section: "${r.deptCode}-${r.year}-${r.semester}"`);

        const errorMsg = `Mapping failed for RoutineEntry. Missing database records for [${missing.join(', ')}]. Complete row details: ${JSON.stringify({
          dept: r.deptCode,
          year: r.year,
          semester: r.semester,
          course: r.courseCode,
          teacher: r.teacherCode,
          room: r.roomNo,
          slot: `${r.startTime}-${r.endTime}`
        })}`;

        try {
          const fs = require('fs');
          fs.appendFileSync('c:\\Class_Routine\\server_error.log', `[${new Date().toISOString()}] ${errorMsg}\n`);
        } catch (fsErr) {
          console.error('Failed to write to server_error.log:', fsErr.message);
        }

        throw new Error(errorMsg);
      }

      return {
        day: r.day,
        sectionId: section.id,
        courseId: course.id,
        teacherId: teacher.id,
        roomId: room.id,
        timeSlotId: ts.id,
        semesterId: sId
      };
    });

    if (finalRoutineRows.length > 0) {
      await tx.routineEntry.createMany({ data: finalRoutineRows });
    }
    report.routineEntries = finalRoutineRows.length;
  });

  return report;
};

module.exports = { importRoutineData, preprocessExcelData, mergeDbDataIntoExcel };