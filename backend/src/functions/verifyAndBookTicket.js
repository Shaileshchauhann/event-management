const { ok, parseBody } = require('../lib/http');
const { getVerificationChallenge, markChallengeUsed, incrementChallengeAttempts } = require('../lib/db');
const { getJwtSecret } = require('../lib/secrets');
const { verifyOtp, MAX_ATTEMPTS } = require('../lib/otp');
const { issueTicketForEvent } = require('../lib/ticketService');

exports.handler = async (event) => {
  try {
    const { challengeId, code } = parseBody(event);

    // --- Input validation ---
    if (!challengeId || typeof challengeId !== 'string') {
      return ok(400, { message: 'challengeId is required' });
    }
    if (!code || typeof code !== 'string' || !/^\d{6}$/.test(code.trim())) {
      return ok(400, { message: 'A 6-digit verification code is required' });
    }

    // --- Load challenge ---
    const challenge = await getVerificationChallenge(challengeId);
    if (!challenge || challenge.purpose !== 'BOOKING') {
      // Generic message to avoid revealing whether challengeId exists
      return ok(400, { message: 'Invalid or expired verification challenge' });
    }

    // --- Check expiry (application-level; DynamoDB TTL is eventual cleanup) ---
    const nowEpoch = Math.floor(Date.now() / 1000);
    if (challenge.expiresAt <= nowEpoch) {
      return ok(400, { message: 'Verification code has expired. Please request a new code.' });
    }

    // --- Check already used ---
    if (challenge.used) {
      return ok(400, { message: 'This verification challenge has already been used' });
    }

    // --- Check attempt limit ---
    if (challenge.attempts >= MAX_ATTEMPTS) {
      return ok(400, {
        message: 'Maximum verification attempts exceeded. Please request a new code.',
      });
    }

    // --- Verify OTP (constant-time comparison) ---
    const secret = await getJwtSecret();
    const isValid = verifyOtp(code.trim(), challenge.codeHash, secret);

    if (!isValid) {
      // Increment attempts atomically. If the conditional update fails (race),
      // we still return the same error — the challenge state is consistent.
      try {
        await incrementChallengeAttempts(challengeId, challenge.attempts);
      } catch (incErr) {
        // Ignore race conditions on the increment; the attempt is already recorded
        // by the winning concurrent request, or the challenge is now used/expired.
        console.warn('incrementChallengeAttempts race', incErr.name);
      }
      const remaining = MAX_ATTEMPTS - (challenge.attempts + 1);
      return ok(400, {
        message:
          remaining > 0
            ? `Incorrect verification code. ${remaining} attempt(s) remaining.`
            : 'Incorrect verification code. No attempts remaining. Please request a new code.',
      });
    }

    // --- Atomically mark challenge as used ---
    // This conditional update fails if another concurrent request already
    // marked it used, preventing the same code from creating two tickets.
    try {
      await markChallengeUsed(challengeId);
    } catch (condErr) {
      if (condErr.name === 'ConditionalCheckFailedException') {
        return ok(409, { message: 'This verification code was already used' });
      }
      throw condErr;
    }

    // --- Create ticket using existing service (handles capacity + JWT + QR + email) ---
    let result;
    try {
      result = await issueTicketForEvent({
        eventId: challenge.eventId,
        attendeeName: challenge.attendeeName,
        attendeeEmail: challenge.attendeeEmail,
      });
    } catch (issueErr) {
      // Log but surface a useful message. Challenge is already consumed so
      // the attendee must request a fresh code if they want to retry.
      console.error('verifyAndBookTicket issueTicket error', issueErr);
      return ok(issueErr.statusCode || 500, {
        message: issueErr.message || 'Ticket creation failed',
      });
    }

    return ok(201, {
      message: 'Ticket created successfully',
      ticketId: result.ticketId,
      eventId: result.eventId,
      attendeeName: result.attendeeName,
      attendeeEmail: result.attendeeEmail,
      status: result.status,
      emailSent: result.emailSent,
    });
  } catch (err) {
    console.error('verifyAndBookTicket error', err);
    return ok(err.statusCode || 500, { message: err.message || 'Internal error' });
  }
};
