const Razorpay = require('razorpay');
const crypto = require('crypto');
const config = require('../config/env');

const razorpay = new Razorpay({
  key_id: config.razorpay.keyId,
  key_secret: config.razorpay.keySecret,
});

const isLiveRazorpay = config.razorpay.keyId?.startsWith('rzp_live_');
if (config.razorpay.keyId) {
  console.log(`[Razorpay] Initialized in ${isLiveRazorpay ? 'LIVE 🟢' : 'TEST 🟡'} mode (${config.razorpay.keyId.slice(0, 12)}...)`);
} else {
  console.warn('[Razorpay] ⚠️ Warning: RAZORPAY_KEY_ID is not configured.');
}

async function createOrder({ amount, currency = 'INR', receipt, notes = {} }) {
  const order = await razorpay.orders.create({
    amount, // in paise
    currency,
    receipt,
    notes,
  });
  return order;
}

function verifyPaymentSignature({ orderId, paymentId, signature }) {
  const generatedSignature = crypto
    .createHmac('sha256', config.razorpay.keySecret)
    .update(`${orderId}|${paymentId}`)
    .digest('hex');

  try {
    return crypto.timingSafeEqual(
      Buffer.from(generatedSignature, 'hex'),
      Buffer.from(signature, 'hex')
    );
  } catch {
    return false;
  }
}

function verifyWebhookSignature(body, signature) {
  if (!signature || !config.razorpay.webhookSecret) return false;
  const payload = Buffer.isBuffer(body) ? body : (typeof body === 'string' ? body : JSON.stringify(body));
  const generatedSignature = crypto
    .createHmac('sha256', config.razorpay.webhookSecret)
    .update(payload)
    .digest('hex');

  try {
    return crypto.timingSafeEqual(
      Buffer.from(generatedSignature, 'hex'),
      Buffer.from(signature, 'hex')
    );
  } catch {
    return false;
  }
}

async function initiateRefund(paymentId, amount) {
  const refund = await razorpay.payments.refund(paymentId, {
    amount,
    speed: 'normal',
  });
  return refund;
}

module.exports = {
  razorpay,
  createOrder,
  verifyPaymentSignature,
  verifyWebhookSignature,
  initiateRefund,
};
