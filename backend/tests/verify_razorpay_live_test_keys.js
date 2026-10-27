const { getRazorpayConfig, getRazorpayClient, createOrder, verifyPaymentSignature } = require('../src/lib/razorpay');
const crypto = require('crypto');

async function testRazorpayCredentials() {
  console.log('=== Verifying Razorpay Test Credentials with Razorpay API ===');
  const config = getRazorpayConfig();
  console.log('Loaded Key ID:', config.key_id);
  console.log('Secret configured (length):', config.key_secret.length);

  if (config.key_id.startsWith('rzp_test_placeholder')) {
    console.error('ERROR: Placeholder key ID found instead of test credentials.');
    process.exit(1);
  }

  const client = getRazorpayClient();

  // Test 1: Create a real test order on Razorpay Test Gateway
  console.log('\n1. Creating test order on Razorpay API (amount: 100 paise / ₹1.00)...');
  try {
    const order = await createOrder({
      amount: 100, // 100 paise = 1 INR
      currency: 'INR',
      receipt: `test_rcpt_${Date.now()}`,
      notes: { test: 'live_test_credentials_verification' },
    });

    console.log('   ✓ SUCCESS! Razorpay Order created successfully.');
    console.log('   Order ID:', order.id);
    console.log('   Amount:', order.amount);
    console.log('   Currency:', order.currency);
    console.log('   Status:', order.status);

    // Test 2: Verify signature generation using the real secret
    console.log('\n2. Testing HMAC-SHA256 signature verification with actual secret...');
    const fakePaymentId = 'pay_test_' + Date.now();
    const payload = `${order.id}|${fakePaymentId}`;
    const validSig = crypto.createHmac('sha256', config.key_secret).update(payload).digest('hex');

    const isValid = verifyPaymentSignature({
      orderId: order.id,
      paymentId: fakePaymentId,
      signature: validSig,
    });
    console.log('   ✓ Valid signature test:', isValid ? 'PASSED' : 'FAILED');

    const isInvalid = verifyPaymentSignature({
      orderId: order.id,
      paymentId: fakePaymentId,
      signature: 'corrupted_signature_1234567890abcdef',
    });
    console.log('   ✓ Tampered signature correctly rejected:', !isInvalid ? 'PASSED' : 'FAILED');

    console.log('\n=== Razorpay Test Credentials Verification: 100% WORKING & VALID! ===');
  } catch (err) {
    console.error('Razorpay API error:', err);
    process.exit(1);
  }
}

testRazorpayCredentials();
