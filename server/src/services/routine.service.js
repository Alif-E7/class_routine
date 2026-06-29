const prisma = require('../utils/prisma');

const getRoutine = async (filters) => {
  const { semesterId, department, year, semester } = filters;

  if (!semesterId) throw new Error('semesterId is required');

  const whereClause = { semesterId };

  if (department || year || semester) {
    whereClause.section = {};
    if (department) whereClause.section.deptCode = department;
    if (year !== undefined && year !== '' && year !== null) {
      const y = parseInt(year, 10);
      if (!Number.isNaN(y)) whereClause.section.year = y;
    }
    if (semester !== undefined && semester !== '' && semester !== null) {
      const sm = parseInt(semester, 10);
      if (!Number.isNaN(sm)) whereClause.section.semester = sm;
    }
  }

  return prisma.routineEntry.findMany({
    where: whereClause,
    include: {
      section: true,
      course: true,
      teacher: true,
      room: true,
      timeSlot: true
    },
    orderBy: [
      { day: 'asc' },
      { timeSlot: { startTime: 'asc' } }
    ]
  });
};

module.exports = { getRoutine };