/**
 * Booking Controller
 *
 * Handles the full booking lifecycle:
 * 1. createBooking      - Creates a pending booking + Razorpay order
 * 2. verifyPayment      - Verifies payment, creates Google Meet event, sends emails
 * 3. getMeetLink        - Returns the meet link for authorized users
 * 4. rescheduleBooking  - Updates booking time + Google Calendar event
 * 5. cancelBooking      - Cancels booking + Google Calendar event
 */

const prisma = require('../config/prisma');
const { createOrder, verifyPaymentSignature, initiateRefund } = require('../services/payment.service');
const { createMeetingEvent, updateMeetingEvent, cancelMeetingEvent } = require('../services/googleMeet.service');
const { sendNotification } = require('../services/notification.service');
const { sendBookingConfirmationEmails } = require('../services/email.service');
const config = require('../config/env');
const exchangeRateService = require('../services/exchangeRate.service');

// ── CREATE BOOKING ─────────────────────────────────────────────────────────────
async function createBooking(req, res) {
  try {
    const { mentorId, scheduledAt, durationMinutes = 30, currency } = req.body;

    // Validate mentor exists and is active
    const mentor = await prisma.mentor.findFirst({
      where: { id: mentorId, isActive: true, approvalStatus: 'APPROVED' },
    });
    if (!mentor) return res.status(404).json({ error: 'Mentor not found or unavailable' });

    // Check for overlapping bookings (prevent double-booking)
    const sessionStart = new Date(scheduledAt);
    const sessionEnd = new Date(sessionStart.getTime() + durationMinutes * 60 * 1000);

    const overlap = await prisma.booking.findFirst({
      where: {
        mentorId,
        status: { in: ['CONFIRMED', 'PENDING'] },
        AND: [
          { scheduledAt: { lt: sessionEnd } },
          {
            scheduledAt: {
              gt: new Date(sessionStart.getTime() - durationMinutes * 60 * 1000),
            },
          },
        ],
      },
    });

    if (overlap) {
      return res.status(409).json({
        error: 'This time slot is already booked. Please choose a different time.',
      });
    }

    // Calculate amount in INR paise (base currency)
    const amountInr = mentor.pricePerSession * (durationMinutes / mentor.sessionDuration);

    // Determine target currency
    let targetCurrency = 'INR';
    if (currency) {
      targetCurrency = currency.toUpperCase();
    } else if (req.user?.currency) {
      targetCurrency = req.user.currency.toUpperCase();
    }

    // Convert INR amount to target currency subunits
    const conversion = await exchangeRateService.convertInrToTarget(amountInr, targetCurrency);

    const booking = await prisma.booking.create({
      data: {
        userId: req.user.id,
        mentorId,
        scheduledAt: new Date(scheduledAt),
        durationMinutes,
        amountPaid: conversion.amount,
        currency: targetCurrency,
        amountPaidINR: amountInr,
        status: 'PENDING',
      },
    });

    const order = await createOrder({
      amount: conversion.amount,
      currency: targetCurrency,
      receipt: `booking_${booking.id}`,
      notes: { bookingId: booking.id },
    });

    res.json({ booking, order, razorpayKeyId: config.razorpay.keyId });
  } catch (e) {
    console.error('[booking] createBooking error:', e);
    res.status(500).json({ error: 'Booking failed. Please try again.' });
  }
}

