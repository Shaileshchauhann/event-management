const assert = require('assert');

// In-memory mock database
const memoryAdmins = new Map();
const memoryEvents = new Map();
const memoryTickets = new Map();
const JWT_TEST_SECRET = 'mock-secret-64-byte-long-character-string-for-jwt-signing-and-auth';

// Setup environment variables for test
process.env.ADMINS_TABLE = 'TestAdmins';
process.env.EVENTS_TABLE = 'TestEvents';
process.env.TICKETS_TABLE = 'TestTickets';
process.env.JWT_SECRET_ARN = 'arn:aws:secretsmanager:ap-south-1:123456789012:secret:TestJwtSecret';
process.env.SENDER_EMAIL = 'test@example.com';
process.env.ADMIN_REGISTRATION_SECRET = 'super-secure-admin-bootstrap-secret';

// Mock lib/secrets
const secretsLib = require('../src/lib/secrets');
secretsLib.getJwtSecret = async () => JWT_TEST_SECRET;

// Mock lib/email
const emailLib = require('../src/lib/email');
emailLib.sendTicketEmail = async () => true;

// Mock lib/db
const dbLib = require('../src/lib/db');

dbLib.putAdmin = async (admin) => {
  memoryAdmins.set(admin.adminId, { ...admin });
  return admin;
};
dbLib.getAdminById = async (adminId) => memoryAdmins.get(adminId) || null;
dbLib.getAdminByEmail = async (email) => {
  const normalized = (email || '').trim().toLowerCase();
  for (const admin of memoryAdmins.values()) {
    if (admin.email === normalized) return { ...admin };
  }
  return null;
};
dbLib.countAdmins = async () => memoryAdmins.size;

dbLib.putEvent = async (event) => {
  memoryEvents.set(event.eventId, { ...event });
  return event;
};
dbLib.getEvent = async (eventId) => {
  const ev = memoryEvents.get(eventId);
  return ev ? { ...ev } : null;
};
dbLib.listEventsByAdmin = async (adminId) => {
  return Array.from(memoryEvents.values()).filter((e) => e.adminId === adminId);
};
dbLib.listPublicEvents = async () => {
  return Array.from(memoryEvents.values())
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
    }));
};
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
  if (ev && (ev.ticketsIssued || 0) > 0) {
    ev.ticketsIssued -= 1;
  }
};

dbLib.putTicket = async (ticket) => {
  memoryTickets.set(ticket.ticketId, { ...ticket });
  return ticket;
};
dbLib.getTicket = async (ticketId) => {
  const t = memoryTickets.get(ticketId);
  return t ? { ...t } : null;
};
dbLib.listTicketsByEvent = async (eventId) => {
  return Array.from(memoryTickets.values()).filter((t) => t.eventId === eventId);
};
dbLib.markTicketSent = async (ticketId) => {
  const t = memoryTickets.get(ticketId);
  if (t) t.status = 'SENT';
};
dbLib.checkInTicket = async (ticketId, gateId) => {
  const t = memoryTickets.get(ticketId);
  if (!t || !['ISSUED', 'SENT'].includes(t.status)) {
    const err = new Error('Conditional check failed');
    err.name = 'ConditionalCheckFailedException';
    throw err;
  }
  t.status = 'CHECKED_IN';
  t.checkedInAt = new Date().toISOString();
  t.checkedInBy = gateId || 'unknown';
  return t.checkedInAt;
};
dbLib.cancelTicket = async (ticketId) => {
  const t = memoryTickets.get(ticketId);
  if (!t || t.status === 'CHECKED_IN') {
    const err = new Error('Conditional check failed');
    err.name = 'ConditionalCheckFailedException';
    throw err;
  }
  t.status = 'CANCELLED';
};

