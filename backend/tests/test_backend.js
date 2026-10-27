const assert = require('assert');
const { hashPassword, comparePassword, signAdminToken, authenticateAdmin } = require('../src/lib/auth');
const { signTicketToken, verifyTicketToken } = require('../src/lib/jwt');
const { ok, parseBody } = require('../src/lib/http');

const TEST_SECRET = 'super-secret-jwt-signing-key-for-tests-123456789012345678901234567890';

async function runTests() {
  console.log('=== Starting Backend Test Suite ===\n');

  // Test 1: Password Hashing & Verification
  console.log('1. Testing Password Hashing & Bcrypt...');
  const plainPassword = 'SuperSecurePassword123!';
  const hash = await hashPassword(plainPassword);
  assert.notStrictEqual(plainPassword, hash, 'Password must not match hash plaintext');
  assert.strictEqual(hash.startsWith('$2'), true, 'Must be a valid bcrypt hash');
  
  const isValid = await comparePassword(plainPassword, hash);
  assert.strictEqual(isValid, true, 'Valid password must verify');
  const isInvalid = await comparePassword('WrongPassword', hash);
  assert.strictEqual(isInvalid, false, 'Invalid password must not verify');
  console.log('   ✓ Password hashing & comparison passed.');

  // Test 2: Admin JWT Signing & Extraction
  console.log('\n2. Testing Admin JWT Token Signing & Auth Guard...');
  const mockAdmin = {
    adminId: 'admin-uuid-1',
    email: 'admin1@example.com',
    name: 'Admin One',
    role: 'ADMIN',
  };
  const adminToken = signAdminToken(mockAdmin, TEST_SECRET, '1h');
  assert.strictEqual(typeof adminToken, 'string');

  const authResult = await authenticateAdmin(
    { headers: { Authorization: `Bearer ${adminToken}` } },
    TEST_SECRET
  );
  assert.strictEqual(authResult.adminId, 'admin-uuid-1');
  assert.strictEqual(authResult.email, 'admin1@example.com');
  assert.strictEqual(authResult.role, 'ADMIN');

  // Test missing auth header
  await assert.rejects(
    async () => authenticateAdmin({ headers: {} }, TEST_SECRET),
    { statusCode: 401 }
  );

  // Test invalid token
  await assert.rejects(
    async () => authenticateAdmin({ headers: { Authorization: 'Bearer invalid.token' } }, TEST_SECRET),
    { statusCode: 401 }
  );
  console.log('   ✓ Admin JWT authentication passed.');

  // Test 3: Ticket JWT Signing & Verification
  console.log('\n3. Testing Ticket JWT Generation & Single-Use Payload...');
  const ticketPayload = { ticketId: 'ticket-100', eventId: 'event-50' };
  const expiresAt = Date.now() + 60000;
  const ticketToken = signTicketToken(ticketPayload, TEST_SECRET, expiresAt);
  const decodedTicket = verifyTicketToken(ticketToken, TEST_SECRET);
  assert.strictEqual(decodedTicket.ticketId, 'ticket-100');
  assert.strictEqual(decodedTicket.eventId, 'event-50');
  console.log('   ✓ Ticket JWT generation & verification passed.');

  // Test 4: HTTP and Body Parsing
  console.log('\n4. Testing HTTP Helper & CORS Headers...');
  const response = ok(200, { success: true });
  assert.strictEqual(response.statusCode, 200);
  assert.strictEqual(response.headers['Access-Control-Allow-Origin'], '*');
  assert.strictEqual(response.headers['Content-Type'], 'application/json');
  assert.strictEqual(JSON.parse(response.body).success, true);

  const parsed = parseBody({ body: JSON.stringify({ name: 'Tech Fest' }) });
  assert.strictEqual(parsed.name, 'Tech Fest');
  console.log('   ✓ HTTP and CORS helpers passed.');

  console.log('\n=== All Tests Passed Successfully! ===');
}

runTests().catch((err) => {
  console.error('Test Suite Failed:', err);
  process.exit(1);
});
