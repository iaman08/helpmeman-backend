require('dns').setDefaultResultOrder('ipv4first'); // env reload trigger v4
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
const googleRoutes = require('./routes/google.routes');
const teamRoutes   = require('./routes/team.routes');
const superAdminRoutes = require('./routes/superAdmin.routes');

const app = express();
const server = http.createServer(app);

const allowedOrigins = [config.frontendUrl].filter(Boolean);
const corsOriginCheck = (origin, callback) => {
  // No origin = server-to-server / curl / mobile — allow
  if (!origin) return callback(null, true);

  const isLocalDev = config.nodeEnv === 'development' && (
    origin.startsWith('http://localhost:') ||
    origin.startsWith('http://127.0.0.1:') ||
    origin.startsWith('http://192.168.') ||
    origin.startsWith('http://10.')
  );

  const isVercelOrigin =
    origin === 'https://helpmeman-frontend.vercel.app' ||
    /^https:\/\/helpmeman-frontend-[a-z0-9-]+\.vercel\.app$/.test(origin);

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
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'", "https:"],
      styleSrc: ["'self'", "'unsafe-inline'", "https:"],
      imgSrc: ["'self'", "data:", "https:", "blob:"],
      connectSrc: ["'self'", "https:", "wss:", "ws:"],
      fontSrc: ["'self'", "https:", "data:"],
      objectSrc: ["'none'"],
      mediaSrc: ["'self'"],
      frameAncestors: ["'none'"],
    },
  },
  crossOriginEmbedderPolicy: false,
  crossOriginOpenerPolicy: { policy: "same-origin" },
  crossOriginResourcePolicy: { policy: "same-origin" },
  referrerPolicy: { policy: "strict-origin-when-cross-origin" },
  hsts: {
    maxAge: 31536000,
    includeSubDomains: true,
    preload: true,
  },
}));
app.use((req, res, next) => {
  res.setHeader(
    'Permissions-Policy',
    'geolocation=(), microphone=(), camera=(), interest-cohort=()'
  );
  next();
});
app.use(cors({ origin: corsOriginCheck, credentials: true }));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(generalLimiter);
app.use(gzipMiddleware);

// Disable caching for all API responses to ensure user data isolation
app.use((req, res, next) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  next();
});

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
app.use('/api/mentor/onboarding', onboardingRoutes);
app.use('/api/mentor', mentorDashboardRoutes);
app.use('/api/bookings', bookingRoutes);
app.use('/api/payments', paymentRoutes);
app.use('/api/chat', chatRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/categories', categoryRoutes);
app.use('/api/ai', aiRoutes);
app.use('/api/public/ai', publicAiRoutes);
app.use('/api/google', googleRoutes);
app.use('/api/team', teamRoutes);
app.use('/api/super-admin', superAdminRoutes);

// Health check & db reaction cleaner
app.get('/api/health', async (req, res) => {
  try {
    const prisma = require('./config/prisma');
    await prisma.$queryRaw`SELECT 1`;
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
  } catch {
    res.status(503).json({ status: 'degraded' });
  }
});

// Error handler
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  const isDev = process.env.NODE_ENV === 'development';
  res.status(err.status || 500).json({
    error: isDev ? (err.message || 'Internal server error') : 'Internal server error'
  });
});

