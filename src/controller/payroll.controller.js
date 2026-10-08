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

async function exportCsv(req, res) {
  const { employeeId, startDate, endDate } = req.query;
  const { csv, filename } = await payrollService.exportPayrollCsv(req.company, {
    employeeId,
    startDate,
    endDate,
  });
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.status(200).send(csv);
}

async function listMy(req, res) {
  const { startDate, endDate, page, limit } = req.query;
  const data = await payrollService.listPayrollForEmployee(req.employment.employeeProfile, {
    startDate,
    endDate,
    page,
    limit,
  });
  res.status(200).json(data);
}

module.exports = { list, listMy, exportCsv };
