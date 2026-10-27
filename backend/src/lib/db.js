const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const {
  DynamoDBDocumentClient,
  PutCommand,
  GetCommand,
  UpdateCommand,
  QueryCommand,
  ScanCommand,
} = require('@aws-sdk/lib-dynamodb');

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));

const ADMINS_TABLE = process.env.ADMINS_TABLE;
const EVENTS_TABLE = process.env.EVENTS_TABLE;
const TICKETS_TABLE = process.env.TICKETS_TABLE;
const VERIFICATION_CODES_TABLE = process.env.VERIFICATION_CODES_TABLE;
const PAYMENTS_TABLE = process.env.PAYMENTS_TABLE || 'PaymentsTable';

// --- Admin Operations ---

async function putAdmin(admin) {
  await ddb.send(new PutCommand({ TableName: ADMINS_TABLE, Item: admin }));
  return admin;
}

async function getAdminById(adminId) {
  const { Item } = await ddb.send(new GetCommand({ TableName: ADMINS_TABLE, Key: { adminId } }));
  return Item;
}

async function getAdminByEmail(email) {
  const normalizedEmail = (email || '').trim().toLowerCase();
  const { Items } = await ddb.send(
    new QueryCommand({
      TableName: ADMINS_TABLE,
      IndexName: 'EmailIndex',
      KeyConditionExpression: 'email = :email',
      ExpressionAttributeValues: { ':email': normalizedEmail },
    })
  );
  return Items && Items.length > 0 ? Items[0] : null;
}

async function countAdmins() {
  const response = await ddb.send(
    new ScanCommand({
      TableName: ADMINS_TABLE,
      Select: 'COUNT',
      Limit: 1,
    })
  );
  return response.Count || 0;
}

// --- Event Operations ---

async function putEvent(event) {
  await ddb.send(new PutCommand({ TableName: EVENTS_TABLE, Item: event }));
  return event;
}

async function getEvent(eventId) {
  const { Item } = await ddb.send(new GetCommand({ TableName: EVENTS_TABLE, Key: { eventId } }));
  return Item;
}

async function listEventsByAdmin(adminId) {
  const { Items } = await ddb.send(
    new QueryCommand({
      TableName: EVENTS_TABLE,
      IndexName: 'AdminIndex',
      KeyConditionExpression: 'adminId = :adminId',
      ExpressionAttributeValues: { ':adminId': adminId },
    })
  );
  return Items || [];
}

