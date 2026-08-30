const prisma = require('../config/prisma');
const authService = require('../services/auth.service');
const { updateUserPresence } = require('../services/presence.service');

// Per-thread typing timeout handles (clears if user stops sending events)
const typingTimers = new Map(); // key: `${threadId}:${userId}`

function setupChatSocket(io) {
  io.onlineUsers = io.onlineUsers || new Set();

  // ── Authentication middleware ───────────────────────────────────────────────
  io.use(async (socket, next) => {
    const token =
      socket.handshake.auth?.token ||
      socket.handshake.headers?.authorization?.split(' ')[1];
    if (!token) return next(new Error('Authentication required'));
    try {
      const user = await authService.verifySession(token);
      socket.userId = user.id;
      socket.userRole = user.role;
      next();
    } catch (e) {
      console.error('[SOCKET] Auth error:', e.message);
      next(new Error('Invalid token'));
    }
  });

  io.on('connection', (socket) => {
    const { userId } = socket;
    io.onlineUsers.add(userId);
    socket.join(`user:${userId}`);
    console.log(`[SOCKET] Connected: ${userId} (${socket.id})`);

    // Mark ONLINE immediately
    updateUserPresence(userId, 'ONLINE').catch(() => {});

    // Broadcast presence to all connected clients
    io.emit('presence_update', { userId, status: 'ONLINE' });

    // ── Activity heartbeat from client ──────────────────────────────────────
    socket.on('user_activity', () => {
      updateUserPresence(userId).catch(() => {});
    });

    // ── Join a thread room (with IDOR protection) ───────────────────────────
    socket.on('join_thread', async ({ threadId }) => {
      if (!threadId) return;
      try {
        const thread = await prisma.chatThread.findUnique({
          where: { id: threadId },
          include: { mentor: { select: { userId: true } } },
        });
        if (!thread) return;

        const isAuthorized =
          thread.userId === userId ||
          thread.mentor?.userId === userId ||
          socket.userRole === 'ADMIN' ||
          socket.userRole === 'SUPER_ADMIN';

        if (!isAuthorized) {
          console.warn(`[SOCKET] Unauthorized join_thread attempt by ${userId} for thread ${threadId}`);
          socket.emit('error', { message: 'Unauthorized thread access' });
          return;
        }

        socket.join(`chat:${threadId}`);
        console.log(`[SOCKET] ${userId} joined chat:${threadId}`);
      } catch (err) {
        console.error('[SOCKET] join_thread validation error:', err.message);
      }
    });

    // ── Leave a thread room ─────────────────────────────────────────────────
    socket.on('leave_thread', ({ threadId }) => {
      if (!threadId) return;
      socket.leave(`chat:${threadId}`);
      clearTypingTimer(userId, threadId);
      socket.to(`chat:${threadId}`).emit('user_stop_typing', { userId });
    });

    // ── Typing indicator ────────────────────────────────────────────────────
    socket.on('typing', ({ threadId }) => {
      if (!threadId) return;
      // Broadcast to others in the room (not back to sender)
      socket.to(`chat:${threadId}`).emit('user_typing', { userId });
      // Auto-stop after 4s of inactivity
      resetTypingTimer(io, userId, threadId);
    });

    socket.on('stop_typing', ({ threadId }) => {
      if (!threadId) return;
      clearTypingTimer(userId, threadId);
      socket.to(`chat:${threadId}`).emit('user_stop_typing', { userId });
    });

    // ── Delivery acknowledgment ─────────────────────────────────────────────
    // Client sends this when it receives a message while in the thread room
    socket.on('message_delivered', ({ threadId, messageId }) => {
      if (!threadId || !messageId) return;
      // Notify the thread that the message was delivered (to update sender's UI)
      socket.to(`chat:${threadId}`).emit('message_status_update', {
        messageId,
        status: 'DELIVERED',
      });
    });

    // ── Disconnect ──────────────────────────────────────────────────────────
    socket.on('disconnect', () => {
      // Check if this user has any other active sockets
      const activeSockets = io.sockets.adapter.rooms.get(`user:${userId}`);
      const remainingCount = activeSockets ? activeSockets.size : 0;

      if (remainingCount === 0) {
        io.onlineUsers.delete(userId);
        console.log(`[SOCKET] Fully disconnected: ${userId}`);
        updateUserPresence(userId, 'OFFLINE').catch(() => {});
        io.emit('presence_update', { userId, status: 'OFFLINE' });

        // Clear all typing timers for this user
        for (const [key] of typingTimers) {
          if (key.endsWith(`:${userId}`)) {
            const threadId = key.split(':')[0];
            clearTypingTimer(userId, threadId);
            io.to(`chat:${threadId}`).emit('user_stop_typing', { userId });
          }
        }
      } else {
        console.log(`[SOCKET] Tab closed, user ${userId} has ${remainingCount} active tabs`);
      }
    });
  });
}

// ── Typing timer helpers ────────────────────────────────────────────────────
function timerKey(userId, threadId) {
  return `${threadId}:${userId}`;
}

function resetTypingTimer(io, userId, threadId) {
  const key = timerKey(userId, threadId);
  if (typingTimers.has(key)) clearTimeout(typingTimers.get(key));
  const timer = setTimeout(() => {
    typingTimers.delete(key);
    io.to(`chat:${threadId}`).emit('user_stop_typing', { userId });
  }, 4000);
  typingTimers.set(key, timer);
}

function clearTypingTimer(userId, threadId) {
  const key = timerKey(userId, threadId);
  if (typingTimers.has(key)) {
    clearTimeout(typingTimers.get(key));
    typingTimers.delete(key);
  }
}

module.exports = { setupChatSocket };
