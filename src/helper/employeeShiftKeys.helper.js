const { SHIFT_KEY } = require('../utils/enums');
const { AppError } = require('../utils/AppError');

const MAX_HALF_SHIFTS = 4;

const REGULAR_SHIFT_KEYS = [SHIFT_KEY.DAY, SHIFT_KEY.NIGHT];
const EXTRA_SHIFT_KEYS = [SHIFT_KEY.EXTRA_DAY, SHIFT_KEY.EXTRA_NIGHT];
const FIXED_SHIFT_KEYS = [...REGULAR_SHIFT_KEYS, ...EXTRA_SHIFT_KEYS];

const HALF_SHIFT_KEYS = Object.freeze(
  Array.from({ length: MAX_HALF_SHIFTS }, (_, i) => `half_shift_${i + 1}`)
);

const ALL_EMPLOYEE_SHIFT_KEYS = new Set([...FIXED_SHIFT_KEYS, ...HALF_SHIFT_KEYS]);

const EXTRA_SHIFTS = new Set(EXTRA_SHIFT_KEYS);

function halfShiftKeyFromSlot(slot) {
  if (!Number.isInteger(slot) || slot < 1 || slot > MAX_HALF_SHIFTS) {
    return null;
  }
  return `half_shift_${slot}`;
}

function parseHalfShiftSlot(shiftKey) {
  if (typeof shiftKey !== 'string') {
    return null;
  }
  const match = /^half_shift_([1-4])$/.exec(shiftKey.trim().toLowerCase());
  if (!match) {
    return null;
  }
  return Number(match[1]);
}

function isHalfShiftKey(shiftKey) {
  return parseHalfShiftSlot(shiftKey) != null;
}

function isExtraShiftKey(shiftKey) {
  return EXTRA_SHIFTS.has(shiftKey);
}

function assertEmployeeShiftKey(shiftKey) {
  if (!ALL_EMPLOYEE_SHIFT_KEYS.has(shiftKey)) {
    throw new AppError(
      'Shift-Key must be day, night, extra_day, extra_night, or half_shift_1 through half_shift_4',
      400
    );
  }
}

function ensureHalfShiftsArray(attendance) {
  if (!attendance.shifts.half_shifts) {
    attendance.shifts.half_shifts = [];
  }
  return attendance.shifts.half_shifts;
}

function ensureHalfShiftSlot(attendance, slot) {
  const arr = ensureHalfShiftsArray(attendance);
  while (arr.length < slot) {
    arr.push({ marked: false });
  }
  return arr[slot - 1];
}

function countMarkedHalfShifts(attendance) {
  const arr = attendance.shifts?.half_shifts || [];
  return arr.filter((s) => Boolean(s?.marked)).length;
}

function assertSequentialHalfShiftConfirm(attendance, slot) {
  const expected = countMarkedHalfShifts(attendance) + 1;
  if (slot !== expected) {
    throw new AppError(
      `Confirm Half Shift ${expected} before Half Shift ${slot}`,
      400
    );
  }
}

/**
 * Mutable shift reference for fixed keys or half_shift_N slots.
 */
function accessEmployeeShift(attendance, shiftKey) {
  const slot = parseHalfShiftSlot(shiftKey);
  if (slot) {
    const shift = ensureHalfShiftSlot(attendance, slot);
    return {
      shift,
      markModified: () => attendance.markModified('shifts.half_shifts'),
    };
  }
  return {
    shift: attendance.shifts[shiftKey],
    markModified: () => attendance.markModified(`shifts.${shiftKey}`),
  };
}

function snapshotHalfShiftMarks(attendance) {
  return (attendance.shifts?.half_shifts || []).map((s) => Boolean(s?.marked));
}

function assertHalfShiftMarksNotReverted(attendance, beforeHalfMarks) {
  const arr = attendance.shifts?.half_shifts || [];
  for (let i = 0; i < beforeHalfMarks.length; i++) {
    if (beforeHalfMarks[i] && !arr[i]?.marked) {
      throw new AppError('Confirmed shifts cannot be unchecked', 400);
    }
  }
}

function listMarkedHalfShiftEntries(attendance) {
  const arr = attendance.shifts?.half_shifts || [];
  const entries = [];
  for (let i = 0; i < arr.length; i++) {
    if (arr[i]?.marked) {
      entries.push({
        slot: i + 1,
        shiftKey: halfShiftKeyFromSlot(i + 1),
        shift: arr[i],
      });
    }
  }
  return entries;
}

module.exports = {
  MAX_HALF_SHIFTS,
  REGULAR_SHIFT_KEYS,
  EXTRA_SHIFT_KEYS,
  FIXED_SHIFT_KEYS,
  HALF_SHIFT_KEYS,
  ALL_EMPLOYEE_SHIFT_KEYS,
  halfShiftKeyFromSlot,
  parseHalfShiftSlot,
  isHalfShiftKey,
  isExtraShiftKey,
  assertEmployeeShiftKey,
  ensureHalfShiftsArray,
  ensureHalfShiftSlot,
  countMarkedHalfShifts,
  assertSequentialHalfShiftConfirm,
  accessEmployeeShift,
  snapshotHalfShiftMarks,
  assertHalfShiftMarksNotReverted,
  listMarkedHalfShiftEntries,
};
