const mongoose = require('mongoose');
const { CURRENCY } = require('../utils/enums');

const companySchema = new mongoose.Schema(
  {
    admin_user_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      unique: true, // one company per admin user in v1
    },
    // Set on manual signup or via company profile update (FR-005 / FR-010).
    company_name: {
      type: String,
      trim: true,
      default: null,
    },

    // --- Optional company profile fields (per FR-010) ---
    company_profile_picture: { type: String, trim: true }, // Cloudinary URL
    owner_name: { type: String, trim: true },
    country_code: { type: String, trim: true },
    personal_email_id: { type: String, trim: true, lowercase: true },
    phone_number: { type: String, trim: true },
    country: { type: String, trim: true },
    state: { type: String, trim: true },
    pin_code: { type: String, trim: true },
    full_address: { type: String, trim: true },

    // --- Settings driving attendance-lock & payroll display (FR-011/012) ---
    timezone: {
      type: String, // IANA tz, e.g. "Asia/Kolkata"
      required: true,
      default: 'Asia/Kolkata',
    },
    currency: {
      type: String,
      enum: Object.values(CURRENCY),
      required: true,
      default: CURRENCY.INR,
      immutable: true, // fixed for v1; revisit when multi-currency is scoped
    },
  },
  { timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' }, versionKey: false }
);

module.exports = mongoose.model('Company', companySchema);
