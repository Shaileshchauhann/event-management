const { ok } = require('../lib/http');
const { getTicket, getEvent, markTicketSent } = require('../lib/db');
const { generateQrPngBuffer } = require('../lib/qrcode');
const { sendTicketEmail } = require('../lib/email');
const { authenticateAdmin } = require('../lib/auth');
const { getJwtSecret } = require('../lib/secrets');

exports.handler = async (event) => {
  try {
    const secret = await getJwtSecret();
    const auth = await authenticateAdmin(event, secret);

    const { ticketId } = event.pathParameters || {};
    if (!ticketId) return ok(400, { message: 'ticketId is required' });

    const ticket = await getTicket(ticketId);
    if (!ticket) return ok(404, { message: 'Ticket not found' });
    if (ticket.status === 'CANCELLED') {
      return ok(409, { message: 'Ticket is cancelled, cannot resend' });
    }

    const eventRecord = await getEvent(ticket.eventId);
    if (!eventRecord) return ok(404, { message: 'Associated event not found' });

    // Ticket ownership verification: ticket -> event -> adminId
    if (eventRecord.adminId !== auth.adminId) {
      return ok(403, { message: 'Forbidden: You do not own the event for this ticket' });
    }

    const qrBuffer = await generateQrPngBuffer(ticket.qrToken);
    await sendTicketEmail({
      toEmail: ticket.attendeeEmail,
      attendeeName: ticket.attendeeName,
      eventName: eventRecord.name,
      eventDate: eventRecord.date,
      venue: eventRecord.venue,
      qrBuffer,
      ticketId: ticket.ticketId,
      frontendBaseUrl: process.env.FRONTEND_BASE_URL,
    });

    if (ticket.status === 'ISSUED') await markTicketSent(ticketId);
    return ok(200, { message: 'Ticket resent', ticketId });
  } catch (err) {
    console.error('resendTicket error', err);
    return ok(err.statusCode || 500, { message: err.message || 'Internal error' });
  }
};

