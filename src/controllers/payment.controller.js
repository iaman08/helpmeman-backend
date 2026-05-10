const { PrismaClient } = require('@prisma/client');
const { verifyWebhookSignature, initiateRefund } = require('../services/payment.service');
const prisma = new PrismaClient();

async function createPaymentOrder(req, res) {
  try {
    // Reuse booking controller's createBooking
    res.status(400).json({ error: 'Use POST /api/bookings to create a booking with payment' });
  } catch (e) { res.status(500).json({ error: 'Failed' }); }
}

async function verifyPayment(req, res) {
  try {
    res.status(400).json({ error: 'Use POST /api/bookings/:id/verify-payment' });
  } catch (e) { res.status(500).json({ error: 'Failed' }); }
}

async function handleWebhook(req, res) {
  try {
    const signature = req.headers['x-razorpay-signature'];
    const valid = verifyWebhookSignature(req.body, signature);
    if (!valid) return res.status(400).json({ error: 'Invalid signature' });

    const event = req.body.event;
    const payment = req.body.payload?.payment?.entity;

    if (event === 'payment.captured') {
      console.log('Payment captured:', payment?.id);
    } else if (event === 'refund.processed') {
      console.log('Refund processed:', payment?.id);
    }

    res.json({ status: 'ok' });
  } catch (e) { console.error('Webhook error:', e); res.status(500).json({ error: 'Webhook failed' }); }
}

module.exports = { createPaymentOrder, verifyPayment, handleWebhook };
