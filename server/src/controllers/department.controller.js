const prisma = require('../utils/prisma');

// IMPORTANT: Department / Teacher / Room / Section are GLOBAL tables — they have
// no `semesterId` column. They exist once and are reused across every semester.
// Only `RoutineEntry` is semester-scoped. The semesterId query param (when
// present) is accepted for API compatibility but ignored for these models.
// `Section` has its own `semester` column (the academic-semester counter, 1 or
// 2), which is unrelated to the Semester record's id — don't confuse them.

const getDepartments = async (req, res, next) => {
  try {
    const data = await prisma.department.findMany({ orderBy: { deptCode: 'asc' } });
    res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
};

const getSections = async (req, res, next) => {
  try {
    const { department } = req.query;
    const where = {};
    if (department) where.deptCode = department;
    const data = await prisma.section.findMany({
      where,
      orderBy: [{ deptCode: 'asc' }, { year: 'asc' }, { semester: 'asc' }]
    });
    res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
};

const getTeachers = async (req, res, next) => {
  try {
    const { department } = req.query;
    const where = {};
    if (department) where.deptCode = department;
    const data = await prisma.teacher.findMany({
      where,
      orderBy: [{ deptCode: 'asc' }, { teacherCode: 'asc' }]
    });
    res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
};

const getRooms = async (req, res, next) => {
  try {
    const data = await prisma.room.findMany({ orderBy: { roomNo: 'asc' } });
    res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  getDepartments,
  getSections,
  getTeachers,
  getRooms
};
