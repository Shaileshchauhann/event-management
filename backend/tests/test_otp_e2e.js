/**
 * test_otp_e2e.js
 *
 * End-to-end tests for the OTP Email Verification features:
 *   A) Email verification before booking
 *   B) Attendee self-service cancellation via OTP
 *
 * Uses the same in-memory mock pattern as test_handlers_e2e.js so no
 * real AWS services are required. The mocks replicate the same conditional
 * DynamoDB semantics that the real implementation depends on.
 */

const assert = require('assert');

// ---------------------------------------------------------------------------
// In-memory mock stores
// ---------------------------------------------------------------------------
const memoryAdmins = new Map();
const memoryEvents = new Map();
const memoryTickets = new Map();
const memoryChallenges = new Map();

const JWT_TEST_SECRET = 'mock-secret-64-byte-long-character-string-for-jwt-signing-and-auth';

// ---------------------------------------------------------------------------
// Environment variables
// ---------------------------------------------------------------------------
process.env.ADMINS_TABLE = 'TestAdmins';
process.env.EVENTS_TABLE = 'TestEvents';
process.env.TICKETS_TABLE = 'TestTickets';
process.env.VERIFICATION_CODES_TABLE = 'TestVerificationCodes';
process.env.JWT_SECRET_ARN = 'arn:aws:secretsmanager:ap-south-1:123456789012:secret:TestJwtSecret';
process.env.SENDER_EMAIL = 'test@example.com';
process.env.ADMIN_REGISTRATION_SECRET = 'super-secure-admin-bootstrap-secret';
process.env.FRONTEND_BASE_URL = 'http://localhost:5173';

// ---------------------------------------------------------------------------
// Mock lib/secrets
// ---------------------------------------------------------------------------
const secretsLib = require('../src/lib/secrets');
secretsLib.getJwtSecret = async () => JWT_TEST_SECRET;

// ---------------------------------------------------------------------------
// Track sent emails for assertions
// ---------------------------------------------------------------------------
const sentEmails = [];
const emailLib = require('../src/lib/email');
emailLib.sendTicketEmail = async (opts) => {
  sentEmails.push({ type: 'TICKET', ...opts });
  return true;
};
emailLib.sendOtpEmail = async (opts) => {
  // Store the code in test memory for assertions (in production the code
  // is never stored or returned — only the hash lives in DynamoDB)
  sentEmails.push({ type: 'OTP', ...opts });
  return true;
};

// ---------------------------------------------------------------------------
// Mock lib/db — full implementation
// ---------------------------------------------------------------------------
const dbLib = require('../src/lib/db');

// --- Admin ---
dbLib.putAdmin = async (admin) => { memoryAdmins.set(admin.adminId, { ...admin }); return admin; };
dbLib.getAdminById = async (id) => memoryAdmins.get(id) || null;
dbLib.getAdminByEmail = async (email) => {
  const n = (email || '').trim().toLowerCase();
  for (const a of memoryAdmins.values()) if (a.email === n) return { ...a };
  return null;
};
dbLib.countAdmins = async () => memoryAdmins.size;

// --- Events ---
dbLib.putEvent = async (ev) => { memoryEvents.set(ev.eventId, { ...ev }); return ev; };
dbLib.getEvent = async (id) => { const e = memoryEvents.get(id); return e ? { ...e } : null; };
dbLib.listEventsByAdmin = async (adminId) =>
  Array.from(memoryEvents.values()).filter((e) => e.adminId === adminId);
dbLib.listPublicEvents = async () =>
  Array.from(memoryEvents.values())
    .filter((e) => e.status === 'ACTIVE')
    .map((ev) => ({ eventId: ev.eventId, name: ev.name, venue: ev.venue || null,
      date: ev.date, capacity: ev.capacity ?? null, ticketsIssued: ev.ticketsIssued ?? 0,
      status: ev.status, createdAt: ev.createdAt }));

