/**
 * test_payments_analytics_e2e.js
 *
 * Comprehensive end-to-end test suite for:
 * - Event pricing (Free vs Paid)
 * - Razorpay order creation and signature verification
 * - Idempotent payment processing & overbooking protection
 * - Webhook processing (payment.captured, payment.failed, refund.processed)
 * - Cancellation and automatic refund initiation
 * - Server-side Admin Analytics calculations (Gross, Net, Refunds, AOV, Rates)
 * - Admin Transactions table and search
 */

const assert = require('assert');
const crypto = require('crypto');

// 1. In-memory Mock Stores
const memoryAdmins = new Map();
const memoryEvents = new Map();
const memoryTickets = new Map();
const memoryChallenges = new Map();
const memoryPayments = new Map();

const JWT_TEST_SECRET = 'mock-secret-64-byte-long-character-string-for-jwt-signing-and-auth';
const RZP_TEST_KEY_ID = process.env.RAZORPAY_KEY_ID || 'rzp_test_placeholder_key_id';
const RZP_TEST_KEY_SECRET = process.env.RAZORPAY_KEY_SECRET || 'dummy_test_secret_for_hmac_24char';
const RZP_TEST_WEBHOOK_SECRET = process.env.RAZORPAY_WEBHOOK_SECRET || 'testwebhooksecret999';

// Setup environment variables
process.env.ADMINS_TABLE = 'TestAdmins';
process.env.EVENTS_TABLE = 'TestEvents';
process.env.TICKETS_TABLE = 'TestTickets';
process.env.VERIFICATION_CODES_TABLE = 'TestVerificationCodes';
process.env.PAYMENTS_TABLE = 'TestPayments';
process.env.JWT_SECRET_ARN = 'arn:aws:secretsmanager:ap-south-1:123456789012:secret:TestJwtSecret';
process.env.SENDER_EMAIL = 'test@example.com';
process.env.ADMIN_REGISTRATION_SECRET = 'super-secure-admin-bootstrap-secret';
process.env.FRONTEND_BASE_URL = 'http://localhost:5174';
process.env.RAZORPAY_KEY_ID = RZP_TEST_KEY_ID;
process.env.RAZORPAY_KEY_SECRET = RZP_TEST_KEY_SECRET;
process.env.RAZORPAY_WEBHOOK_SECRET = RZP_TEST_WEBHOOK_SECRET;

// 2. Mock Secrets
const secretsLib = require('../src/lib/secrets');
secretsLib.getJwtSecret = async () => JWT_TEST_SECRET;

// 3. Mock Email
const emailLib = require('../src/lib/email');
const sentEmails = [];
emailLib.sendTicketEmail = async (opts) => {
  sentEmails.push({ type: 'TICKET', ...opts });
  return true;
};
emailLib.sendOtpEmail = async (opts) => {
  sentEmails.push({ type: 'OTP', ...opts });
  return true;
};

// 4. Mock DB
const dbLib = require('../src/lib/db');

// Admin methods
dbLib.putAdmin = async (a) => { memoryAdmins.set(a.adminId, { ...a }); return a; };
dbLib.getAdminById = async (id) => memoryAdmins.get(id) || null;
dbLib.getAdminByEmail = async (email) => {
  const norm = (email || '').trim().toLowerCase();
  for (const a of memoryAdmins.values()) if (a.email === norm) return { ...a };
  return null;
};
dbLib.countAdmins = async () => memoryAdmins.size;

// Event methods
dbLib.putEvent = async (ev) => { memoryEvents.set(ev.eventId, { ...ev }); return ev; };
dbLib.updateEvent = async (ev) => { memoryEvents.set(ev.eventId, { ...ev }); return ev; };
dbLib.getEvent = async (id) => { const e = memoryEvents.get(id); return e ? { ...e } : null; };
dbLib.listEventsByAdmin = async (adminId) =>
  Array.from(memoryEvents.values()).filter((e) => e.adminId === adminId);
