const { SHIFT_KEY } = require('../utils/enums');
const { AppError } = require('../utils/AppError');

const REGULAR_SHIFT_KEYS = [SHIFT_KEY.DAY, SHIFT_KEY.NIGHT];
const EXTRA_SHIFT_KEYS = [SHIFT_KEY.EXTRA_DAY, SHIFT_KEY.EXTRA_NIGHT];
const FIXED_SHIFT_KEYS = [...REGULAR_SHIFT_KEYS, ...EXTRA_SHIFT_KEYS];

const HALF_SHIFT_KEYS = Object.freeze([SHIFT_KEY.HALF_SHIFT_DAY, SHIFT_KEY.HALF_SHIFT_NIGHT]);

const LEGACY_HALF_SLOT_ALIASES = Object.freeze({
  half_shift_1: SHIFT_KEY.HALF_SHIFT_DAY,
  half_shift_2: SHIFT_KEY.HALF_SHIFT_NIGHT,
});

const ALL_EMPLOYEE_SHIFT_KEYS = new Set([...FIXED_SHIFT_KEYS, ...HALF_SHIFT_KEYS]);

const EXTRA_SHIFTS = new Set(EXTRA_SHIFT_KEYS);

/** @deprecated use HALF_SHIFT_KEYS.length */
const MAX_HALF_SHIFTS = HALF_SHIFT_KEYS.length;

function normalizeEmployeeShiftKey(shiftKey) {
  if (typeof shiftKey !== 'string') {
    return shiftKey;
  }
  const normalized = shiftKey.trim().toLowerCase();
  if (LEGACY_HALF_SLOT_ALIASES[normalized]) {
    return LEGACY_HALF_SLOT_ALIASES[normalized];
  }
  if (/^half_shift_[34]$/.test(normalized)) {
    throw new AppError(
      'Half shift slots 3 and 4 are no longer supported — use half_shift_day or half_shift_night',
      400
    );
  }
  return normalized;
}

function halfShiftKeyFromSlot(slot) {
  if (slot === 1 || slot === 'day') {
    return SHIFT_KEY.HALF_SHIFT_DAY;
  }
  if (slot === 2 || slot === 'night') {
    return SHIFT_KEY.HALF_SHIFT_NIGHT;
  }
  return null;
}

/** @returns {'day'|'night'|null} for ordering / display helpers */
function parseHalfShiftSlot(shiftKey) {
  const key = normalizeEmployeeShiftKey(shiftKey);
  if (key === SHIFT_KEY.HALF_SHIFT_DAY) {
    return 'day';
  }
  if (key === SHIFT_KEY.HALF_SHIFT_NIGHT) {
    return 'night';
  }
  return null;
}

function isHalfShiftKey(shiftKey) {
  try {
    const key = normalizeEmployeeShiftKey(shiftKey);
    return HALF_SHIFT_KEYS.includes(key);
  } catch {
    return false;
  }
}

function isExtraShiftKey(shiftKey) {
  return EXTRA_SHIFTS.has(normalizeEmployeeShiftKey(shiftKey));
}

function assertEmployeeShiftKey(shiftKey) {
  const normalized = normalizeEmployeeShiftKey(shiftKey);
  if (!ALL_EMPLOYEE_SHIFT_KEYS.has(normalized)) {
    throw new AppError(
      'Shift-Key must be day, night, extra_day, extra_night, half_shift_day, or half_shift_night',
      400
    );
  }
}

function ensureHalfShiftFields(attendance) {
  if (!attendance.shifts.half_shift_day) {
    attendance.shifts.half_shift_day = { marked: false };
  }
  if (!attendance.shifts.half_shift_night) {
    attendance.shifts.half_shift_night = { marked: false };
  }
}

/**
 * Copies legacy half_shifts[0|1] into fixed half_shift_day / half_shift_night when needed.
 * @returns {boolean} whether in-memory data was changed
 */
function migrateLegacyHalfShiftArray(attendance) {
  if (!attendance?.shifts) {
    return false;
  }
  const arr = attendance.shifts.half_shifts;
  if (!Array.isArray(arr) || arr.length === 0) {
    return false;
  }

  ensureHalfShiftFields(attendance);

  for (let i = 0; i < Math.min(arr.length, 2); i += 1) {
    if (!arr[i]?.marked) {
      continue;
    }
    const targetKey = i === 0 ? SHIFT_KEY.HALF_SHIFT_DAY : SHIFT_KEY.HALF_SHIFT_NIGHT;
    const target = attendance.shifts[targetKey];
    if (!target.marked) {
      Object.assign(target, arr[i]);
    }
  }

  attendance.shifts.half_shifts = [];
  return true;
}

