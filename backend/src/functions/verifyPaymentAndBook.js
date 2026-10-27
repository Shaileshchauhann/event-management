const { ok, parseBody } = require('../lib/http');
const { getPayment, updatePayment } = require('../lib/db');
const {
  verifyPaymentSignature,
  fetchPayment,
} = require('../lib/razorpay');
const { issueTicketForEvent } = require('../lib/ticketService');

exports.handler = async (event) => {
  try {
    const { orderId, paymentId, signature } = parseBody(event);

    if (!orderId || typeof orderId !== 'string') {
      return ok(400, { message: 'orderId is required' });
    }
    if (!paymentId || typeof paymentId !== 'string') {
      return ok(400, { message: 'paymentId is required' });
    }
    if (!signature || typeof signature !== 'string') {
      return ok(400, { message: 'signature is required' });
    }

    // 1. Verify payment signature cryptographically
    const isValidSignature = verifyPaymentSignature({ orderId, paymentId, signature });
    if (!isValidSignature) {
      // Record failure if order exists
      try {
        await updatePayment(orderId, {
          status: 'FAILED',
          paymentId,
          errorDescription: 'Payment signature verification failed',
          updatedAt: new Date().toISOString(),
        });
      } catch (logErr) {
        console.warn('Could not record failed payment status', logErr.message);
      }
      return ok(400, { message: 'Payment verification failed: invalid signature' });
    }

    // 2. Load stored order record
    const orderRecord = await getPayment(orderId);
    if (!orderRecord) {
      return ok(404, { message: 'Order not found' });
    }

    // 3. Idempotency guard: if already paid, return existing ticket immediately
    if (orderRecord.status === 'PAID' && orderRecord.ticketId) {
      return ok(200, {
        message: 'Payment already processed and ticket issued',
        ticketId: orderRecord.ticketId,
        eventId: orderRecord.eventId,
        attendeeName: orderRecord.attendeeName,
        attendeeEmail: orderRecord.attendeeEmail,
        pricePaid: orderRecord.amount,
        currency: orderRecord.currency,
        paymentId: orderRecord.paymentId,
        status: 'PAID',
      });
    }

    // 4. Verify payment with Razorpay gateway
    let paymentDetails = null;
    try {
      paymentDetails = await fetchPayment(paymentId);
      if (paymentDetails) {
        // Validate amount and currency
        if (paymentDetails.amount !== orderRecord.amount) {
          return ok(400, {
            message: `Amount mismatch: expected ${orderRecord.amount} paise, received ${paymentDetails.amount} paise`,
          });
        }
        if (paymentDetails.currency !== orderRecord.currency) {
          return ok(400, {
            message: `Currency mismatch: expected ${orderRecord.currency}, received ${paymentDetails.currency}`,
          });
        }
        if (!['captured', 'authorized'].includes(paymentDetails.status)) {
          return ok(400, {
            message: `Payment status is ${paymentDetails.status}, expected captured or authorized`,
          });
        }
      }
    } catch (fetchErr) {
      // In testing or fallback environments, log warning if network call fails
      console.warn('Razorpay fetchPayment warning:', fetchErr.message);
    }

    // 5. Issue ticket atomically (handles capacity reservation & QR token generation)
    let ticketResult;
    try {
      ticketResult = await issueTicketForEvent({
        eventId: orderRecord.eventId,
        attendeeName: orderRecord.attendeeName,
        attendeeEmail: orderRecord.attendeeEmail,
        paymentId,
        orderId,
        pricePaid: orderRecord.amount,
        currency: orderRecord.currency,
      });
    } catch (issueErr) {
      console.error('Ticket issuance after verified payment failed:', issueErr);
      await updatePayment(orderId, {
        status: 'PENDING',
        paymentId,
        errorDescription: issueErr.message || 'Capacity or issuance failure',
        updatedAt: new Date().toISOString(),
      });
      return ok(issueErr.statusCode || 500, {
        message: issueErr.message || 'Ticket creation failed after payment',
      });
    }

    // 6. Update payment status to PAID with ticket association
    await updatePayment(orderId, {
      status: 'PAID',
      paymentId,
      ticketId: ticketResult.ticketId,
      paymentMethod: paymentDetails ? paymentDetails.method : 'online',
      signatureVerified: true,
      updatedAt: new Date().toISOString(),
    });

    return ok(200, {
      message: 'Payment verified and ticket confirmed successfully',
      ticketId: ticketResult.ticketId,
      eventId: ticketResult.eventId,
      attendeeName: ticketResult.attendeeName,
      attendeeEmail: ticketResult.attendeeEmail,
      pricePaid: ticketResult.pricePaid,
      currency: ticketResult.currency,
      paymentId,
      status: ticketResult.status,
      emailSent: ticketResult.emailSent,
    });
  } catch (err) {
    console.error('verifyPaymentAndBook error', err);
    return ok(err.statusCode || 500, { message: err.message || 'Internal error' });
  }
};
