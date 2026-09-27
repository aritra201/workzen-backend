const extraShiftService = require('../service/extraShift.service');
const { AppError } = require('../utils/AppError');
const { parseObjectId } = require('../utils/objectId.helper');

async function declare(req, res) {
  const { employeeId, date, extraDayShift, extraNightShift } = req.body;

  if (!employeeId || !date) {
    throw new AppError('employeeId and date are required', 400);
  }

  const result = await extraShiftService.declareExtraShifts({
    company: req.company,
    adminUserId: req.user._id,
    employeeId,
    date,
    extraDayShift,
    extraNightShift,
  });

  res.status(200).json({
    message: 'Extra shift(s) declared',
    attendance: result,
  });
}

async function list(req, res) {
  const {
    date,
    page,
    limit,
    declarationsPage,
    declarationsLimit,
    declarationsEmployeeId,
    employeeId,
  } = req.query;
  const result = await extraShiftService.listExtraShiftDeclarations({
    company: req.company,
    date,
    page,
    limit,
    declarationsPage,
    declarationsLimit,
    declarationsEmployeeId,
    employeeId: employeeId ? parseObjectId(employeeId, 'employeeId') : undefined,
  });
  res.status(200).json(result);
}

module.exports = { declare, list };
