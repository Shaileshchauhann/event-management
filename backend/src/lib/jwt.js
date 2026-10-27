const jwt = require('jsonwebtoken');

// Symmetric (HMAC) signing. Verification always happens server-side against
// DynamoDB anyway, so there's no offline-verification case that would
// justify the extra key-management overhead of asymmetric (RSA/ECDSA) keys.
function signTicketToken({ ticketId, eventId }, secret, expiresAtMs) {
  const expiresInSeconds = Math.max(60, Math.floor((expiresAtMs - Date.now()) / 1000));
  return jwt.sign({ ticketId, eventId }, secret, { expiresIn: expiresInSeconds });
}

function verifyTicketToken(token, secret) {
  return jwt.verify(token, secret); // throws TokenExpiredError / JsonWebTokenError
}

function signToken(payload, secret, options = {}) {
  return jwt.sign(payload, secret, options);
}

function verifyToken(token, secret) {
  return jwt.verify(token, secret);
}

module.exports = { signTicketToken, verifyTicketToken, signToken, verifyToken };
