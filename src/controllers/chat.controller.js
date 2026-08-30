const prisma = require('../config/prisma');
const {
  startOrGetThread,
  sendMessage,
  editMessage,
  deleteMessage,
  getThreadMessages,
  markThreadRead,
  closeThread,
  addReaction,
  removeReaction,
} = require('../services/chat.service');

// ─── Helper: emit over socket if available ────────────────────────────────────
function emitTo(req, room, event, data) {
  if (req.app.io) req.app.io.to(room).emit(event, data);
}

// ─── Helper: check thread access authorization ──────────────────────────────
async function checkThreadAccess(threadId, user) {
  const thread = await prisma.chatThread.findUnique({
    where: { id: threadId },
    include: { mentor: { select: { userId: true } } },
  });
  if (!thread) return { error: 'Thread not found', status: 404 };

  const authorized =
    thread.userId === user.id ||
    thread.mentor?.userId === user.id ||
    user.role === 'ADMIN' ||
    user.role === 'SUPER_ADMIN';

  if (!authorized) return { error: 'Forbidden', status: 403 };
  return { thread };
}

// ─── Thread includes for list vs single view ──────────────────────────────────
const THREAD_LIST_INCLUDE = {
  messages: {
    orderBy: { createdAt: 'desc' },
    take: 1,
  },
  user: { select: { id: true, name: true, username: true, email: true, avatar: true, role: true } },
  mentor: { select: { displayName: true, avatar: true, id: true, userId: true } },
};

// ─── POST /chat/threads ───────────────────────────────────────────────────────
async function createThread(req, res) {
  try {
    const { mentorId } = req.body;
    if (!mentorId) return res.status(400).json({ error: 'mentorId required' });
    const mentor = await prisma.mentor.findFirst({ where: { id: mentorId, isActive: true } });
    if (!mentor) return res.status(404).json({ error: 'Mentor not found' });
    const thread = await startOrGetThread(req.user.id, mentorId);
    res.json({ thread });
  } catch (e) {
    console.error('[CHAT] createThread error:', e);
    res.status(500).json({ error: 'Failed to start thread' });
  }
}

// ─── GET /chat/threads ────────────────────────────────────────────────────────
async function listThreads(req, res) {
  try {
    const where = req.user.role === 'MENTOR'
      ? { mentor: { userId: req.user.id } }
      : { userId: req.user.id };

    const threads = await prisma.chatThread.findMany({
      where,
      include: THREAD_LIST_INCLUDE,
      orderBy: { updatedAt: 'desc' },
    });

    // Batch unread count
    const unreadCounts = await prisma.chatMessage.groupBy({
      by: ['threadId'],
      where: {
        threadId: { in: threads.map(t => t.id) },
        senderId: { not: req.user.id },
        isRead: false,
      },
      _count: { _all: true },
    });
    const unreadMap = Object.fromEntries(unreadCounts.map(r => [r.threadId, r._count._all]));

    const threadsWithUnread = threads.map(t => ({
      ...t,
      unreadCount: unreadMap[t.id] ?? 0,
    }));

    res.json({ threads: threadsWithUnread });
  } catch (e) {
    console.error('[CHAT] listThreads error:', e);
    res.status(500).json({ error: 'Failed to list threads' });
  }
}

// ─── GET /chat/threads/:threadId ──────────────────────────────────────────────
async function getThread(req, res) {
  try {
    const thread = await prisma.chatThread.findUnique({
      where: { id: req.params.threadId },
      include: {
        user: { select: { id: true, name: true, username: true, email: true, avatar: true, role: true, presenceStatus: true, lastSeen: true } },
        mentor: { select: { displayName: true, avatar: true, id: true, userId: true } },
        messages: { orderBy: { createdAt: 'asc' } },
      },
    });
    if (!thread) return res.status(404).json({ error: 'Thread not found' });

    // Authorization check
    const authorized =
      thread.userId === req.user.id ||
      thread.mentor?.userId === req.user.id ||
      req.user.role === 'ADMIN' ||
      req.user.role === 'SUPER_ADMIN';
    if (!authorized) return res.status(403).json({ error: 'Forbidden' });

    res.json({ thread });
  } catch (e) {
    console.error('[CHAT] getThread error:', e);
    res.status(500).json({ error: 'Failed' });
  }
}

// ─── GET /chat/threads/:threadId/messages ────────────────────────────────────
async function getMessages(req, res) {
  try {
    const access = await checkThreadAccess(req.params.threadId, req.user);
    if (access.error) return res.status(access.status).json({ error: access.error });

    const { cursor, limit = 40 } = req.query;
    const result = await getThreadMessages(req.params.threadId, { cursor, limit: Number(limit) });
    res.json(result);
  } catch (e) {
    console.error('[CHAT] getMessages error:', e);
    res.status(500).json({ error: 'Failed' });
  }
}

