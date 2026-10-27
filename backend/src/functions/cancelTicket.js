const { ok, parseBody } = require('../lib/http');
const {
  getTicket,
  getEvent,
  cancelTicket,
  releaseTicketCapacity,
  updateTicket,
  updatePayment,
} = require('../lib/db');
const { authenticateAdmin } = require('../lib/auth');
const { getJwtSecret } = require('../lib/secrets');
const { createRefund } = require('../lib/razorpay');

exports.handler = async (event) => {
  try {
    const secret = await getJwtSecret();
    const auth = await authenticateAdmin(event, secret);

    const { ticketId } = event.pathParameters || {};
    if (!ticketId) return ok(400, { message: 'ticketId is required' });

    const ticket = await getTicket(ticketId);
    if (!ticket) return ok(404, { message: 'Ticket not found' });

    // Ticket ownership verification: ticket -> event -> adminId
    const eventRecord = await getEvent(ticket.eventId);
    if (!eventRecord) return ok(404, { message: 'Associated event not found' });

    if (eventRecord.adminId !== auth.adminId) {
      return ok(403, { message: 'Forbidden: You do not own the event for this ticket' });
    }

    try {
      await cancelTicket(ticketId);
      await releaseTicketCapacity(ticket.eventId);
    } catch (conditionErr) {
      return ok(409, { message: 'Ticket is already checked in, cannot cancel' });
    }

    // Process refund for paid ticket if requested (default is true)
    const body = parseBody(event);
    const shouldRefund = body.refund !== false;
    let refundProcessed = false;
    let refundId = null;
    let refundAmount = 0;

    if (ticket.pricePaid > 0 && ticket.paymentId && shouldRefund) {
      const customAmount = body.refundAmount ? Math.round(Number(body.refundAmount) * 100) : ticket.pricePaid;
      try {
        const rzpRefund = await createRefund(ticket.paymentId, {
          amount: customAmount,
          notes: {
            ticketId,
            eventId: ticket.eventId,
            reason: body.reason || 'Admin cancellation',
          },
        });
        refundProcessed = true;
        refundId = rzpRefund.id;
        refundAmount = customAmount;
      } catch (refundErr) {
        console.error('Razorpay refund error on admin cancel:', refundErr.message);
      }

      await updateTicket(ticketId, {
        refundStatus: refundProcessed ? 'REFUNDED' : 'PENDING',
        refundAmount,
        refundId,
      });

      if (ticket.orderId) {
        await updatePayment(ticket.orderId, {
          status: 'CANCELLED',
          refundStatus: refundProcessed ? 'REFUNDED' : 'PENDING',
          refundAmount,
          refundId,
          refundReason: body.reason || 'Admin cancellation',
          updatedAt: new Date().toISOString(),
        });
      }
    }

    return ok(200, {
      message: 'Ticket cancelled',
      ticketId,
      refundProcessed,
      refundAmount,
      refundId,
    });
  } catch (err) {
    console.error('cancelTicket error', err);
    return ok(err.statusCode || 500, { message: err.message || 'Internal error' });
  }
};
