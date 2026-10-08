const payrollService = require('../service/payroll.service');

async function list(req, res) {
  const { employeeId, startDate, endDate, page, limit } = req.query;
  const data = await payrollService.listPayroll(req.company, {
    employeeId,
    startDate,
    endDate,
    page,
    limit,
  });
  res.status(200).json(data);
}

module.exports = { list };