// Require handlers after mocking
const adminRegisterHandler = require('../src/functions/adminRegister').handler;
const adminLoginHandler = require('../src/functions/adminLogin').handler;
const createEventHandler = require('../src/functions/createEvent').handler;
const listAdminEventsHandler = require('../src/functions/listAdminEvents').handler;
const getAdminEventHandler = require('../src/functions/getAdminEvent').handler;
const listPublicEventsHandler = require('../src/functions/listPublicEvents').handler;
const getEventHandler = require('../src/functions/getEvent').handler;
const issueTicketHandler = require('../src/functions/issueTicket').handler;
const listEventTicketsHandler = require('../src/functions/listEventTickets').handler;
const getEventStatsHandler = require('../src/functions/getEventStats').handler;
const cancelTicketHandler = require('../src/functions/cancelTicket').handler;
const resendTicketHandler = require('../src/functions/resendTicket').handler;
const verifyTicketHandler = require('../src/functions/verifyTicket').handler;
const getTicketHandler = require('../src/functions/getTicket').handler;
const fs = require('fs');


async function runE2ETest() {
  console.log('=== Starting End-to-End Handlers Test ===\n');

  // 1. Bootstrap Admin A (first admin)
  console.log('Step 1: Register initial Admin A (Bootstrap)...');
  const regARes = await adminRegisterHandler({
    body: JSON.stringify({
      name: 'Alice Admin',
      email: 'alice@eventhub.com',
      password: 'passwordAlice123',
    }),
  });
  assert.strictEqual(regARes.statusCode, 201);
  const regABody = JSON.parse(regARes.body);
  const adminAId = regABody.admin.adminId;
  console.log('   ✓ Admin A registered with ID:', adminAId);

  // 2. Login Admin A
  console.log('\nStep 2: Login Admin A...');
  const loginARes = await adminLoginHandler({
    body: JSON.stringify({
      email: 'alice@eventhub.com',
      password: 'passwordAlice123',
    }),
  });
  assert.strictEqual(loginARes.statusCode, 200);
  const tokenA = JSON.parse(loginARes.body).token;
  console.log('   ✓ Admin A logged in successfully. Token generated.');

  // 3. Admin A creates Event A (Capacity: 2)
  console.log('\nStep 3: Admin A creates Event A (Capacity: 2)...');
  const createEventARes = await createEventHandler({
    headers: { Authorization: `Bearer ${tokenA}` },
    body: JSON.stringify({
      name: 'Alice Annual Gala',
      venue: 'Grand Ballroom',
      date: '2026-11-20T19:00:00Z',
      capacity: 2,
    }),
  });
  assert.strictEqual(createEventARes.statusCode, 201);
  const eventA = JSON.parse(createEventARes.body);
  assert.strictEqual(eventA.adminId, adminAId, 'Event A must belong to Admin A');
  console.log('   ✓ Event A created with ID:', eventA.eventId);

  // 4. Register Admin B (using registration secret)
  console.log('\nStep 4: Register Admin B (Protected by secret)...');
  const regBRes = await adminRegisterHandler({
    headers: { 'x-admin-secret': 'super-secure-admin-bootstrap-secret' },
    body: JSON.stringify({
      name: 'Bob Admin',
      email: 'bob@eventhub.com',
      password: 'passwordBob123',
    }),
  });
  assert.strictEqual(regBRes.statusCode, 201);
  const adminBId = JSON.parse(regBRes.body).admin.adminId;

  const loginBRes = await adminLoginHandler({
    body: JSON.stringify({
      email: 'bob@eventhub.com',
      password: 'passwordBob123',
    }),
  });
  const tokenB = JSON.parse(loginBRes.body).token;
  console.log('   ✓ Admin B registered & logged in with ID:', adminBId);

  // 5. Admin B creates Event B
  console.log('\nStep 5: Admin B creates Event B...');
  const createEventBRes = await createEventHandler({
    headers: { Authorization: `Bearer ${tokenB}` },
    body: JSON.stringify({
      name: 'Bob Dev Summit',
      venue: 'Tech Park',
      date: '2026-12-10T10:00:00Z',
      capacity: 50,
    }),
  });
  assert.strictEqual(createEventBRes.statusCode, 201);
  const eventB = JSON.parse(createEventBRes.body);
  console.log('   ✓ Event B created with ID:', eventB.eventId);

  // Issue a ticket for Event B (owned by Admin B)
  const ticketBRes = await issueTicketHandler({
    pathParameters: { eventId: eventB.eventId },
    body: JSON.stringify({
      attendeeName: 'Bob Attendee',
      attendeeEmail: 'bobattendee@example.com',
    }),
  });
  assert.strictEqual(ticketBRes.statusCode, 201);
  const ticketB = JSON.parse(ticketBRes.body);

  // 6. Test Unauthenticated Attendee Denial on Admin APIs
  console.log('\nStep 6: Testing Unauthenticated Attendee Denial on Admin APIs...');
  const noAuthCreate = await createEventHandler({ headers: {}, body: JSON.stringify({ name: 'Hack Event' }) });
  assert.strictEqual(noAuthCreate.statusCode, 401, 'Unauthenticated event creation must be rejected with 401');

  const noAuthList = await listAdminEventsHandler({ headers: {} });
  assert.strictEqual(noAuthList.statusCode, 401, 'Unauthenticated admin event listing must be rejected with 401');

  const noAuthStats = await getEventStatsHandler({ headers: {}, pathParameters: { eventId: eventA.eventId } });
  assert.strictEqual(noAuthStats.statusCode, 401, 'Unauthenticated stats check must be rejected with 401');

  const noAuthGetTicket = await getTicketHandler({ path: `/admin/tickets/${ticketB.ticketId}`, headers: {}, pathParameters: { ticketId: ticketB.ticketId } });
  assert.strictEqual(noAuthGetTicket.statusCode, 401, 'Unauthenticated getTicket must be rejected with 401');
  console.log('   ✓ All admin endpoints reject unauthenticated calls with 401 Unauthorized.');

  // 7. Test Cross-Admin Event Authorization Isolation
  console.log('\nStep 7: Testing Admin Ownership Authorization Isolation...');
  // Admin B tries to get Event A
  const bGetsARes = await getAdminEventHandler({
    headers: { Authorization: `Bearer ${tokenB}` },
    pathParameters: { eventId: eventA.eventId },
  });
  assert.strictEqual(bGetsARes.statusCode, 403, 'Admin B must be 403 Forbidden on Event A');

  // Admin A tries to get Event B
  const aGetsBRes = await getAdminEventHandler({
    headers: { Authorization: `Bearer ${tokenA}` },
    pathParameters: { eventId: eventB.eventId },
  });
  assert.strictEqual(aGetsBRes.statusCode, 403, 'Admin A must be 403 Forbidden on Event B');
  console.log('   ✓ Cross-admin event access correctly blocked with 403 Forbidden.');

  // 8. Test Protected GET /tickets/{ticketId} and Cross-Admin Ticket Access
  console.log('\nStep 8: Testing Protected GET /tickets/{ticketId} and Cross-Admin Ticket Access...');
  // Admin A tries to get Admin B's ticket
  const aGetsTicketB = await getTicketHandler({
    path: `/admin/tickets/${ticketB.ticketId}`,
    headers: { Authorization: `Bearer ${tokenA}` },
    pathParameters: { ticketId: ticketB.ticketId },
  });
  assert.strictEqual(aGetsTicketB.statusCode, 403, 'Admin A must NOT be able to retrieve Admin B ticket (403)');

  // Admin B retrieves Admin B's ticket successfully
  const bGetsTicketB = await getTicketHandler({
    path: `/admin/tickets/${ticketB.ticketId}`,
    headers: { Authorization: `Bearer ${tokenB}` },
    pathParameters: { ticketId: ticketB.ticketId },
  });
  assert.strictEqual(bGetsTicketB.statusCode, 200, 'Admin B can retrieve own ticket');
  const ticketBData = JSON.parse(bGetsTicketB.body);
  assert.strictEqual(ticketBData.attendeeName, 'Bob Attendee');
  assert.strictEqual(ticketBData.qrToken, undefined, 'qrToken must be stripped and not exposed');

  // Admin A tries to resend Admin B's ticket
  const aResendsTicketB = await resendTicketHandler({
    headers: { Authorization: `Bearer ${tokenA}` },
    pathParameters: { ticketId: ticketB.ticketId },
  });
  assert.strictEqual(aResendsTicketB.statusCode, 403, 'Admin A must NOT be able to resend Admin B ticket (403)');

  // Admin A tries to cancel Admin B's ticket
  const aCancelsTicketB = await cancelTicketHandler({
    headers: { Authorization: `Bearer ${tokenA}` },
    pathParameters: { ticketId: ticketB.ticketId },
  });
  assert.strictEqual(aCancelsTicketB.statusCode, 403, 'Admin A must NOT be able to cancel Admin B ticket (403)');
  console.log('   ✓ GET /tickets/{id}, /resend, and /cancel strictly enforce admin ownership.');

  // 9. Public Browsing of Events
  console.log('\nStep 9: Public attendee browsing...');
  const publicEventsRes = await listPublicEventsHandler();
  assert.strictEqual(publicEventsRes.statusCode, 200);
  const publicList = JSON.parse(publicEventsRes.body);
  assert.strictEqual(publicList.length, 2);
  assert.strictEqual(publicList[0].adminId, undefined, 'Public events must not expose adminId');
  console.log('   ✓ Public events returned safely without sensitive internal attributes.');

  // 10. Public Attendee Ticket Registrations & Capacity Limits
  console.log('\nStep 10: Attendee Registrations & Capacity Limit Testing...');
  // Registration 1 for Event A
  const t1Res = await issueTicketHandler({
    pathParameters: { eventId: eventA.eventId },
    body: JSON.stringify({
      attendeeName: 'John Doe',
      attendeeEmail: 'john@example.com',
    }),
  });
  assert.strictEqual(t1Res.statusCode, 201);
  const t1 = JSON.parse(t1Res.body);
  assert.strictEqual(t1.qrToken, undefined, 'JWT must not be returned in API response');

  // Registration 2 for Event A (Hits capacity of 2)
  const t2Res = await issueTicketHandler({
    pathParameters: { eventId: eventA.eventId },
    body: JSON.stringify({
      attendeeName: 'Jane Smith',
      attendeeEmail: 'jane@example.com',
    }),
  });
  assert.strictEqual(t2Res.statusCode, 201);
  const t2 = JSON.parse(t2Res.body);

  // Registration 3 for Event A (Should fail with 409 Event is full)
  const t3Res = await issueTicketHandler({
    pathParameters: { eventId: eventA.eventId },
    body: JSON.stringify({
      attendeeName: 'Overbooked Guest',
      attendeeEmail: 'over@example.com',
    }),
  });
  assert.strictEqual(t3Res.statusCode, 409, 'Must return 409 when capacity is full');
  assert.strictEqual(JSON.parse(t3Res.body).message, 'Event is full');
  console.log('   ✓ Capacity enforcement passed: exactly 2 tickets allowed, 3rd blocked with 409.');

  // 11. Admin Ticket Management & Stats
  console.log('\nStep 11: Admin Event Stats & Ticket Listing...');
  const statsRes = await getEventStatsHandler({
    headers: { Authorization: `Bearer ${tokenA}` },
    pathParameters: { eventId: eventA.eventId },
  });
  assert.strictEqual(statsRes.statusCode, 200);
  const stats = JSON.parse(statsRes.body);
  assert.strictEqual(stats.totalTickets, 2);
  assert.strictEqual(stats.remainingCapacity, 0);

  // Admin B tries to access tickets for Event A
  const bListTicketsRes = await listEventTicketsHandler({
    headers: { Authorization: `Bearer ${tokenB}` },
    pathParameters: { eventId: eventA.eventId },
  });
  assert.strictEqual(bListTicketsRes.statusCode, 403, 'Admin B cannot view tickets for Event A');
  console.log('   ✓ Admin stats verified & unauthorized ticket listing blocked.');

  // 12. Gate Verification Pipeline (QR / JWT Validation & Single-Use Check-in)
  console.log('\nStep 12: Gate Verification Pipeline...');
  const rawTicket1 = memoryTickets.get(t1.ticketId);
  const validJwt = rawTicket1.qrToken;

  // First Scan: should succeed
  const scan1Res = await verifyTicketHandler({
    body: JSON.stringify({ token: validJwt, gateId: 'Gate-North' }),
  });
  assert.strictEqual(scan1Res.statusCode, 200);
  const scan1 = JSON.parse(scan1Res.body);
  assert.strictEqual(scan1.valid, true);
  assert.strictEqual(scan1.ticketId, t1.ticketId);

  // Second Scan: should return already_used
  const scan2Res = await verifyTicketHandler({
    body: JSON.stringify({ token: validJwt, gateId: 'Gate-South' }),
  });
  assert.strictEqual(scan2Res.statusCode, 200);
  const scan2 = JSON.parse(scan2Res.body);
  assert.strictEqual(scan2.valid, false);
  assert.strictEqual(scan2.reason, 'already_used');
  assert.strictEqual(scan2.checkedInBy, 'Gate-North');
  console.log('   ✓ Gate check-in passed: 1st scan valid, 2nd scan rejected as already_used.');

  // 13. Ticket Cancellation & Capacity Release
  console.log('\nStep 13: Ticket Cancellation & Capacity Release...');
  // Admin A cancels Ticket 2
  const cancelRes = await cancelTicketHandler({
    headers: { Authorization: `Bearer ${tokenA}` },
    pathParameters: { ticketId: t2.ticketId },
  });
  assert.strictEqual(cancelRes.statusCode, 200);

  // Verifying cancelled ticket at gate
  const rawTicket2 = memoryTickets.get(t2.ticketId);
  const scanCancelledRes = await verifyTicketHandler({
    body: JSON.stringify({ token: rawTicket2.qrToken, gateId: 'Gate-North' }),
  });
  const scanCancelled = JSON.parse(scanCancelledRes.body);
  assert.strictEqual(scanCancelled.valid, false);
  assert.strictEqual(scanCancelled.reason, 'cancelled');

  // Since ticket 2 was cancelled, capacity was released, so now 3rd attendee can register!
  const retryT3Res = await issueTicketHandler({
    pathParameters: { eventId: eventA.eventId },
    body: JSON.stringify({
      attendeeName: 'Now Admitted Guest',
      attendeeEmail: 'admitted@example.com',
    }),
  });
  assert.strictEqual(retryT3Res.statusCode, 201);
  console.log('   ✓ Ticket cancellation and dynamic capacity release verified.');

  // 14. Invalid / Corrupted Token Gate Scan
  console.log('\nStep 14: Invalid / Corrupt Gate Tokens...');
  const invalidScanRes = await verifyTicketHandler({
    body: JSON.stringify({ token: 'fake.tampered.jwt.signature', gateId: 'Gate-01' }),
  });
  const invalidScan = JSON.parse(invalidScanRes.body);
  assert.strictEqual(invalidScan.valid, false);
  assert.strictEqual(invalidScan.reason, 'invalid_token');
  console.log('   ✓ Invalid token rejected with reason: invalid_token.');

  // 15. Verify SAM Template Configuration for Gate Auth & Routes
  console.log('\nStep 15: Validating SAM template.yaml security definitions...');
  const templateYamlContent = fs.readFileSync('template.yaml', 'utf8');
  assert.strictEqual(templateYamlContent.includes('ApiKeyRequired: false'), true, 'TicketApi must have global ApiKeyRequired: false');
  assert.strictEqual(templateYamlContent.includes('Path: /verify\n            Method: post\n            Auth:\n              ApiKeyRequired: true') ||
    templateYamlContent.includes('Path: /verify\r\n            Method: post\r\n            Auth:\r\n              ApiKeyRequired: true'), true,
    '/verify must explicitly enforce route-level ApiKeyRequired: true');
  assert.strictEqual(templateYamlContent.includes('GateApiKey:'), true, 'GateApiKey must be defined');
  assert.strictEqual(templateYamlContent.includes('AdminApiKey:'), true, 'AdminApiKey must be defined');
  console.log('   ✓ SAM template enforces route-level ApiKeyRequired: true specifically on /verify.');

  console.log('\n=== ALL END-TO-END TESTS PASSED PERFECTLY! ===');
}

runE2ETest().catch((err) => {
  console.error('E2E Test Failed:', err);
  process.exit(1);
});