// ── VERIFY PAYMENT ─────────────────────────────────────────────────────────────
async function verifyPayment(req, res) {
  try {
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body;

    // Step 1: Verify Razorpay signature
    const valid = verifyPaymentSignature({
      orderId: razorpay_order_id,
      paymentId: razorpay_payment_id,
      signature: razorpay_signature,
    });
    if (!valid) {
      return res.status(400).json({ error: 'Invalid payment signature. Payment not verified.' });
    }

    // Step 2: Fetch booking (must belong to requesting user)
    const booking = await prisma.booking.findFirst({
      where: { id: req.params.id, userId: req.user.id },
    });
    if (!booking) return res.status(404).json({ error: 'Booking not found' });
    if (booking.paymentStatus === 'PAID') {
      return res.status(409).json({ error: 'Payment already verified for this booking.' });
    }

    // Step 3: Fetch full booking data including mentor (with OAuth fields) + user
    const fullBooking = await prisma.booking.findUnique({
      where: { id: booking.id },
      include: {
        user: true,
        mentor: {
          include: {
            user: { select: { id: true, name: true, email: true } },
          },
        },
      },
    });

    // Step 4: Create Google Calendar event + Meet link
    // This will gracefully return null values if mentor hasn't connected Google
    const { googleEventId, meetLink } = await createMeetingEvent({
      booking: fullBooking,
      mentor: fullBooking.mentor,
      user: fullBooking.user,
      timezone: fullBooking.mentor.googleCalendarTimezone,
    });

    // Step 5: Confirm booking in DB
    const confirmed = await prisma.booking.update({
      where: { id: booking.id },
      data: {
        status: 'CONFIRMED',
        paymentStatus: 'PAID',
        paymentId: razorpay_payment_id,
        googleEventId,
        meetLink,
      },
    });

    // Step 6: Create mentor earning (platform fee deducted)
    const originalAmountInr = booking.amountPaidINR || booking.amountPaid;
    await prisma.earning.create({
      data: {
        mentorId: booking.mentorId,
        bookingId: booking.id,
        amount: Math.floor(originalAmountInr * (1 - config.platformFeePercent / 100)),
      },
    });

    // Step 7: Increment mentor session count
    await prisma.mentor.update({
      where: { id: booking.mentorId },
      data: { totalSessions: { increment: 1 } },
    });

    // Step 8: Link chat thread to this booking
    await prisma.chatThread.updateMany({
      where: { userId: booking.userId, mentorId: booking.mentorId },
      data: { bookingId: booking.id, status: 'BOOKED' },
    });

    // Step 9: Send confirmation emails to both mentor and mentee (non-blocking)
    sendBookingConfirmationEmails({
      booking: confirmed,
      mentor: fullBooking.mentor,
      user: fullBooking.user,
      meetLink,
    }).catch((err) => console.error('[booking] Email send error:', err.message));

    // Step 10: In-app notifications for both users
    await Promise.all([
      sendNotification({
        userId: booking.userId,
        type: 'BOOKING_CONFIRMED',
        title: 'Session confirmed! 🎉',
        body: meetLink
          ? `Your session with ${fullBooking.mentor.displayName} is confirmed. Your Google Meet link is ready.`
          : `Your session with ${fullBooking.mentor.displayName} is confirmed. The meet link will be shared shortly.`,
        metadata: { bookingId: booking.id, meetLink },
      }),
      sendNotification({
        mentorId: booking.mentorId,
        type: 'NEW_BOOKING',
        title: 'New session booked! 📅',
        body: `${fullBooking.user.name} booked a ${booking.durationMinutes}-minute session with you.`,
        metadata: { bookingId: booking.id, userId: booking.userId },
      }),
    ]);

    res.json({
      booking: confirmed,
      meetLink: meetLink || null,
      calendarConnected: !!meetLink,
    });
  } catch (e) {
    console.error('[booking] verifyPayment error:', e);
    res.status(500).json({ error: 'Payment verification failed. Please contact support.' });
  }
}

// ── GET MEET LINK ──────────────────────────────────────────────────────────────
async function getMeetLink(req, res) {
  try {
    const booking = await prisma.booking.findFirst({
      where: {
        id: req.params.id,
        OR: [{ userId: req.user.id }, { mentor: { userId: req.user.id } }],
      },
      select: { meetLink: true, status: true, scheduledAt: true },
    });

    if (!booking) return res.status(404).json({ error: 'Booking not found' });
    if (booking.status !== 'CONFIRMED') {
      return res.status(400).json({ error: 'Booking is not confirmed yet' });
    }

    res.json({
      meetLink: booking.meetLink,
      scheduledAt: booking.scheduledAt,
    });
  } catch (e) {
    console.error('[booking] getMeetLink error:', e);
    res.status(500).json({ error: 'Failed to get meet link' });
  }
}

// ── RESCHEDULE BOOKING ─────────────────────────────────────────────────────────
async function rescheduleBooking(req, res) {
  try {
    const { id } = req.params;
    const { scheduledAt } = req.body;

    if (!scheduledAt) {
      return res.status(400).json({ error: 'New schedule time is required' });
    }

    const booking = await prisma.booking.findUnique({
      where: { id },
      include: {
        user: true,
        mentor: {
          include: { user: { select: { id: true, name: true, email: true } } },
        },
      },
    });

    if (!booking) return res.status(404).json({ error: 'Booking not found' });

    // Auth check: only the mentee or the mentor can reschedule
    if (booking.userId !== req.user.id && booking.mentor.userId !== req.user.id) {
      return res.status(403).json({ error: 'Unauthorized to reschedule this booking' });
    }

    // Check for new overlapping booking
    const newStart = new Date(scheduledAt);
    const newEnd = new Date(newStart.getTime() + booking.durationMinutes * 60 * 1000);
    const overlap = await prisma.booking.findFirst({
      where: {
        mentorId: booking.mentorId,
        id: { not: id }, // exclude current booking
        status: { in: ['CONFIRMED', 'PENDING'] },
        AND: [
          { scheduledAt: { lt: newEnd } },
          { scheduledAt: { gt: new Date(newStart.getTime() - booking.durationMinutes * 60 * 1000) } },
        ],
      },
    });
    if (overlap) {
      return res.status(409).json({ error: 'The new time slot is already booked. Choose another time.' });
    }

    const updated = await prisma.booking.update({
      where: { id },
      data: { scheduledAt: new Date(scheduledAt) },
    });

    // Update Google Calendar event (non-blocking)
    if (booking.googleEventId) {
      updateMeetingEvent(
        booking.mentor,
        booking.googleEventId,
        scheduledAt,
        booking.durationMinutes,
        booking.mentor.googleCalendarTimezone
      ).catch((err) => console.error('[booking] Calendar update error:', err.message));
    }

    const msg = `Session rescheduled to ${new Date(scheduledAt).toLocaleString('en-IN', { timeZone: booking.mentor.googleCalendarTimezone || 'Asia/Kolkata' })}`;

    await Promise.all([
      sendNotification({
        userId: booking.userId,
        type: 'BOOKING_RESCHEDULED',
        title: 'Session rescheduled',
        body: msg,
        metadata: { bookingId: id },
      }),
      sendNotification({
        mentorId: booking.mentorId,
        type: 'BOOKING_RESCHEDULED',
        title: 'Session rescheduled',
        body: msg,
        metadata: { bookingId: id },
      }),
    ]);

    res.json({ booking: updated });
  } catch (e) {
    console.error('[booking] rescheduleBooking error:', e);
    res.status(500).json({ error: 'Failed to reschedule. Please try again.' });
  }
}

