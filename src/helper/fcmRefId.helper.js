const crypto = require('crypto');

/** Deterministic positive 31-bit integer for FCM subscriber ref_id from Mongo user id. */
function fcmRefIdFromUserId(userId) {
  const hash = crypto.createHash('sha256').update(String(userId)).digest();
  return hash.readUInt32BE(0) & 0x7fffffff;
}

module.exports = { fcmRefIdFromUserId };
