const { ok } = require('../lib/http');
const { listPublicEvents } = require('../lib/db');

exports.handler = async () => {
  try {
    const events = await listPublicEvents();
    return ok(200, events);
  } catch (err) {
    console.error('listPublicEvents error', err);
    return ok(500, { message: 'Internal error' });
  }
};
