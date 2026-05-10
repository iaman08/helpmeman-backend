const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function createNotification({ userId, mentorId, type, title, body }) {
  try {
    return await prisma.notification.create({
      data: { userId, mentorId, type, title, body },
    });
  } catch (error) {
    console.error('Notification create error:', error);
    return null;
  }
}

async function getUserNotifications(userId, { page = 1, limit = 20 }) {
  const skip = (page - 1) * limit;
  const [notifications, total] = await Promise.all([
    prisma.notification.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      skip,
      take: limit,
    }),
    prisma.notification.count({ where: { userId } }),
  ]);

  return {
    notifications,
    total,
    page,
    totalPages: Math.ceil(total / limit),
    unreadCount: await prisma.notification.count({ where: { userId, isRead: false } }),
  };
}

async function getMentorNotifications(mentorId, { page = 1, limit = 20 }) {
  const skip = (page - 1) * limit;
  const [notifications, total] = await Promise.all([
    prisma.notification.findMany({
      where: { mentorId },
      orderBy: { createdAt: 'desc' },
      skip,
      take: limit,
    }),
    prisma.notification.count({ where: { mentorId } }),
  ]);

  return {
    notifications,
    total,
    page,
    totalPages: Math.ceil(total / limit),
    unreadCount: await prisma.notification.count({ where: { mentorId, isRead: false } }),
  };
}

async function markAsRead(notificationId) {
  return prisma.notification.update({
    where: { id: notificationId },
    data: { isRead: true },
  });
}

async function markAllReadForUser(userId) {
  return prisma.notification.updateMany({
    where: { userId, isRead: false },
    data: { isRead: true },
  });
}

module.exports = {
  createNotification,
  getUserNotifications,
  getMentorNotifications,
  markAsRead,
  markAllReadForUser,
};
