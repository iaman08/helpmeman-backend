const { PrismaClient } = require('@prisma/client');
const { startOrGetThread, sendMessage, getThreadMessages, markThreadRead, closeThread } = require('../services/chat.service');
const prisma = new PrismaClient();

async function createThread(req, res) {
  try {
    const { mentorId } = req.body;
    const mentor = await prisma.mentor.findFirst({ where: { id: mentorId, isActive: true } });
    if (!mentor) return res.status(404).json({ error: 'Mentor not found' });
    const thread = await startOrGetThread(req.user.id, mentorId);
    res.json({ thread });
  } catch (e) { console.error(e); res.status(500).json({ error: 'Failed to start thread' }); }
}

async function listThreads(req, res) {
  try {
    const where = req.user.role === 'MENTOR'
      ? { mentor: { userId: req.user.id } }
      : { userId: req.user.id };

    const threads = await prisma.chatThread.findMany({
      where,
      include: {
        messages: { orderBy: { createdAt: 'desc' }, take: 1 },
        user: { select: { name: true, avatar: true } },
        mentor: { select: { displayName: true, avatar: true } },
      },
      orderBy: { updatedAt: 'desc' },
    });

    // Add unread count
    const threadsWithUnread = await Promise.all(threads.map(async (t) => {
      const unread = await prisma.chatMessage.count({
        where: { threadId: t.id, senderId: { not: req.user.id }, isRead: false },
      });
      return { ...t, unreadCount: unread };
    }));

    res.json({ threads: threadsWithUnread });
  } catch (e) { console.error(e); res.status(500).json({ error: 'Failed' }); }
}

async function getThread(req, res) {
  try {
    const thread = await prisma.chatThread.findUnique({
      where: { id: req.params.threadId },
      include: { messages: { orderBy: { createdAt: 'asc' } }, user: { select: { name: true, avatar: true } }, mentor: { select: { displayName: true, avatar: true, id: true } } },
    });
    if (!thread) return res.status(404).json({ error: 'Thread not found' });
    res.json({ thread });
  } catch (e) { res.status(500).json({ error: 'Failed' }); }
}

async function postMessage(req, res) {
  try {
    const { body } = req.body;
    if (!body || body.length > 500) return res.status(400).json({ error: 'Message must be 1-500 chars' });

    const senderRole = req.user.role === 'MENTOR' ? 'MENTOR' : 'USER';
    const result = await sendMessage(req.params.threadId, req.user.id, senderRole, body);

    // Emit via Socket.io if available
    if (req.app.io) {
      req.app.io.to(`chat:${req.params.threadId}`).emit('new_message', {
        id: result.message.id, body: result.message.body, senderRole: result.message.senderRole,
        senderId: result.message.senderId, createdAt: result.message.createdAt,
        threadStatus: result.thread.status, userMsgCount: result.thread.userMsgCount, mentorMsgCount: result.thread.mentorMsgCount,
      });
      if (result.thread.status === 'LOCKED') {
        req.app.io.to(`chat:${req.params.threadId}`).emit('thread_locked', { threadId: req.params.threadId, reason: 'MESSAGE_LIMIT_REACHED' });
      }
    }

    res.json(result);
  } catch (e) {
    if (e.status === 403) return res.status(403).json({ error: e.message, locked: true });
    console.error(e); res.status(500).json({ error: 'Failed to send message' });
  }
}

async function markRead(req, res) {
  try {
    await markThreadRead(req.params.threadId, req.user.id);
    res.json({ message: 'Marked as read' });
  } catch (e) { res.status(500).json({ error: 'Failed' }); }
}

async function closeThreadHandler(req, res) {
  try {
    const thread = await closeThread(req.params.threadId);
    res.json({ thread });
  } catch (e) { res.status(500).json({ error: 'Failed' }); }
}

module.exports = { createThread, listThreads, getThread, postMessage, markRead, closeThreadHandler };
