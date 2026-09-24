const { DateTime } = require('luxon');
const { AppError } = require('../utils/AppError');
const { dateKeyToUtcDate } = require('../utils/timezone.helper');

const DATE_KEY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Parses an optional yyyy-MM-dd query value.
 */
function parseDateKeyInput(value, fieldName) {
  if (value === undefined || value === null || value === '') {
    return null;
  }
  if (typeof value !== 'string' || !DATE_KEY_PATTERN.test(value.trim())) {
    throw new AppError(`${fieldName} must be yyyy-MM-dd`, 400);
  }
  return value.trim();
}

function parseRequiredDateKey(value, fieldName = 'date') {
  const dateKey = parseDateKeyInput(value, fieldName);
  if (!dateKey) {
    throw new AppError(`${fieldName} is required in yyyy-MM-dd format`, 400);
  }
  return dateKey;
}

function resolveDateRangeFilter({
  startDate,
  endDate,
  timezone,
  todayKey,
  defaultWindowDays = 30,
  allowFuture = false,
}) {
  const endDateKey = parseDateKeyInput(endDate, 'endDate') ?? todayKey;
  let startDateKey = parseDateKeyInput(startDate, 'startDate');

  if (!allowFuture && endDateKey > todayKey) {
    throw new AppError('endDate cannot be in the future', 400);
  }

  if (!startDateKey) {
    const windowDays = Math.max(1, defaultWindowDays);
    startDateKey = DateTime.fromFormat(endDateKey, 'yyyy-MM-dd', { zone: timezone })
      .minus({ days: windowDays - 1 })
      .toFormat('yyyy-MM-dd');
  }

  if (startDateKey > endDateKey) {
    throw new AppError('startDate must be on or before endDate', 400);
  }

  if (!allowFuture && startDateKey > todayKey) {
    throw new AppError('startDate cannot be in the future', 400);
  }

  return {
    startDate: startDateKey,
    endDate: endDateKey,
    dateRange: {
      $gte: dateKeyToUtcDate(startDateKey),
      $lte: dateKeyToUtcDate(endDateKey),
    },
  };
}

module.exports = {
  parseDateKeyInput,
  parseRequiredDateKey,
  resolveDateRangeFilter,
};
