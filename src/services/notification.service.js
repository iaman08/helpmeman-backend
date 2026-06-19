const { PrismaClient } = require('@prisma/client');
const { sendNotificationEmail } = require('./email.service');
const { sendPushToUser } = require('./fcm.service');
const { actionUrlForType } = require('../emails/notificationEmail');
const config = require('../config/env');

const prisma = new PrismaClient();

const MESSAGE_TYPES = new Set(['CHAT_MESSAGE', 'CHAT_REPLY', 'NEW_CHAT_THREAD']);
const MENTOR_TYPES = new Set(['MENTOR_APPROVED', 'MENTOR_REJECTED']);
const MARKETING_TYPES = new Set(['MARKETING', 'WEEKLY_UPDATE', 'PLATFORM_ANNOUNCEMENT']);
const ACCOUNT_TYPES = new Set(['ACCOUNT_UPDATE', 'SECURITY_ALERT', 'BOOKING_CONFIRMED', 'BOOKING_RESCHEDULED', 'SESSION_REMINDER']);

async function getOrCreatePreferences(userId) {
  return prisma.userNotificationPreference.upsert({
    where: { userId },
    create: { userId },
    update: {},
  });
}

function shouldSendEmail(prefs, type) {
  if (!prefs.emailNotifications) return false;
  if (MARKETING_TYPES.has(type)) return prefs.marketingEmails;
  if (MESSAGE_TYPES.has(type)) return prefs.messages;
  if (MENTOR_TYPES.has(type)) return prefs.mentorUpdates;
  if (ACCOUNT_TYPES.has(type)) return prefs.accountUpdates;
  return true;
}

function shouldSendPush(prefs, type) {
  if (!prefs.pushNotifications) return false;
  if (MARKETING_TYPES.has(type)) return prefs.marketingEmails;
  if (MESSAGE_TYPES.has(type)) return prefs.messages;
  if (MENTOR_TYPES.has(type)) return prefs.mentorUpdates;
  if (ACCOUNT_TYPES.has(type)) return prefs.accountUpdates;
  return true;
}

async function resolveTargetUser({ userId, mentorId }) {
  if (userId) {
    return prisma.user.findUnique({ where: { id: userId }, select: { id: true, name: true, email: true } });
  }
  if (mentorId) {
    const mentor = await prisma.mentor.findUnique({
      where: { id: mentorId },
      select: { userId: true, user: { select: { id: true, name: true, email: true } } },
    });
    return mentor?.user || null;
  }
  return null;
}

async function sendNotification({
  userId,
  mentorId,
  title,
  body,
  type,
  sendEmail = true,
  sendPush = true,
  metadata = null,
  queue = false,
}) {
  if (queue && config.nodeEnv === 'production') {
    const { enqueueNotification } = require('./notificationQueue.service');
    return enqueueNotification({ userId, mentorId, title, body, type, sendEmail, sendPush, metadata });
  }

  const targetUser = await resolveTargetUser({ userId, mentorId });
  const prefs = targetUser ? await getOrCreatePreferences(targetUser.id) : null;

  let notification;
  try {
    notification = await prisma.notification.create({
      data: {
        userId: userId || null,
        mentorId: mentorId || null,
        type,
        title,
        body,
        metadata,
        emailSent: false,
        pushSent: false,
      },
    });
  } catch (error) {
    console.error('Notification create error:', error);
    return { notification: null, delivery: { email: null, push: null }, error: error.message };
  }

  const delivery = { email: null, push: null };

  if (targetUser && sendEmail && prefs && shouldSendEmail(prefs, type)) {
    try {
      delivery.email = await sendNotificationEmail({
        user: targetUser,
        title,
        body,
        type,
        notificationId: notification.id,
      });
      if (delivery.email?.success) {
        await prisma.notification.update({
          where: { id: notification.id },
          data: { emailSent: true },
        });
      }
    } catch (error) {
      console.error('Notification email error:', error.message);
      delivery.email = { success: false, error: error.message };
    }
  }

  if (targetUser && sendPush && prefs && shouldSendPush(prefs, type)) {
    try {
      delivery.push = await sendPushToUser(targetUser.id, {
        title,
        body,
        data: {
          notificationId: notification.id,
          type,
          link: actionUrlForType(type),
        },
      });
      if (delivery.push.sent > 0) {
        await prisma.notification.update({
          where: { id: notification.id },
          data: { pushSent: true },
        });
      }
    } catch (error) {
      console.error('Notification push error:', error.message);
      delivery.push = { sent: 0, failed: 0, error: error.message };
    }
  }

  return { notification, delivery };
}

