/**
 * Central enum definitions shared across models.
 * Keeping these in one place avoids drift between schema validators
 * and business-logic checks in services/controllers.
 */

const AUTH_PROVIDER = Object.freeze({
  LOCAL: 'local',
  GOOGLE: 'google',
});

const COMPANY_ROLE = Object.freeze({
  ADMIN: 'admin',
  MEMBER: 'member',
  EMPLOYEE: 'employee',
  SYSTEM: 'system', // used by ActivityLog for scheduled-job actions (e.g. daily lock)
});

const INVITATION_ROLE = Object.freeze({
  MEMBER: 'member',
  EMPLOYEE: 'employee',
});

const INVITATION_STATUS = Object.freeze({
  PENDING: 'pending',
  ACCEPTED: 'accepted',
  EXPIRED: 'expired',
  REVOKED: 'revoked',
});

const SHIFT_KEY = Object.freeze({
  DAY: 'day',
  NIGHT: 'night',
  EXTRA_DAY: 'extra_day',
  EXTRA_NIGHT: 'extra_night',
});

const SHIFT_STATUS = Object.freeze({
  PENDING_VERIFICATION: 'pending_verification',
  VERIFIED: 'verified',
  REJECTED: 'rejected',
});

const UNLOCK_REQUEST_STATUS = Object.freeze({
  PENDING: 'pending',
  APPROVED: 'approved',
  DENIED: 'denied',
});

const CURRENCY = Object.freeze({
  INR: 'INR', // only supported currency in v1; field kept for future extensibility
});

module.exports = {
  AUTH_PROVIDER,
  COMPANY_ROLE,
  INVITATION_ROLE,
  INVITATION_STATUS,
  SHIFT_KEY,
  SHIFT_STATUS,
  UNLOCK_REQUEST_STATUS,
  CURRENCY,
};
