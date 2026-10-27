const { ok } = require('../lib/http');
const { getEvent } = require('../lib/db');
const { authenticateAdmin } = require('../lib/auth');
const { getJwtSecret } = require('../lib/secrets');

exports.handler = async (event) => {
  try {
    const secret = await getJwtSecret();
    const auth = await authenticateAdmin(event, secret);

    const { eventId } = event.pathParameters || {};
    const item = await getEvent(eventId);
    if (!item) {
      return ok(404, { message: 'Event not found' });
    }

    if (item.adminId !== auth.adminId) {
      return ok(403, { message: 'Forbidden: You do not own this event' });
    }

    return ok(200, item);
  } catch (err) {
    console.error('getAdminEvent error', err);
    return ok(err.statusCode || 500, { message: err.message || 'Internal error' });
  }
};
