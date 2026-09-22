const mongoose = require('mongoose');
const { COMPANY_ROLE } = require('../utils/enums');

const memberProfileSchema = new mongoose.Schema(
  {
    user_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    company_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Company',
      required: true,
    },
    // Fixed, non-configurable view-only role for v1 (FR-021/023).
    role: {
      type: String,
      enum: [COMPANY_ROLE.MEMBER],
      required: true,
      default: COMPANY_ROLE.MEMBER,
      immutable: true,
    },
    is_active: {
      type: Boolean,
      required: true,
      default: false,
    },
  },
  { timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' }, versionKey: false }
);

// A given user has exactly one membership row per company.
memberProfileSchema.index({ user_id: 1, company_id: 1 }, { unique: true });

module.exports = mongoose.model('MemberProfile', memberProfileSchema);
