const prisma = require('../utils/prisma');

const getSemesters = async (req, res, next) => {
  try {
    // Fetch all semesters ordered newest first
    const semesters = await prisma.semester.findMany({
      orderBy: { createdAt: 'desc' }
    });

    // For each semester, derive which departments are present by looking at
    // distinct deptCodes on Sections referenced by that semester's RoutineEntries.
    // (Department is a global table with no semesterId, so we must derive this.)
    const semestersWithDepts = await Promise.all(
      semesters.map(async (sem) => {
        // Get distinct deptCodes from sections linked to this semester's routine entries
        const entries = await prisma.routineEntry.findMany({
          where: { semesterId: sem.id },
          select: { section: { select: { deptCode: true } } },
          distinct: ['sectionId']
        });

        const deptCodes = [...new Set(entries.map(e => e.section.deptCode))];

        // Fetch full department records for those codes
        const departments = deptCodes.length > 0
          ? await prisma.department.findMany({
            where: { deptCode: { in: deptCodes } },
            orderBy: { deptCode: 'asc' }
          })
          : [];

        return { ...sem, departments };
      })
    );

    res.json({ success: true, data: semestersWithDepts });
  } catch (error) {
    next(error);
  }
};

const deleteSemester = async (req, res, next) => {
  try {
    const { id } = req.params;
    await prisma.semester.delete({
      where: { id }
    });
    res.json({ success: true, message: 'Semester deleted successfully' });
  } catch (error) {
    next(error);
  }
};

const exportDepartmentRoutine = async (req, res, next) => {
  try {
    const { id: semesterId, deptCode } = req.params;

    // Department is global (no semesterId) — find by deptCode only
    const targetDept = await prisma.department.findFirst({
      where: { deptCode }
    });
    if (!targetDept) return res.status(404).json({ success: false, message: 'Department not found' });

    // Sections are global — find by deptCode only
    const sections = await prisma.section.findMany({ where: { deptCode } });

    // RoutineEntries ARE semester-scoped
    const sectionIds = sections.map(s => s.id);
    const routineEntries = await prisma.routineEntry.findMany({
      where: { semesterId, sectionId: { in: sectionIds } },
      include: { section: true, course: true, teacher: true, room: true, timeSlot: true }
    });

    // Collect IDs actually referenced by this semester's routine entries
    const refTeacherIds = [...new Set(routineEntries.map(r => r.teacherId))];
    const refCourseIds = [...new Set(routineEntries.map(r => r.courseId))];
    const refRoomIds = [...new Set(routineEntries.map(r => r.roomId))];
    const refTsIds = [...new Set(routineEntries.map(r => r.timeSlotId))];

    // Fetch only entities actually used in this semester's routine
    const [teachers, courses, rooms, timeSlots] = await Promise.all([
      refTeacherIds.length > 0 ? prisma.teacher.findMany({ where: { id: { in: refTeacherIds } } }) : Promise.resolve([]),
      refCourseIds.length > 0 ? prisma.course.findMany({ where: { id: { in: refCourseIds } } }) : Promise.resolve([]),
      refRoomIds.length > 0 ? prisma.room.findMany({ where: { id: { in: refRoomIds } } }) : Promise.resolve([]),
      refTsIds.length > 0 ? prisma.timeSlot.findMany({ where: { id: { in: refTsIds } } }) : Promise.resolve([])
    ]);

    // Build Excel Workbook
    const ExcelJS = require('exceljs');
    const wb = new ExcelJS.Workbook();

    const addSheet = (name, columns, data) => {
      const sheet = wb.addWorksheet(name);
      sheet.columns = columns.map(c => ({ header: c, key: c, width: Math.min(Math.max(c.length + 4, 14), 40) }));
      const headerRow = sheet.getRow(1);
      headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };
      headerRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E3A8A' } };
      data.forEach(row => sheet.addRow(row));
    };

    addSheet('Departments', ['dept_code', 'dept_name', 'faculty'], [{
      dept_code: targetDept.deptCode,
      dept_name: targetDept.deptName,
      faculty: targetDept.faculty
    }]);

    addSheet('Teachers', ['teacher_code', 'teacher_name', 'dept_code', 'designation'], teachers.map(t => ({
      teacher_code: t.teacherCode,
      teacher_name: t.teacherName,
      dept_code: t.deptCode,
      designation: t.designation || ''
    })));

    addSheet('Rooms', ['room_no', 'building'], rooms.map(r => ({
      room_no: r.roomNo,
      building: r.building || ''
    })));

    addSheet('Courses', ['course_code', 'course_name', 'credit', 'dept_code'], courses.map(c => ({
      course_code: c.courseCode,
      course_name: c.courseName,
      credit: c.credit,
      dept_code: c.deptCode
    })));

    addSheet('Sections', ['dept_code', 'year', 'semester'], sections.map(s => ({
      dept_code: s.deptCode,
      year: s.year,
      semester: s.semester
    })));

    addSheet('TimeSlots', ['start_time', 'end_time'], timeSlots.map(ts => ({
      start_time: ts.startTime,
      end_time: ts.endTime
    })));

    addSheet('RoutineEntries', ['day', 'dept_code', 'year', 'semester', 'course_code', 'teacher_code', 'room_no', 'start_time', 'end_time'], routineEntries.map(r => ({
      day: r.day,
      dept_code: r.section.deptCode,
      year: r.section.year,
      semester: r.section.semester,
      course_code: r.course.courseCode,
      teacher_code: r.teacher.teacherCode,
      room_no: r.room.roomNo,
      start_time: r.timeSlot.startTime,
      end_time: r.timeSlot.endTime
    })));

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename=${deptCode}_Routine.xlsx`);
    await wb.xlsx.write(res);
    res.end();
  } catch (error) {
    next(error);
  }
};

// Public PDF export for a department's routine in a given semester.
// Used by the homepage (no auth required).
const exportDepartmentRoutinePdf = async (req, res, next) => {
  try {
    const { id: semesterId, deptCode } = req.params;

    const semester = await prisma.semester.findUnique({ where: { id: semesterId } });
    if (!semester) return res.status(404).json({ success: false, message: 'Semester not found' });

    const targetDept = await prisma.department.findFirst({ where: { deptCode } });
    if (!targetDept) return res.status(404).json({ success: false, message: 'Department not found' });

    const sections = await prisma.section.findMany({ where: { deptCode } });
    const sectionIds = sections.map((s) => s.id);

    const routineEntries = await prisma.routineEntry.findMany({
      where: { semesterId, sectionId: { in: sectionIds } },
      include: { section: true, course: true, teacher: true, room: true, timeSlot: true },
      orderBy: [{ day: 'asc' }, { timeSlot: { startTime: 'asc' } }],
    });

    const safeName = `${deptCode}_${(semester.name || 'Routine').replace(/[^a-zA-Z0-9]+/g, '_')}.pdf`;
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${safeName}"`);

    const pdfService = require('../services/pdf.service');
    pdfService.streamDepartmentRoutinePdf(res, {
      entries: routineEntries,
      departmentName: targetDept.deptName,
      semesterName: semester.name,
    });
  } catch (error) {
    next(error);
  }
};

