const { ok } = require('../lib/http');
const { getTicket, getEvent } = require('../lib/db');
const { authenticateAdmin } = require('../lib/auth');
const { getJwtSecret } = require('../lib/secrets');

exports.handler = async (event) => {
  try {
    const { ticketId } = event.pathParameters || {};
    if (!ticketId) {
      return ok(400, { message: 'ticketId is required' });
    }

    const item = await getTicket(ticketId);
    if (!item) {
      return ok(404, { message: 'Ticket not found' });
    }

    /*
     * Admin route:
     * /admin/tickets/{ticketId}
     *
     * Requires Admin JWT and verifies event ownership.
     */
    const path = event.resource || event.path || '';

    if (path.includes('/admin/tickets/')) {
      const secret = await getJwtSecret();
      const auth = await authenticateAdmin(event, secret);

      const eventRecord = await getEvent(item.eventId);
      if (!eventRecord) {
        return ok(404, { message: 'Associated event not found' });
      }

      if (eventRecord.adminId !== auth.adminId) {
        return ok(403, {
          message: 'Forbidden: You do not own the event for this ticket',
        });
      }

      const { qrToken, ...safeItem } = item;
      return ok(200, safeItem);
    }

    /*
     * Attendee route:
     * /tickets/{ticketId}
     *
     * No Admin JWT required.
     *
     * Only return information needed by the attendee's
     * ticket-management page.
     */
    const eventRecord = await getEvent(item.eventId);

    if (!eventRecord) {
      return ok(404, { message: 'Associated event not found' });
    }

    const safeItem = {
      ticketId: item.ticketId,
      eventId: item.eventId,
      attendeeName: item.attendeeName,
      status: item.status,
      issuedAt: item.issuedAt,
      checkedInAt: item.checkedInAt || null,
      pricePaid: item.pricePaid ?? 0,
      currency: item.currency || 'INR',
      paymentId: item.paymentId || null,
      refundStatus: item.refundStatus || 'NONE',
      refundAmount: item.refundAmount || 0,
    };

    return ok(200, {
      ...safeItem,
      eventName: eventRecord.name,
      venue: eventRecord.venue || null,
      eventDate: eventRecord.date,
    });
  } catch (err) {
    console.error('getTicket error', err);
    return ok(err.statusCode || 500, {
      message: err.message || 'Internal error',
    });
  }
};