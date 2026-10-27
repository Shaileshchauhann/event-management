const { randomUUID } = require('crypto');
const { ok } = require('../lib/http');
const { getTicket, putVerificationChallenge, queryCancellationChallenge } = require('../lib/db');
const { getJwtSecret } = require('../lib/secrets');
const { generateOtp, hashOtp, OTP_TTL_SECONDS, RESEND_COOLDOWN_SECONDS } = require('../lib/otp');
const { sendOtpEmail } = require('../lib/email');

exports.handler = async (event) => {
  try {
    const { ticketId } = event.pathParameters || {};
    if (!ticketId) return ok(400, { message: 'ticketId is required' });

    // --- Load ticket ---
    const ticket = await getTicket(ticketId);
    if (!ticket) {
      // Generic message to avoid ticket ID enumeration
      return ok(404, { message: 'Ticket not found' });
    }

    // --- Check ticket is cancellable ---
    if (ticket.status === 'CANCELLED') {
      return ok(409, { message: 'Ticket is already cancelled' });
    }
    if (ticket.status === 'CHECKED_IN') {
      return ok(409, { message: 'Checked-in tickets cannot be cancelled' });
    }

    // --- Resend cooldown: check for a recent active CANCELLATION challenge ---
    // We look for any active (non-expired, non-used) challenge created in the
    // last RESEND_COOLDOWN_SECONDS to prevent OTP spam on this ticket.
    const recentChallenge = await queryCancellationChallenge(ticketId);
    if (recentChallenge) {
      const createdAtMs = new Date(recentChallenge.createdAt).getTime();
      const cooldownEndsMs = createdAtMs + RESEND_COOLDOWN_SECONDS * 1000;
      if (Date.now() < cooldownEndsMs) {
        return ok(429, {
          message: `Please wait before requesting another cancellation code.`,
        });
      }
      // Cooldown has passed but challenge is still technically active — allow new code
    }

    // --- Generate and store OTP challenge ---
    const secret = await getJwtSecret();
    const code = generateOtp();
    const codeHash = hashOtp(code, secret);

    const now = new Date();
    const expiresAt = Math.floor(now.getTime() / 1000) + OTP_TTL_SECONDS;

    const challenge = {
      challengeId: randomUUID(),
      purpose: 'CANCELLATION',
      ticketId,
      attendeeEmail: ticket.attendeeEmail,
      codeHash,
      expiresAt,
      attempts: 0,
      used: false,
      createdAt: now.toISOString(),
    };

    await putVerificationChallenge(challenge);

    // --- Send cancellation OTP email ---
    // `code` is only in memory here — never stored in DB, never returned.
    await sendOtpEmail({
      toEmail: ticket.attendeeEmail,
      attendeeName: ticket.attendeeName,
      code,
      purpose: 'CANCELLATION',
    });

    // Return generic success — do not confirm the registered email in the response
    return ok(200, {
      message: 'Cancellation code sent to your registered email address',
    });
  } catch (err) {
    console.error('requestCancellationCode error', err);
    return ok(err.statusCode || 500, { message: err.message || 'Internal error' });
  }
};
