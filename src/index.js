require('dns').setDefaultResultOrder('ipv4first'); // env reload trigger
const express = require('express');
const cors    = require('cors');
const helmet  = require('helmet');
const http    = require('http');
const zlib    = require('zlib');
const { Server } = require('socket.io');
const config  = require('./config/env');
const { generalLimiter } = require('./middleware/rateLimiter');
const { setupChatSocket }   = require('./sockets/chat.socket');
const { initReminderQueue } = require('./jobs/sessionReminder.job');
const { initNotificationQueue } = require('./services/notificationQueue.service');
const { retryFailedEmails } = require('./services/email.service');

// ── Lightweight gzip middleware (no extra dependency) ─────────────────────────
function gzipMiddleware(req, res, next) {
  const acceptEncoding = req.headers['accept-encoding'] || '';
  if (!acceptEncoding.includes('gzip')) return next();

  const _json = res.json.bind(res);
  res.json = (body) => {
    const raw = JSON.stringify(body);
    // Only compress if payload > 512 bytes (overhead not worth it below this)
    if (!raw || raw.length < 512) return _json(body);
    zlib.gzip(raw, (err, compressed) => {
      if (err) return _json(body);
      res.setHeader('Content-Encoding', 'gzip');
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Content-Length', compressed.length);
      res.end(compressed);
    });
  };
  next();
}

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
const publicAiRoutes = require('./routes/publicAi.routes');
const onboardingRoutes = require('./routes/onboarding.routes');

const app = express();
const server = http.createServer(app);

const allowedOrigins = [config.frontendUrl].filter(Boolean);
const corsOriginCheck = (origin, callback) => {
  // No origin = server-to-server / curl / mobile — allow
  if (!origin) return callback(null, true);

  const isLocalDev =
    origin.startsWith('http://localhost:') ||
    origin.startsWith('http://127.0.0.1:') ||
    origin.startsWith('http://192.168.') ||
    origin.startsWith('http://10.');

  const isVercelOrigin =
    origin.endsWith('.vercel.app') ||
    origin === 'https://helpmeman-frontend.vercel.app';

  const isCustomDomain =
    origin === 'https://helpmeman.com' ||
    origin === 'https://www.helpmeman.com' ||
    origin.endsWith('.helpmeman.com');

  const isAllowedOrigin = allowedOrigins.includes(origin);

  if (isAllowedOrigin || isLocalDev || isVercelOrigin || isCustomDomain) {
    callback(null, true);
  } else {
    // Silently reject — do NOT pass an Error to avoid unhandled exception noise
    console.warn(`[CORS] Blocked origin: ${origin}`);
    callback(null, false);
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
app.use(cors({ origin: corsOriginCheck, credentials: true }));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(generalLimiter);
app.use(gzipMiddleware);

// Request timing — adds X-Response-Time header visible in browser DevTools
app.use((req, _res, next) => {
  const start = process.hrtime.bigint();
  _res.on('finish', () => {
    const ms = Number(process.hrtime.bigint() - start) / 1e6;
    if (process.env.NODE_ENV !== 'production' || ms > 500) {
      console.log(`[${req.method}] ${req.path} → ${_res.statusCode} (${ms | 0}ms)`);
    }
  });
  next();
});

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
app.use('/api/public/ai', publicAiRoutes);
app.use('/api/onboarding', onboardingRoutes);

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
  // Initialize job queue (skipped in development to avoid Upstash limit-reached console floods)
  if (config.nodeEnv === 'production') {
    try { initReminderQueue(config.redis.url); } catch (e) { console.warn('Redis queue init skipped'); }
    try { initNotificationQueue(config.redis.url); } catch (e) { console.warn('Notification queue init skipped'); }
    setInterval(() => {
      retryFailedEmails(20).catch((err) => console.warn('Email retry job failed:', err.message));
    }, 15 * 60 * 1000);
  } else {
    console.log('Skipping Redis reminder queue in development');
  }
});

module.exports = { app, server };