// ── CANCEL BOOKING ─────────────────────────────────────────────────────────────
async function cancelBooking(req, res) {
  try {
    const { id } = req.params;
    const { reason } = req.body;

    const booking = await prisma.booking.findUnique({
      where: { id },
      include: {
        user: true,
        mentor: {
          include: { user: { select: { id: true, name: true, email: true } } },
        },
      },
    });

    if (!booking) return res.status(404).json({ error: 'Booking not found' });

    // Auth check: only the mentee or the mentor can cancel
    if (booking.userId !== req.user.id && booking.mentor.userId !== req.user.id) {
      return res.status(403).json({ error: 'Unauthorized to cancel this booking' });
    }

    if (booking.status === 'CANCELLED') {
      return res.status(400).json({ error: 'Booking is already cancelled' });
    }

    if (booking.status === 'COMPLETED') {
      return res.status(400).json({ error: 'Cannot cancel a completed session' });
    }

    const cancelledBy = req.user.id;

    // Attempt refund (non-blocking — log failure but don't block response)
    let refunded = false;
    if (booking.paymentStatus === 'PAID' && booking.paymentId) {
      try {
        await initiateRefund(booking.paymentId, booking.amountPaid);
        refunded = true;
      } catch (refundErr) {
        console.error('[booking] Refund initiation failed:', refundErr.message);
      }
    }

    // Cancel in DB
    const cancelled = await prisma.booking.update({
      where: { id },
      data: {
        status: 'CANCELLED',
        paymentStatus: refunded ? 'REFUNDED' : booking.paymentStatus,
        cancelledBy,
        cancellationReason: reason || null,
      },
    });

    // Cancel Google Calendar event (non-blocking)
    if (booking.googleEventId) {
      cancelMeetingEvent(booking.mentor, booking.googleEventId)
        .catch((err) => console.error('[booking] Calendar cancel error:', err.message));
    }

    // Revert mentor session count if it was confirmed
    if (booking.status === 'CONFIRMED') {
      await prisma.mentor.update({
        where: { id: booking.mentorId },
        data: { totalSessions: { decrement: 1 } },
      });
    }

    const cancelMsg = reason
      ? `Your session has been cancelled. Reason: ${reason}`
      : 'Your session has been cancelled.';

    await Promise.all([
      sendNotification({
        userId: booking.userId,
        type: 'BOOKING_CANCELLED',
        title: 'Session cancelled',
        body: cancelMsg,
        metadata: { bookingId: id, refunded },
      }),
      sendNotification({
        mentorId: booking.mentorId,
        type: 'BOOKING_CANCELLED',
        title: 'Session cancelled',
        body: `${booking.user.name}'s session has been cancelled.`,
        metadata: { bookingId: id },
      }),
    ]);

    res.json({ booking: cancelled, refunded });
  } catch (e) {
    console.error('[booking] cancelBooking error:', e);
    res.status(500).json({ error: 'Failed to cancel booking. Please try again.' });
  }
}