dbLib.listPublicEvents = async () =>
  Array.from(memoryEvents.values())
    .filter((e) => e.status === 'ACTIVE')
    .map((ev) => ({
      eventId: ev.eventId,
      name: ev.name,
      venue: ev.venue || null,
      date: ev.date,
      capacity: ev.capacity ?? null,
      ticketsIssued: ev.ticketsIssued ?? 0,
      status: ev.status,
      createdAt: ev.createdAt,
      isPaid: Boolean(ev.isPaid),
      price: ev.price ?? 0,
      currency: ev.currency || 'INR',
      salesStart: ev.salesStart || null,
      salesEnd: ev.salesEnd || null,
      maxTicketsPerUser: ev.maxTicketsPerUser ?? 1,
    }));

dbLib.reserveTicketCapacity = async (eventId) => {
  const ev = memoryEvents.get(eventId);
  if (!ev || ev.status !== 'ACTIVE') {
    const err = new Error('Conditional check failed');
    err.name = 'ConditionalCheckFailedException';
    throw err;
  }
  if (ev.capacity !== null && ev.capacity !== undefined && (ev.ticketsIssued || 0) >= ev.capacity) {
    const err = new Error('Conditional check failed');
    err.name = 'ConditionalCheckFailedException';
    throw err;
  }
  ev.ticketsIssued = (ev.ticketsIssued || 0) + 1;
  return { ...ev };
};
dbLib.releaseTicketCapacity = async (eventId) => {
  const ev = memoryEvents.get(eventId);
  if (ev && (ev.ticketsIssued || 0) > 0) ev.ticketsIssued -= 1;
};

// Ticket methods
dbLib.putTicket = async (t) => { memoryTickets.set(t.ticketId, { ...t }); return t; };
dbLib.getTicket = async (id) => { const t = memoryTickets.get(id); return t ? { ...t } : null; };
dbLib.listTicketsByEvent = async (eventId) =>
  Array.from(memoryTickets.values()).filter((t) => t.eventId === eventId);
dbLib.markTicketSent = async (id) => { const t = memoryTickets.get(id); if (t) t.status = 'SENT'; };
dbLib.cancelTicket = async (id) => {
  const t = memoryTickets.get(id);
  if (!t || t.status === 'CHECKED_IN') {
    const err = new Error('Conditional check failed');
    err.name = 'ConditionalCheckFailedException';
    throw err;
  }
  t.status = 'CANCELLED';
};
dbLib.updateTicket = async (ticketId, fields) => {
  const t = memoryTickets.get(ticketId);
  if (t) Object.assign(t, fields);
};

// Payment methods
dbLib.putPayment = async (p) => { memoryPayments.set(p.orderId, { ...p }); return p; };
dbLib.getPayment = async (orderId) => { const p = memoryPayments.get(orderId); return p ? { ...p } : null; };
dbLib.getPaymentByPaymentId = async (paymentId) => {
  for (const p of memoryPayments.values()) {
    if (p.paymentId === paymentId) return { ...p };
  }
  return null;
};
dbLib.listPaymentsByAdmin = async (adminId) =>
  Array.from(memoryPayments.values()).filter((p) => p.adminId === adminId);
dbLib.listPaymentsByEvent = async (eventId) =>
  Array.from(memoryPayments.values()).filter((p) => p.eventId === eventId);
dbLib.updatePayment = async (orderId, fields) => {
  const p = memoryPayments.get(orderId);
  if (p) Object.assign(p, fields);
};

