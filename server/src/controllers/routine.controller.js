const routineService = require('../services/routine.service');

const getRoutine = async (req, res, next) => {
  try {
    const { semesterId, department, year, semester } = req.query;
    const entries = await routineService.getRoutine({
      semesterId,
      department,
      year,
      semester
    });
    res.json({ success: true, data: entries });
  } catch (error) {
    next(error);
  }
};

module.exports = { getRoutine };