async function listPublicEvents() {
  const { Items } = await ddb.send(
    new ScanCommand({
      TableName: EVENTS_TABLE,
      FilterExpression: '#status = :active',
      ExpressionAttributeNames: { '#status': 'status' },
      ExpressionAttributeValues: { ':active': 'ACTIVE' },
    })
  );

  return (Items || []).map((ev) => ({
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
}

async function updateEvent(event) {
  await ddb.send(new PutCommand({ TableName: EVENTS_TABLE, Item: event }));
  return event;
}

// Atomic capacity check and reservation:
// Atomically increments ticketsIssued ONLY IF:
// 1. Event exists and is ACTIVE
// 2. Either capacity is null/not set OR ticketsIssued < capacity
async function reserveTicketCapacity(eventId) {
  const result = await ddb.send(
    new UpdateCommand({
      TableName: EVENTS_TABLE,
      Key: { eventId },
      UpdateExpression: 'SET ticketsIssued = if_not_exists(ticketsIssued, :zero) + :one',
      ConditionExpression:
  'attribute_exists(eventId) AND #status = :active AND (attribute_not_exists(#capacity) OR #capacity = :null OR (attribute_not_exists(ticketsIssued) OR ticketsIssued < #capacity))',
ExpressionAttributeNames: {
  '#status': 'status',
  '#capacity': 'capacity',
},
      ExpressionAttributeValues: {
        ':zero': 0,
        ':one': 1,
        ':null': null,
        ':active': 'ACTIVE',
      },
      ReturnValues: 'ALL_NEW',
    })
  );
  return result.Attributes;
}

async function releaseTicketCapacity(eventId) {
  await ddb.send(
    new UpdateCommand({
      TableName: EVENTS_TABLE,
      Key: { eventId },
      UpdateExpression: 'SET ticketsIssued = ticketsIssued - :one',
      ConditionExpression:
        'attribute_exists(eventId) AND attribute_exists(ticketsIssued) AND ticketsIssued > :zero',
      ExpressionAttributeValues: {
        ':one': 1,
        ':zero': 0,
      },
    })
  );
}
// --- Ticket Operations ---

async function putTicket(ticket) {
  await ddb.send(new PutCommand({ TableName: TICKETS_TABLE, Item: ticket }));
  return ticket;
}

async function getTicket(ticketId) {
  const { Item } = await ddb.send(new GetCommand({ TableName: TICKETS_TABLE, Key: { ticketId } }));
  return Item;
}

async function listTicketsByEvent(eventId) {
  const { Items } = await ddb.send(
    new QueryCommand({
      TableName: TICKETS_TABLE,
      IndexName: 'EventIndex',
      KeyConditionExpression: 'eventId = :eventId',
      ExpressionAttributeValues: { ':eventId': eventId },
    })
  );
  return Items || [];
}

async function markTicketSent(ticketId) {
  await ddb.send(
    new UpdateCommand({
      TableName: TICKETS_TABLE,
      Key: { ticketId },
      UpdateExpression: 'SET #status = :sent',
      ConditionExpression: '#status = :issued',
      ExpressionAttributeNames: { '#status': 'status' },
      ExpressionAttributeValues: { ':sent': 'SENT', ':issued': 'ISSUED' },
    })
  );
}

// The core anti-fraud mechanism: an atomic conditional update. Two
// near-simultaneous scans of the same (duplicated/screenshotted) QR race
// here, and only one can ever win, because the condition only matches a
// ticket that hasn't been used yet.
async function checkInTicket(ticketId, gateId) {
  const now = new Date().toISOString();
  await ddb.send(
    new UpdateCommand({
      TableName: TICKETS_TABLE,
      Key: { ticketId },
      UpdateExpression: 'SET #status = :checkedIn, checkedInAt = :now, checkedInBy = :gateId',
      ConditionExpression: '#status IN (:issued, :sent)',
      ExpressionAttributeNames: { '#status': 'status' },
      ExpressionAttributeValues: {
        ':checkedIn': 'CHECKED_IN',
        ':issued': 'ISSUED',
        ':sent': 'SENT',
        ':now': now,
        ':gateId': gateId || 'unknown',
      },
    })
  );
  return now;
}
async function cancelTicket(ticketId) {
  await ddb.send(
    new UpdateCommand({
      TableName: TICKETS_TABLE,
      Key: { ticketId },
      UpdateExpression: 'SET #status = :cancelled',
      ConditionExpression: '#status IN (:issued, :sent)',
      ExpressionAttributeNames: { '#status': 'status' },
      ExpressionAttributeValues: {
        ':cancelled': 'CANCELLED',
        ':issued': 'ISSUED',
        ':sent': 'SENT',
      },
    })
  );
}
// --- Verification Code (OTP Challenge) Operations ---

/**
 * Persist a new OTP challenge record.
 * The record includes a DynamoDB TTL (expiresAt in epoch seconds) so
 * DynamoDB will eventually clean it up automatically.
 */
async function putVerificationChallenge(challenge) {
  await ddb.send(new PutCommand({ TableName: VERIFICATION_CODES_TABLE, Item: challenge }));
  return challenge;
}

async function getVerificationChallenge(challengeId) {
  const { Item } = await ddb.send(
    new GetCommand({ TableName: VERIFICATION_CODES_TABLE, Key: { challengeId } })
  );
  return Item || null;
}

/**
 * Atomically mark a challenge as used.
 * Conditional: only succeeds if `used` is NOT already true.
 * This prevents two concurrent valid-code submissions from both succeeding.
 */
async function markChallengeUsed(challengeId) {
  await ddb.send(
    new UpdateCommand({
      TableName: VERIFICATION_CODES_TABLE,
      Key: { challengeId },
      UpdateExpression: 'SET #used = :true',
      ConditionExpression: '#used = :false',
      ExpressionAttributeNames: { '#used': 'used' },
      ExpressionAttributeValues: { ':true': true, ':false': false },
    })
  );
}

/**
 * Atomically increment failed attempt counter.
 * Conditional: only increments if current attempts still match the
 * expected value and the challenge is not yet used, preventing races.
 */
async function incrementChallengeAttempts(challengeId, expectedAttempts) {
  await ddb.send(
    new UpdateCommand({
      TableName: VERIFICATION_CODES_TABLE,
      Key: { challengeId },
      UpdateExpression: 'SET attempts = attempts + :one',
      ConditionExpression: 'attempts = :expected AND #used = :false',
      ExpressionAttributeNames: { '#used': 'used' },
      ExpressionAttributeValues: { ':one': 1, ':expected': expectedAttempts, ':false': false },
    })
  );
}

/**
 * Look up the most recent active CANCELLATION challenge for a given ticketId
 * using the TicketIdIndex GSI on VerificationCodesTable.
 */
async function queryCancellationChallenge(ticketId) {
  const nowEpoch = Math.floor(Date.now() / 1000);
  const { Items } = await ddb.send(
    new QueryCommand({
      TableName: VERIFICATION_CODES_TABLE,
      IndexName: 'TicketIdIndex',
      KeyConditionExpression: 'ticketId = :ticketId',
      FilterExpression: '#purpose = :purpose AND #used = :false AND expiresAt > :now',
      ExpressionAttributeNames: {
        '#purpose': 'purpose',
        '#used': 'used',
      },
      ExpressionAttributeValues: {
        ':ticketId': ticketId,
        ':purpose': 'CANCELLATION',
        ':false': false,
        ':now': nowEpoch,
      },
    })
  );
  if (!Items || Items.length === 0) return null;
  // Return the most recently created active challenge
  return Items.sort((a, b) => (b.createdAt > a.createdAt ? 1 : -1))[0];
}

/**
 * Check whether a recent OTP request exists for a given email+purpose
 * within the cooldown window. Used to rate-limit resend requests.
 * Scans with a filter — acceptable for a small prototype where the
 * VerificationCodesTable has a short 10-min TTL on all records.
 */
async function findRecentChallenge({ email, purpose, cooldownSeconds }) {
  const cutoffIso = new Date(Date.now() - cooldownSeconds * 1000).toISOString();
  const { Items } = await ddb.send(
    new ScanCommand({
      TableName: VERIFICATION_CODES_TABLE,
      FilterExpression:
        'attendeeEmail = :email AND #purpose = :purpose AND createdAt > :cutoff AND #used = :false',
      ExpressionAttributeNames: {
        '#purpose': 'purpose',
        '#used': 'used',
      },
      ExpressionAttributeValues: {
        ':email': email,
        ':purpose': purpose,
        ':cutoff': cutoffIso,
        ':false': false,
      },
    })
  );
  return Items && Items.length > 0 ? Items[0] : null;
}

// --- Payment & Transaction Operations ---

async function putPayment(payment) {
  const item = { ...payment };
  // DynamoDB GSI PaymentIdIndex requires type String (S); null values cause validation errors
  if (!item.paymentId) delete item.paymentId;
  await ddb.send(new PutCommand({ TableName: PAYMENTS_TABLE, Item: item }));
  return payment;
}

async function getPayment(orderId) {
  const { Item } = await ddb.send(new GetCommand({ TableName: PAYMENTS_TABLE, Key: { orderId } }));
  return Item || null;
}

async function getPaymentByPaymentId(paymentId) {
  const { Items } = await ddb.send(
    new QueryCommand({
      TableName: PAYMENTS_TABLE,
      IndexName: 'PaymentIdIndex',
      KeyConditionExpression: 'paymentId = :paymentId',
      ExpressionAttributeValues: { ':paymentId': paymentId },
    })
  );
  return Items && Items.length > 0 ? Items[0] : null;
}

async function listPaymentsByEvent(eventId) {
  const { Items } = await ddb.send(
    new QueryCommand({
      TableName: PAYMENTS_TABLE,
      IndexName: 'EventIndex',
      KeyConditionExpression: 'eventId = :eventId',
      ExpressionAttributeValues: { ':eventId': eventId },
    })
  );
  return Items || [];
}

async function listPaymentsByAdmin(adminId) {
  const { Items } = await ddb.send(
    new QueryCommand({
      TableName: PAYMENTS_TABLE,
      IndexName: 'AdminIndex',
      KeyConditionExpression: 'adminId = :adminId',
      ExpressionAttributeValues: { ':adminId': adminId },
    })
  );
  return Items || [];
}

async function updatePayment(orderId, updateFields) {
  const sanitized = { ...updateFields };
  if ('paymentId' in sanitized && !sanitized.paymentId) {
    delete sanitized.paymentId;
  }
  const keys = Object.keys(sanitized);
  if (keys.length === 0) return;
  const updateExprParts = [];
  const exprAttrNames = {};
  const exprAttrValues = {};

  keys.forEach((key, idx) => {
    updateExprParts.push(`#k${idx} = :v${idx}`);
    exprAttrNames[`#k${idx}`] = key;
    exprAttrValues[`:v${idx}`] = sanitized[key];
  });

  await ddb.send(
    new UpdateCommand({
      TableName: PAYMENTS_TABLE,
      Key: { orderId },
      UpdateExpression: `SET ${updateExprParts.join(', ')}`,
      ExpressionAttributeNames: exprAttrNames,
      ExpressionAttributeValues: exprAttrValues,
    })
  );
}

async function updateTicket(ticketId, updateFields) {
  const keys = Object.keys(updateFields);
  if (keys.length === 0) return;
  const updateExprParts = [];
  const exprAttrNames = {};
  const exprAttrValues = {};

  keys.forEach((key, idx) => {
    updateExprParts.push(`#k${idx} = :v${idx}`);
    exprAttrNames[`#k${idx}`] = key;
    exprAttrValues[`:v${idx}`] = updateFields[key];
  });

  await ddb.send(
    new UpdateCommand({
      TableName: TICKETS_TABLE,
      Key: { ticketId },
      UpdateExpression: `SET ${updateExprParts.join(', ')}`,
      ExpressionAttributeNames: exprAttrNames,
      ExpressionAttributeValues: exprAttrValues,
    })
  );
}

module.exports = {
  putAdmin,
  getAdminById,
  getAdminByEmail,
  countAdmins,
  putEvent,
  updateEvent,
  getEvent,
  listEventsByAdmin,
  listPublicEvents,
  reserveTicketCapacity,
  releaseTicketCapacity,
  putTicket,
  updateTicket,
  getTicket,
  listTicketsByEvent,
  markTicketSent,
  checkInTicket,
  cancelTicket,
  // Payment operations
  putPayment,
  getPayment,
  getPaymentByPaymentId,
  listPaymentsByEvent,
  listPaymentsByAdmin,
  updatePayment,
  // OTP challenge operations
  putVerificationChallenge,
  getVerificationChallenge,
  markChallengeUsed,
  incrementChallengeAttempts,
  queryCancellationChallenge,
  findRecentChallenge,
};