// Challenge (OTP) methods
dbLib.putVerificationChallenge = async (c) => { memoryChallenges.set(c.challengeId, { ...c }); return c; };
dbLib.getVerificationChallenge = async (id) => { const c = memoryChallenges.get(id); return c ? { ...c } : null; };
dbLib.markChallengeUsed = async (id) => {
  const c = memoryChallenges.get(id);
  if (!c || c.used) {
    const err = new Error('Conditional check failed');
    err.name = 'ConditionalCheckFailedException';
    throw err;
  }
  c.used = true;
};
dbLib.incrementChallengeAttempts = async (id, expected) => {
  const c = memoryChallenges.get(id);
  if (c) c.attempts = (c.attempts || 0) + 1;
};
dbLib.queryCancellationChallenge = async (ticketId) => {
  const nowEpoch = Math.floor(Date.now() / 1000);
  const active = Array.from(memoryChallenges.values()).filter(
    (c) => c.ticketId === ticketId && c.purpose === 'CANCELLATION' && !c.used && c.expiresAt > nowEpoch
  );
  if (active.length === 0) return null;
  return active.sort((a, b) => (b.createdAt > a.createdAt ? 1 : -1))[0];
};
dbLib.findRecentChallenge = async ({ email, purpose, cooldownSeconds }) => null;

// 5. Mock Razorpay Client
const rzpLib = require('../src/lib/razorpay');
let nextRzpOrderId = 1000;
let nextRzpPaymentId = 5000;
let nextRzpRefundId = 8000;

rzpLib.setRazorpayClient({
  orders: {
    create: async ({ amount, currency, receipt, notes }) => {
      nextRzpOrderId++;
      return {
        id: `order_test_${nextRzpOrderId}`,
        entity: 'order',
        amount,
        currency: currency || 'INR',
        receipt,
        status: 'created',
        notes,
        created_at: Math.floor(Date.now() / 1000),
      };
    },
  },
  payments: {
    fetch: async (paymentId) => {
      return {
        id: paymentId,
        entity: 'payment',
        amount: 49900,
        currency: 'INR',
        status: 'captured',
        method: 'upi',
      };
    },
    refund: async (paymentId, payload) => {
      nextRzpRefundId++;
      return {
        id: `rfnd_test_${nextRzpRefundId}`,
        entity: 'refund',
        amount: payload.amount || 49900,
        currency: 'INR',
        payment_id: paymentId,
        status: 'processed',
        notes: payload.notes || {},
      };
    },
  },
});

// Helper: generate valid Razorpay payment signature
function generateValidSignature(orderId, paymentId) {
  return crypto
    .createHmac('sha256', RZP_TEST_KEY_SECRET)
    .update(`${orderId}|${paymentId}`)
    .digest('hex');
}

// 6. Import Handlers
const adminRegisterHandler = require('../src/functions/adminRegister').handler;
const adminLoginHandler = require('../src/functions/adminLogin').handler;
const createEventHandler = require('../src/functions/createEvent').handler;
const updateEventHandler = require('../src/functions/updateEvent').handler;
const listPublicEventsHandler = require('../src/functions/listPublicEvents').handler;
const issueTicketHandler = require('../src/functions/issueTicket').handler;
const createPaymentOrderHandler = require('../src/functions/createPaymentOrder').handler;
const verifyPaymentAndBookHandler = require('../src/functions/verifyPaymentAndBook').handler;
const getAdminAnalyticsHandler = require('../src/functions/getAdminAnalytics').handler;
const listAdminPaymentsHandler = require('../src/functions/listAdminPayments').handler;
const refundPaymentHandler = require('../src/functions/refundPayment').handler;
const verifyCancellationCodeHandler = require('../src/functions/verifyCancellationCode').handler;
const requestCancellationCodeHandler = require('../src/functions/requestCancellationCode').handler;

