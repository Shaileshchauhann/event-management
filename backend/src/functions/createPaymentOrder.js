const { ok, parseBody } = require('../lib/http');
const {
  getEvent,
  putPayment,
  getVerificationChallenge,
  markChallengeUsed,
} = require('../lib/db');
const { getJwtSecret } = require('../lib/secrets');
const { verifyOtp } = require('../lib/otp');
const { createOrder, getRazorpayConfig } = require('../lib/razorpay');

exports.handler = async (event) => {
  try {
    const body = parseBody(event);
    let { eventId, attendeeName, attendeeEmail, challengeId, code } = body;

    // Support OTP challenge verification flow if provided
    if (challengeId && code) {
      if (typeof code !== 'string' || !/^\d{6}$/.test(code.trim())) {
        return ok(400, { message: 'A 6-digit verification code is required' });
      }
      const challenge = await getVerificationChallenge(challengeId);
      if (!challenge || challenge.purpose !== 'BOOKING') {
        return ok(400, { message: 'Invalid or expired verification challenge' });
      }
      const nowEpoch = Math.floor(Date.now() / 1000);
      if (challenge.expiresAt <= nowEpoch) {
        return ok(400, { message: 'Verification code has expired. Please request a new code.' });
      }
      if (challenge.used) {
        return ok(400, { message: 'This verification challenge has already been used' });
      }
      const secret = await getJwtSecret();
      const isValid = verifyOtp(code.trim(), challenge.codeHash, secret);
      if (!isValid) {
        return ok(400, { message: 'Incorrect verification code' });
      }
      eventId = challenge.eventId;
      attendeeName = challenge.attendeeName;
      attendeeEmail = challenge.attendeeEmail;
    }

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

    // Verify event exists and is active
    const eventRecord = await getEvent(eventId);
    if (!eventRecord) {
      return ok(404, { message: 'Event not found' });
    }
    if (eventRecord.status !== 'ACTIVE') {
      return ok(409, { message: `Event is ${eventRecord.status}, not accepting registrations` });
    }

    // Verify this is a paid event
    if (!eventRecord.isPaid || !eventRecord.price || eventRecord.price <= 0) {
      return ok(400, { message: 'This is a free event. Please use the free registration flow.' });
    }

    // Check sales start/end dates
    const now = new Date();
    if (eventRecord.salesStart && now < new Date(eventRecord.salesStart)) {
      return ok(400, {
        message: `Ticket sales have not started yet. Sales open on ${new Date(eventRecord.salesStart).toLocaleString()}`,
      });
    }
    if (eventRecord.salesEnd && now > new Date(eventRecord.salesEnd)) {
      return ok(400, { message: 'Ticket sales for this event have closed.' });
    }

    // Check capacity
    if (eventRecord.capacity !== null && eventRecord.capacity !== undefined) {
      if ((eventRecord.ticketsIssued || 0) >= eventRecord.capacity) {
        return ok(409, { message: 'Event is full' });
      }
    }

    // If challenge was used, mark challenge used to prevent OTP reuse
    if (challengeId) {
      try {
        await markChallengeUsed(challengeId);
      } catch (err) {
        // If race condition, challenge was already consumed
        console.warn('markChallengeUsed race', err.name);
      }
    }

    // Create Razorpay Order via official SDK
    const receiptId = `rcpt_${eventId.slice(0, 8)}_${Date.now().toString().slice(-8)}`;
    const rzpOrder = await createOrder({
      amount: eventRecord.price, // in integer paise
      currency: eventRecord.currency || 'INR',
      receipt: receiptId,
      notes: {
        eventId,
        eventName: eventRecord.name,
        attendeeName: normalizedName,
        attendeeEmail: normalizedEmail,
      },
    });

    // Store record in PaymentsTable
    // Note: paymentId is omitted until verified and captured so DynamoDB PaymentIdIndex (AttributeType: S) is not given a NULL value
    const paymentRecord = {
      orderId: rzpOrder.id,
      eventId,
      adminId: eventRecord.adminId,
      attendeeName: normalizedName,
      attendeeEmail: normalizedEmail,
      amount: eventRecord.price,
      currency: eventRecord.currency || 'INR',
      status: 'CREATED',
      refundAmount: 0,
      refundStatus: 'NONE',
      receipt: receiptId,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    await putPayment(paymentRecord);

    const { key_id } = getRazorpayConfig();

    return ok(201, {
      orderId: rzpOrder.id,
      amount: eventRecord.price,
      currency: eventRecord.currency || 'INR',
      keyId: key_id,
      eventName: eventRecord.name,
      attendeeName: normalizedName,
      attendeeEmail: normalizedEmail,
    });
  } catch (err) {
    console.error('createPaymentOrder error', err);
    return ok(err.statusCode || 500, { message: err.message || 'Internal error' });
  }
};
