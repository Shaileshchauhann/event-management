const { ok } = require('../lib/http');
const {
  listEventsByAdmin,
  listTicketsByEvent,
  listPaymentsByAdmin,
} = require('../lib/db');
const { authenticateAdmin } = require('../lib/auth');
const { getJwtSecret } = require('../lib/secrets');

exports.handler = async (event) => {
  try {
    const secret = await getJwtSecret();
    const auth = await authenticateAdmin(event, secret);

    const query = event.queryStringParameters || {};
    const { range = '30d', startDate, endDate, eventId } = query;

    // Determine date filter boundaries
    const now = new Date();
    let filterStart = null;
    let filterEnd = new Date(now.getTime() + 24 * 60 * 60 * 1000); // end of today

    if (range === 'today') {
      filterStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    } else if (range === '7d') {
      filterStart = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    } else if (range === '30d') {
      filterStart = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    } else if (range === '90d') {
      filterStart = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
    } else if (range === 'custom' && startDate) {
      filterStart = new Date(startDate);
      if (endDate) filterEnd = new Date(new Date(endDate).getTime() + 24 * 60 * 60 * 1000);
    }

    // 1. Fetch owned events
    let ownedEvents = await listEventsByAdmin(auth.adminId);
    if (eventId) {
      ownedEvents = ownedEvents.filter((e) => e.eventId === eventId);
    }

    const eventMap = new Map();
    ownedEvents.forEach((e) => eventMap.set(e.eventId, e));

    // 2. Fetch payments for admin
    let payments = await listPaymentsByAdmin(auth.adminId);
    if (eventId) {
      payments = payments.filter((p) => p.eventId === eventId);
    }

    // Filter payments by date range if applicable
    if (filterStart) {
      payments = payments.filter((p) => {
        const pDate = new Date(p.createdAt);
        return pDate >= filterStart && pDate <= filterEnd;
      });
    }

    // 3. Fetch tickets across events
    const allTickets = [];
    for (const ev of ownedEvents) {
      const tickets = await listTicketsByEvent(ev.eventId);
      tickets.forEach((t) => {
        t.eventName = ev.name;
        t.eventDate = ev.date;
        t.eventIsPaid = Boolean(ev.isPaid);
      });
      allTickets.push(...tickets);
    }

    // Filter tickets by date range
    let filteredTickets = allTickets;
    if (filterStart) {
      filteredTickets = allTickets.filter((t) => {
        const tDate = new Date(t.issuedAt || t.createdAt);
        return tDate >= filterStart && tDate <= filterEnd;
      });
    }

    // --- Metric Calculations ---
    let grossSalesPaise = 0;
    let totalRefundsPaise = 0;
    let successfulPaidOrders = 0;
    let failedPaymentsCount = 0;
    const paymentMethods = {};

    payments.forEach((p) => {
      const isSuccessfulPurchase =
        p.status === 'PAID' ||
        p.refundStatus === 'REFUNDED' ||
        p.refundStatus === 'PARTIALLY_REFUNDED' ||
        (p.paymentId && p.status !== 'FAILED' && p.status !== 'CREATED');

      if (isSuccessfulPurchase) {
        grossSalesPaise += p.amount || 0;
        successfulPaidOrders += 1;
        const method = p.paymentMethod || 'online';
        paymentMethods[method] = (paymentMethods[method] || 0) + 1;
      } else if (p.status === 'FAILED') {
        failedPaymentsCount += 1;
      }

      if ((p.refundStatus === 'REFUNDED' || p.refundStatus === 'PARTIALLY_REFUNDED') && p.refundAmount) {
        totalRefundsPaise += p.refundAmount;
      }
    });

    const netRevenuePaise = Math.max(0, grossSalesPaise - totalRefundsPaise);
    const grossSalesRupees = +(grossSalesPaise / 100).toFixed(2);
    const totalRefundsRupees = +(totalRefundsPaise / 100).toFixed(2);
    const netRevenueRupees = +(netRevenuePaise / 100).toFixed(2);

    let confirmedCount = 0;
    let checkedInCount = 0;
    let cancelledCount = 0;
    let paidTicketsCount = 0;
    let freeTicketsCount = 0;

    filteredTickets.forEach((t) => {
      if (t.status === 'CANCELLED') {
        cancelledCount += 1;
      } else {
        confirmedCount += 1;
        if (t.status === 'CHECKED_IN') checkedInCount += 1;
        if (t.pricePaid && t.pricePaid > 0) {
          paidTicketsCount += 1;
        } else {
          freeTicketsCount += 1;
        }
      }
    });

    const totalRegistrations = filteredTickets.length;
    const cancellationRate = totalRegistrations > 0
      ? +((cancelledCount / totalRegistrations) * 100).toFixed(1)
      : 0;
    const refundRate = grossSalesPaise > 0
      ? +((totalRefundsPaise / grossSalesPaise) * 100).toFixed(1)
      : 0;
    const averageOrderValueRupees = successfulPaidOrders > 0
      ? +(grossSalesRupees / successfulPaidOrders).toFixed(2)
      : 0;

    // Events categorization
    const nowEpoch = now.getTime();
    let upcomingEventsCount = 0;
    let completedEventsCount = 0;

    ownedEvents.forEach((e) => {
      const eTime = new Date(e.date).getTime();
      if (eTime > nowEpoch) upcomingEventsCount++;
      else completedEventsCount++;
    });

    // --- Event-Wise Performance ---
    const eventPerformance = ownedEvents.map((ev) => {
      const evTickets = allTickets.filter((t) => t.eventId === ev.eventId);
      const evFilteredTickets = filteredTickets.filter((t) => t.eventId === ev.eventId);
      const evPayments = payments.filter((p) => p.eventId === ev.eventId);

      let evGrossPaise = 0;
      let evRefundPaise = 0;
      evPayments.forEach((p) => {
        const isSuccessfulPurchase =
          p.status === 'PAID' ||
          p.refundStatus === 'REFUNDED' ||
          p.refundStatus === 'PARTIALLY_REFUNDED' ||
          (p.paymentId && p.status !== 'FAILED' && p.status !== 'CREATED');

        if (isSuccessfulPurchase) evGrossPaise += p.amount || 0;
        if ((p.refundStatus === 'REFUNDED' || p.refundStatus === 'PARTIALLY_REFUNDED') && p.refundAmount) {
          evRefundPaise += p.refundAmount;
        }
      });

      const evTotalReg = evFilteredTickets.length;
      const evCancelled = evFilteredTickets.filter((t) => t.status === 'CANCELLED').length;
      const evConfirmed = evTotalReg - evCancelled;
      const evCapacity = ev.capacity ?? null;
      const evCapUtil = evCapacity && evCapacity > 0
        ? +((evConfirmed / evCapacity) * 100).toFixed(1)
        : null;

      return {
        eventId: ev.eventId,
        name: ev.name,
        date: ev.date,
        venue: ev.venue || '—',
        isPaid: Boolean(ev.isPaid),
        priceRupees: ev.price ? +(ev.price / 100).toFixed(2) : 0,
        currency: ev.currency || 'INR',
        capacity: evCapacity,
        ticketsIssued: ev.ticketsIssued ?? 0,
        totalRegistrations: evTotalReg,
        confirmedRegistrations: evConfirmed,
        cancelledRegistrations: evCancelled,
        ticketsSold: evConfirmed,
        capacityUtilization: evCapUtil,
        grossSales: +(evGrossPaise / 100).toFixed(2),
        refunds: +(evRefundPaise / 100).toFixed(2),
        netRevenue: +((evGrossPaise - evRefundPaise) / 100).toFixed(2),
        cancellationRate: evTotalReg > 0 ? +((evCancelled / evTotalReg) * 100).toFixed(1) : 0,
      };
    });

    // --- Timeline / Daily Buckets (Last 7-30 days) ---
    const timelineMap = new Map();
    // Default last 7 days buckets
    const daysToShow = range === '7d' ? 7 : range === 'today' ? 1 : 14;
    for (let i = daysToShow - 1; i >= 0; i--) {
      const d = new Date(now.getTime() - i * 24 * 60 * 60 * 1000);
      const key = d.toISOString().split('T')[0];
      timelineMap.set(key, { date: key, revenue: 0, tickets: 0, refunds: 0 });
    }

    payments.forEach((p) => {
      const day = (p.createdAt || '').split('T')[0];
      if (timelineMap.has(day)) {
        const item = timelineMap.get(day);
        const isSuccessfulPurchase =
          p.status === 'PAID' ||
          p.refundStatus === 'REFUNDED' ||
          p.refundStatus === 'PARTIALLY_REFUNDED' ||
          (p.paymentId && p.status !== 'FAILED' && p.status !== 'CREATED');

        if (isSuccessfulPurchase) {
          item.revenue += +((p.amount || 0) / 100).toFixed(2);
        }
        if ((p.refundStatus === 'REFUNDED' || p.refundStatus === 'PARTIALLY_REFUNDED') && p.refundAmount) {
          item.refunds += +((p.refundAmount || 0) / 100).toFixed(2);
        }
      }
    });

    filteredTickets.forEach((t) => {
      const day = (t.issuedAt || t.createdAt || '').split('T')[0];
      if (timelineMap.has(day) && t.status !== 'CANCELLED') {
        timelineMap.get(day).tickets += 1;
      }
    });

    const revenueTimeline = Array.from(timelineMap.values());

    return ok(200, {
      kpis: {
        totalTicketsSold: confirmedCount,
        grossSales: grossSalesRupees,
        totalRefunds: totalRefundsRupees,
        netRevenue: netRevenueRupees,
        totalRegistrations,
        confirmedRegistrations: confirmedCount,
        checkedInRegistrations: checkedInCount,
        cancelledRegistrations: cancelledCount,
        failedPayments: failedPaymentsCount,
        averageOrderValue: averageOrderValueRupees,
        cancellationRate,
        refundRate,
        totalEvents: ownedEvents.length,
        upcomingEvents: upcomingEventsCount,
        completedEvents: completedEventsCount,
      },
      distribution: {
        paidTickets: paidTicketsCount,
        freeTickets: freeTicketsCount,
        paymentMethods,
      },
      timeline: revenueTimeline,
      eventPerformance,
    });
  } catch (err) {
    console.error('getAdminAnalytics error', err);
    return ok(err.statusCode || 500, { message: err.message || 'Internal error' });
  }
};