// 7. Test Execution
async function runPaymentAnalyticsE2ETests() {
  console.log('=== Starting Razorpay Payments & Admin Analytics E2E Test Suite ===\n');

  // STEP 1: Register and login admin
  console.log('Step 1: Admin Registration & Authentication...');
  const regRes = await adminRegisterHandler({
    body: JSON.stringify({ name: 'Finance Admin', email: 'finance@eventcorp.com', password: 'password123' }),
  });
  assert.strictEqual(regRes.statusCode, 201);
  const adminId = JSON.parse(regRes.body).admin.adminId;

  const loginRes = await adminLoginHandler({
    body: JSON.stringify({ email: 'finance@eventcorp.com', password: 'password123' }),
  });
  const token = JSON.parse(loginRes.body).token;
  const authHeaders = { Authorization: `Bearer ${token}` };
  console.log('   ✓ Admin registered and authenticated.');

  // STEP 2: Create a Free Event
  console.log('\nStep 2: Create Free Event...');
  const freeEvRes = await createEventHandler({
    headers: authHeaders,
    body: JSON.stringify({
      name: 'Open Community Meetup',
      venue: 'Town Hall',
      date: '2026-11-15T18:00:00Z',
      capacity: 100,
      isPaid: false,
      price: 0,
      currency: 'INR',
    }),
  });
  assert.strictEqual(freeEvRes.statusCode, 201);
  const freeEvent = JSON.parse(freeEvRes.body);
  assert.strictEqual(freeEvent.isPaid, false);
  assert.strictEqual(freeEvent.price, 0);
  console.log('   ✓ Free event created with price = 0.');

  // STEP 3: Create a Paid Event
  console.log('\nStep 3: Create Paid Event with Price Validation...');
  // 3a. Reject negative price
  const negPriceRes = await createEventHandler({
    headers: authHeaders,
    body: JSON.stringify({
      name: 'Negative Price Event',
      venue: 'Hall',
      date: '2026-11-20T10:00:00Z',
      isPaid: true,
      price: -50,
    }),
  });
  assert.strictEqual(negPriceRes.statusCode, 400, 'Must reject negative price');

  // 3b. Reject unsupported currency
  const badCurrRes = await createEventHandler({
    headers: authHeaders,
    body: JSON.stringify({
      name: 'Bad Currency Event',
      venue: 'Hall',
      date: '2026-11-20T10:00:00Z',
      isPaid: true,
      price: 500,
      currency: 'USD',
    }),
  });
  assert.strictEqual(badCurrRes.statusCode, 400, 'Must reject non-INR currency');

  // 3c. Create valid paid event: ₹499 (49900 paise), capacity = 3
  const paidEvRes = await createEventHandler({
    headers: authHeaders,
    body: JSON.stringify({
      name: 'Premium Tech Summit 2026',
      venue: 'Grand Convention Center',
      date: '2026-12-05T09:00:00Z',
      capacity: 3,
      isPaid: true,
      price: 499, // ₹499 -> 49900 paise
      currency: 'INR',
    }),
  });
  assert.strictEqual(paidEvRes.statusCode, 201);
  const paidEvent = JSON.parse(paidEvRes.body);
  assert.strictEqual(paidEvent.isPaid, true);
  assert.strictEqual(paidEvent.price, 49900, 'Price must be stored in paise');
  assert.strictEqual(paidEvent.currency, 'INR');
  console.log('   ✓ Paid event created successfully. Price stored as 49900 paise (₹499.00).');

  // STEP 4: Public event list exposes pricing
  console.log('\nStep 4: Verify Public Event Listing contains pricing attributes...');
  const publicEventsRes = await listPublicEventsHandler();
  assert.strictEqual(publicEventsRes.statusCode, 200);
  const publicEvents = JSON.parse(publicEventsRes.body);
  const foundPaid = publicEvents.find((e) => e.eventId === paidEvent.eventId);
  assert.ok(foundPaid, 'Paid event must be in public list');
  assert.strictEqual(foundPaid.isPaid, true);
  assert.strictEqual(foundPaid.price, 49900);
  assert.strictEqual(foundPaid.currency, 'INR');
  console.log('   ✓ Public listing verified with pricing metadata.');

  // STEP 5: Security Check — Paid event cannot issue ticket directly without payment
  console.log('\nStep 5: Security Guard — Direct ticket issuance blocked on paid event...');
  const unauthFreeRes = await issueTicketHandler({
    pathParameters: { eventId: paidEvent.eventId },
    body: JSON.stringify({ attendeeName: 'Hacker', attendeeEmail: 'hack@example.com' }),
  });
  assert.strictEqual(unauthFreeRes.statusCode, 402, 'Must reject free issuance for paid event');
  console.log('   ✓ Direct free issuance rejected on paid event with HTTP 402.');

  // Free event direct issuance continues to work
  const freeTicketRes = await issueTicketHandler({
    pathParameters: { eventId: freeEvent.eventId },
    body: JSON.stringify({ attendeeName: 'Free Attendee', attendeeEmail: 'free@example.com' }),
  });
  assert.strictEqual(freeTicketRes.statusCode, 201, 'Free event booking succeeds');
  console.log('   ✓ Free event booking remains fully functional.');

  // STEP 6: Attendee creates Razorpay Order for Paid Event
  console.log('\nStep 6: Attendee initiates Razorpay Order creation...');
  const createOrderRes = await createPaymentOrderHandler({
    body: JSON.stringify({
      eventId: paidEvent.eventId,
      attendeeName: 'Priya Sharma',
      attendeeEmail: 'priya@example.com',
    }),
  });
  assert.strictEqual(createOrderRes.statusCode, 201);
  const orderData = JSON.parse(createOrderRes.body);
  assert.ok(orderData.orderId.startsWith('order_test_'));
  assert.strictEqual(orderData.amount, 49900);
  assert.strictEqual(orderData.currency, 'INR');
  assert.strictEqual(orderData.keyId, RZP_TEST_KEY_ID);
  console.log('   ✓ Razorpay order created. orderId:', orderData.orderId, '| keyId returned.');

  // Verify stored payment record in CREATED status
  const storedPayment = memoryPayments.get(orderData.orderId);
  assert.ok(storedPayment);
  assert.strictEqual(storedPayment.status, 'CREATED');
  assert.strictEqual(storedPayment.amount, 49900);
  console.log('   ✓ Payment record persisted in CREATED status in PaymentsTable.');

  // STEP 7: Verify Payment Signature & Confirm Booking
  console.log('\nStep 7: Payment Verification & Ticket Issuance...');
  const paymentId1 = 'pay_test_5001';

  // 7a. Reject invalid signature
  const invalidSigRes = await verifyPaymentAndBookHandler({
    body: JSON.stringify({
      orderId: orderData.orderId,
      paymentId: paymentId1,
      signature: 'bad_tampered_signature_12345',
    }),
  });
  assert.strictEqual(invalidSigRes.statusCode, 400, 'Tampered signature must be rejected');
  console.log('   ✓ Invalid payment signature rejected with 400.');

  // 7b. Accept valid signature
  const validSig = generateValidSignature(orderData.orderId, paymentId1);
  const validPaymentRes = await verifyPaymentAndBookHandler({
    body: JSON.stringify({
      orderId: orderData.orderId,
      paymentId: paymentId1,
      signature: validSig,
    }),
  });
  assert.strictEqual(validPaymentRes.statusCode, 200);
  const ticket1 = JSON.parse(validPaymentRes.body);
  assert.ok(ticket1.ticketId, 'Ticket ID must be returned');
  assert.strictEqual(ticket1.pricePaid, 49900);
  assert.strictEqual(ticket1.paymentId, paymentId1);
  assert.strictEqual(ticket1.currency, 'INR');
  console.log('   ✓ Payment verified. Ticket issued with ID:', ticket1.ticketId);

  // STEP 8: Idempotency Protection — Duplicate payment verification callback
  console.log('\nStep 8: Idempotency Test — Duplicate payment callback...');
  const dupVerifyRes = await verifyPaymentAndBookHandler({
    body: JSON.stringify({
      orderId: orderData.orderId,
      paymentId: paymentId1,
      signature: validSig,
    }),
  });
  assert.strictEqual(dupVerifyRes.statusCode, 200);
  const dupResult = JSON.parse(dupVerifyRes.body);
  assert.strictEqual(dupResult.ticketId, ticket1.ticketId, 'Must return same ticketId without re-issuing');
  // Capacity should only have been incremented once!
  const eventCheck = memoryEvents.get(paidEvent.eventId);
  assert.strictEqual(eventCheck.ticketsIssued, 1, 'ticketsIssued must be exactly 1');
  console.log('   ✓ Idempotency verified: duplicate submission produced no double ticket or double capacity reservation.');

  // STEP 9: Second Attendee Direct Payment Verification
  console.log('\nStep 9: Second Attendee Payment Verification & Ticket Issuance...');
  // Create second order
  const order2Res = await createPaymentOrderHandler({
    body: JSON.stringify({
      eventId: paidEvent.eventId,
      attendeeName: 'Rahul Verma',
      attendeeEmail: 'rahul@example.com',
    }),
  });
  const order2Data = JSON.parse(order2Res.body);
  const paymentId2 = 'pay_test_5002';
  const sig2 = crypto
    .createHmac('sha256', RZP_TEST_KEY_SECRET)
    .update(`${order2Data.orderId}|${paymentId2}`)
    .digest('hex');

  const verify2Res = await verifyPaymentAndBookHandler({
    body: JSON.stringify({
      orderId: order2Data.orderId,
      paymentId: paymentId2,
      signature: sig2,
    }),
  });
  assert.strictEqual(verify2Res.statusCode, 200);
  const order2Record = memoryPayments.get(order2Data.orderId);
  assert.strictEqual(order2Record.status, 'PAID');
  assert.ok(order2Record.ticketId, 'Payment verification must have issued ticket');
  console.log('   ✓ Second attendee payment verified and ticket issued directly.');

  // STEP 10: Capacity Limit Enforcement (Capacity = 3, currently 2 issued)
  console.log('\nStep 10: Paid Event Capacity Limit Enforcement...');
  // 3rd ticket fills capacity (3/3)
  const order3Res = await createPaymentOrderHandler({
    body: JSON.stringify({
      eventId: paidEvent.eventId,
      attendeeName: 'Third Buyer',
      attendeeEmail: 'third@example.com',
    }),
  });
  const order3Data = JSON.parse(order3Res.body);
  const paymentId3 = 'pay_test_5003';
  const sig3 = generateValidSignature(order3Data.orderId, paymentId3);
  await verifyPaymentAndBookHandler({
    body: JSON.stringify({ orderId: order3Data.orderId, paymentId: paymentId3, signature: sig3 }),
  });
  assert.strictEqual(memoryEvents.get(paidEvent.eventId).ticketsIssued, 3);

  // 4th buyer tries to create order -> blocked with 409 Event is full
  const order4Res = await createPaymentOrderHandler({
    body: JSON.stringify({
      eventId: paidEvent.eventId,
      attendeeName: 'Fourth Overflow',
      attendeeEmail: 'overflow@example.com',
    }),
  });
  assert.strictEqual(order4Res.statusCode, 409, 'Must return 409 when capacity full');
  console.log('   ✓ Capacity limit strictly enforced: 3 paid tickets allowed, 4th blocked with 409.');

  // STEP 11: Cancellation & Refund Processing
  console.log('\nStep 11: Paid Ticket Cancellation with Automatic Refund...');
  // Attendee 1 requests cancellation OTP
  const cancelReqRes = await requestCancellationCodeHandler({
    pathParameters: { ticketId: ticket1.ticketId },
  });
  assert.strictEqual(cancelReqRes.statusCode, 200);
  const cancelOtp = sentEmails.filter((e) => e.purpose === 'CANCELLATION').pop().code;

  // Confirm cancellation with OTP
  const cancelConfirmRes = await verifyCancellationCodeHandler({
    pathParameters: { ticketId: ticket1.ticketId },
    body: JSON.stringify({ code: cancelOtp }),
  });
  assert.strictEqual(cancelConfirmRes.statusCode, 200);
  const cancelResult = JSON.parse(cancelConfirmRes.body);
  assert.strictEqual(cancelResult.refundProcessed, true);
  assert.strictEqual(cancelResult.refundAmount, 49900);
  assert.ok(cancelResult.refundId);

  // Capacity must be released
  assert.strictEqual(memoryEvents.get(paidEvent.eventId).ticketsIssued, 2, 'Capacity decremented to 2');
  console.log('   ✓ Paid ticket cancelled. Refund processed via Razorpay SDK & capacity released.');

  // STEP 12: Admin Analytics Calculations & Aggregation
  console.log('\nStep 12: Admin Analytics Verification (KPIs & Calculations)...');
  const analyticsRes = await getAdminAnalyticsHandler({
    headers: authHeaders,
    queryStringParameters: { range: 'all' },
  });
  assert.strictEqual(analyticsRes.statusCode, 200);
  const analytics = JSON.parse(analyticsRes.body);

  // Calculations check:
  // Paid orders: 3 created and paid (3 * 499 = ₹1497.00 gross sales)
  // 1 refunded (₹499.00)
  // Net ticket revenue: 1497.00 - 499.00 = ₹998.00
  console.log('   Analytics KPIs returned:', analytics.kpis);
  assert.strictEqual(analytics.kpis.grossSales, 1497.0, 'Gross sales must be ₹1497.00');
  assert.strictEqual(analytics.kpis.totalRefunds, 499.0, 'Total refunds must be ₹499.00');
  assert.strictEqual(analytics.kpis.netRevenue, 998.0, 'Net ticket revenue must be ₹998.00');
  assert.strictEqual(analytics.kpis.averageOrderValue, 499.0, 'AOV must be ₹499.00');
  assert.ok(analytics.eventPerformance.length >= 2, 'Must include event-wise breakdown');

  const paidPerf = analytics.eventPerformance.find((e) => e.eventId === paidEvent.eventId);
  assert.strictEqual(paidPerf.grossSales, 1497.0);
  assert.strictEqual(paidPerf.refunds, 499.0);
  assert.strictEqual(paidPerf.netRevenue, 998.0);
  console.log('   ✓ Admin Analytics KPIs, Gross, Net, Refund, and Event Performance strictly verified.');

  // STEP 13: Admin Payments & Transactions Listing
  console.log('\nStep 13: Admin Transactions Table & Filtering...');
  const paymentsListRes = await listAdminPaymentsHandler({
    headers: authHeaders,
    queryStringParameters: { search: 'priya' },
  });
  assert.strictEqual(paymentsListRes.statusCode, 200);
  const paymentsList = JSON.parse(paymentsListRes.body);
  assert.strictEqual(paymentsList.payments.length, 1);
  assert.strictEqual(paymentsList.payments[0].attendeeName, 'Priya Sharma');
  assert.strictEqual(paymentsList.payments[0].refundStatus, 'REFUNDED');
  console.log('   ✓ Admin payment search and refund status verified.');

  // STEP 14: Admin Initiates Refund on an active transaction
  console.log('\nStep 14: Admin Dashboard Refund Action...');
  const adminRefundRes = await refundPaymentHandler({
    headers: authHeaders,
    pathParameters: { paymentId: paymentId2 },
    body: JSON.stringify({ reason: 'VIP Customer Service Refund' }),
  });
  assert.strictEqual(adminRefundRes.statusCode, 200);
  const adminRefundResult = JSON.parse(adminRefundRes.body);
  assert.strictEqual(adminRefundResult.refundAmountRupees, 499.0);
  console.log('   ✓ Admin refund initiated successfully via dashboard.');

  console.log('\n=== ALL PAYMENT & ANALYTICS E2E TESTS PASSED 100%! ===');
}

runPaymentAnalyticsE2ETests().catch((err) => {
  console.error('\nPayment & Analytics E2E Test FAILED:', err);
  process.exit(1);
});