// ─── POST /chat/threads/:threadId/messages ────────────────────────────────────
async function postMessage(req, res) {
  try {
    const { body, attachments, replyToId } = req.body;

    // Validate: must have body or attachments
    if (!body && (!attachments || attachments.length === 0)) {
      return res.status(400).json({ error: 'Message body or attachment required' });
    }
    if (body && body.length > 2000) {
      return res.status(400).json({ error: 'Message must be ≤2000 characters' });
    }

    const thread = await prisma.chatThread.findUnique({
      where: { id: req.params.threadId },
      include: { mentor: { select: { userId: true } } },
    });
    if (!thread) return res.status(404).json({ error: 'Thread not found' });

    // Authorization check
    const isMentor = req.user.role === 'MENTOR';
    const authorized = isMentor
      ? thread.mentor?.userId === req.user.id
      : thread.userId === req.user.id;
    if (!authorized) return res.status(403).json({ error: 'Forbidden' });

    const recipientUserId = isMentor ? thread.userId : thread.mentor?.userId;
    const isRecipientOnline = req.app.io?.onlineUsers?.has(recipientUserId) || false;

    const senderRole = isMentor ? 'MENTOR' : 'USER';
    const result = await sendMessage(
      req.params.threadId,
      req.user.id,
      senderRole,
      body || '',
      isRecipientOnline,
      { attachments, replyToId }
    );

    const msgPayload = {
      id: result.message.id,
      threadId: req.params.threadId,
      body: result.message.body,
      senderRole: result.message.senderRole,
      senderId: result.message.senderId,
      status: result.message.status,
      replyToId: result.message.replyToId,
      replyTo: result.message.replyTo,
      attachments: result.message.attachments,
      editedAt: result.message.editedAt,
      deletedAt: result.message.deletedAt,
      createdAt: result.message.createdAt,
      threadStatus: result.thread.status,
      userMsgCount: result.thread.userMsgCount,
      mentorMsgCount: result.thread.mentorMsgCount,
    };

    // Emit to thread room — sender's socket will dedup by tempId
    emitTo(req, `chat:${req.params.threadId}`, 'new_message', msgPayload);

    // Emit to both recipient's and sender's personal rooms for multi-device sync
    if (recipientUserId) {
      emitTo(req, `user:${recipientUserId}`, 'new_message_notification', {
        threadId: req.params.threadId,
        message: msgPayload,
      });
    }
    emitTo(req, `user:${req.user.id}`, 'new_message_notification', {
      threadId: req.params.threadId,
      message: msgPayload,
    });

    if (result.thread.status === 'LOCKED') {
      emitTo(req, `chat:${req.params.threadId}`, 'thread_locked', {
        threadId: req.params.threadId,
        reason: 'MESSAGE_LIMIT_REACHED',
      });
    } else if (thread.status === 'LOCKED' && result.thread.status === 'OPEN') {
      emitTo(req, `chat:${req.params.threadId}`, 'thread_unlocked', {
        threadId: req.params.threadId,
      });
    }

    res.json(result);
  } catch (e) {
    if (e.status === 403) return res.status(403).json({ error: e.message, locked: true });
    console.error('[CHAT] postMessage error:', e);
    res.status(500).json({ error: 'Failed to send message' });
  }
}

// ─── PATCH /chat/threads/:threadId/messages/:messageId ───────────────────────
async function editMessageHandler(req, res) {
  try {
    const { body } = req.body;
    if (!body || !body.trim()) return res.status(400).json({ error: 'Body required' });

    const access = await checkThreadAccess(req.params.threadId, req.user);
    if (access.error) return res.status(access.status).json({ error: access.error });

    const message = await prisma.chatMessage.findUnique({ where: { id: req.params.messageId } });
    if (!message || message.threadId !== req.params.threadId) {
      return res.status(400).json({ error: 'Message not found in this thread' });
    }

    const updated = await editMessage(req.params.messageId, req.user.id, body.trim());

    emitTo(req, `chat:${req.params.threadId}`, 'message_edited', {
      threadId: req.params.threadId,
      messageId: updated.id,
      body: updated.body,
      editedAt: updated.editedAt,
    });

    res.json({ message: updated });
  } catch (e) {
    if (e.status === 404) return res.status(404).json({ error: 'Message not found' });
    if (e.status === 403) return res.status(403).json({ error: e.message });
    console.error('[CHAT] editMessage error:', e);
    res.status(500).json({ error: 'Failed to edit message' });
  }
}

// ─── DELETE /chat/threads/:threadId/messages/:messageId ──────────────────────
async function deleteMessageHandler(req, res) {
  try {
    const access = await checkThreadAccess(req.params.threadId, req.user);
    if (access.error) return res.status(access.status).json({ error: access.error });

    const message = await prisma.chatMessage.findUnique({ where: { id: req.params.messageId } });
    if (!message || message.threadId !== req.params.threadId) {
      return res.status(400).json({ error: 'Message not found in this thread' });
    }

    await deleteMessage(req.params.messageId, req.user.id);

    emitTo(req, `chat:${req.params.threadId}`, 'message_deleted', {
      threadId: req.params.threadId,
      messageId: req.params.messageId,
    });

    res.json({ success: true });
  } catch (e) {
    if (e.status === 404) return res.status(404).json({ error: 'Message not found' });
    console.error('[CHAT] deleteMessage error:', e);
    res.status(500).json({ error: 'Failed to delete message' });
  }
}