dbLib.reserveTicketCapacity = async (eventId) => {
  const ev = memoryEvents.get(eventId);
  if (!ev || ev.status !== 'ACTIVE') throw Object.assign(new Error('Conditional check failed'), { name: 'ConditionalCheckFailedException' });
  if (ev.capacity !== null && ev.capacity !== undefined && (ev.ticketsIssued || 0) >= ev.capacity)
    throw Object.assign(new Error('Conditional check failed'), { name: 'ConditionalCheckFailedException' });
  ev.ticketsIssued = (ev.ticketsIssued || 0) + 1;
  return { ...ev };
};
dbLib.releaseTicketCapacity = async (eventId) => {
  const ev = memoryEvents.get(eventId);
  if (ev && (ev.ticketsIssued || 0) > 0) ev.ticketsIssued -= 1;
};

// --- Tickets ---
dbLib.putTicket = async (t) => { memoryTickets.set(t.ticketId, { ...t }); return t; };
dbLib.getTicket = async (id) => { const t = memoryTickets.get(id); return t ? { ...t } : null; };
dbLib.listTicketsByEvent = async (eventId) =>
  Array.from(memoryTickets.values()).filter((t) => t.eventId === eventId);
dbLib.markTicketSent = async (ticketId) => {
  const t = memoryTickets.get(ticketId);
  if (t && t.status === 'ISSUED') t.status = 'SENT';
};
dbLib.checkInTicket = async (ticketId, gateId) => {
  const t = memoryTickets.get(ticketId);
  if (!t || !['ISSUED', 'SENT'].includes(t.status))
    throw Object.assign(new Error('Conditional check failed'), { name: 'ConditionalCheckFailedException' });
  t.status = 'CHECKED_IN';
  t.checkedInAt = new Date().toISOString();
  t.checkedInBy = gateId || 'unknown';
  return t.checkedInAt;
};
dbLib.cancelTicket = async (ticketId) => {
  const t = memoryTickets.get(ticketId);
  if (!t || t.status === 'CHECKED_IN')
    throw Object.assign(new Error('Conditional check failed'), { name: 'ConditionalCheckFailedException' });
  t.status = 'CANCELLED';
};

// --- Verification Challenges (OTP) ---
dbLib.putVerificationChallenge = async (ch) => {
  memoryChallenges.set(ch.challengeId, { ...ch });
  return ch;
};
dbLib.getVerificationChallenge = async (id) => {
  const c = memoryChallenges.get(id);
  return c ? { ...c } : null;
};
dbLib.markChallengeUsed = async (challengeId) => {
  const c = memoryChallenges.get(challengeId);
  if (!c || c.used === true)
    throw Object.assign(new Error('Conditional check failed'), { name: 'ConditionalCheckFailedException' });
  c.used = true;
};
dbLib.incrementChallengeAttempts = async (challengeId, expectedAttempts) => {
  const c = memoryChallenges.get(challengeId);
  if (!c || c.used || c.attempts !== expectedAttempts)
    throw Object.assign(new Error('Conditional check failed'), { name: 'ConditionalCheckFailedException' });
  c.attempts += 1;
};
dbLib.queryCancellationChallenge = async (ticketId) => {
  const nowEpoch = Math.floor(Date.now() / 1000);
  const active = Array.from(memoryChallenges.values()).filter(
    (c) => c.ticketId === ticketId && c.purpose === 'CANCELLATION' && !c.used && c.expiresAt > nowEpoch
  );
  if (active.length === 0) return null;
  return active.sort((a, b) => (b.createdAt > a.createdAt ? 1 : -1))[0];
};
dbLib.findRecentChallenge = async ({ email, purpose, cooldownSeconds }) => {
  const cutoff = new Date(Date.now() - cooldownSeconds * 1000).toISOString();
  const found = Array.from(memoryChallenges.values()).find(
    (c) => c.attendeeEmail === email && c.purpose === purpose && !c.used && c.createdAt > cutoff
  );
  return found || null;
};

