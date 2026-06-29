// Quick DB state inspector — run after seed/import to confirm everything looks right.
const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();

(async () => {
  const [depts, teachers, rooms, courses, sections, ts, semesters, re] = await Promise.all([
    p.department.count(),
    p.teacher.count(),
    p.room.count(),
    p.course.count(),
    p.section.count(),
    p.timeSlot.count(),
    p.semester.count(),
    p.routineEntry.findMany({
      include: { section: true, course: true, teacher: true, room: true, timeSlot: true, semester: true }
    })
  ]);

  console.log({ depts, teachers, rooms, courses, sections, timeSlots: ts, semesters, routineEntries: re.length });
  re.forEach((r) => {
    console.log(
      ' ->',
      r.day,
      r.course.courseCode,
      r.teacher.teacherCode,
      r.room.roomNo,
      `${r.timeSlot.startTime}-${r.timeSlot.endTime}`,
      `[${r.section.deptCode}-${r.section.year}-${r.section.semester}]`,
      `sem=${r.semester.name}`
    );
  });

  await p.$disconnect();
})();