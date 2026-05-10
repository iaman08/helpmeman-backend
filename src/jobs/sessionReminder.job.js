// Session reminder job using BullMQ
// Requires Redis running. Falls back gracefully if unavailable.

let Queue, Worker;

try {
  const bullmq = require('bullmq');
  Queue = bullmq.Queue;
  Worker = bullmq.Worker;
} catch (e) {
  console.warn('BullMQ not available, session reminders disabled');
}

const { PrismaClient } = require('@prisma/client');
const { sendEmail, sessionReminderTemplate } = require('../services/email.service');
const { createNotification } = require('../services/notification.service');

const prisma = new PrismaClient();

let reminderQueue = null;

function initReminderQueue(redisUrl) {
  if (!Queue) return;
  try {
    const IORedis = require('ioredis');
    const connection = new IORedis(redisUrl, {
      maxRetriesPerRequest: null,
      retryStrategy: () => null // don't retry on failure
    });
    
    connection.on('error', () => {
      // silently ignore connection errors during the test phase
    });

    connection.on('end', () => {
      console.warn('Redis not available. Session reminders disabled.');
    });

    connection.on('ready', () => {
      reminderQueue = new Queue('session-reminders', { connection });

      const worker = new Worker('session-reminders', async (job) => {
        const booking = await prisma.booking.findUnique({
          where: { id: job.data.bookingId },
          include: { user: true, mentor: { include: { user: true } } },
        });
        if (booking?.status === 'CONFIRMED') {
          await sendEmail({ to: booking.user.email, subject: 'Session in 1 hour — HelpMeMan', html: sessionReminderTemplate(booking.user, booking) });
          await sendEmail({ to: booking.mentor.user.email, subject: 'Session in 1 hour — HelpMeMan', html: sessionReminderTemplate(booking.mentor.user, booking) });
          await createNotification({ userId: booking.userId, type: 'SESSION_REMINDER', title: 'Session in 1 hour', body: 'Your session starts soon!' });
          await createNotification({ mentorId: booking.mentorId, type: 'SESSION_REMINDER', title: 'Session in 1 hour', body: 'Your session starts soon!' });
        }
      }, { connection });

      worker.on('error', err => {
        if (err.code !== 'ECONNREFUSED') console.error('BullMQ worker error:', err);
      });

      console.log('Session reminder queue initialized');
    });

  } catch (e) {
    console.warn('Redis not available, session reminders disabled:', e.message);
  }
}

async function scheduleSessionReminder(booking) {
  if (!reminderQueue) return;
  const fireAt = new Date(new Date(booking.scheduledAt).getTime() - 60 * 60 * 1000);
  const delay = fireAt.getTime() - Date.now();
  if (delay > 0) {
    await reminderQueue.add('remind', { bookingId: booking.id }, { delay });
  }
}

module.exports = { initReminderQueue, scheduleSessionReminder };
