const { ok, parseBody } = require('../lib/http');
const { getEvent, updateEvent } = require('../lib/db');
const { authenticateAdmin } = require('../lib/auth');
const { getJwtSecret } = require('../lib/secrets');

exports.handler = async (event) => {
  try {
    const secret = await getJwtSecret();
    const auth = await authenticateAdmin(event, secret);

    const { eventId } = event.pathParameters || {};
    if (!eventId) {
      return ok(400, { message: 'eventId is required' });
    }

    const eventRecord = await getEvent(eventId);
    if (!eventRecord) {
      return ok(404, { message: 'Event not found' });
    }

    if (eventRecord.adminId !== auth.adminId) {
      return ok(403, { message: 'Forbidden: You do not own this event' });
    }

    const body = parseBody(event);
    const {
      name,
      venue,
      date,
      capacity,
      isPaid,
      price,
      currency,
      salesStart,
      salesEnd,
      maxTicketsPerUser,
      status,
    } = body;

    // Optional field updates with validation
    let updatedName = eventRecord.name;
    if (name !== undefined) {
      if (!name || typeof name !== 'string' || !name.trim()) {
        return ok(400, { message: 'name cannot be empty' });
      }
      updatedName = name.trim();
    }

    let updatedDate = eventRecord.date;
    if (date !== undefined) {
      if (!date || typeof date !== 'string' || isNaN(new Date(date).getTime())) {
        return ok(400, { message: 'date must be a valid ISO date string' });
      }
      updatedDate = date;
    }

    let updatedCapacity = eventRecord.capacity;
    if (capacity !== undefined) {
      if (capacity === null || capacity === '') {
        updatedCapacity = null;
      } else {
        const parsed = parseInt(capacity, 10);
        if (isNaN(parsed) || parsed <= 0) {
          return ok(400, { message: 'capacity must be a positive integer if provided' });
        }
        if (eventRecord.ticketsIssued > parsed) {
          return ok(400, {
            message: `Cannot reduce capacity to ${parsed}; ${eventRecord.ticketsIssued} tickets already issued`,
          });
        }
        updatedCapacity = parsed;
      }
    }

    let updatedIsPaid = eventRecord.isPaid ?? false;
    let updatedPrice = eventRecord.price ?? 0;
    if (isPaid !== undefined) {
      updatedIsPaid = Boolean(isPaid);
    }

    if (price !== undefined) {
      const numPrice = Number(price);
      if (isNaN(numPrice) || numPrice < 0) {
        return ok(400, { message: 'price must be a non-negative number' });
      }
      if (updatedIsPaid && numPrice <= 0) {
        return ok(400, { message: 'Ticket price must be greater than 0 for paid events' });
      }
      updatedPrice = updatedIsPaid ? Math.round(numPrice * 100) : 0;
    } else if (!updatedIsPaid) {
      updatedPrice = 0;
    }

    let updatedCurrency = eventRecord.currency || 'INR';
    if (currency !== undefined) {
      const upperCurr = String(currency).toUpperCase();
      if (upperCurr !== 'INR') {
        return ok(400, { message: 'Currently only INR currency is supported' });
      }
      updatedCurrency = upperCurr;
    }

    let updatedSalesStart = eventRecord.salesStart ?? null;
    if (salesStart !== undefined) {
      if (salesStart && isNaN(new Date(salesStart).getTime())) {
        return ok(400, { message: 'salesStart must be a valid date string' });
      }
      updatedSalesStart = salesStart || null;
    }

    let updatedSalesEnd = eventRecord.salesEnd ?? null;
    if (salesEnd !== undefined) {
      if (salesEnd && isNaN(new Date(salesEnd).getTime())) {
        return ok(400, { message: 'salesEnd must be a valid date string' });
      }
      updatedSalesEnd = salesEnd || null;
    }

    if (updatedSalesStart && updatedSalesEnd && new Date(updatedSalesStart) > new Date(updatedSalesEnd)) {
      return ok(400, { message: 'salesStart cannot be after salesEnd' });
    }

    let updatedMaxTickets = eventRecord.maxTicketsPerUser ?? 1;
    if (maxTicketsPerUser !== undefined) {
      const parsedLimit = parseInt(maxTicketsPerUser, 10);
      if (isNaN(parsedLimit) || parsedLimit <= 0) {
        return ok(400, { message: 'maxTicketsPerUser must be a positive integer' });
      }
      updatedMaxTickets = parsedLimit;
    }

    let updatedStatus = eventRecord.status;
    if (status !== undefined) {
      if (!['ACTIVE', 'PAUSED', 'COMPLETED', 'CANCELLED'].includes(status)) {
        return ok(400, { message: 'Invalid status' });
      }
      updatedStatus = status;
    }

    const updatedEvent = {
      ...eventRecord,
      name: updatedName,
      venue: venue !== undefined ? (venue ? venue.trim() : null) : eventRecord.venue,
      date: updatedDate,
      capacity: updatedCapacity,
      isPaid: updatedIsPaid,
      price: updatedPrice, // in integer paise
      currency: updatedCurrency,
      salesStart: updatedSalesStart,
      salesEnd: updatedSalesEnd,
      maxTicketsPerUser: updatedMaxTickets,
      status: updatedStatus,
      updatedAt: new Date().toISOString(),
    };

    await updateEvent(updatedEvent);
    return ok(200, updatedEvent);
  } catch (err) {
    console.error('updateEvent error', err);
    return ok(err.statusCode || 500, { message: err.message || 'Internal error' });
  }
};
