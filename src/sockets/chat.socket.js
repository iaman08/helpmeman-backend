const { verifyAccessToken } = require('../utils/jwt');

function setupChatSocket(io) {
  io.use((socket, next) => {
    const token = socket.handshake.auth?.token || socket.handshake.headers?.authorization?.split(' ')[1];
    if (!token) return next(new Error('Authentication required'));
    try {
      const decoded = verifyAccessToken(token);
      socket.userId = decoded.userId;
      socket.userRole = decoded.role;
      next();
    } catch (e) { next(new Error('Invalid token')); }
  });

  io.on('connection', (socket) => {
    console.log(`Socket connected: ${socket.userId}`);

    socket.on('join_thread', ({ threadId }) => {
      socket.join(`chat:${threadId}`);
      console.log(`User ${socket.userId} joined chat:${threadId}`);
    });

    socket.on('leave_thread', ({ threadId }) => {
      socket.leave(`chat:${threadId}`);
    });

    socket.on('typing', ({ threadId }) => {
      socket.to(`chat:${threadId}`).emit('user_typing', { userId: socket.userId });
    });

    socket.on('stop_typing', ({ threadId }) => {
      socket.to(`chat:${threadId}`).emit('user_stop_typing', { userId: socket.userId });
    });

    socket.on('disconnect', () => {
      console.log(`Socket disconnected: ${socket.userId}`);
    });
  });
}

module.exports = { setupChatSocket };
