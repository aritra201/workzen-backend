const crypto = require('crypto');

/**
 * Generates a random raw token plus its SHA-256 hash. The raw token is what
 * gets emailed to the user (in a link); only the hash is ever persisted in
 * the database, mirroring how the Invitation model handles invite tokens —
 * this way a database leak alone can never be used to forge a valid link.
 */
function generateRawTokenAndHash() {
  const rawToken = crypto.randomBytes(32).toString('hex');
  const tokenHash = hashToken(rawToken);
  return { rawToken, tokenHash };
}

function hashToken(rawToken) {
  return crypto.createHash('sha256').update(rawToken).digest('hex');
}

module.exports = { generateRawTokenAndHash, hashToken };
