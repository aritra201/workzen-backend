const crypto = require('crypto');
const mongoose = require('mongoose');
const { INVITATION_ROLE, INVITATION_STATUS } = require('../utils/enums');

const DEFAULT_EXPIRY_HOURS = 72;

const invitationSchema = new mongoose.Schema(
  {
    company_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Company',
      required: true,
    },
    invited_email: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
    },
    invited_role: {
      type: String,
      enum: Object.values(INVITATION_ROLE),
      required: true,
    },
    // Required for employee invites (admin pre-sets the name); not used for member invites.
    invited_name: {
      type: String,
      trim: true,
    },
    // Only the SHA-256 hash of the raw token is stored — the raw token is emailed
    // to the invitee once and never persisted, same principle as a password.
    token_hash: {
      type: String,
      required: true,
      select: false,
    },
    status: {
      type: String,
      enum: Object.values(INVITATION_STATUS),
      required: true,
      default: INVITATION_STATUS.PENDING,
    },
    expires_at: {
      type: Date,
      required: true,
    },
    accepted_at: {
      type: Date,
    },
  },
  { timestamps: { createdAt: 'created_at', updatedAt: false }, versionKey: false }
);

invitationSchema.pre('validate', function requireNameForEmployeeInvites() {
  if (this.invited_role === INVITATION_ROLE.EMPLOYEE && !this.invited_name) {
    throw new Error('invited_name is required for employee invitations');
  }
});

// TTL-style lookup index (actual expiry enforcement happens in the service layer
// by checking `expires_at` against now, plus a scheduled sweep to flip stale
// `pending` invites to `expired`).
invitationSchema.index({ company_id: 1, invited_email: 1, status: 1 });

/**
 * Generates a raw invite token + its hash. Call this in the invitation service:
 *   const { rawToken, tokenHash } = Invitation.generateToken();
 *   // email `rawToken` to the invitee, store `tokenHash` as token_hash
 */
invitationSchema.statics.generateToken = function generateToken() {
  const rawToken = crypto.randomBytes(32).toString('hex');
  const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
  return { rawToken, tokenHash };
};

invitationSchema.statics.defaultExpiry = function defaultExpiry() {
  return new Date(Date.now() + DEFAULT_EXPIRY_HOURS * 60 * 60 * 1000);
};

module.exports = mongoose.model('Invitation', invitationSchema);
