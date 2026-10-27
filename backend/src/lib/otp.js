const { randomInt, createHmac, timingSafeEqual } = require('crypto');

const OTP_LENGTH = 6;
const OTP_MODULUS = 1_000_000; // 10^6 → values 0–999999

/**
 * Generate a cryptographically random 6-digit OTP string (zero-padded).
 * Uses crypto.randomInt which is CSPRNG-backed.
 */
function generateOtp() {
  const value = randomInt(0, OTP_MODULUS);
  return value.toString().padStart(OTP_LENGTH, '0');
}

/**
 * Compute HMAC-SHA256 of the OTP code using the application JWT secret.
 * We reuse the existing Secrets Manager secret as the HMAC key so no new
 * secret infrastructure is needed. The code is never stored in plaintext.
 *
 * @param {string} code  - 6-digit OTP string
 * @param {string} secret - JWT/HMAC key from Secrets Manager
 * @returns {string} hex digest
 */
function hashOtp(code, secret) {
  return createHmac('sha256', secret).update(code).digest('hex');
}

/**
 * Constant-time comparison of a submitted code against a stored hash.
 * Uses timingSafeEqual to prevent timing side-channel attacks.
 *
 * @param {string} submittedCode - Code submitted by the user
 * @param {string} storedHash    - HMAC hex stored in DynamoDB
 * @param {string} secret        - HMAC key from Secrets Manager
 * @returns {boolean}
 */
function verifyOtp(submittedCode, storedHash, secret) {
  if (typeof submittedCode !== 'string' || typeof storedHash !== 'string') {
    return false;
  }
  // Pad submitted code to 6 digits before hashing (defensive)
  const padded = submittedCode.trim().padStart(OTP_LENGTH, '0');
  const submittedHash = hashOtp(padded, secret);

  // Both must be same byte length for timingSafeEqual
  const a = Buffer.from(submittedHash, 'hex');
  const b = Buffer.from(storedHash, 'hex');

  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/** OTP expiry in seconds (10 minutes) */
const OTP_TTL_SECONDS = 10 * 60;

/** Maximum failed verification attempts before a challenge is locked */
const MAX_ATTEMPTS = 5;

/** Minimum seconds between successive OTP requests for the same target */
const RESEND_COOLDOWN_SECONDS = 60;

module.exports = {
  generateOtp,
  hashOtp,
  verifyOtp,
  OTP_TTL_SECONDS,
  MAX_ATTEMPTS,
  RESEND_COOLDOWN_SECONDS,
};
