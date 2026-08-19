const prisma = require('../config/prisma');
const { hashPassword, comparePassword } = require('../utils/hash');
const { generateAccessToken, generateRefreshToken } = require('../utils/jwt');
const { sendOtpEmail, sendMentorApprovalEmail, sendAccountStatusEmail, retryFailedEmails } = require('../services/email.service');
const { sendSessionReminders } = require('../jobs/sessionReminder.job');
const config = require('../config/env');

const DEV_EMAIL = 'riturdev@gmail.com';
const DEV_PASSWORD = 'Ritu@7672';

/**
 * POST /api/dev/login
 * Developer authentication endpoint for /dev portal.
 */
async function devLogin(req, res) {
  try {
    const { email, password } = req.body;
    const normalizedEmail = (email || '').toLowerCase().trim();

    if (normalizedEmail !== DEV_EMAIL || password !== DEV_PASSWORD) {
      return res.status(401).json({ error: 'Invalid developer credentials' });
    }

    let devUser = await prisma.user.findUnique({
      where: { email: DEV_EMAIL },
    });

    if (!devUser) {
      const passwordHash = await hashPassword(DEV_PASSWORD);
      devUser = await prisma.user.create({
        data: {
          email: DEV_EMAIL,
          name: 'HelpMeMan Developer Console',
          passwordHash,
          role: 'DEVELOPER',
          isEmailVerified: true,
          status: 'ACTIVE',
        },
      });
      console.log(`[DEV] Created developer account ${DEV_EMAIL} with DEVELOPER role.`);
    } else if (devUser.role !== 'DEVELOPER') {
      devUser = await prisma.user.update({
        where: { id: devUser.id },
        data: { role: 'DEVELOPER', status: 'ACTIVE' },
      });
      console.log(`[DEV] Upgraded user ${DEV_EMAIL} to DEVELOPER role.`);
    }

    const accessToken = generateAccessToken(devUser);
    const refreshToken = generateRefreshToken(devUser);

    res.json({
      user: {
        id: devUser.id,
        name: devUser.name,
        email: devUser.email,
        role: devUser.role,
        status: devUser.status,
      },
      accessToken,
      refreshToken,
    });
  } catch (error) {
    console.error('[DEV] Dev login error:', error);
    res.status(500).json({ error: 'Developer login failed' });
  }
}

/**
 * GET /api/dev/stats
 * Real-time developer metrics and diagnostic stats.
 */
async function getDevStats(req, res) {
  try {
    const [
      userCount,
      mentorCount,
      bookingCount,
      reviewCount,
      auditCount,
      threadCount,
      failedEmailCount,
      recentAuditLogs,
      recentEmailLogs,
    ] = await Promise.all([
      prisma.user.count(),
      prisma.mentor.count(),
      prisma.booking.count(),
      prisma.review.count(),
      prisma.auditLog.count(),
      prisma.chatThread.count(),
      prisma.emailDeliveryLog.count({ where: { status: 'failed' } }),
      prisma.auditLog.findMany({
        take: 10,
        orderBy: { createdAt: 'desc' },
      }),
      prisma.emailDeliveryLog.findMany({
        take: 10,
        orderBy: { createdAt: 'desc' },
      }),
    ]);

    const memory = process.memoryUsage();

    res.json({
      runtime: {
        nodeEnv: config.nodeEnv,
        uptimeSeconds: Math.floor(process.uptime()),
        memoryUsageMb: {
          rss: Math.round(memory.rss / (1024 * 1024)),
          heapTotal: Math.round(memory.heapTotal / (1024 * 1024)),
          heapUsed: Math.round(memory.heapUsed / (1024 * 1024)),
        },
      },
      counts: {
        users: userCount,
        mentors: mentorCount,
        bookings: bookingCount,
        reviews: reviewCount,
        chatThreads: threadCount,
        auditLogs: auditCount,
        failedEmails: failedEmailCount,
      },
      services: {
        resendConfigured: !!config.resend.apiKey,
        gmailConfigured: !!(config.gmail && config.gmail.user && config.gmail.appPassword),
        smtpConfigured: !!(config.smtp && config.smtp.host && config.smtp.user),
        googleCalendarConfigured: !!(config.google && config.google.clientId),
      },
      recentAuditLogs,
      recentEmailLogs,
    });
  } catch (error) {
    console.error('[DEV] Get dev stats error:', error);
    res.status(500).json({ error: 'Failed to fetch developer stats' });
  }
}

/**
 * POST /api/dev/test-email
 * Dispatch sample test emails for debugging transport layer.
 */
async function sendTestEmail(req, res) {
  try {
    const { toEmail, type = 'otp' } = req.body;
    const recipient = toEmail || DEV_EMAIL;

    let result;
    if (type === 'otp') {
      result = await sendOtpEmail({ email: recipient, name: 'Developer Tester', otp: '767299', purpose: 'verify' });
    } else if (type === 'approval') {
      result = await sendMentorApprovalEmail({ email: recipient, displayName: 'Test Developer Mentor' }, true);
    } else if (type === 'rejection') {
      result = await sendMentorApprovalEmail({ email: recipient, displayName: 'Test Developer Mentor' }, false, 'Developer system test rejection');
    } else if (type === 'account_hold') {
      result = await sendAccountStatusEmail({ email: recipient, name: 'Developer Tester' }, 'ON_HOLD', 'Developer security audit check');
    } else {
      return res.status(400).json({ error: 'Unknown email test type' });
    }

    res.json({ success: true, result });
  } catch (error) {
    console.error('[DEV] Test email error:', error);
    res.status(500).json({ error: 'Test email failed to send', details: error.message });
  }
}

/**
 * POST /api/dev/trigger-job
 * Manually trigger background jobs.
 */
async function triggerDevJob(req, res) {
  try {
    const { jobName } = req.body;

    if (jobName === 'session_reminders') {
      const result = await sendSessionReminders();
      return res.json({ success: true, job: 'session_reminders', result });
    }

    if (jobName === 'email_retries') {
      const result = await retryFailedEmails();
      return res.json({ success: true, job: 'email_retries', result });
    }

    return res.status(400).json({ error: 'Unknown job name' });
  } catch (error) {
    console.error('[DEV] Trigger job error:', error);
    res.status(500).json({ error: 'Job execution failed', details: error.message });
  }
}

module.exports = {
  devLogin,
  getDevStats,
  sendTestEmail,
  triggerDevJob,
};