// ── SUBMIT BOOKING INTAKE (PRE-SESSION PREREQUISITES) ──────────────────────────
async function generateAIBriefingSummary({ booking, mentor, mentee, intakeAnswers }) {
  const Groq = require('groq-sdk');
  if (!config.groq?.apiKey) {
    const goals = intakeAnswers.primaryGoal || intakeAnswers.notes || '1:1 Guidance Session';
    const qs = Array.isArray(intakeAnswers.keyQuestions) ? intakeAnswers.keyQuestions.join(', ') : (intakeAnswers.keyQuestions || '');
    return `🎯 **Mentee Goal & Target**: ${goals}\n❓ **Priority Questions to Answer**: ${qs || 'Consultation & guidance'}\n⏱️ **Recommended Session Roadmap**: Start with goals, address top questions, define action items.`;
  }

  try {
    const client = new Groq({ apiKey: config.groq.apiKey });
    const prompt = `You are an AI briefing assistant for HelpMeMan. A mentee named ${mentee?.name || 'User'} has booked a ${booking.durationMinutes}-minute consultation with mentor ${mentor?.displayName || 'Mentor'} (${mentor?.category?.name || 'General'}).

Mentee's Pre-Session Intake Details:
- Primary Goal: ${intakeAnswers.primaryGoal || intakeAnswers.goal || 'Not specified'}
- Key Questions: ${Array.isArray(intakeAnswers.keyQuestions) ? intakeAnswers.keyQuestions.join('; ') : (intakeAnswers.keyQuestions || intakeAnswers.questions || 'Not specified')}
- Current Background / Level: ${intakeAnswers.currentLevel || intakeAnswers.background || intakeAnswers.notes || 'Not specified'}
- Specific Topics/Links: ${intakeAnswers.links || intakeAnswers.specificTopics || 'None'}

Synthesize a high-impact, 3-bullet briefing summary for the mentor to read in 10 seconds before joining the video call. Return plain markdown formatted EXACTLY as:

🎯 **Mentee Goal & Target**: [1 concise sentence]
❓ **Priority Questions to Answer**: [1-2 key points]
⏱️ **Recommended Session Roadmap**: [Quick timing breakdown for the ${booking.durationMinutes}-min session]`;

    const groqCall = client.chat.completions.create({
      model: 'llama-3.1-8b-instant',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.3,
      max_tokens: 300,
    });
    const timeout = new Promise((_, reject) => setTimeout(() => reject(new Error('Groq API timeout')), 4000));
    const result = await Promise.race([groqCall, timeout]);
    return result.choices[0]?.message?.content?.trim() || `🎯 **Mentee Goal & Target**: ${intakeAnswers.primaryGoal || 'Consultation'}\n❓ **Priority Questions to Answer**: ${Array.isArray(intakeAnswers.keyQuestions) ? intakeAnswers.keyQuestions.join(', ') : 'Guidance & QA'}`;
  } catch (error) {
    console.warn('[booking] AI briefing generation fallback:', error.message);
    const goals = intakeAnswers.primaryGoal || intakeAnswers.notes || '1:1 Guidance Session';
    const qs = Array.isArray(intakeAnswers.keyQuestions) ? intakeAnswers.keyQuestions.join(', ') : (intakeAnswers.keyQuestions || '');
    return `🎯 **Mentee Goal & Target**: ${goals}\n❓ **Priority Questions to Answer**: ${qs || 'Consultation & guidance'}\n⏱️ **Recommended Session Roadmap**: Address key questions, discuss action plan.`;
  }
}

async function submitBookingIntake(req, res) {
  try {
    const { id } = req.params;
    const { intakeAnswers } = req.body;

    if (!intakeAnswers || typeof intakeAnswers !== 'object') {
      return res.status(400).json({ error: 'intakeAnswers object is required' });
    }

    const booking = await prisma.booking.findFirst({
      where: { id, userId: req.user.id },
      include: {
        user: { select: { id: true, name: true, email: true } },
        mentor: {
          include: {
            user: { select: { id: true, name: true, email: true } },
            category: { select: { name: true, slug: true } },
          },
        },
      },
    });

    if (!booking) {
      return res.status(404).json({ error: 'Booking not found' });
    }

    // Synthesize AI Briefing Summary
    const aiBriefSummary = await generateAIBriefingSummary({
      booking,
      mentor: booking.mentor,
      mentee: booking.user,
      intakeAnswers,
    });

    const updated = await prisma.booking.update({
      where: { id },
      data: {
        intakeAnswers,
        aiBriefSummary,
      },
    });

    // Notify mentor of updated pre-session brief
    sendNotification({
      mentorId: booking.mentorId,
      type: 'BOOKING_INTAKE_SUBMITTED',
      title: '⚡ Pre-Session Briefing Ready',
      body: `${booking.user.name} submitted session prerequisites for your upcoming call.`,
      metadata: { bookingId: id },
    }).catch((err) => console.error('[booking] Intake notification error:', err.message));

    res.json({ success: true, booking: updated });
  } catch (e) {
    console.error('[booking] submitBookingIntake error:', e);
    res.status(500).json({ error: 'Failed to submit session intake answers.' });
  }
}

module.exports = { createBooking, verifyPayment, getMeetLink, rescheduleBooking, cancelBooking, submitBookingIntake };
