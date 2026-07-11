const prisma = require('../config/prisma');
const { sendNotification } = require('./notification.service');

function getMessageInclude() {
  return {
    include: {
      replyTo: {
        select: { id: true, body: true, senderId: true, senderRole: true }
      },
      reactions: {
        select: { id: true, userId: true, emoji: true }
      }
    }
  };
}

// ─── Thread create / get ─────────────────────────────────────────────────────
async function startOrGetThread(userId, mentorId) {
  const include = {
    messages: { orderBy: { createdAt: 'asc' } },
    user: { select: { id: true, name: true, username: true, email: true, avatar: true, role: true } },
    mentor: { select: { displayName: true, avatar: true, id: true, userId: true } },
  };

  let thread = await prisma.chatThread.findUnique({
    where: { userId_mentorId: { userId, mentorId } },
    include,
  });
  if (!thread) {
    try {
      thread = await prisma.chatThread.create({
        data: { userId, mentorId },
        include,
      });
      // Fire-and-forget notification asynchronously so it doesn't block thread creation
      sendNotification({
        mentorId,
        type: 'NEW_CHAT_THREAD',
        title: 'Someone wants to chat',
        body: 'A student has started a conversation with you.',
        sendEmail: false,
      }).catch(err => console.error('[CHAT] Notification async error:', err));
    } catch (e) {
      if (e.code === 'P2002') {
        thread = await prisma.chatThread.findUnique({
          where: { userId_mentorId: { userId, mentorId } },
          include,
        });
      } else {
        throw e;
      }
    }
  }
  return thread;
}

// ─── Send message ─────────────────────────────────────────────────────────────
async function sendMessage(threadId, senderId, senderRole, body, isRecipientOnline = false, { attachments, replyToId } = {}) {
  if (body && body.length > 2000) throw new Error('BODY_TOO_LONG');
  if (!body && (!attachments || attachments.length === 0)) throw new Error('EMPTY_MESSAGE');

  const thread = await prisma.chatThread.findUnique({ where: { id: threadId } });
  if (!thread) throw new Error('THREAD_NOT_FOUND');

  const isUser = senderRole === 'USER';

  // Lock and limit checks ONLY apply to user (student/mentee), not mentors
  if (isUser) {
    if (thread.status === 'CLOSED') {
      const err = new Error('THREAD_CLOSED'); err.status = 403; throw err;
    }
    if (thread.status === 'LOCKED' && thread.mentorMsgCount === 0) {
      const err = new Error('THREAD_LOCKED'); err.status = 403; throw err;
    }
    if (thread.userMsgCount >= 3 && thread.mentorMsgCount === 0) {
      const err = new Error('MESSAGE_LIMIT_REACHED'); err.status = 403; throw err;
    }
  }

  const messageData = { 
    threadId, 
    senderId, 
    senderRole, 
    body: body || '',
    status: 'SENT'
  };
  
  if (attachments) messageData.attachments = attachments;
  if (replyToId) {
    const parent = await prisma.chatMessage.findFirst({ where: { id: replyToId, threadId } });
    if (parent) messageData.replyToId = replyToId;
  }

  const countField = isUser ? 'userMsgCount' : 'mentorMsgCount';
  
  let statusToSet = thread.status;
  let isLockedForBookingToSet = thread.isLockedForBooking;

  if (isUser) {
    if (thread.userMsgCount + 1 >= 3 && thread.mentorMsgCount === 0) {
      statusToSet = 'LOCKED';
      isLockedForBookingToSet = true;
    }
  } else {
    // Mentor replies
    if (thread.status === 'LOCKED' || thread.mentorMsgCount === 0) {
      statusToSet = 'OPEN';
      isLockedForBookingToSet = false;
    }
  }

  const [message, updatedThread] = await prisma.$transaction([
    prisma.chatMessage.create({ data: messageData, ...getMessageInclude() }),
    prisma.chatThread.update({
      where: { id: threadId },
      data: {
        [countField]: { increment: 1 },
        status: statusToSet,
        isLockedForBooking: isLockedForBookingToSet,
        updatedAt: new Date(),
      },
    }),
  ]);

  const unreadCount = await prisma.chatMessage.count({ where: { threadId, senderId, isRead: false } });
  const preview = (body || (attachments?.[0]?.name ?? 'Attachment')).substring(0, 120);
  const emailBody = `You have ${unreadCount} unread message${unreadCount !== 1 ? 's' : ''}. Latest: "${preview}"`;

  if (isUser) {
    sendNotification({ mentorId: thread.mentorId, type: 'CHAT_MESSAGE', title: 'New message received', body: emailBody, sendEmail: !isRecipientOnline })
      .catch(err => console.error('[CHAT] Notification async error:', err));
  } else {
    sendNotification({ userId: thread.userId, type: 'CHAT_REPLY', title: 'Your mentor replied', body: emailBody, sendEmail: !isRecipientOnline })
      .catch(err => console.error('[CHAT] Notification async error:', err));
  }

  if (senderRole === 'MENTOR') {
    const { calculateAndCacheResponseTime } = require('./responseTime.service');
    calculateAndCacheResponseTime(thread.mentorId).catch(() => {});
  }

  return { message, thread: updatedThread };
}

