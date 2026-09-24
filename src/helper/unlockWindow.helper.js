const env = require('../config/env');

function getUnlockGraceHours() {
  return env.unlockGraceHours;
}

function computeUnlockExpiresAt(fromDate = new Date()) {
  return new Date(fromDate.getTime() + getUnlockGraceHours() * 60 * 60 * 1000);
}

function isUnlockWindowActive(expiresAt) {
  if (!expiresAt) {
    return false;
  }
  return new Date(expiresAt).getTime() > Date.now();
}

module.exports = {
  getUnlockGraceHours,
  computeUnlockExpiresAt,
  isUnlockWindowActive,
};
