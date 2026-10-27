const { ok, parseBody } = require('../lib/http');
const { getTicket, checkInTicket } = require('../lib/db');
const { getJwtSecret } = require('../lib/secrets');
const { verifyTicketToken } = require('../lib/jwt');

exports.handler = async (event) => {
  try {
    const { token, gateId } = parseBody(event);
    if (!token) return ok(400, { valid: false, reason: 'missing_token' });

    const secret = await getJwtSecret();
    let decoded;
    try {
      decoded = verifyTicketToken(token, secret);
    } catch (jwtErr) {
      const reason = jwtErr.name === 'TokenExpiredError' ? 'expired' : 'invalid_token';
      return ok(200, { valid: false, reason });
    }

    const { ticketId } = decoded;
    const ticket = await getTicket(ticketId);
    if (!ticket) return ok(200, { valid: false, reason: 'not_found' });

    try {
      const checkedInAt = await checkInTicket(ticketId, gateId);
      return ok(200, {
        valid: true,
        ticketId,
        eventId: ticket.eventId,
        attendeeName: ticket.attendeeName,
        checkedInAt,
      });
    } catch (conditionErr) {
      // Conditional write failed: ticket was already checked in or cancelled.
      const current = await getTicket(ticketId);
      return ok(200, {
        valid: false,
        reason: current.status === 'CANCELLED' ? 'cancelled' : 'already_used',
        checkedInAt: current.checkedInAt,
        checkedInBy: current.checkedInBy,
      });
    }
  } catch (err) {
    console.error('verifyTicket error', err);
    return ok(500, { valid: false, reason: 'internal_error' });
  }
};
