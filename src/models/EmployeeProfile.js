const mongoose = require('mongoose');
const { COMPANY_ROLE } = require('../utils/enums');

const employeeProfileSchema = new mongoose.Schema(
  {
    user_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      // v1: exactly one company per employee. Kept as its own field (rather than
      // merged into User) so this can become a non-unique, multi-row relationship
      // later without restructuring — see DRD §B.4.
      unique: true,
    },
    company_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Company',
      required: true,
    },
    employee_name: {
      type: String,
      required: true,
      trim: true,
    },
    employee_email: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
      match: [/^\S+@\S+\.\S+$/, 'Invalid email format'],
    },
    role: {
      type: String,
      enum: [COMPANY_ROLE.EMPLOYEE],
      required: true,
      default: COMPANY_ROLE.EMPLOYEE,
      immutable: true,
    },
    is_active: {
      type: Boolean,
      required: true,
      default: false,
    },

    // --- Optional profile fields (per FR-035) ---
    employee_profile_picture: { type: String, trim: true }, // Cloudinary URL
    country_code: { type: String, trim: true },
    phone_number: { type: String, trim: true },
    country: { type: String, trim: true },
    state: { type: String, trim: true },
    pin_code: { type: String, trim: true },
    full_address: { type: String, trim: true },
  },
  { timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' }, versionKey: false }
);

// An employee's email must be unique within a given company (not globally —
// the same person's email could in principle be invited by a different
// company once multi-company support lands).
employeeProfileSchema.index({ company_id: 1, employee_email: 1 }, { unique: true });

module.exports = mongoose.model('EmployeeProfile', employeeProfileSchema);
