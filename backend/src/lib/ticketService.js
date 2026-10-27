const { randomUUID } = require('crypto');
const { getEvent, putTicket, markTicketSent, reserveTicketCapacity, releaseTicketCapacity } = require('./db');
const { getJwtSecret } = require('./secrets');
const { signTicketToken } = require('./jwt');
const { generateQrPngBuffer } = require('./qrcode');
const { sendTicketEmail } = require('./email');

async function issueTicketForEvent({
  eventId,
  attendeeName,
  attendeeEmail,
  paymentId = null,
  orderId = null,
  pricePaid = 0,
  currency = 'INR',
}) {
  if (!eventId) {
    throw Object.assign(new Error('eventId is required'), { statusCode: 400 });
  }
  if (!attendeeName || typeof attendeeName !== 'string' || !attendeeName.trim()) {
    throw Object.assign(new Error('attendeeName is required'), { statusCode: 400 });
  }
  if (!attendeeEmail || typeof attendeeEmail !== 'string' || !attendeeEmail.includes('@')) {
    throw Object.assign(new Error('Valid attendeeEmail is required'), { statusCode: 400 });
  }

  const normalizedName = attendeeName.trim();
  const normalizedEmail = attendeeEmail.trim().toLowerCase();

  const eventRecord = await getEvent(eventId);
  if (!eventRecord) {
    throw Object.assign(new Error('Event not found'), { statusCode: 404 });
  }
  if (eventRecord.status !== 'ACTIVE') {
    throw Object.assign(new Error(`Event is ${eventRecord.status}, not accepting registrations`), { statusCode: 409 });
  }

  // Security check: if the event is a paid event, a verified paymentId is mandatory!
  if (eventRecord.isPaid && eventRecord.price > 0 && !paymentId) {
    throw Object.assign(new Error('This is a paid event. Verified payment is required before ticket can be issued.'), { statusCode: 402 });
  }

  // Sales window check
  const now = new Date();
  if (eventRecord.salesStart && now < new Date(eventRecord.salesStart)) {
    throw Object.assign(new Error(`Ticket sales have not started yet. Sales open on ${new Date(eventRecord.salesStart).toLocaleString()}`), { statusCode: 400 });
  }
  if (eventRecord.salesEnd && now > new Date(eventRecord.salesEnd)) {
    throw Object.assign(new Error('Ticket sales for this event have closed.'), { statusCode: 400 });
  }

  // Atomic capacity reservation
  try {
    await reserveTicketCapacity(eventId);
  } catch (capacityErr) {
    if (capacityErr.name === 'ConditionalCheckFailedException') {
      const freshEvent = await getEvent(eventId);
      if (!freshEvent || freshEvent.status !== 'ACTIVE') {
        throw Object.assign(new Error('Event is not active or no longer exists'), { statusCode: 409 });
      }
      throw Object.assign(new Error('Event is full'), { statusCode: 409 });
    }
    throw capacityErr;
  }

  const ticketId = randomUUID();
  let secret;
  try {
    secret = await getJwtSecret();
  } catch (secretErr) {
    await releaseTicketCapacity(eventId);
    throw secretErr;
  }

  const eventDateMs = new Date(eventRecord.date).getTime();
  // Valid until event date + 24 hour buffer, or fallback to 30 days if invalid date string
  const expiresAtMs = isNaN(eventDateMs)
    ? Date.now() + 30 * 24 * 60 * 60 * 1000
    : eventDateMs + 24 * 60 * 60 * 1000;

  const qrToken = signTicketToken({ ticketId, eventId }, secret, expiresAtMs);

  const ticket = {
    ticketId,
    eventId,
    attendeeName: normalizedName,
    attendeeEmail: normalizedEmail,
    status: 'ISSUED',
    qrToken, // stored internally so /resend can re-send exact same QR
    issuedAt: new Date().toISOString(),
    checkedInAt: null,
    checkedInBy: null,
    // Payment details
    pricePaid: pricePaid !== undefined ? pricePaid : (eventRecord.price || 0),
    currency: currency || eventRecord.currency || 'INR',
    paymentId: paymentId || null,
    orderId: orderId || null,
    refundStatus: 'NONE',
    refundAmount: 0,
    refundId: null,
  };

  try {
    await putTicket(ticket);
  } catch (putErr) {
    await releaseTicketCapacity(eventId);
    throw putErr;
  }

  let emailSent = false;
  try {
    const qrBuffer = await generateQrPngBuffer(qrToken);
    await sendTicketEmail({
      toEmail: normalizedEmail,
      attendeeName: normalizedName,
      eventName: eventRecord.name,
      eventDate: eventRecord.date,
      venue: eventRecord.venue,
      qrBuffer,
      ticketId,
      frontendBaseUrl: process.env.FRONTEND_BASE_URL,
    });
    await markTicketSent(ticketId);
    emailSent = true;
  } catch (emailErr) {
    // Ticket record is safely saved; email can be retried via admin resend
    console.error('issueTicket email error', emailErr);
  }

  // Safe response: NEVER leak qrToken or JWT secret in the response payload
  return {
    ticketId,
    eventId,
    attendeeName: normalizedName,
    attendeeEmail: normalizedEmail,
    status: emailSent ? 'SENT' : 'ISSUED',
    emailSent,
    pricePaid: ticket.pricePaid,
    currency: ticket.currency,
    paymentId: ticket.paymentId,
  };
}

module.exports = { issueTicketForEvent };
