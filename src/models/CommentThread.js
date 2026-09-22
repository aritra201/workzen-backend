const mongoose = require('mongoose');
const { COMPANY_ROLE, SHIFT_KEY } = require('../utils/enums');

const messageSchema = new mongoose.Schema(
  {
    author_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    author_role: {
      type: String,
      enum: [COMPANY_ROLE.ADMIN, COMPANY_ROLE.EMPLOYEE], // members are view-only, never authors (FR-023)
      required: true,
    },
    text: {
      type: String,
      required: true,
      trim: true,
    },
  },
  { timestamps: { createdAt: 'created_at', updatedAt: false }, _id: true, versionKey: false }
);

const commentThreadSchema = new mongoose.Schema(
  {
    attendance_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Attendance',
      required: true,
    },
    shift_key: {
      type: String,
      enum: Object.values(SHIFT_KEY),
      required: true,
    },
    // Ordered: index 0 is always the employee's original shift comment;
    // subsequent entries are the back-and-forth reply thread (FR-073).
    messages: {
      type: [messageSchema],
      default: [],
    },
  },
  { timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' }, versionKey: false }
);

// One thread per shift entry.
commentThreadSchema.index({ attendance_id: 1, shift_key: 1 }, { unique: true });

module.exports = mongoose.model('CommentThread', commentThreadSchema);
