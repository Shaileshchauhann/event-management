const { ok, parseBody } = require('../lib/http');
const {
  getPaymentByPaymentId,
  getEvent,
  updatePayment,
  updateTicket,
  releaseTicketCapacity,
} = require('../lib/db');
const { authenticateAdmin } = require('../lib/auth');
const { getJwtSecret } = require('../lib/secrets');
const { createRefund } = require('../lib/razorpay');

exports.handler = async (event) => {
  try {
    const secret = await getJwtSecret();
    const auth = await authenticateAdmin(event, secret);

    const { paymentId } = event.pathParameters || {};
    if (!paymentId) return ok(400, { message: 'paymentId is required' });

    const paymentRecord = await getPaymentByPaymentId(paymentId);
    if (!paymentRecord) {
      return ok(404, { message: 'Payment record not found' });
    }

    // Verify admin owns the event
    const eventRecord = await getEvent(paymentRecord.eventId);
    if (!eventRecord) return ok(404, { message: 'Associated event not found' });

    if (eventRecord.adminId !== auth.adminId) {
      return ok(403, { message: 'Forbidden: You do not own the event for this payment' });
    }

    if (paymentRecord.status !== 'PAID') {
      return ok(400, { message: `Cannot refund payment with status: ${paymentRecord.status}` });
    }

    if (paymentRecord.refundStatus === 'REFUNDED') {
      return ok(409, { message: 'This payment has already been refunded' });
    }

    const body = parseBody(event);
    let refundAmount = paymentRecord.amount; // default full refund
    if (body.amount) {
      const parsedAmount = Math.round(Number(body.amount) * 100);
      if (parsedAmount > 0 && parsedAmount <= paymentRecord.amount) {
        refundAmount = parsedAmount;
      }
    }

    let rzpRefund = null;
    try {
      rzpRefund = await createRefund(paymentId, {
        amount: refundAmount,
        notes: {
          orderId: paymentRecord.orderId,
          reason: body.reason || 'Admin dashboard refund',
        },
      });
    } catch (refundErr) {
      console.error('Razorpay API refund error:', refundErr.message);
      return ok(refundErr.statusCode || 502, {
        message: refundErr.message || 'Razorpay refund processing failed',
      });
    }

    const refundId = rzpRefund ? rzpRefund.id : `rfnd_manual_${Date.now()}`;

    // Update payment record
    await updatePayment(paymentRecord.orderId, {
      refundId,
      refundAmount,
      refundStatus: refundAmount >= paymentRecord.amount ? 'REFUNDED' : 'PARTIALLY_REFUNDED',
      refundReason: body.reason || 'Admin initiated refund',
      updatedAt: new Date().toISOString(),
    });

    // Update ticket record if exists
    if (paymentRecord.ticketId) {
      await updateTicket(paymentRecord.ticketId, {
        refundStatus: refundAmount >= paymentRecord.amount ? 'REFUNDED' : 'PARTIALLY_REFUNDED',
        refundAmount,
        refundId,
      });

      // If full refund, optionally release capacity
      if (refundAmount >= paymentRecord.amount && body.releaseCapacity !== false) {
        try {
          await releaseTicketCapacity(paymentRecord.eventId);
        } catch (capErr) {
          console.warn('Capacity release on refund skipped or failed:', capErr.message);
        }
      }
    }

    return ok(200, {
      message: 'Refund processed successfully',
      paymentId,
      refundId,
      refundAmountRupees: +(refundAmount / 100).toFixed(2),
      status: refundAmount >= paymentRecord.amount ? 'REFUNDED' : 'PARTIALLY_REFUNDED',
    });
  } catch (err) {
    console.error('refundPayment error', err);
    return ok(err.statusCode || 500, { message: err.message || 'Internal error' });
  }
};
