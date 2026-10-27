const { ok, parseBody } = require('../lib/http');
const { issueTicketForEvent } = require('../lib/ticketService');

exports.handler = async (event) => {
  try {
    const { eventId } = event.pathParameters || {};
    const { attendeeName, attendeeEmail } = parseBody(event);

    const result = await issueTicketForEvent({
      eventId,
      attendeeName,
      attendeeEmail,
    });

    return ok(201, result);
  } catch (err) {
    console.error('issueTicket error', err);
    return ok(err.statusCode || 500, { message: err.message || 'Internal error' });
  }
};