// ─── Edit message (within 15 minutes) ────────────────────────────────────────
async function editMessage(messageId, senderId, newBody) {
  if (!newBody || newBody.length > 2000) throw new Error('INVALID_BODY');
  const msg = await prisma.chatMessage.findFirst({ where: { id: messageId, senderId } });
  if (!msg) { const e = new Error('NOT_FOUND'); e.status = 404; throw e; }
  const ageMs = Date.now() - new Date(msg.createdAt).getTime();
  if (ageMs > 15 * 60 * 1000) { const e = new Error('EDIT_WINDOW_EXPIRED'); e.status = 403; throw e; }

  const updateData = { body: newBody, editedAt: new Date() };

  return prisma.chatMessage.update({ where: { id: messageId }, data: updateData, ...getMessageInclude() });
}

// ─── Soft-delete message ──────────────────────────────────────────────────────
async function deleteMessage(messageId, senderId) {
  const msg = await prisma.chatMessage.findFirst({ where: { id: messageId, senderId } });
  if (!msg) { const e = new Error('NOT_FOUND'); e.status = 404; throw e; }

  // Clean up attachments in storage
  if (msg.attachments) {
    try {
      const { deleteFile } = require('./upload.service');
      // Handle prisma Json field parsed or raw string cases
      const attachments = typeof msg.attachments === 'string'
        ? JSON.parse(msg.attachments)
        : msg.attachments;
      if (Array.isArray(attachments)) {
        for (const att of attachments) {
          if (att.url) {
            await deleteFile(att.url);
          }
        }
      }
    } catch (err) {
      console.error('[CHAT DELETE] Failed to clean up attachments:', err.message);
    }
  }

  const updateData = { body: '', deletedAt: new Date(), attachments: null };
  return prisma.chatMessage.update({ where: { id: messageId }, data: updateData });
}


// ─── Paginated messages ───────────────────────────────────────────────────────
async function getThreadMessages(threadId, { cursor, limit = 40 } = {}) {
  const take = Math.min(Number(limit), 100);
  const messages = await prisma.chatMessage.findMany({
    where: { threadId },
    orderBy: { createdAt: 'desc' },
    take: take + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    ...getMessageInclude(),
  });
  const hasMore = messages.length > take;
  const items = hasMore ? messages.slice(0, take) : messages;
  return { messages: items.reverse(), hasMore, nextCursor: hasMore ? items[0]?.id : null };
}

// ─── Mark thread read ─────────────────────────────────────────────────────────
async function markThreadRead(threadId, userId) {
  const updateData = { isRead: true, status: 'READ' };
  const result = await prisma.chatMessage.updateMany({
    where: { threadId, senderId: { not: userId }, isRead: false },
    data: updateData,
  });
  return result.count;
}

// ─── Close thread ─────────────────────────────────────────────────────────────
async function closeThread(threadId) {
  return prisma.chatThread.update({ where: { id: threadId }, data: { status: 'CLOSED' } });
}

// ─── Message Reactions ────────────────────────────────────────────────────────
async function addReaction(messageId, userId, emoji) {
  const message = await prisma.chatMessage.findUnique({ where: { id: messageId } });
  if (!message) {
    const err = new Error('Message not found');
    err.status = 404;
    throw err;
  }
  if (message.deletedAt) {
    const err = new Error('Reactions not allowed on deleted messages');
    err.status = 403;
    throw err;
  }

  const existing = await prisma.messageReaction.findUnique({
    where: {
      messageId_userId: { messageId, userId }
    }
  });

  if (existing) {
    if (existing.emoji === emoji) {
      // Toggle off: remove reaction
      await prisma.messageReaction.delete({
        where: {
          messageId_userId: { messageId, userId }
        }
      });
      return { action: 'removed', reaction: existing };
    } else {
      // Update emoji
      const updated = await prisma.messageReaction.update({
        where: {
          messageId_userId: { messageId, userId }
        },
        data: { emoji }
      });
      return { action: 'updated', reaction: updated };
    }
  }

  // Create new reaction
  const created = await prisma.messageReaction.create({
    data: { messageId, userId, emoji }
  });
  return { action: 'added', reaction: created };
}

async function removeReaction(messageId, userId, emoji) {
  return prisma.messageReaction.deleteMany({
    where: { messageId, userId, emoji }
  });
}

module.exports = {
  startOrGetThread,
  sendMessage,
  editMessage,
  deleteMessage,
  getThreadMessages,
  markThreadRead,
  closeThread,
  addReaction,
  removeReaction,
};
