const Razorpay = require('razorpay');
const crypto = require('crypto');
const config = require('../config/env');

const razorpay = new Razorpay({
  key_id: config.razorpay.keyId,
  key_secret: config.razorpay.keySecret,
});

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
  const generatedSignature = crypto
    .createHmac('sha256', config.razorpay.webhookSecret)
    .update(JSON.stringify(body))
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