// ─── PUT /chat/threads/:threadId/read ────────────────────────────────────────
async function markRead(req, res) {
  try {
    const access = await checkThreadAccess(req.params.threadId, req.user);
    if (access.error) return res.status(access.status).json({ error: access.error });

    const count = await markThreadRead(req.params.threadId, req.user.id);

    // Notify sender(s) that messages have been read (for read receipts)
    if (count > 0) {
      emitTo(req, `chat:${req.params.threadId}`, 'messages_read', {
        threadId: req.params.threadId,
        readBy: req.user.id,
      });
    }

    res.json({ message: 'Marked as read', count });
  } catch (e) {
    console.error('[CHAT] markRead error:', e);
    res.status(500).json({ error: 'Failed' });
  }
}

// ─── POST /chat/threads/:threadId/close ──────────────────────────────────────
async function closeThreadHandler(req, res) {
  try {
    const access = await checkThreadAccess(req.params.threadId, req.user);
    if (access.error) return res.status(access.status).json({ error: access.error });

    const thread = await closeThread(req.params.threadId);
    emitTo(req, `chat:${req.params.threadId}`, 'thread_locked', {
      threadId: req.params.threadId,
      reason: 'CLOSED',
    });
    res.json({ thread });
  } catch (e) {
    console.error('[CHAT] closeThread error:', e);
    res.status(500).json({ error: 'Failed' });
  }
}

async function addReactionHandler(req, res) {
  try {
    const { emoji } = req.body;
    if (!emoji) return res.status(400).json({ error: 'Emoji is required' });

    const access = await checkThreadAccess(req.params.threadId, req.user);
    if (access.error) return res.status(access.status).json({ error: access.error });

    const message = await prisma.chatMessage.findUnique({ where: { id: req.params.messageId } });
    if (!message || message.threadId !== req.params.threadId) {
      return res.status(400).json({ error: 'Message not found in this thread' });
    }

    const result = await addReaction(req.params.messageId, req.user.id, emoji);
    
    if (result.action === 'removed') {
      emitTo(req, `chat:${req.params.threadId}`, 'reaction_removed', {
        threadId: req.params.threadId,
        messageId: req.params.messageId,
        userId: req.user.id,
        emoji,
      });
    } else {
      emitTo(req, `chat:${req.params.threadId}`, 'reaction_added', {
        threadId: req.params.threadId,
        messageId: req.params.messageId,
        reaction: result.reaction,
        action: result.action,
      });
    }
    res.json({ success: true, ...result });
  } catch (e) {
    if (e.status === 404) return res.status(404).json({ error: 'Message not found' });
    if (e.status === 403) return res.status(403).json({ error: e.message });
    console.error('[CHAT] addReaction error:', e);
    res.status(500).json({ error: 'Failed to add reaction' });
  }
}

async function removeReactionHandler(req, res) {
  try {
    const { emoji } = req.params;

    const access = await checkThreadAccess(req.params.threadId, req.user);
    if (access.error) return res.status(access.status).json({ error: access.error });

    const message = await prisma.chatMessage.findUnique({ where: { id: req.params.messageId } });
    if (!message || message.threadId !== req.params.threadId) {
      return res.status(400).json({ error: 'Message not found in this thread' });
    }

    await removeReaction(req.params.messageId, req.user.id, emoji);
    emitTo(req, `chat:${req.params.threadId}`, 'reaction_removed', {
      threadId: req.params.threadId,
      messageId: req.params.messageId,
      userId: req.user.id,
      emoji,
    });
    res.json({ success: true });
  } catch (e) {
    console.error('[CHAT] removeReaction error:', e);
    res.status(500).json({ error: 'Failed to remove reaction' });
  }
}

async function getUnreadCount(req, res) {
  try {
    const isMentor = req.user.role === 'MENTOR';
    const where = isMentor
      ? { mentor: { userId: req.user.id } }
      : { userId: req.user.id };

    const threads = await prisma.chatThread.findMany({
      where,
      select: { id: true }
    });

    const threadIds = threads.map(t => t.id);
    if (threadIds.length === 0) {
      return res.json({ unreadCount: 0 });
    }

    const unreadCount = await prisma.chatMessage.count({
      where: {
        threadId: { in: threadIds },
        senderId: { not: req.user.id },
        isRead: false,
      },
    });

    res.json({ unreadCount });
  } catch (e) {
    console.error('[CHAT] getUnreadCount error:', e);
    res.status(500).json({ error: 'Failed to get unread count' });
  }
}

module.exports = {
  createThread,
  listThreads,
  getThread,
  getMessages,
  postMessage,
  editMessageHandler,
  deleteMessageHandler,
  markRead,
  closeThreadHandler,
  addReactionHandler,
  removeReactionHandler,
  getUnreadCount,
};
