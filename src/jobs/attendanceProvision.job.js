const cron = require('node-cron');
const { provisionAttendanceForAllCompanies } = require('../service/attendanceProvisioning.service');

/** Every 3 hours (minute 0) — ensures today's rows exist even if employees never open the app. */
const PROVISION_CRON = '0 */3 * * *';

async function runAttendanceProvisionSweep() {
  const summary = await provisionAttendanceForAllCompanies();
  if (summary.recordsCreated > 0) {
    // eslint-disable-next-line no-console
    console.log(
      `[attendance-provision] created ${summary.recordsCreated} row(s) across ${summary.companiesProcessed} company(ies)`
    );
  }
  return summary;
}

function startAttendanceProvisionJob() {
  cron.schedule(PROVISION_CRON, () => {
    runAttendanceProvisionSweep().catch((err) => {
      // eslint-disable-next-line no-console
      console.error('[attendance-provision] sweep failed:', err);
    });
  });

  runAttendanceProvisionSweep().catch((err) => {
    // eslint-disable-next-line no-console
    console.error('[attendance-provision] initial sweep failed:', err);
  });
}

module.exports = { startAttendanceProvisionJob, runAttendanceProvisionSweep, PROVISION_CRON };
