const { FIXED_SHIFT_KEYS } = require('./employeeShiftKeys.helper');

const MARKED_SHIFT_MONGO_OR = [
  { 'shifts.day.marked': true },
  { 'shifts.night.marked': true },
  { 'shifts.extra_day.marked': true },
  { 'shifts.extra_night.marked': true },
  { 'shifts.half_shifts.marked': true },
];

function parseMarkedAttendanceQuery(value) {
  if (value === undefined || value === null || value === '') {
    return false;
  }
  const normalized = String(value).trim().toLowerCase();
  return normalized === 'true' || normalized === '1' || normalized === 'yes';
}

function attendanceDocumentHasMarkedShift(attendance) {
  const shifts = attendance?.shifts || {};
  for (const key of FIXED_SHIFT_KEYS) {
    if (shifts[key]?.marked) {
      return true;
    }
  }
  return (shifts.half_shifts || []).some((half) => Boolean(half?.marked));
}

module.exports = {
  MARKED_SHIFT_MONGO_OR,
  parseMarkedAttendanceQuery,
  attendanceDocumentHasMarkedShift,
};