// Start
const PORT = config.port;
server.listen(PORT, async () => {
  console.log(`🚀 HelpMeMan backend running on port ${PORT}`);
  console.log(`📡 Socket.io ready`);
  
  // Clean up any stale failed email delivery logs on startup to prevent email storms
  try {
    const { count } = await prisma.emailDeliveryLog.updateMany({
      where: { status: 'failed' },
      data: { status: 'cancelled' },
    });
    if (count > 0) {
      console.log(`🧹 Cleaned up ${count} stale failed email logs on startup.`);
    }
  } catch (dbError) {
    console.warn('Failed to clean up stale email logs on startup:', dbError.message);
  }

  // Initialize presence checker sweep
  try {
    const { initPresenceSweep } = require('./services/presence.service');
    initPresenceSweep();
  } catch (error) {
    console.warn('[PRESENCE] Failed to start sweeper:', error.message);
  }

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

  // Seed demo team members if none exist
  try {
    const prismaInstance = require('./config/prisma');
    const count = await prismaInstance.teamMember.count();
    if (count === 0) {
      console.log('🌱 Database has no team members. Seeding demo profiles...');
      await prismaInstance.teamMember.createMany({
        data: [
          {
            fullName: "Marcus Mango",
            username: "marcus",
            role: "Founder & CEO",
            department: "Operations",
            bio: "Marcus started HelpMeMan with a single mission: to create a global ecosystem where real-time peer mentorship is accessible to everyone, anywhere.",
            story: "Marcus previously led operations at various high-growth startups before starting HelpMeMan in 2024. He believes that access to direct mentorship is the ultimate catalyst for career growth.",
            skills: ["Operations", "Product Strategy", "Venture Capital"],
            interests: ["Hiking", "Venture Investing", "Coffee"],
            languages: ["English", "Spanish"],
            location: "Bengaluru",
            country: "India",
            email: "marcus@helpmeman.com",
            linkedin: "https://linkedin.com",
            github: "https://github.com",
            twitter: "https://twitter.com",
            status: "ONLINE",
            isFounder: true,
            isLeadership: true,
            isVerified: true,
            imageUrl: "https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?auto=format&fit=crop&q=80&w=600",
            coverUrl: "https://images.unsplash.com/photo-1557683316-973673baf926?auto=format&fit=crop&q=80&w=1000",
            displayOrder: 0,
            joinedAt: new Date('2024-01-15'),
          },
          {
            fullName: "Sarah Jenkins",
            username: "sarah",
            role: "Chief Technology Officer",
            department: "Engineering",
            bio: "Sarah designs and oversees the core HelpMeMan architecture, scaling our system to support hundreds of concurrent videocalls.",
            story: "Sarah has over a decade of experience scaling backend systems. Previously, she was a principal infrastructure engineer at a major cloud provider.",
            skills: ["Node.js", "PostgreSQL", "Socket.io", "AWS"],
            interests: ["Open Source", "Running", "Photography"],
            languages: ["English", "German"],
            location: "San Francisco",
            country: "USA",
            email: "sarah@helpmeman.com",
            linkedin: "https://linkedin.com",
            github: "https://github.com",
            status: "ONLINE",
            isFounder: false,
            isLeadership: true,
            isVerified: true,
            imageUrl: "https://images.unsplash.com/photo-1580489944761-15a19d654956?auto=format&fit=crop&q=80&w=600",
            displayOrder: 1,
            joinedAt: new Date('2024-03-10'),
          },
          {
            fullName: "David Chen",
            username: "david",
            role: "Head of AI",
            department: "AI",
            bio: "David leads our machine learning pipelines, building dynamic user summary vector models and smart scheduling suggestions.",
            story: "David previously worked as an NLP researcher. His work at HelpMeMan focuses on building zero-latency contextual AI suggestions.",
            skills: ["Python", "PyTorch", "LLMs", "Vector DBs"],
            interests: ["Chess", "AI Safety", "Music"],
            languages: ["English", "Mandarin"],
            location: "Singapore",
            country: "Singapore",
            email: "david@helpmeman.com",
            linkedin: "https://linkedin.com",
            github: "https://github.com",
            status: "AWAY",
            isFounder: false,
            isLeadership: true,
            isVerified: true,
            imageUrl: "https://images.unsplash.com/photo-1500648767791-00dcc994a43e?auto=format&fit=crop&q=80&w=600",
            displayOrder: 2,
            joinedAt: new Date('2024-06-01'),
          },
          {
            fullName: "Elena Rostova",
            username: "elena",
            role: "Senior Backend Engineer",
            department: "Backend",
            bio: "Elena implements secure payment processes, direct Firebase push notifications, and handles third-party calendar synchronizations.",
            story: "Elena holds a Masters in Distributed Systems and loves designing bulletproof transactional database models.",
            skills: ["Express.js", "Redis", "Supabase", "Docker"],
            interests: ["Sailing", "Cooking", "Microcontrollers"],
            languages: ["English", "Russian"],
            location: "Munich",
            country: "Germany",
            email: "elena@helpmeman.com",
            linkedin: "https://linkedin.com",
            status: "ONLINE",
            isFounder: false,
            isLeadership: false,
            isVerified: false,
            imageUrl: "https://images.unsplash.com/photo-1494790108377-be9c29b29330?auto=format&fit=crop&q=80&w=600",
            displayOrder: 3,
            joinedAt: new Date('2024-09-15'),
          },
          {
            fullName: "Alex Mercer",
            username: "alex",
            role: "Lead Frontend Engineer",
            department: "Frontend",
            bio: "Alex leads our Next.js visual engineering, creating responsive dashboard elements and smooth interactive UI components.",
            story: "Alex is obsessed with performance, sub-100ms render times, and micro-interactions that make interfaces feel alive.",
            skills: ["React", "Next.js", "Tailwind CSS", "Framer Motion"],
            interests: ["Gaming", "UI Design", "Synthwave"],
            languages: ["English"],
            location: "London",
            country: "UK",
            email: "alex@helpmeman.com",
            linkedin: "https://linkedin.com",
            github: "https://github.com",
            status: "ONLINE",
            isFounder: false,
            isLeadership: false,
            isVerified: false,
            imageUrl: "https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&q=80&w=600",
            displayOrder: 4,
            joinedAt: new Date('2024-11-20'),
          },
          {
            fullName: "Jessica Lin",
            username: "jessica",
            role: "Lead Product Designer",
            department: "Design",
            bio: "Jessica designs our Stripe-meets-Linear aesthetics, refining card states, typography, layouts, and product branding.",
            story: "Jessica has a background in fine arts and human-computer interaction. She designs clean, low-fatigue layout architectures.",
            skills: ["UI/UX Design", "Figma", "Design Systems", "Prototyping"],
            interests: ["Architecture", "Sketching", "Travel"],
            languages: ["English", "Japanese"],
            location: "Tokyo",
            country: "Japan",
            email: "jessica@helpmeman.com",
            linkedin: "https://linkedin.com",
            status: "AWAY",
            isFounder: false,
            isLeadership: false,
            isVerified: false,
            imageUrl: "https://images.unsplash.com/photo-1544005313-94ddf0286df2?auto=format&fit=crop&q=80&w=600",
            displayOrder: 5,
            joinedAt: new Date('2025-01-10'),
          }
        ]
      });
      console.log('🌱 Demo profiles seeded successfully.');
    }
  } catch (seedError) {
    console.warn('⚠️ Seeding demo profiles failed:', seedError.message);
  }

  // Print email delivery logs only in development for diagnostics
  if (config.nodeEnv === 'development') {
    try {
      const prismaInstance = require('./config/prisma');
      const logs = await prismaInstance.emailDeliveryLog.findMany({
        orderBy: { createdAt: 'desc' },
        take: 30,
      });
      console.log(`\n--- 📊 LAST ${logs.length} EMAIL DELIVERY LOGS ---`);
      logs.forEach(log => {
        console.log(`[${log.createdAt.toISOString()}] ID: ${log.id} | Status: ${log.status} | Template: ${log.templateType}`);
      });
      console.log('-------------------------------------\n');
    } catch (e) {
      console.error('Failed to log email diagnostics on startup:', e.message);
    }
  }
});

module.exports = { app, server };