const getDepartmentRoutineData = async (req, res, next) => {
  try {
    const { id: semesterId, deptCode } = req.params;

    // Department is global (no semesterId) — find by deptCode only
    const targetDept = await prisma.department.findFirst({ where: { deptCode } });
    if (!targetDept) return res.status(404).json({ success: false, message: 'Department not found' });

    // Sections are global — find by deptCode only
    const sections = await prisma.section.findMany({ where: { deptCode } });

    // RoutineEntries ARE semester-scoped
    const sectionIds = sections.map(s => s.id);
    const routineEntries = await prisma.routineEntry.findMany({
      where: { semesterId, sectionId: { in: sectionIds } },
      include: { section: true, course: true, teacher: true, room: true, timeSlot: true }
    });

    // Collect IDs actually referenced by this semester's routine entries
    const refTeacherIds = [...new Set(routineEntries.map(r => r.teacherId))];
    const refCourseIds = [...new Set(routineEntries.map(r => r.courseId))];
    const refRoomIds = [...new Set(routineEntries.map(r => r.roomId))];
    const refTsIds = [...new Set(routineEntries.map(r => r.timeSlotId))];

    // Fetch only entities actually used in this semester's routine
    const [teachers, courses, rooms, timeSlots] = await Promise.all([
      refTeacherIds.length > 0 ? prisma.teacher.findMany({ where: { id: { in: refTeacherIds } } }) : Promise.resolve([]),
      refCourseIds.length > 0 ? prisma.course.findMany({ where: { id: { in: refCourseIds } } }) : Promise.resolve([]),
      refRoomIds.length > 0 ? prisma.room.findMany({ where: { id: { in: refRoomIds } } }) : Promise.resolve([]),
      refTsIds.length > 0 ? prisma.timeSlot.findMany({ where: { id: { in: refTsIds } } }) : Promise.resolve([])
    ]);

    const data = {
      Departments: [{
        dept_code: targetDept.deptCode,
        dept_name: targetDept.deptName,
        faculty: targetDept.faculty
      }],
      Teachers: teachers.map(t => ({
        teacher_code: t.teacherCode,
        teacher_name: t.teacherName,
        dept_code: t.deptCode,
        designation: t.designation || ''
      })),
      Rooms: rooms.map(r => ({
        room_no: r.roomNo,
        building: r.building || ''
      })),
      Courses: courses.map(c => ({
        course_code: c.courseCode,
        course_name: c.courseName,
        credit: c.credit,
        dept_code: c.deptCode
      })),
      Sections: sections.map(s => ({
        dept_code: s.deptCode,
        year: s.year,
        semester: s.semester
      })),
      TimeSlots: timeSlots.map(ts => ({
        start_time: ts.startTime,
        end_time: ts.endTime
      })),
      RoutineEntries: routineEntries.map(r => ({
        day: r.day,
        dept_code: r.section.deptCode,
        year: r.section.year,
        semester: r.section.semester,
        course_code: r.course.courseCode,
        teacher_code: r.teacher.teacherCode,
        room_no: r.room.roomNo,
        start_time: r.timeSlot.startTime,
        end_time: r.timeSlot.endTime
      }))
    };

    res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
};

const updateDepartmentRoutineData = async (req, res, next) => {
  try {
    const { id: semesterId, deptCode } = req.params;
    const data = req.body;

    const semester = await prisma.semester.findUnique({
      where: { id: semesterId }
    });

    if (!semester) {
      return res.status(404).json({ success: false, message: 'Semester not found' });
    }

    const importService = require('../services/import.service');

    // We already have the JSON, so we just run the preprocessing and import
    importService.preprocessExcelData(data, deptCode);

    const validationService = require('../services/validation.service');
    await importService.mergeDbDataIntoExcel(data);
    validationService.validateForeignKeys(data);
    validationService.checkConflicts(data.RoutineEntries || []);

    const report = await importService.importRoutineData(semester.name, deptCode, data);

    res.json({ success: true, message: 'Routine updated successfully', data: report });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  getSemesters,
  deleteSemester,
  exportDepartmentRoutine,
  exportDepartmentRoutinePdf,
  getDepartmentRoutineData,
  updateDepartmentRoutineData
};
