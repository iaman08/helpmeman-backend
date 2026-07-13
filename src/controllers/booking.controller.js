const prisma = require('../config/prisma');
const { createOrder, verifyPaymentSignature } = require('../services/payment.service');
const { createMeetingEvent } = require('../services/googleMeet.service');
const { sendNotification } = require('../services/notification.service');
const config = require('../config/env');
const exchangeRateService = require('../services/exchangeRate.service');


async function createBooking(req, res) {
  try {
    const { mentorId, scheduledAt, durationMinutes = 30, currency } = req.body;
    const mentor = await prisma.mentor.findFirst({ where: { id: mentorId, isActive: true, approvalStatus: 'APPROVED' } });
    if (!mentor) return res.status(404).json({ error: 'Mentor not found or unavailable' });

    // Original amount in INR Paise
    const amountInr = mentor.pricePerSession * (durationMinutes / mentor.sessionDuration);
    
    // Determine target currency (use request body currency, or user preferred currency, default to INR)
    let targetCurrency = 'INR';
    if (currency) {
      targetCurrency = currency.toUpperCase();
    } else if (req.user && req.user.currency) {
      targetCurrency = req.user.currency.toUpperCase();
    }

    // Convert the INR amount to the target currency subunits
    const conversion = await exchangeRateService.convertInrToTarget(amountInr, targetCurrency);

    const booking = await prisma.booking.create({
      data: { 
        userId: req.user.id, 
        mentorId, 
        scheduledAt: new Date(scheduledAt), 
        durationMinutes, 
        amountPaid: conversion.amount, // Converted amount in target currency subunits (cents/paise)
        currency: targetCurrency,
        amountPaidINR: amountInr, // Original amount in INR paise
        status: 'PENDING' 
      },
    });

    const order = await createOrder({ 
      amount: conversion.amount, 
      currency: targetCurrency, 
      receipt: `booking_${booking.id}`, 
      notes: { bookingId: booking.id } 
    });
    res.json({ booking, order, razorpayKeyId: config.razorpay.keyId });
  } catch (e) { console.error(e); res.status(500).json({ error: 'Booking failed' }); }
}

async function verifyPayment(req, res) {
  try {
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body;
    const valid = verifyPaymentSignature({ orderId: razorpay_order_id, paymentId: razorpay_payment_id, signature: razorpay_signature });
    if (!valid) return res.status(400).json({ error: 'Invalid payment' });

    const booking = await prisma.booking.findFirst({ where: { id: req.params.id, userId: req.user.id } });
    if (!booking) return res.status(404).json({ error: 'Booking not found' });

    const fullBooking = await prisma.booking.findUnique({ where: { id: booking.id }, include: { user: true, mentor: { include: { user: true } } } });
    const { googleEventId, meetLink } = await createMeetingEvent({ booking: fullBooking, mentor: fullBooking.mentor, user: fullBooking.user });

    const confirmed = await prisma.booking.update({
      where: { id: booking.id },
      data: { status: 'CONFIRMED', paymentStatus: 'PAID', paymentId: razorpay_payment_id, googleEventId, meetLink },
    });

    // Create earning (80% to mentor, based on amountPaidINR base currency)
    const originalAmountInr = booking.amountPaidINR || booking.amountPaid;
    await prisma.earning.create({ data: { mentorId: booking.mentorId, bookingId: booking.id, amount: Math.floor(originalAmountInr * (1 - config.platformFeePercent / 100)) } });
    await prisma.mentor.update({ where: { id: booking.mentorId }, data: { totalSessions: { increment: 1 } } });

    // Link chat thread if exists
    await prisma.chatThread.updateMany({ where: { userId: booking.userId, mentorId: booking.mentorId }, data: { bookingId: booking.id, status: 'BOOKED' } });

    await sendNotification({
      userId: booking.userId,
      type: 'BOOKING_CONFIRMED',
      title: 'Session confirmed!',
      body: 'Your session is confirmed. Your meet link is ready.',
    });
    await sendNotification({
      mentorId: booking.mentorId,
      type: 'NEW_BOOKING',
      title: 'New booking received',
      body: 'A student booked a session with you.',
    });

    res.json({ booking: confirmed });
  } catch (e) { console.error(e); res.status(500).json({ error: 'Payment verification failed' }); }
}

async function getMeetLink(req, res) {
  try {
    const booking = await prisma.booking.findFirst({
      where: { id: req.params.id, OR: [{ userId: req.user.id }, { mentor: { userId: req.user.id } }] },
      select: { meetLink: true, status: true },
    });
    if (!booking) return res.status(404).json({ error: 'Booking not found' });
    if (booking.status !== 'CONFIRMED') return res.status(400).json({ error: 'Booking not confirmed' });
    res.json({ meetLink: booking.meetLink });
  } catch (e) { res.status(500).json({ error: 'Failed' }); }
}

async function rescheduleBooking(req, res) {
  try {
    const { id } = req.params;
    const { scheduledAt } = req.body;

    if (!scheduledAt) {
      return res.status(400).json({ error: 'New schedule time is required' });
    }

    const booking = await prisma.booking.findUnique({
      where: { id },
      include: { user: true, mentor: { include: { user: true } } },
    });

    if (!booking) return res.status(404).json({ error: 'Booking not found' });

    // Auth check: student or mentor
    if (booking.userId !== req.user.id && booking.mentor.userId !== req.user.id) {
      return res.status(403).json({ error: 'Unauthorized' });
    }

    const updated = await prisma.booking.update({
      where: { id },
      data: { scheduledAt: new Date(scheduledAt) },
    });

    // Update Google Calendar
    if (booking.googleEventId) {
      const { updateMeetingEvent } = require('../services/googleMeet.service');
      await updateMeetingEvent(booking.googleEventId, scheduledAt, booking.durationMinutes);
    }

    const { sendNotification } = require('../services/notification.service');
    const msg = `Session rescheduled to ${new Date(scheduledAt).toLocaleString()}`;
    await sendNotification({ userId: booking.userId, type: 'BOOKING_RESCHEDULED', title: 'Session rescheduled', body: msg });
    await sendNotification({ mentorId: booking.mentorId, type: 'BOOKING_RESCHEDULED', title: 'Session rescheduled', body: msg });

    res.json({ booking: updated });
  } catch (e) { console.error(e); res.status(500).json({ error: 'Failed to reschedule' }); }
}

module.exports = { createBooking, verifyPayment, getMeetLink, rescheduleBooking };
