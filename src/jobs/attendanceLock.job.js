const cron = require('node-cron');
const { Company, Attendance, EmployeeProfile } = require('../models');
const { COMPANY_ROLE } = require('../utils/enums');
const { writeActivityLog } = require('../helper/activityLog.helper');
const {
  getCompanyTodayDateKey,
  dateKeyToUtcDate,
  utcDateToDateKey,
  isCompanyLocalLockCutoffReached,
  DEFAULT_TIMEZONE,
} = require('../utils/timezone.helper');

/**
 * FR-045: lock attendance at company-local 11:59 PM and catch up missed days.
 */
async function lockAttendanceForCompanyOnDate(companyId, dateKey) {
  const storedDate = dateKeyToUtcDate(dateKey);

  const records = await Attendance.find({
    company_id: companyId,
    date: storedDate,
    lock_attendance: false,
  });

  for (const record of records) {
    record.lock_attendance = true;
    await record.save();

    const employee = await EmployeeProfile.findById(record.employee_id).select('user_id');

    await writeActivityLog({
      companyId,
      actorUserId: employee?.user_id || companyId,
      actorRole: COMPANY_ROLE.SYSTEM,
      actionType: 'attendance.locked',
      targetType: 'Attendance',
      targetId: record._id,
      metadata: { date: dateKey, reason: 'daily_cutoff' },
    });
  }

  return records.length;
}

async function runAttendanceLockSweep() {
  const companies = await Company.find({}).select('_id timezone');

  for (const company of companies) {
    const timezone = company.timezone || DEFAULT_TIMEZONE;
    const todayKey = getCompanyTodayDateKey(timezone);
    const todayUtc = dateKeyToUtcDate(todayKey);

    if (isCompanyLocalLockCutoffReached(timezone)) {
      await lockAttendanceForCompanyOnDate(company._id, todayKey);
    }

    const stale = await Attendance.find({
      company_id: company._id,
      lock_attendance: false,
      date: { $lt: todayUtc },
    });

    for (const record of stale) {
      record.lock_attendance = true;
      await record.save();

      const employee = await EmployeeProfile.findById(record.employee_id).select('user_id');

      await writeActivityLog({
        companyId: company._id,
        actorUserId: employee?.user_id || company._id,
        actorRole: COMPANY_ROLE.SYSTEM,
        actionType: 'attendance.locked',
        targetType: 'Attendance',
        targetId: record._id,
        metadata: {
          date: utcDateToDateKey(record.date),
          reason: 'catch_up_past_date',
        },
      });
    }
  }
}

function startAttendanceLockJob() {
  cron.schedule('* * * * *', () => {
    runAttendanceLockSweep().catch((err) => {
      // eslint-disable-next-line no-console
      console.error('[attendance-lock] sweep failed:', err);
    });
  });
}

module.exports = { startAttendanceLockJob, runAttendanceLockSweep, lockAttendanceForCompanyOnDate };
