const mongoose = require('mongoose');
const { SHIFT_STATUS } = require('../utils/enums');

const geoLocationSchema = new mongoose.Schema(
  {
    lat: { type: Number, required: true, min: -90, max: 90 },
    lng: { type: Number, required: true, min: -180, max: 180 },
  },
  { _id: false, versionKey: false }
);

// Shared shape for a regular shift (day / night).
const shiftSchema = new mongoose.Schema(
  {
    marked: { type: Boolean, required: true, default: false },
    amount: { type: Number, min: 0 },
    comment: { type: String, trim: true },
    work_picture: [{ type: String, trim: true }], // Cloudinary URLs
    geo_location: geoLocationSchema,
    status: {
      type: String,
      enum: Object.values(SHIFT_STATUS),
      default: SHIFT_STATUS.AWAITING_SUBMISSION,
    },
    verified_by: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    verified_at: { type: Date },
  },
  { _id: false, versionKey: false }
);

// Extra day/night: same workflow as regular shifts (employee confirms when worked).
// `declared*` fields remain for legacy rows from the old admin-declare flow.
const extraShiftSchema = new mongoose.Schema(
  {
    declared: { type: Boolean, required: true, default: false },
    declared_by: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    declared_at: { type: Date },
    marked: { type: Boolean, required: true, default: false },
    amount: { type: Number, min: 0 },
    comment: { type: String, trim: true },
    work_picture: [{ type: String, trim: true }],
    geo_location: geoLocationSchema,
    status: {
      type: String,
      enum: Object.values(SHIFT_STATUS),
      default: SHIFT_STATUS.AWAITING_ATTENDANCE,
    },
    verified_by: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    verified_at: { type: Date },
  },
  { _id: false, versionKey: false }
);

const attendanceSchema = new mongoose.Schema(
  {
    company_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Company',
      required: true,
    },
    employee_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'EmployeeProfile',
      required: true,
    },
    // Stored at day-precision (time truncated to 00:00:00) — always interpreted
    // in the owning Company's timezone by the service layer, not server-local time.
    date: {
      type: Date,
      required: true,
    },
    lock_attendance: {
      type: Boolean,
      required: true,
      default: false,
    },
    shifts: {
      day: { type: shiftSchema, default: () => ({}) },
      night: { type: shiftSchema, default: () => ({}) },
      extra_day: { type: extraShiftSchema, default: () => ({}) },
      extra_night: { type: extraShiftSchema, default: () => ({}) },
      half_shift_day: { type: shiftSchema, default: () => ({}) },
      half_shift_night: { type: shiftSchema, default: () => ({}) },
      /** @deprecated legacy rows — migrated to half_shift_day / half_shift_night on save */
      half_shifts: {
        type: [shiftSchema],
        default: () => [],
      },
    },
    // Set when this record exists because of an approved UnlockRequest for a
    // past date (FR-063), rather than same-day entry.
    unlocked_via_request_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'UnlockRequest',
    },
    unlock_expires_at: {
      type: Date,
    },
  },
  { timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' }, versionKey: false }
);

// One attendance document per employee per date.
attendanceSchema.index({ employee_id: 1, date: 1 }, { unique: true });
attendanceSchema.index({ company_id: 1, date: 1 });

/**
 * Guards against edits after lock, at the schema layer, as a last line of
 * defense (the primary enforcement belongs in the attendance service, which
 * knows about approved UnlockRequests and can legitimately bypass this).
 *
 * Callers that are performing a deliberate, unlock-request-authorized edit
 * must set `doc.$locals.allowLockedEdit = true` before saving.
 *
 * Employee shift cancel (POST …/shifts/cancel) sets `doc.$locals.allowShiftCancel = true`.
 */
attendanceSchema.pre('save', function migrateLegacyHalfShifts() {
  const { migrateLegacyHalfShiftArray } = require('../helper/employeeShiftKeys.helper');
  if (migrateLegacyHalfShiftArray(this)) {
    this.markModified('shifts');
  }
});

// FR-042: confirmed shifts cannot be unmarked except via employee cancel endpoint.
attendanceSchema.pre('save', async function preventShiftUnconfirm() {
  if (this.isNew || !this.isModified('shifts') || this.$locals.allowShiftCancel) {
    return;
  }

  const existing = await this.constructor
    .findById(this._id)
    .select(
      'shifts.day.marked shifts.night.marked shifts.extra_day.marked shifts.extra_night.marked shifts.half_shift_day.marked shifts.half_shift_night.marked shifts.half_shifts.marked'
    );
  if (!existing) {
    return;
  }

  for (const key of ['day', 'night', 'extra_day', 'extra_night', 'half_shift_day', 'half_shift_night']) {
    if (existing.shifts?.[key]?.marked && !this.shifts?.[key]?.marked) {
      throw new Error('Confirmed shifts cannot be unchecked');
    }
  }

  const beforeHalf = existing.shifts?.half_shifts || [];
  const afterHalf = this.shifts?.half_shifts || [];
  for (let i = 0; i < beforeHalf.length; i++) {
    if (beforeHalf[i]?.marked && !afterHalf[i]?.marked) {
      throw new Error('Confirmed shifts cannot be unchecked');
    }
  }
});

attendanceSchema.pre('save', function guardLockedEdits() {
  const isEditingShiftData = this.isModified('shifts');
  const isAlreadyLocked = !this.isNew && this.lock_attendance;

  if (isEditingShiftData && isAlreadyLocked && !this.$locals.allowLockedEdit) {
    throw new Error(
      'Cannot modify a locked attendance record without an approved unlock request'
    );
  }
});

module.exports = mongoose.model('Attendance', attendanceSchema);