async function createNotification(payload) {
  const { notification } = await sendNotification({ ...payload, sendEmail: false, sendPush: false });
  return notification;
}

async function getUserNotifications(userId, { page = 1, limit = 20, type }) {
  const skip = (Number(page) - 1) * Number(limit);
  const mentor = await prisma.mentor.findUnique({ where: { userId }, select: { id: true } });
  const or = [{ userId }];
  if (mentor) or.push({ mentorId: mentor.id });

  const where = { OR: or };
  if (type) where.type = type;

  const unreadWhere = { OR: or, isRead: false };

  const [notifications, total, unreadCount] = await Promise.all([
    prisma.notification.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip,
      take: Number(limit),
    }),
    prisma.notification.count({ where }),
    prisma.notification.count({ where: unreadWhere }),
  ]);

  return {
    notifications,
    total,
    page: Number(page),
    totalPages: Math.ceil(total / Number(limit)),
    unreadCount,
  };
}

async function getMentorNotifications(mentorId, { page = 1, limit = 20, type }) {
  const skip = (Number(page) - 1) * Number(limit);
  const where = { mentorId };
  if (type) where.type = type;

  const [notifications, total, unreadCount] = await Promise.all([
    prisma.notification.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip,
      take: Number(limit),
    }),
    prisma.notification.count({ where }),
    prisma.notification.count({ where: { mentorId, isRead: false } }),
  ]);

  return {
    notifications,
    total,
    page: Number(page),
    totalPages: Math.ceil(total / Number(limit)),
    unreadCount,
  };
}

async function markAsRead(notificationId, userId) {
  const notification = await prisma.notification.findFirst({
    where: {
      id: notificationId,
      OR: [{ userId }, { mentor: { userId } }],
    },
  });
  if (!notification) return null;
  return prisma.notification.update({
    where: { id: notificationId },
    data: { isRead: true },
  });
}

async function markAllReadForUser(userId) {
  const mentor = await prisma.mentor.findUnique({ where: { userId }, select: { id: true } });
  const or = [{ userId }];
  if (mentor) or.push({ mentorId: mentor.id });

  return prisma.notification.updateMany({
    where: { OR: or, isRead: false },
    data: { isRead: true },
  });
}

async function deleteNotification(notificationId, userId) {
  const notification = await prisma.notification.findFirst({
    where: {
      id: notificationId,
      OR: [{ userId }, { mentor: { userId } }],
    },
  });
  if (!notification) return null;
  return prisma.notification.delete({ where: { id: notificationId } });
}

async function getNotificationAnalytics(userId) {
  const mentor = await prisma.mentor.findUnique({ where: { userId }, select: { id: true } });
  const or = [{ userId }];
  if (mentor) or.push({ mentorId: mentor.id });
  const where = { OR: or };

  const [total, unread, emailSent, pushSent, byType, emailStats] = await Promise.all([
    prisma.notification.count({ where }),
    prisma.notification.count({ where: { ...where, isRead: false } }),
    prisma.notification.count({ where: { ...where, emailSent: true } }),
    prisma.notification.count({ where: { ...where, pushSent: true } }),
    prisma.notification.groupBy({
      by: ['type'],
      where,
      _count: { _all: true },
    }),
    prisma.emailDeliveryLog.groupBy({
      by: ['status'],
      where: { userId },
      _count: { _all: true },
    }),
  ]);

  return {
    total,
    unread,
    emailSent,
    pushSent,
    byType: byType.map((row) => ({ type: row.type, count: row._count._all })),
    emailDelivery: emailStats.map((row) => ({ status: row.status, count: row._count._all })),
  };
}

async function registerDevice(userId, fcmToken, deviceType = 'web') {
  return prisma.userDevice.upsert({
    where: { fcmToken },
    create: { userId, fcmToken, deviceType },
    update: { userId, deviceType, lastActive: new Date() },
  });
}

async function removeDevice(userId, fcmToken) {
  return prisma.userDevice.deleteMany({ where: { userId, fcmToken } });
}

async function updatePreferences(userId, data) {
  await getOrCreatePreferences(userId);
  return prisma.userNotificationPreference.update({
    where: { userId },
    data,
  });
}

async function getPreferences(userId) {
  return getOrCreatePreferences(userId);
}

module.exports = {
  sendNotification,
  createNotification,
  getUserNotifications,
  getMentorNotifications,
  markAsRead,
  markAllReadForUser,
  deleteNotification,
  getNotificationAnalytics,
  registerDevice,
  removeDevice,
  updatePreferences,
  getPreferences,
  getOrCreatePreferences,
};