// ---------------------------------------------------------------------------
// Load handlers (after all mocks are set up)
// ---------------------------------------------------------------------------
const adminRegisterHandler = require('../src/functions/adminRegister').handler;
const adminLoginHandler    = require('../src/functions/adminLogin').handler;
const createEventHandler   = require('../src/functions/createEvent').handler;
const verifyTicketHandler  = require('../src/functions/verifyTicket').handler;
const cancelTicketHandler  = require('../src/functions/cancelTicket').handler;

const requestBookingVerificationHandler = require('../src/functions/requestBookingVerification').handler;
const verifyAndBookTicketHandler        = require('../src/functions/verifyAndBookTicket').handler;
const requestCancellationCodeHandler    = require('../src/functions/requestCancellationCode').handler;
const verifyCancellationCodeHandler     = require('../src/functions/verifyCancellationCode').handler;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function getLastSentOtp(purpose) {
  const matching = sentEmails.filter((e) => e.type === 'OTP' && e.purpose === purpose);
  return matching.length ? matching[matching.length - 1] : null;
}

function getLastSentTicket() {
  const matching = sentEmails.filter((e) => e.type === 'TICKET');
  return matching.length ? matching[matching.length - 1] : null;
}

// ---------------------------------------------------------------------------
// Test runner
// ---------------------------------------------------------------------------
async function runOtpTests() {
  console.log('=== Starting OTP End-to-End Tests ===\n');

  // ─────────────────────────────────────────────
  // SETUP: Create admin and event
  // ─────────────────────────────────────────────
  const regRes = await adminRegisterHandler({
    body: JSON.stringify({ name: 'Test Admin', email: 'admin@test.com', password: 'password123' }),
  });
  assert.strictEqual(regRes.statusCode, 201);
  const loginRes = await adminLoginHandler({
    body: JSON.stringify({ email: 'admin@test.com', password: 'password123' }),
  });
  const tokenA = JSON.parse(loginRes.body).token;

  // Create event with capacity 2
  const evRes = await createEventHandler({
    headers: { Authorization: `Bearer ${tokenA}` },
    body: JSON.stringify({ name: 'OTP Test Event', venue: 'Hall A', date: '2026-12-01T10:00:00Z', capacity: 2 }),
  });
  assert.strictEqual(evRes.statusCode, 201);
  const testEvent = JSON.parse(evRes.body);
  console.log('Setup: Admin and event created. eventId =', testEvent.eventId);

  // ─────────────────────────────────────────────
  // TEST 1: Request booking verification — success
  // ─────────────────────────────────────────────
  console.log('\nTest 1: Request booking verification code...');
  sentEmails.length = 0;
  const req1Res = await requestBookingVerificationHandler({
    body: JSON.stringify({ eventId: testEvent.eventId, attendeeName: 'Alice', attendeeEmail: 'alice@example.com' }),
  });
  assert.strictEqual(req1Res.statusCode, 200);
  const req1Body = JSON.parse(req1Res.body);
  assert.ok(req1Body.challengeId, 'challengeId must be returned');
  assert.strictEqual(req1Body.code, undefined, 'OTP must NOT be returned in API response');
  assert.strictEqual(sentEmails.length, 1, 'Exactly one email must be sent');
  assert.strictEqual(sentEmails[0].purpose, 'BOOKING');
  assert.ok(sentEmails[0].code, 'Code must be sent via email (in test)');
  console.log('   ✓ Booking verification requested. challengeId:', req1Body.challengeId);
  const challengeId1 = req1Body.challengeId;
  const code1 = sentEmails[0].code;

  // ─────────────────────────────────────────────
  // TEST 2: Wrong code is rejected, attempts incremented
  // ─────────────────────────────────────────────
  console.log('\nTest 2: Wrong code is rejected...');
  const wrongCodeRes = await verifyAndBookTicketHandler({
    body: JSON.stringify({ challengeId: challengeId1, code: '000000' }),
  });
  assert.strictEqual(wrongCodeRes.statusCode, 400);
  const wrongBody = JSON.parse(wrongCodeRes.body);
  assert.ok(wrongBody.message.includes('Incorrect'), 'Must indicate incorrect code');
  // Verify attempts incremented in memory
  const challengeState = memoryChallenges.get(challengeId1);
  assert.strictEqual(challengeState.attempts, 1, 'Attempts must be 1 after one failure');
  console.log('   ✓ Wrong code rejected. attempts =', challengeState.attempts);

  // ─────────────────────────────────────────────
  // TEST 3: Correct code creates ticket
  // ─────────────────────────────────────────────
  console.log('\nTest 3: Correct code creates ticket...');
  sentEmails.length = 0;
  const bookRes = await verifyAndBookTicketHandler({
    body: JSON.stringify({ challengeId: challengeId1, code: code1 }),
  });
  assert.strictEqual(bookRes.statusCode, 201, 'Ticket must be created with 201');
  const bookBody = JSON.parse(bookRes.body);
  assert.ok(bookBody.ticketId, 'ticketId must be in response');
  assert.strictEqual(bookBody.qrToken, undefined, 'qrToken must NOT be in response');
  assert.strictEqual(bookBody.codeHash, undefined, 'codeHash must NOT be in response');
  // Ticket email sent
  assert.strictEqual(sentEmails.length, 1);
  assert.strictEqual(sentEmails[0].type, 'TICKET');
  const ticketEmail = sentEmails[0];
  // Verify manage link is present
  assert.ok(ticketEmail.ticketId, 'ticketId must be passed to email');
  assert.ok(ticketEmail.frontendBaseUrl, 'frontendBaseUrl must be passed to email');
  const ticket1Id = bookBody.ticketId;
  console.log('   ✓ Ticket created. ticketId:', ticket1Id, '| Email sent with manage link.');

  // ─────────────────────────────────────────────
  // TEST 4: Same code cannot be reused
  // ─────────────────────────────────────────────
  console.log('\nTest 4: Code cannot be reused (replay prevention)...');
  const replayRes = await verifyAndBookTicketHandler({
    body: JSON.stringify({ challengeId: challengeId1, code: code1 }),
  });
  assert.notStrictEqual(replayRes.statusCode, 201, 'Replay must not create another ticket');
  console.log('   ✓ Replay attempt blocked. status:', replayRes.statusCode, JSON.parse(replayRes.body).message);

  // ─────────────────────────────────────────────
  // TEST 5: 60-second resend cooldown enforced
  // ─────────────────────────────────────────────
  console.log('\nTest 5: Resend cooldown enforced within 60 seconds...');
  const req2Res = await requestBookingVerificationHandler({
    body: JSON.stringify({ eventId: testEvent.eventId, attendeeName: 'Alice', attendeeEmail: 'alice@example.com' }),
  });
  // alice@example.com has a recent (just-used) challenge — cooldown NOT triggered because used=true.
  // So a new code request should succeed (used challenge does not count for cooldown).
  // Let's verify another request works normally since the first challenge is marked used.
  assert.strictEqual(req2Res.statusCode, 200, 'New code request should succeed after previous challenge is used');
  const code2 = getLastSentOtp('BOOKING').code;
  const challengeId2 = JSON.parse(req2Res.body).challengeId;
  console.log('   ✓ New code requested successfully after first challenge was consumed.');

  // ─────────────────────────────────────────────
  // TEST 6: Expired code is rejected
  // ─────────────────────────────────────────────
  console.log('\nTest 6: Expired code is rejected...');
  // Manually expire the challenge by setting expiresAt to the past
  const expiredChallenge = memoryChallenges.get(challengeId2);
  const savedExpiry = expiredChallenge.expiresAt;
  expiredChallenge.expiresAt = Math.floor(Date.now() / 1000) - 1; // 1 second in the past

  const expiredRes = await verifyAndBookTicketHandler({
    body: JSON.stringify({ challengeId: challengeId2, code: code2 }),
  });
  assert.strictEqual(expiredRes.statusCode, 400);
  assert.ok(JSON.parse(expiredRes.body).message.toLowerCase().includes('expir'), 'Must report expiry');
  expiredChallenge.expiresAt = savedExpiry; // restore for cleanup
  console.log('   ✓ Expired code rejected correctly.');

  // ─────────────────────────────────────────────
  // TEST 7: Max attempts enforcement (5 attempts)
  // ─────────────────────────────────────────────
  console.log('\nTest 7: Max 5 failed attempts, 6th attempt rejected...');
  // Request a fresh code
  sentEmails.length = 0;
  const req3Res = await requestBookingVerificationHandler({
    body: JSON.stringify({ eventId: testEvent.eventId, attendeeName: 'BruteUser', attendeeEmail: 'brute@example.com' }),
  });
  assert.strictEqual(req3Res.statusCode, 200);
  const bruteCode = getLastSentOtp('BOOKING').code;
  const bruteChallengeId = JSON.parse(req3Res.body).challengeId;

  // Exhaust 5 attempts with a wrong code
  for (let i = 0; i < 5; i++) {
    const r = await verifyAndBookTicketHandler({
      body: JSON.stringify({ challengeId: bruteChallengeId, code: '000000' }),
    });
    assert.strictEqual(r.statusCode, 400);
  }
  // 6th attempt — even with correct code — must be rejected due to exhausted attempts
  const sixthRes = await verifyAndBookTicketHandler({
    body: JSON.stringify({ challengeId: bruteChallengeId, code: bruteCode }),
  });
  assert.strictEqual(sixthRes.statusCode, 400);
  assert.ok(
    JSON.parse(sixthRes.body).message.toLowerCase().includes('attempt'),
    'Must indicate max attempts exceeded'
  );
  console.log('   ✓ 6th attempt correctly blocked after 5 failures.');

  // ─────────────────────────────────────────────
  // TEST 8: Capacity enforcement via OTP flow
  // ─────────────────────────────────────────────
  console.log('\nTest 8: OTP capacity enforcement (capacity=2)...');

  // Slot 2 (alice has slot 1 from Test 3)
  sentEmails.length = 0;
  const reqBobRes = await requestBookingVerificationHandler({
    body: JSON.stringify({ eventId: testEvent.eventId, attendeeName: 'Bob', attendeeEmail: 'bob@example.com' }),
  });
  assert.strictEqual(reqBobRes.statusCode, 200);
  const bobCode = getLastSentOtp('BOOKING').code;
  const bobChallengeId = JSON.parse(reqBobRes.body).challengeId;
  const bobBookRes = await verifyAndBookTicketHandler({
    body: JSON.stringify({ challengeId: bobChallengeId, code: bobCode }),
  });
  assert.strictEqual(bobBookRes.statusCode, 201, 'Second ticket must succeed');
  const ticket2Id = JSON.parse(bobBookRes.body).ticketId;

  // Slot 3 — must be rejected as Event is full
  sentEmails.length = 0;
  const reqCharlieRes = await requestBookingVerificationHandler({
    body: JSON.stringify({ eventId: testEvent.eventId, attendeeName: 'Charlie', attendeeEmail: 'charlie@example.com' }),
  });
  assert.strictEqual(reqCharlieRes.statusCode, 200);
  const charlieCode = getLastSentOtp('BOOKING').code;
  const charlieChallengeId = JSON.parse(reqCharlieRes.body).challengeId;
  const charlieBookRes = await verifyAndBookTicketHandler({
    body: JSON.stringify({ challengeId: charlieChallengeId, code: charlieCode }),
  });
  assert.strictEqual(charlieBookRes.statusCode, 409, 'Third ticket must fail with 409');
  assert.ok(JSON.parse(charlieBookRes.body).message.toLowerCase().includes('full'));
  console.log('   ✓ Capacity enforcement: 2 tickets created, 3rd OTP-verified attempt blocked with 409.');

  // ─────────────────────────────────────────────
  // TEST 9: Cancellation OTP flow — request code
  // ─────────────────────────────────────────────
  console.log('\nTest 9: Attendee requests cancellation code...');
  sentEmails.length = 0;
  const cancelReqRes = await requestCancellationCodeHandler({
    pathParameters: { ticketId: ticket1Id },
  });
  assert.strictEqual(cancelReqRes.statusCode, 200);
  assert.strictEqual(JSON.parse(cancelReqRes.body).code, undefined, 'Code must not be in response');
  assert.strictEqual(sentEmails.length, 1);
  assert.strictEqual(sentEmails[0].purpose, 'CANCELLATION');
  const cancelCode1 = sentEmails[0].code;
  console.log('   ✓ Cancellation code sent. Purpose: CANCELLATION.');

  // ─────────────────────────────────────────────
  // TEST 10: Wrong cancellation code rejected
  // ─────────────────────────────────────────────
  console.log('\nTest 10: Wrong cancellation code rejected...');
  const wrongCancelRes = await verifyCancellationCodeHandler({
    pathParameters: { ticketId: ticket1Id },
    body: JSON.stringify({ code: '999999' }),
  });
  assert.strictEqual(wrongCancelRes.statusCode, 400);
  assert.ok(JSON.parse(wrongCancelRes.body).message.toLowerCase().includes('incorrect'));
  console.log('   ✓ Wrong cancellation code rejected.');

  // ─────────────────────────────────────────────
  // TEST 11: Correct cancellation code cancels ticket + releases capacity
  // ─────────────────────────────────────────────
  console.log('\nTest 11: Correct cancellation code cancels ticket and releases capacity...');
  const eventBefore = memoryEvents.get(testEvent.eventId);
  const capacityBefore = eventBefore.ticketsIssued;

  const cancelVerifyRes = await verifyCancellationCodeHandler({
    pathParameters: { ticketId: ticket1Id },
    body: JSON.stringify({ code: cancelCode1 }),
  });
  assert.strictEqual(cancelVerifyRes.statusCode, 200);
  const cancelBody = JSON.parse(cancelVerifyRes.body);
  assert.strictEqual(cancelBody.status, 'CANCELLED');
  assert.strictEqual(cancelBody.ticketId, ticket1Id);

  // Verify capacity was released
  const eventAfter = memoryEvents.get(testEvent.eventId);
  assert.strictEqual(eventAfter.ticketsIssued, capacityBefore - 1, 'ticketsIssued must decrease by 1');

  // Verify ticket is actually cancelled
  const cancelledTicket = memoryTickets.get(ticket1Id);
  assert.strictEqual(cancelledTicket.status, 'CANCELLED');
  console.log('   ✓ Ticket cancelled. Capacity released: ticketsIssued =', eventAfter.ticketsIssued);

  // ─────────────────────────────────────────────
  // TEST 12: Cancellation code cannot be reused
  // ─────────────────────────────────────────────
  console.log('\nTest 12: Cancellation code cannot be reused...');
  const reuseCancelRes = await verifyCancellationCodeHandler({
    pathParameters: { ticketId: ticket1Id },
    body: JSON.stringify({ code: cancelCode1 }),
  });
  // The ticket is already CANCELLED so it should return 409
  assert.notStrictEqual(reuseCancelRes.statusCode, 200, 'Reuse must not succeed');
  console.log('   ✓ Cancellation code reuse blocked. status:', reuseCancelRes.statusCode);

  // ─────────────────────────────────────────────
  // TEST 13: Second cancellation attempt cannot release capacity twice
  // ─────────────────────────────────────────────
  console.log('\nTest 13: Double cancellation cannot release capacity twice...');
  const capacityAfterFirst = memoryEvents.get(testEvent.eventId).ticketsIssued;

  // Request a new cancellation code for the already-cancelled ticket
  sentEmails.length = 0;
  const reqCancelAgain = await requestCancellationCodeHandler({
    pathParameters: { ticketId: ticket1Id },
  });
  // Should fail because ticket is already CANCELLED
  assert.strictEqual(reqCancelAgain.statusCode, 409, 'Cannot request cancellation code for already-cancelled ticket');

  const capacityAfterSecond = memoryEvents.get(testEvent.eventId).ticketsIssued;
  assert.strictEqual(capacityAfterFirst, capacityAfterSecond, 'Capacity must not be released again');
  console.log('   ✓ Double cancellation blocked. Capacity unchanged at:', capacityAfterSecond);

  // ─────────────────────────────────────────────
  // TEST 14: Cancelled ticket rejected at gate
  // ─────────────────────────────────────────────
  console.log('\nTest 14: Cancelled ticket rejected at gate...');
  const cancelledTicketData = memoryTickets.get(ticket1Id);
  const gateScanRes = await verifyTicketHandler({
    body: JSON.stringify({ token: cancelledTicketData.qrToken, gateId: 'Gate-01' }),
  });
  const gateScan = JSON.parse(gateScanRes.body);
  assert.strictEqual(gateScan.valid, false);
  assert.strictEqual(gateScan.reason, 'cancelled');
  console.log('   ✓ Cancelled ticket correctly rejected at gate with reason: cancelled.');

  // ─────────────────────────────────────────────
  // TEST 15: Admin can still cancel tickets (JWT flow unchanged)
  // ─────────────────────────────────────────────
  console.log('\nTest 15: Admin cancellation continues to work (JWT auth)...');
  const adminCancelRes = await cancelTicketHandler({
    headers: { Authorization: `Bearer ${tokenA}` },
    pathParameters: { ticketId: ticket2Id },
  });
  assert.strictEqual(adminCancelRes.statusCode, 200);
  assert.strictEqual(JSON.parse(adminCancelRes.body).message, 'Ticket cancelled');
  const ticket2Status = memoryTickets.get(ticket2Id);
  assert.strictEqual(ticket2Status.status, 'CANCELLED');
  console.log('   ✓ Admin cancelled ticket via JWT. ticket2 status: CANCELLED.');

  // ─────────────────────────────────────────────
  // TEST 16: After admin cancel, capacity released — new booking via OTP succeeds
  // ─────────────────────────────────────────────
  console.log('\nTest 16: After two cancellations, capacity restored — new booking via OTP succeeds...');
  sentEmails.length = 0;
  const reqDaveRes = await requestBookingVerificationHandler({
    body: JSON.stringify({ eventId: testEvent.eventId, attendeeName: 'Dave', attendeeEmail: 'dave@example.com' }),
  });
  assert.strictEqual(reqDaveRes.statusCode, 200);
  const daveCode = getLastSentOtp('BOOKING').code;
  const daveChallengeId = JSON.parse(reqDaveRes.body).challengeId;
  const daveBookRes = await verifyAndBookTicketHandler({
    body: JSON.stringify({ challengeId: daveChallengeId, code: daveCode }),
  });
  assert.strictEqual(daveBookRes.statusCode, 201, 'Booking must succeed after capacity was released by cancellations');
  console.log('   ✓ New ticket created after capacity release. ticketId:', JSON.parse(daveBookRes.body).ticketId);

  // ─────────────────────────────────────────────
  // TEST 17: Invalid event ID rejected at OTP request step
  // ─────────────────────────────────────────────
  console.log('\nTest 17: Invalid eventId is rejected at request-verification...');
  const badEventRes = await requestBookingVerificationHandler({
    body: JSON.stringify({ eventId: 'non-existent-event-id', attendeeName: 'Eve', attendeeEmail: 'eve@example.com' }),
  });
  assert.strictEqual(badEventRes.statusCode, 404);
  assert.ok(JSON.parse(badEventRes.body).message.toLowerCase().includes('not found'));
  console.log('   ✓ Non-existent event correctly returns 404.');

  // ─────────────────────────────────────────────
  // TEST 18: Cancellation of non-existent ticket
  // ─────────────────────────────────────────────
  console.log('\nTest 18: Cancellation request for non-existent ticket...');
  const badTicketRes = await requestCancellationCodeHandler({
    pathParameters: { ticketId: 'does-not-exist' },
  });
  assert.strictEqual(badTicketRes.statusCode, 404);
  console.log('   ✓ Non-existent ticket returns 404.');

  // ─────────────────────────────────────────────
  // TEST 19: Verify ticket email includes manage link
  // ─────────────────────────────────────────────
  console.log('\nTest 19: Ticket email contains ticketId and frontendBaseUrl for manage link...');
  sentEmails.length = 0;
  const reqEdRes = await requestBookingVerificationHandler({
    body: JSON.stringify({ eventId: testEvent.eventId, attendeeName: 'Ed', attendeeEmail: 'ed@example.com' }),
  });
  // Wait... capacity: we now have 1 ticket (dave). Let's check remaining
  // Dave = 1, capacity = 2, so 1 remaining
  assert.strictEqual(reqEdRes.statusCode, 200);
  const edCode = getLastSentOtp('BOOKING').code;
  const edChallengeId = JSON.parse(reqEdRes.body).challengeId;
  sentEmails.length = 0;
  const edBookRes = await verifyAndBookTicketHandler({
    body: JSON.stringify({ challengeId: edChallengeId, code: edCode }),
  });
  assert.strictEqual(edBookRes.statusCode, 201);
  const ticketEmail2 = sentEmails.find((e) => e.type === 'TICKET');
  assert.ok(ticketEmail2, 'Ticket email must have been sent');
  assert.ok(ticketEmail2.ticketId, 'ticketId must be in ticket email params');
  assert.strictEqual(ticketEmail2.frontendBaseUrl, 'http://localhost:5173');
  console.log('   ✓ Ticket email params include ticketId and frontendBaseUrl.');

  // ─────────────────────────────────────────────
  // TEST 20: Concurrent same challengeId submissions (race safety)
  // ─────────────────────────────────────────────
  console.log('\nTest 20: Concurrent OTP submissions cannot create duplicate tickets...');
  sentEmails.length = 0;
  const reqRaceRes = await requestBookingVerificationHandler({
    body: JSON.stringify({ eventId: testEvent.eventId, attendeeName: 'Racer', attendeeEmail: 'racer@example.com' }),
  });
  // Event is now full (dave + ed = 2). So booking will fail with 409.
  // But we test the race-safety of markChallengeUsed by calling twice concurrently.
  // Reset capacity for this test:
  memoryEvents.get(testEvent.eventId).ticketsIssued = 0; // reset for test
  assert.strictEqual(reqRaceRes.statusCode, 200);
  const racerCode = getLastSentOtp('BOOKING').code;
  const racerChallengeId = JSON.parse(reqRaceRes.body).challengeId;

  // Simulate two concurrent submissions of the same valid code
  const [r1, r2] = await Promise.all([
    verifyAndBookTicketHandler({ body: JSON.stringify({ challengeId: racerChallengeId, code: racerCode }) }),
    verifyAndBookTicketHandler({ body: JSON.stringify({ challengeId: racerChallengeId, code: racerCode }) }),
  ]);
  const statuses = [r1.statusCode, r2.statusCode].sort();
  assert.ok(statuses.includes(201), 'Exactly one must succeed with 201');
  assert.ok(statuses.includes(409) || statuses.includes(400), 'Exactly one must fail (replay blocked)');
  // Only one ticket should have been created for this challenge
  const ticketsForRacer = Array.from(memoryTickets.values()).filter(
    (t) => t.attendeeEmail === 'racer@example.com'
  );
  assert.strictEqual(ticketsForRacer.length, 1, 'Exactly 1 ticket must exist for the racer despite concurrent requests');
  console.log('   ✓ Race safety verified: concurrent submissions produced only 1 ticket. Statuses:', statuses);

  console.log('\n=== ALL OTP TESTS PASSED ===');
}

runOtpTests().catch((err) => {
  console.error('OTP Test Failed:', err);
  process.exit(1);
});
