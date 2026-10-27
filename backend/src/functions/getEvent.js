const { ok } = require('../lib/http');
const { getEvent } = require('../lib/db');

exports.handler = async (event) => {
  try {
    const { eventId } = event.pathParameters || {};
    if (!eventId) return ok(400, { message: 'eventId is required' });

    const item = await getEvent(eventId);
    if (!item) return ok(404, { message: 'Event not found' });

    // Safe public representation
    const safeItem = {
      eventId: item.eventId,
      name: item.name,
      venue: item.venue || null,
      date: item.date,
      capacity: item.capacity ?? null,
      ticketsIssued: item.ticketsIssued ?? 0,
      status: item.status,
      createdAt: item.createdAt,
      isPaid: Boolean(item.isPaid),
      price: item.price ?? 0,
      currency: item.currency || 'INR',
      salesStart: item.salesStart || null,
      salesEnd: item.salesEnd || null,
      maxTicketsPerUser: item.maxTicketsPerUser ?? 1,
    };

    return ok(200, safeItem);
  } catch (err) {
    console.error('getEvent error', err);
    return ok(500, { message: 'Internal error' });
  }
};

