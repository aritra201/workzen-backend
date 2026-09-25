const crypto = require('crypto');
const { AppError } = require('../utils/AppError');
const { hashToken } = require('./token.helper');

const OTP_LENGTH = 4;

function generateNumericOtp() {
  const value = crypto.randomInt(0, 10 ** OTP_LENGTH);
  const rawOtp = String(value).padStart(OTP_LENGTH, '0');
  return { rawOtp, otpHash: hashToken(rawOtp) };
}

function parseOtpInput(otp) {
  if (otp === undefined || otp === null) {
    throw new AppError('otp is required', 400);
  }
  const normalized = String(otp).trim();
  if (!/^\d{4}$/.test(normalized)) {
    throw new AppError('otp must be a 4-digit code', 400);
  }
  return normalized;
}

function hashOtp(rawOtp) {
  return hashToken(parseOtpInput(rawOtp));
}

module.exports = {
  OTP_LENGTH,
  generateNumericOtp,
  parseOtpInput,
  hashOtp,
};
