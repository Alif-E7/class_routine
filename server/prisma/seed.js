// Seeds a usable demo dataset against the global-masters schema.
//
//   - Admin user
//   - Two departments (CSE, MATH)
//   - Global teachers / rooms / courses / sections / time slots
//   - One semester with a handful of sample routine entries
//
// Re-running this seed is safe: every master uses upsert by its natural key.
const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');

const prisma = new PrismaClient();

async function main() {
  // ── Admin user ─────────────────────────────────────────────────────────
  const password = await bcrypt.hash('123456', 10);
  const admin = await prisma.user.upsert({
    where: { email: 'admin_main@gmail.com' },
    update: { password },
    create: {
      email: 'admin_main@gmail.com',
      password,
      role: 'ADMIN'
    }
  });
  console.log(`✅ Admin user ready: ${admin.email}`);

  // ── Global Departments ─────────────────────────────────────────────────
  await prisma.department.upsert({
    where: { deptCode: 'CSE' },
    update: {},
    create: { deptCode: 'CSE', deptName: 'Computer Science and Engineering', faculty: 'Engineering' }
  });
  await prisma.department.upsert({
    where: { deptCode: 'MATH' },
    update: {},
    create: { deptCode: 'MATH', deptName: 'Mathematics', faculty: 'Science' }
  });
  console.log('✅ Departments ready: CSE, MATH');

  // ── Global Rooms ───────────────────────────────────────────────────────
  for (const room of [
    { roomNo: '407', building: 'Main Building' },
    { roomNo: '411A', building: 'Main Building' },
    { roomNo: '412', building: 'Main Building' }
  ]) {
    await prisma.room.upsert({
      where: { roomNo: room.roomNo },
      update: { building: room.building },
      create: room
    });
  }
  console.log('✅ Rooms ready');

  // ── Global Teachers ────────────────────────────────────────────────────
  for (const t of [
    { teacherCode: 'MF', teacherName: 'Md. Ferdous', deptCode: 'CSE', designation: 'Lecturer' },
    { teacherCode: 'AK', teacherName: 'Ahmed Khan', deptCode: 'CSE', designation: 'Associate Professor' },
    { teacherCode: 'SY', teacherName: 'Sabina Yeasmin', deptCode: 'MATH', designation: 'Assistant Professor' }
  ]) {
    await prisma.teacher.upsert({
      where: { teacherCode: t.teacherCode },
      update: t,
      create: t
    });
  }
  console.log('✅ Teachers ready');

  // ── Global Courses ─────────────────────────────────────────────────────
  for (const c of [
    { courseCode: 'CSE404', courseName: 'Computer Architecture', credit: 3, deptCode: 'CSE' },
    { courseCode: 'CSE302', courseName: 'Data Structures', credit: 3, deptCode: 'CSE' },
    { courseCode: 'MATH101', courseName: 'Calculus I', credit: 3, deptCode: 'MATH' }
  ]) {
    await prisma.course.upsert({
      where: { courseCode: c.courseCode },
      update: c,
      create: c
    });
  }
  console.log('✅ Courses ready');

  // ── Global Sections ────────────────────────────────────────────────────
  for (const s of [
    { deptCode: 'CSE', year: 4, semester: 1 },
    { deptCode: 'CSE', year: 3, semester: 2 },
    { deptCode: 'MATH', year: 1, semester: 1 }
  ]) {
    await prisma.section.upsert({
      where: {
        deptCode_year_semester: { deptCode: s.deptCode, year: s.year, semester: s.semester }
      },
      update: {},
      create: s
    });
  }
  console.log('✅ Sections ready');

  // ── Global TimeSlots ───────────────────────────────────────────────────
  for (const ts of [
    { startTime: '09:00', endTime: '09:50' },
    { startTime: '09:50', endTime: '10:40' },
    { startTime: '10:40', endTime: '11:30' },
    { startTime: '11:30', endTime: '12:20' },
    { startTime: '12:20', endTime: '14:00' } // lab block
  ]) {
    await prisma.timeSlot.upsert({
      where: {
        startTime_endTime: { startTime: ts.startTime, endTime: ts.endTime }
      },
      update: {},
      create: ts
    });
  }
  console.log('✅ TimeSlots ready');

  // ── Sample Semester + RoutineEntries ───────────────────────────────────
  const semesterName = 'July-December 2026';
  const semester = await prisma.semester.upsert({
    where: { name: semesterName },
    update: {},
    create: { name: semesterName, year: 2026 }
  });

  // Clear any previous demo routine for this semester (idempotent re-seed).
  const cseSection = await prisma.section.findUnique({
    where: { deptCode_year_semester: { deptCode: 'CSE', year: 4, semester: 1 } }
  });
  if (cseSection) {
    await prisma.routineEntry.deleteMany({
      where: { semesterId: semester.id, sectionId: cseSection.id }
    });
  }

  const [cse404, math101, mf, sy, room407, room411a, ts1040, ts0900] = await Promise.all([
    prisma.course.findUnique({ where: { courseCode: 'CSE404' } }),
    prisma.course.findUnique({ where: { courseCode: 'MATH101' } }),
    prisma.teacher.findUnique({ where: { teacherCode: 'MF' } }),
    prisma.teacher.findUnique({ where: { teacherCode: 'SY' } }),
    prisma.room.findUnique({ where: { roomNo: '407' } }),
    prisma.room.findUnique({ where: { roomNo: '411A' } }),
    prisma.timeSlot.findUnique({
      where: { startTime_endTime: { startTime: '10:40', endTime: '11:30' } }
    }),
    prisma.timeSlot.findUnique({
      where: { startTime_endTime: { startTime: '09:00', endTime: '09:50' } }
    })
  ]);

  if (cseSection && cse404 && math101 && mf && sy && room407 && room411a && ts1040 && ts0900) {
    await prisma.routineEntry.createMany({
      data: [
        {
          day: 'SUN',
          sectionId: cseSection.id,
          courseId: cse404.id,
          teacherId: mf.id,
          roomId: room407.id,
          timeSlotId: ts1040.id,
          semesterId: semester.id
        },
        {
          day: 'MON',
          sectionId: cseSection.id,
          courseId: math101.id,           // MATH course taught to CSE section — cross-dept, now supported
          teacherId: sy.id,               // MATH teacher teaching CSE students — cross-dept, now supported
          roomId: room411a.id,
          timeSlotId: ts0900.id,
          semesterId: semester.id
        }
      ]
    });
    console.log(`✅ Sample routine entries created for semester: ${semesterName}`);
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
