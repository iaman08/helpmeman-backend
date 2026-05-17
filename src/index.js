const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const http = require('http');
const { Server } = require('socket.io');
const config = require('./config/env');
const { generalLimiter } = require('./middleware/rateLimiter');
const { setupChatSocket } = require('./sockets/chat.socket');
const { initReminderQueue } = require('./jobs/sessionReminder.job');

// Routes
const authRoutes = require('./routes/auth.routes');
const userRoutes = require('./routes/user.routes');
const mentorRoutes = require('./routes/mentor.routes');
const mentorDashboardRoutes = require('./routes/mentorDashboard.routes');
const bookingRoutes = require('./routes/booking.routes');
const paymentRoutes = require('./routes/payment.routes');
const chatRoutes = require('./routes/chat.routes');
const adminRoutes = require('./routes/admin.routes');
const categoryRoutes = require('./routes/category.routes');
const aiRoutes = require('./routes/ai.routes');

const app = express();
const server = http.createServer(app);

const allowedOrigins = [config.frontendUrl];
const corsOriginCheck = (origin, callback) => {
  if (!origin) return callback(null, true);
  const isLocalDev = config.nodeEnv === 'development' && (
    origin.startsWith('http://localhost:') || 
    origin.startsWith('http://127.0.0.1:') || 
    origin.startsWith('http://192.168.')
  );
  if (allowedOrigins.includes(origin) || isLocalDev) {
    callback(null, true);
  } else {
    callback(new Error('Not allowed by CORS'));
  }
};

// Socket.io
const io = new Server(server, {
  cors: { origin: corsOriginCheck, methods: ['GET', 'POST'], credentials: true },
});
app.io = io;
setupChatSocket(io);

// Middleware
app.use(helmet());

app.use(cors({
  origin: corsOriginCheck,
  credentials: true
}));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(generalLimiter);

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/mentors', mentorRoutes);
app.use('/api/mentor', mentorDashboardRoutes);
app.use('/api/bookings', bookingRoutes);
app.use('/api/payments', paymentRoutes);
app.use('/api/chat', chatRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/categories', categoryRoutes);
app.use('/api/ai', aiRoutes);

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Error handler
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(err.status || 500).json({ error: err.message || 'Internal server error' });
});

// Start
const PORT = config.port;
server.listen(PORT, () => {
  console.log(`🚀 HelpMeMan backend running on port ${PORT}`);
  console.log(`📡 Socket.io ready`);
  // Initialize job queue
  try { initReminderQueue(config.redis.url); } catch (e) { console.warn('Redis queue init skipped'); }
});

module.exports = { app, server };
