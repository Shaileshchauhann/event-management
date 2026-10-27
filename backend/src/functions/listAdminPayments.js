const { ok } = require('../lib/http');
const { listPaymentsByAdmin, listEventsByAdmin } = require('../lib/db');
const { authenticateAdmin } = require('../lib/auth');
const { getJwtSecret } = require('../lib/secrets');

exports.handler = async (event) => {
  try {
    const secret = await getJwtSecret();
    const auth = await authenticateAdmin(event, secret);

    const query = event.queryStringParameters || {};
    const { search = '', status, eventId, limit = 100 } = query;

    // Fetch payments owned by this admin
    let payments = await listPaymentsByAdmin(auth.adminId);

    // Fetch admin events to attach event names
    const events = await listEventsByAdmin(auth.adminId);
    const eventNameMap = new Map();
    events.forEach((e) => eventNameMap.set(e.eventId, e.name));

    // Filter by eventId
    if (eventId) {
      payments = payments.filter((p) => p.eventId === eventId);
    }

    // Filter by status
    if (status) {
      const upperStatus = status.toUpperCase();
      if (upperStatus === 'REFUNDED') {
        payments = payments.filter((p) => p.refundStatus === 'REFUNDED');
      } else {
        payments = payments.filter((p) => p.status === upperStatus);
      }
    }

    // Search filter
    if (search.trim()) {
      const term = search.trim().toLowerCase();
      payments = payments.filter((p) => {
        const text = `${p.attendeeName || ''} ${p.attendeeEmail || ''} ${p.orderId || ''} ${p.paymentId || ''} ${p.ticketId || ''}`.toLowerCase();
        return text.includes(term);
      });
    }

    // Sort by createdAt descending
    payments.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

    // Limit results
    const parsedLimit = parseInt(limit, 10) || 100;
    const paginated = payments.slice(0, parsedLimit);

    const result = paginated.map((p) => ({
      orderId: p.orderId,
      paymentId: p.paymentId || null,
      eventId: p.eventId,
      eventName: eventNameMap.get(p.eventId) || 'Unknown Event',
      attendeeName: p.attendeeName,
      attendeeEmail: p.attendeeEmail,
      amountRupees: +( (p.amount || 0) / 100 ).toFixed(2),
      amountPaise: p.amount || 0,
      currency: p.currency || 'INR',
      status: p.status,
      ticketId: p.ticketId || null,
      paymentMethod: p.paymentMethod || 'online',
      refundStatus: p.refundStatus || 'NONE',
      refundAmountRupees: p.refundAmount ? +(p.refundAmount / 100).toFixed(2) : 0,
      refundId: p.refundId || null,
      createdAt: p.createdAt,
    }));

    return ok(200, {
      total: payments.length,
      count: result.length,
      payments: result,
    });
  } catch (err) {
    console.error('listAdminPayments error', err);
    return ok(err.statusCode || 500, { message: err.message || 'Internal error' });
  }
};
