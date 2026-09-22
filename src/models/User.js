const mongoose = require('mongoose');
const bcrypt = require('bcrypt');
const { AUTH_PROVIDER } = require('../utils/enums');

const SALT_ROUNDS = 10;

const userSchema = new mongoose.Schema(
  {
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
      index: true,
      match: [/^\S+@\S+\.\S+$/, 'Invalid email format'],
    },
    // Never returned by default queries — must .select('+password_hash') explicitly.
    password_hash: {
      type: String,
      select: false,
    },
    auth_provider: {
      type: String,
      enum: Object.values(AUTH_PROVIDER),
      required: true,
    },
    google_id: {
      type: String,
      sparse: true,
      unique: true,
    },
    is_active: {
      type: Boolean,
      required: true,
      default: false,
    },
    is_email_verified: {
      type: Boolean,
      required: true,
      default: false,
    },
    email_verification_token_hash: { type: String, select: false },
    email_verification_expires: { type: Date, select: false },
    password_reset_token_hash: { type: String, select: false },
    password_reset_expires: { type: Date, select: false },
    current_refresh_token_hash: { type: String, select: false },
  },
  { timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' }, versionKey: false }
);

// --- Validation: local accounts must have a password; google accounts must have a google_id.
// `password_hash` is select:false — on partial updates (e.g. verify email) it is not loaded;
// only enforce when creating a user or when the password field is explicitly changed.
userSchema.pre('validate', function guardAuthProviderFields() {
  if (this.auth_provider === AUTH_PROVIDER.LOCAL) {
    const passwordTouched = this.isNew || this.isModified('password_hash');
    if (passwordTouched && !this.password_hash) {
      throw new Error('password_hash is required for local auth accounts');
    }
  }
  if (this.auth_provider === AUTH_PROVIDER.GOOGLE) {
    const googleIdTouched = this.isNew || this.isModified('google_id');
    if (googleIdTouched && !this.google_id) {
      throw new Error('google_id is required for google auth accounts');
    }
  }
});

// --- Hash password whenever it's set/changed. Callers set `password_hash` to the
// PLAINTEXT password; this hook replaces it with the bcrypt hash before saving.
userSchema.pre('save', async function hashPassword() {
  if (!this.isModified('password_hash') || !this.password_hash) {
    return;
  }
  this.password_hash = await bcrypt.hash(this.password_hash, SALT_ROUNDS);
});

userSchema.methods.comparePassword = async function comparePassword(plaintext) {
  if (!this.password_hash) return false;
  return bcrypt.compare(plaintext, this.password_hash);
};

module.exports = mongoose.model('User', userSchema);
