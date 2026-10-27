const { ok } = require('../lib/http');
const { listEventsByAdmin } = require('../lib/db');
const { authenticateAdmin } = require('../lib/auth');
const { getJwtSecret } = require('../lib/secrets');

exports.handler = async (event) => {
  try {
    const secret = await getJwtSecret();
    const auth = await authenticateAdmin(event, secret);

    const items = await listEventsByAdmin(auth.adminId);
    return ok(200, items);
  } catch (err) {
    console.error('listAdminEvents error', err);
    return ok(err.statusCode || 500, { message: err.message || 'Internal error' });
  }
};
