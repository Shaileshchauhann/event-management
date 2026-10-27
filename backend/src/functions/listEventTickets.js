const { ok } = require('../lib/http');
const { getEvent, listTicketsByEvent } = require('../lib/db');
const { authenticateAdmin } = require('../lib/auth');
const { getJwtSecret } = require('../lib/secrets');

exports.handler = async (event) => {
  try {
    const secret = await getJwtSecret();
    const auth = await authenticateAdmin(event, secret);

    const { eventId } = event.pathParameters || {};
    const eventRecord = await getEvent(eventId);
    if (!eventRecord) {
      return ok(404, { message: 'Event not found' });
    }

    if (eventRecord.adminId !== auth.adminId) {
      return ok(403, { message: 'Forbidden: You do not own this event' });
    }

    const tickets = await listTicketsByEvent(eventId);

    // Strip qrToken from responses
    const safeTickets = tickets.map(({ qrToken, ...safeTicket }) => safeTicket);
    return ok(200, safeTickets);
  } catch (err) {
    console.error('listEventTickets error', err);
    return ok(err.statusCode || 500, { message: err.message || 'Internal error' });
  }
};
