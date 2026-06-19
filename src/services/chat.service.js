const { PrismaClient } = require('@prisma/client');
const { sendNotification } = require('./notification.service');
const prisma = new PrismaClient();

async function startOrGetThread(userId, mentorId) {
  let thread = await prisma.chatThread.findUnique({
    where: { userId_mentorId: { userId, mentorId } },
    include: { messages: { orderBy: { createdAt: 'asc' } } },
  });
  if (!thread) {
    thread = await prisma.chatThread.create({
      data: { userId, mentorId },
      include: { messages: true },
    });
    await sendNotification({
      mentorId,
      type: 'NEW_CHAT_THREAD',
      title: 'Someone wants to chat',
      body: 'A student has started a conversation with you.',
    });
  }
  return thread;
}

async function sendMessage(threadId, senderId, senderRole, body) {
  if (body.length > 500) throw new Error('BODY_TOO_LONG');
  const thread = await prisma.chatThread.findUnique({ where: { id: threadId } });
  if (!thread) throw new Error('THREAD_NOT_FOUND');
  if (thread.status === 'LOCKED' || thread.status === 'CLOSED') {
    const err = new Error('THREAD_LOCKED'); err.status = 403; throw err;
  }
  const isUser = senderRole === 'USER';
  const countField = isUser ? 'userMsgCount' : 'mentorMsgCount';
  if (thread[countField] >= 3) {
    const err = new Error('MESSAGE_LIMIT_REACHED'); err.status = 403; throw err;
  }
  const [message, updatedThread] = await prisma.$transaction([
    prisma.chatMessage.create({ data: { threadId, senderId, senderRole, body } }),
    prisma.chatThread.update({
      where: { id: threadId },
      data: {
        [countField]: { increment: 1 },
        status: thread[countField] + 1 >= 3 ? 'LOCKED' : thread.status,
        isLockedForBooking: thread[countField] + 1 >= 3 ? true : thread.isLockedForBooking,
      },
    }),
  ]);
  if (isUser) {
    await sendNotification({
      mentorId: thread.mentorId,
      type: 'CHAT_MESSAGE',
      title: 'New message received',
      body: body.substring(0, 120),
    });
  } else {
    await sendNotification({
      userId: thread.userId,
      type: 'CHAT_REPLY',
      title: 'Your mentor replied',
      body: body.substring(0, 120),
    });
  }
  return { message, thread: updatedThread };
}

async function getThreadMessages(threadId) {
  return prisma.chatMessage.findMany({ where: { threadId }, orderBy: { createdAt: 'asc' } });
}

async function markThreadRead(threadId, userId) {
  return prisma.chatMessage.updateMany({
    where: { threadId, senderId: { not: userId }, isRead: false },
    data: { isRead: true },
  });
}

async function closeThread(threadId) {
  return prisma.chatThread.update({ where: { id: threadId }, data: { status: 'CLOSED' } });
}

module.exports = { startOrGetThread, sendMessage, getThreadMessages, markThreadRead, closeThread };
