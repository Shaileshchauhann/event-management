const { randomUUID } = require('crypto');
const { ok, parseBody } = require('../lib/http');
const { putEvent } = require('../lib/db');
const { authenticateAdmin } = require('../lib/auth');
const { getJwtSecret } = require('../lib/secrets');

exports.handler = async (event) => {
  try {
    const secret = await getJwtSecret();
    const auth = await authenticateAdmin(event, secret);

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
    } = parseBody(event);

    if (!name || typeof name !== 'string' || !name.trim()) {
      return ok(400, { message: 'name is required' });
    }
    if (!date || typeof date !== 'string') {
      return ok(400, { message: 'date is required' });
    }
    if (isNaN(new Date(date).getTime())) {
      return ok(400, { message: 'date must be a valid ISO date string' });
    }

    let parsedCapacity = null;
    if (capacity !== undefined && capacity !== null && capacity !== '') {
      parsedCapacity = parseInt(capacity, 10);
      if (isNaN(parsedCapacity) || parsedCapacity <= 0) {
        return ok(400, { message: 'capacity must be a positive integer if provided' });
      }
    }

    // Pricing validation
    const eventIsPaid = Boolean(isPaid);
    let priceInPaise = 0;
    const selectedCurrency = (currency || 'INR').toUpperCase();

    if (selectedCurrency !== 'INR') {
      return ok(400, { message: 'Currently only INR currency is supported' });
    }

    if (eventIsPaid) {
      if (price === undefined || price === null || price === '') {
        return ok(400, { message: 'price is required for paid events' });
      }
      const numPrice = Number(price);
      if (isNaN(numPrice) || numPrice <= 0) {
        return ok(400, { message: 'Ticket price must be a positive number for paid events' });
      }
      // If client sends e.g. 500 (rupees), store as 50000 paise
      // If already >= 100 and has isPaise flag, can also handle, but convention is Rupee input -> paise stored
      priceInPaise = Math.round(numPrice * 100);
    } else {
      priceInPaise = 0;
    }

    // Sales start and end date validation
    if (salesStart && isNaN(new Date(salesStart).getTime())) {
      return ok(400, { message: 'salesStart must be a valid date string' });
    }
    if (salesEnd && isNaN(new Date(salesEnd).getTime())) {
      return ok(400, { message: 'salesEnd must be a valid date string' });
    }
    if (salesStart && salesEnd && new Date(salesStart) > new Date(salesEnd)) {
      return ok(400, { message: 'salesStart cannot be after salesEnd' });
    }

    let perUserLimit = 1;
    if (maxTicketsPerUser !== undefined && maxTicketsPerUser !== null && maxTicketsPerUser !== '') {
      const parsedLimit = parseInt(maxTicketsPerUser, 10);
      if (isNaN(parsedLimit) || parsedLimit <= 0) {
        return ok(400, { message: 'maxTicketsPerUser must be a positive integer' });
      }
      perUserLimit = parsedLimit;
    }

    const newEvent = {
      eventId: randomUUID(),
      adminId: auth.adminId, // derived strictly from authenticated admin token
      name: name.trim(),
      venue: venue ? venue.trim() : null,
      date, // ISO 8601 string
      capacity: parsedCapacity,
      ticketsIssued: 0,
      status: 'ACTIVE',
      isPaid: eventIsPaid,
      price: priceInPaise, // stored in integer paise
      currency: selectedCurrency,
      salesStart: salesStart || null,
      salesEnd: salesEnd || null,
      maxTicketsPerUser: perUserLimit,
      createdAt: new Date().toISOString(),
    };

    await putEvent(newEvent);
    return ok(201, newEvent);
  } catch (err) {
    console.error('createEvent error', err);
    return ok(err.statusCode || 500, { message: err.message || 'Internal error' });
  }
};
