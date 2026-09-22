const mongoose = require('mongoose');
const { COMPANY_ROLE } = require('../utils/enums');

const activityLogSchema = new mongoose.Schema(
  {
    company_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Company',
      required: true,
    },
    actor_user_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    actor_role: {
      type: String,
      enum: Object.values(COMPANY_ROLE),
      required: true,
    },
    // e.g. "attendance.amount_edited", "extra_shift.declared",
    // "unlock_request.approved", "invitation.accepted" — see FRD §A.9.
    action_type: {
      type: String,
      required: true,
      trim: true,
    },
    target_type: {
      type: String,
      required: true,
      trim: true,
    },
    target_id: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
    },
    before_value: mongoose.Schema.Types.Mixed,
    after_value: mongoose.Schema.Types.Mixed,
    metadata: mongoose.Schema.Types.Mixed,
  },
  { timestamps: { createdAt: 'created_at', updatedAt: false }, versionKey: false }
);

activityLogSchema.index({ company_id: 1, created_at: -1 });
activityLogSchema.index({ target_type: 1, target_id: 1 });

// Append-only at the application layer: block update/delete operations.
// (This is a safety net, not a substitute for DB-level permissions in prod.)
function blockMutation() {
  throw new Error('ActivityLog entries are append-only and cannot be modified or deleted');
}
activityLogSchema.pre('findOneAndUpdate', blockMutation);
activityLogSchema.pre('updateOne', blockMutation);
activityLogSchema.pre('updateMany', blockMutation);
activityLogSchema.pre('findOneAndDelete', blockMutation);
activityLogSchema.pre('deleteOne', blockMutation);
activityLogSchema.pre('deleteMany', blockMutation);

module.exports = mongoose.model('ActivityLog', activityLogSchema);
