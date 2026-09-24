const mongoose = require('mongoose');
const { UNLOCK_REQUEST_STATUS } = require('../utils/enums');

const unlockRequestSchema = new mongoose.Schema(
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
    requested_date: {
      type: Date,
      required: true,
    },
    attendance_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Attendance',
      required: true,
    },
    reason: {
      type: String,
      trim: true,
    },
    status: {
      type: String,
      enum: Object.values(UNLOCK_REQUEST_STATUS),
      required: true,
      default: UNLOCK_REQUEST_STATUS.PENDING,
    },
    decided_by: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
    },
    decision_note: {
      type: String,
      trim: true,
    },
    decided_at: {
      type: Date,
    },
    // Set on approval — employee may edit that date until this instant (planning §4.5).
    unlock_expires_at: {
      type: Date,
    },
  },
  { timestamps: { createdAt: 'created_at', updatedAt: false }, versionKey: false }
);

// Every past unmarked date is blocked by default (FR-060) — an employee may
// have at most one *pending* request per date, to avoid duplicate spam requests.
unlockRequestSchema.index(
  { employee_id: 1, requested_date: 1, status: 1 },
  {
    unique: true,
    partialFilterExpression: { status: UNLOCK_REQUEST_STATUS.PENDING },
  }
);
unlockRequestSchema.index({ company_id: 1, status: 1 });
unlockRequestSchema.index(
  { attendance_id: 1, status: 1 },
  {
    unique: true,
    partialFilterExpression: { status: UNLOCK_REQUEST_STATUS.PENDING },
  }
);

module.exports = mongoose.model('UnlockRequest', unlockRequestSchema);