function prepareAttendanceHalfShifts(attendance) {
  const migrated = migrateLegacyHalfShiftArray(attendance);
  ensureHalfShiftFields(attendance);
  return migrated;
}

function countMarkedHalfShifts(attendance) {
  prepareAttendanceHalfShifts(attendance);
  return HALF_SHIFT_KEYS.filter((key) => Boolean(attendance.shifts[key]?.marked)).length;
}

/** @deprecated sequential half slots removed — kept as no-op for callers */
function assertSequentialHalfShiftConfirm() {}

/** @deprecated sequential half slots removed — kept as no-op for callers */
function assertSequentialHalfShiftCancel() {}

function ensureHalfShiftsArray(attendance) {
  prepareAttendanceHalfShifts(attendance);
  return [];
}

function ensureHalfShiftSlot(attendance, slot) {
  prepareAttendanceHalfShifts(attendance);
  const key = halfShiftKeyFromSlot(slot);
  if (!key) {
    throw new AppError('Invalid half shift slot', 400);
  }
  return attendance.shifts[key];
}

/**
 * Mutable shift reference for fixed keys (including half_shift_day / half_shift_night).
 */
function accessEmployeeShift(attendance, shiftKeyRaw) {
  const shiftKey = normalizeEmployeeShiftKey(shiftKeyRaw);
  assertEmployeeShiftKey(shiftKey);
  prepareAttendanceHalfShifts(attendance);
  return {
    shift: attendance.shifts[shiftKey],
    markModified: () => attendance.markModified(`shifts.${shiftKey}`),
    shiftKey,
  };
}

function snapshotHalfShiftMarks(attendance) {
  prepareAttendanceHalfShifts(attendance);
  return {
    [SHIFT_KEY.HALF_SHIFT_DAY]: Boolean(attendance.shifts.half_shift_day?.marked),
    [SHIFT_KEY.HALF_SHIFT_NIGHT]: Boolean(attendance.shifts.half_shift_night?.marked),
  };
}

function assertHalfShiftMarksNotReverted(attendance, beforeHalfMarks) {
  prepareAttendanceHalfShifts(attendance);

  if (Array.isArray(beforeHalfMarks)) {
    for (let i = 0; i < beforeHalfMarks.length; i += 1) {
      if (!beforeHalfMarks[i]) {
        continue;
      }
      const key = i === 0 ? SHIFT_KEY.HALF_SHIFT_DAY : SHIFT_KEY.HALF_SHIFT_NIGHT;
      if (!attendance.shifts[key]?.marked) {
        throw new AppError('Confirmed shifts cannot be unchecked', 400);
      }
    }
    return;
  }

  if (!beforeHalfMarks || typeof beforeHalfMarks !== 'object') {
    return;
  }

  for (const key of HALF_SHIFT_KEYS) {
    if (beforeHalfMarks[key] && !attendance.shifts[key]?.marked) {
      throw new AppError('Confirmed shifts cannot be unchecked', 400);
    }
  }
}

function listMarkedHalfShiftEntries(attendance) {
  prepareAttendanceHalfShifts(attendance);
  const entries = [];
  for (const shiftKey of HALF_SHIFT_KEYS) {
    const shift = attendance.shifts[shiftKey];
    if (shift?.marked) {
      entries.push({ shiftKey, shift });
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
  normalizeEmployeeShiftKey,
  halfShiftKeyFromSlot,
  parseHalfShiftSlot,
  isHalfShiftKey,
  isExtraShiftKey,
  assertEmployeeShiftKey,
  ensureHalfShiftsArray,
  ensureHalfShiftSlot,
  countMarkedHalfShifts,
  assertSequentialHalfShiftConfirm,
  assertSequentialHalfShiftCancel,
  accessEmployeeShift,
  snapshotHalfShiftMarks,
  assertHalfShiftMarksNotReverted,
  listMarkedHalfShiftEntries,
  migrateLegacyHalfShiftArray,
  prepareAttendanceHalfShifts,
};
