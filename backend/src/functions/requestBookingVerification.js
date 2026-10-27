const { randomUUID } = require('crypto');
const { ok, parseBody } = require('../lib/http');
const { getEvent } = require('../lib/db');
const {
  putVerificationChallenge,
  findRecentChallenge,
} = require('../lib/db');
const { getJwtSecret } = require('../lib/secrets');
const { generateOtp, hashOtp, OTP_TTL_SECONDS, RESEND_COOLDOWN_SECONDS } = require('../lib/otp');
const { sendOtpEmail } = require('../lib/email');

exports.handler = async (event) => {
  try {
    const { eventId, attendeeName, attendeeEmail } = parseBody(event);

    // --- Input validation ---
    if (!eventId || typeof eventId !== 'string') {
      return ok(400, { message: 'eventId is required' });
    }
    if (!attendeeName || typeof attendeeName !== 'string' || !attendeeName.trim()) {
      return ok(400, { message: 'attendeeName is required' });
    }
    if (!attendeeEmail || typeof attendeeEmail !== 'string' || !attendeeEmail.includes('@')) {
      return ok(400, { message: 'Valid attendeeEmail is required' });
    }

    const normalizedName = attendeeName.trim();
    const normalizedEmail = attendeeEmail.trim().toLowerCase();

    // --- Verify event exists and is accepting registrations ---
    const eventRecord = await getEvent(eventId);
    if (!eventRecord) {
      return ok(404, { message: 'Event not found' });
    }
    if (eventRecord.status !== 'ACTIVE') {
      return ok(409, { message: `Event is ${eventRecord.status}, not accepting registrations` });
    }

    // --- Resend cooldown: prevent OTP spam ---
    const recentChallenge = await findRecentChallenge({
      email: normalizedEmail,
      purpose: 'BOOKING',
      cooldownSeconds: RESEND_COOLDOWN_SECONDS,
    });
    if (recentChallenge) {
      return ok(429, {
        message: `Please wait before requesting another code. Try again in ${RESEND_COOLDOWN_SECONDS} seconds.`,
      });
    }

    // --- Generate and store OTP challenge ---
    const secret = await getJwtSecret();
    const code = generateOtp();
    const codeHash = hashOtp(code, secret);

    const now = new Date();
    const expiresAt = Math.floor(now.getTime() / 1000) + OTP_TTL_SECONDS; // epoch seconds for DynamoDB TTL

    const challenge = {
      challengeId: randomUUID(),
      purpose: 'BOOKING',
      eventId,
      attendeeName: normalizedName,
      attendeeEmail: normalizedEmail,
      codeHash,
      expiresAt,            // DynamoDB TTL attribute (epoch seconds)
      attempts: 0,
      used: false,
      createdAt: now.toISOString(),
    };

    await putVerificationChallenge(challenge);

    // --- Send OTP email ---
    // NOTE: `code` is passed in-memory only. It is NEVER stored in DynamoDB,
    // never logged, and never returned in the API response.
    await sendOtpEmail({
      toEmail: normalizedEmail,
      attendeeName: normalizedName,
      code,
      purpose: 'BOOKING',
      eventName: eventRecord.name,
    });

    // Return the challengeId so the client can submit it in the next step.
    // Never return the code itself.
    return ok(200, {
      message: 'Verification code sent to your email address',
      challengeId: challenge.challengeId,
    });
  } catch (err) {
    console.error('requestBookingVerification error', err);
    return ok(err.statusCode || 500, { message: err.message || 'Internal error' });
  }
};
