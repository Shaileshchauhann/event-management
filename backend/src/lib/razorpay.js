const crypto = require('crypto');
const Razorpay = require('razorpay');

const fs = require('fs');
const path = require('path');

function autoLoadEnv() {
  const candidatePaths = [
    path.resolve(__dirname, '../../.env'),
    path.resolve(__dirname, '../../../.env'),
    path.resolve(process.cwd(), '.env'),
    path.resolve(process.cwd(), 'backend/.env')
  ];
  for (const p of candidatePaths) {
    if (fs.existsSync(p)) {
      try {
        const lines = fs.readFileSync(p, 'utf8').split('\n');
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || trimmed.startsWith('#')) continue;
          const idx = trimmed.indexOf('=');
          if (idx !== -1) {
            const k = trimmed.slice(0, idx).trim();
            const v = trimmed.slice(idx + 1).trim().replace(/^['"](.*)['"]$/, '$1');
            if (!process.env[k]) {
              process.env[k] = v;
            }
          }
        }
      } catch (err) {}
    }
  }
}

function getRazorpayConfig() {
  autoLoadEnv();
  const key_id = process.env.RAZORPAY_KEY_ID || 'rzp_test_placeholder';
  const key_secret = process.env.RAZORPAY_KEY_SECRET || 'secret_placeholder';
  return { key_id, key_secret };
}

let razorpayInstance = null;

function getRazorpayClient() {
  if (razorpayInstance) return razorpayInstance;
  const { key_id, key_secret } = getRazorpayConfig();
  razorpayInstance = new Razorpay({
    key_id,
    key_secret,
  });
  return razorpayInstance;
}

// Allows setting a mock or custom client (invaluable for unit/E2E test suites)
function setRazorpayClient(customClient) {
  razorpayInstance = customClient;
}

/**
 * Creates an order on Razorpay
 * @param {Object} options - { amount, currency, receipt, notes }
 * @returns {Promise<Object>} Razorpay order object
 */
async function createOrder({ amount, currency = 'INR', receipt, notes = {} }) {
  if (!amount || typeof amount !== 'number' || amount <= 0) {
    throw Object.assign(new Error('Invalid order amount: must be positive integer paise'), { statusCode: 400 });
  }
  const client = getRazorpayClient();
  return client.orders.create({
    amount: Math.round(amount),
    currency,
    receipt: receipt || `rcpt_${Date.now()}`,
    notes,
  });
}

/**
 * Fetches payment details from Razorpay
 * @param {string} paymentId
 * @returns {Promise<Object>}
 */
async function fetchPayment(paymentId) {
  if (!paymentId) {
    throw Object.assign(new Error('paymentId is required'), { statusCode: 400 });
  }
  const client = getRazorpayClient();
  return client.payments.fetch(paymentId);
}

/**
 * Verifies Razorpay checkout payment signature
 * signature = hmac_sha256(order_id + "|" + payment_id, secret)
 */
function verifyPaymentSignature({ orderId, paymentId, signature }) {
  if (!orderId || !paymentId || !signature) return false;
  const { key_secret } = getRazorpayConfig();
  const text = `${orderId}|${paymentId}`;
  const generatedSignature = crypto
    .createHmac('sha256', key_secret)
    .update(text)
    .digest('hex');

  try {
    return crypto.timingSafeEqual(
      Buffer.from(generatedSignature, 'utf8'),
      Buffer.from(signature, 'utf8')
    );
  } catch (err) {
    return false;
  }
}

/**
 * Initiates a refund for a captured payment
 * @param {string} paymentId
 * @param {Object} options - { amount, notes, speed }
 */
async function createRefund(paymentId, { amount, notes = {} } = {}) {
  if (!paymentId) {
    throw Object.assign(new Error('paymentId is required for refund'), { statusCode: 400 });
  }
  const client = getRazorpayClient();
  const payload = { notes };
  if (amount && typeof amount === 'number' && amount > 0) {
    payload.amount = Math.round(amount);
  }
  return client.payments.refund(paymentId, payload);
}

module.exports = {
  getRazorpayConfig,
  getRazorpayClient,
  setRazorpayClient,
  createOrder,
  fetchPayment,
  verifyPaymentSignature,
  createRefund,
};
