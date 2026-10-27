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

    let issuedCount = 0;
    let sentCount = 0;
    let checkedInCount = 0;
    let cancelledCount = 0;
    const gateStats = {};

    for (const ticket of tickets) {
      if (ticket.status === 'ISSUED') issuedCount++;
      else if (ticket.status === 'SENT') sentCount++;
      else if (ticket.status === 'CHECKED_IN') {
        checkedInCount++;
        const gate = ticket.checkedInBy || 'unknown';
        gateStats[gate] = (gateStats[gate] || 0) + 1;
      } else if (ticket.status === 'CANCELLED') {
        cancelledCount++;
      }
    }

    const totalTickets = tickets.length;
    const activeValidTickets = totalTickets - cancelledCount;
    const capacity = eventRecord.capacity !== undefined ? eventRecord.capacity : null;
    const remainingCapacity = capacity !== null ? Math.max(0, capacity - activeValidTickets) : null;
    const checkInRate = activeValidTickets > 0 ? ((checkedInCount / activeValidTickets) * 100).toFixed(1) + '%' : '0.0%';

    return ok(200, {
      eventId,
      eventName: eventRecord.name,
      status: eventRecord.status,
      capacity,
      totalTickets,
      activeValidTickets,
      remainingCapacity,
      breakdown: {
        issued: issuedCount,
        sent: sentCount,
        checkedIn: checkedInCount,
        cancelled: cancelledCount,
      },
      checkInRate,
      gateStats,
    });
  } catch (err) {
    console.error('getEventStats error', err);
    return ok(err.statusCode || 500, { message: err.message || 'Internal error' });
  }
};
