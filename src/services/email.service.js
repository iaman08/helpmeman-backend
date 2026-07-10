const nodemailer = require('nodemailer');
const https = require('https');
const prisma = require('../config/prisma');
const config = require('../config/env');

// Singleton HTTPS keep-alive agent — reuses TCP/TLS connections for Resend API
// Saves ~100-200ms per email (avoids TLS handshake on every request)
const resendAgent = new https.Agent({
  keepAlive: true,
  keepAliveMsecs: 30000,  // send keep-alive packets every 30s
  maxSockets: 10,         // max concurrent connections to api.resend.com
});
const { renderOtpEmail } = require('../emails/otpEmail');
const { renderNotificationEmail } = require('../emails/notificationEmail');
const {
  renderVerifyEmail,
  renderPasswordResetEmail,
  renderMentorApprovalEmail,
  renderWelcomeEmail,
  renderWeeklyUpdateEmail,
} = require('../emails/transactionalEmails');


// Brevo SMTP transporter
const smtpTransporter =
  config.smtp.host && config.smtp.user && config.smtp.pass
    ? nodemailer.createTransport({
        host: config.smtp.host,
        port: config.smtp.port,
        secure: config.smtp.port === 465,
        auth: { user: config.smtp.user, pass: config.smtp.pass },
      })
    : null;

// Gmail SMTP transporter (App Password — most reliable, no IP restrictions)
const gmailTransporter =
  config.gmail?.user && config.gmail?.appPassword
    ? nodemailer.createTransport({
        service: 'gmail',
        auth: {
          user: config.gmail.user,
          pass: config.gmail.appPassword,
        },
      })
    : null;

if (gmailTransporter) {
  // Verify Gmail connection on startup — detects wrong password / missing 2FA immediately
  gmailTransporter.verify((error) => {
    if (error) {
      console.error(`❌ Gmail SMTP auth failed for ${config.gmail.user}: ${error.message}`);
      console.error('   → Make sure 2FA is ON and the App Password belongs to GMAIL_USER account');
    } else {
      console.log(`✅ Gmail SMTP ready and verified (${config.gmail.user})`);
    }
  });
} else {
  console.log('⚠️ Gmail SMTP not configured — set GMAIL_USER and GMAIL_APP_PASSWORD in .env to enable');
}

function sendResendEmail({ to, subject, html, from }) {
  return new Promise((resolve, reject) => {
    const apiKey = config.resend.apiKey;
    const fromAddress = from || config.smtp.fromEmail || 'onboarding@resend.dev';
    
    // Sandbox keys must use onboarding@resend.dev as the sender
    const isSandboxKey = apiKey.startsWith('re_');
    const finalFrom = isSandboxKey ? 'HelpMeMan <onboarding@resend.dev>' : `HelpMeMan <${fromAddress}>`;

    const data = JSON.stringify({
      from: finalFrom,
      to: [to],
      subject,
      html,
    });

    const options = {
      hostname: 'api.resend.com',
      port: 443,
      path: '/emails',
      method: 'POST',
      agent: resendAgent,   // reuse persistent TCP connection
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data),
      },
    };

    const req = https.request(options, (res) => {
      let body = '';
      res.on('data', (chunk) => body += chunk);
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          try {
            const parsed = JSON.parse(body);
            resolve({ id: parsed.id });
          } catch (e) {
            resolve({ id: 'resend_ok' });
          }
        } else {
          reject(new Error(`Resend API returned status ${res.statusCode}: ${body}`));
        }
      });
    });

    req.on('error', (err) => reject(err));
    req.write(data);
    req.end();
  });
}

// Retry logic wrapper
async function sendResendEmailWithRetry(params, retries = 2, delay = 500) {
  try {
    return await sendResendEmail(params);
  } catch (error) {
    if (retries <= 0) throw error;
    await new Promise((resolve) => setTimeout(resolve, delay));
    return sendResendEmailWithRetry(params, retries - 1, delay * 2);
  }
}

async function logEmailDelivery({
  userId,
  toEmail,
  subject,
  templateType,
  status,
  providerId,
  errorMessage,
  notificationId,
  retryCount = 0,
}) {
  try {
    return await prisma.emailDeliveryLog.create({
      data: {
        userId,
        toEmail,
        subject,
        templateType,
        status,
        resendId: providerId,
        errorMessage,
        notificationId,
        retryCount,
        sentAt: status === 'sent' ? new Date() : null,
      },
    });
  } catch (error) {
    console.error('Email delivery log error:', error.message);
    return null;
  }
}

async function sendEmail({ to, subject, html, text, userId, templateType = 'generic', notificationId , }) {
  // Validate email address before sending
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!to || !emailRegex.test(to)) {
    console.error(`[EMAIL] ❌ Invalid recipient email address: "${to}"`);
    return { success: false, provider: null, error: 'Invalid email address' };
  }

  console.log(`[EMAIL] 📤 Attempting to send "${subject}" to ${to}`);
  const plainText = text || html.replace(/<[^>]*>/g, '');

  // Try Resend first
  if (config.resend.apiKey) {
    console.log(`[EMAIL] 🔑 Trying Resend (key: ${config.resend.apiKey.substring(0, 10)}...)`);
    try {
      const res = await sendResendEmailWithRetry({ to, subject, html, from: config.smtp.fromEmail });
      console.log(`[EMAIL] ✅ Resend delivered successfully! ID: ${res.id}`);
      await logEmailDelivery({
        userId,
        toEmail: to,
        subject,
        templateType,
        status: 'sent',
        providerId: res.id,
        notificationId,
      });
      return { success: true, provider: 'resend', id: res.id };
    } catch (error) {
      console.error(`[EMAIL] ⚠️ Resend failed: ${error.message}`);
      console.log(`[EMAIL] ↩️ Falling back to Brevo SMTP...`);
    }
  } else {
    console.log(`[EMAIL] ⚠️ No Resend API key configured, using SMTP directly.`);
  }

  // --- Gmail SMTP fallback ---
  if (gmailTransporter) {
    try {
      const gmailFrom = config.gmail?.user || 'noreply@gmail.com';
      const info = await gmailTransporter.sendMail({
        from: `"HelpMeMan" <${gmailFrom}>`,
        to,
        subject,
        html,
        text: plainText,
      });
      console.log(`[EMAIL] ✅ Gmail delivered! Message ID: ${info.messageId}`);
      await logEmailDelivery({ userId, toEmail: to, subject, templateType, status: 'sent', providerId: info.messageId, notificationId });
      return { success: true, provider: 'gmail', id: info.messageId };
    } catch (error) {
      console.error(`[EMAIL] ❌ Gmail failed: ${error.message}`);
    }
  }

  // --- Brevo SMTP fallback ---
  if (smtpTransporter) {
    try {
      const info = await smtpTransporter.sendMail({
        from: `"HelpMeMan" <${config.smtp.fromEmail}>`,
        to,
        subject,
        html,
        text: plainText,
      });
      console.log(`[EMAIL] ✅ Brevo SMTP delivered! Message ID: ${info.messageId}`);
      await logEmailDelivery({ userId, toEmail: to, subject, templateType, status: 'sent', providerId: info.messageId, notificationId });
      return { success: true, provider: 'brevo-smtp', id: info.messageId };
    } catch (error) {
      console.error(`[EMAIL] ❌ Brevo SMTP failed: ${error.message}`);
      await logEmailDelivery({ userId, toEmail: to, subject, templateType, status: 'failed', errorMessage: error.message, notificationId });
    }
  }

  if (!gmailTransporter && !smtpTransporter) {
    console.warn(`[EMAIL] ❌ No SMTP transporter configured! Set GMAIL_USER + GMAIL_APP_PASSWORD in .env`);
  }

  console.error(`[EMAIL] ❌ All delivery methods exhausted for ${to}`);
  return { success: false, provider: null };
}


async function retryFailedEmails(limit = 25) {
  const failed = await prisma.emailDeliveryLog.findMany({
    where: { status: 'failed', retryCount: { lt: 3 } },
    orderBy: { createdAt: 'asc' },
    take: limit,
  });

  let retried = 0;
  for (const entry of failed) {
    const html = entry.errorMessage?.includes('storedHtml:')
      ? entry.errorMessage.split('storedHtml:')[1]
      : `<p>${entry.subject}</p>`;

    const result = await sendEmail({
      to: entry.toEmail,
      subject: entry.subject,
      html,
      userId: entry.userId,
      templateType: entry.templateType,
      notificationId: entry.notificationId,
    });

    if (result.success) {
      await prisma.emailDeliveryLog.update({
        where: { id: entry.id },
        data: { status: 'sent', retryCount: entry.retryCount + 1, sentAt: new Date(), errorMessage: null },
      });
      retried += 1;
    } else {
      await prisma.emailDeliveryLog.update({
        where: { id: entry.id },
        data: { retryCount: entry.retryCount + 1 },
      });
    }
  }

  return { retried, attempted: failed.length };
}

async function sendOtpEmail({ email, name, otp, purpose = 'verify' }) {
  // ALWAYS log OTP — works as fallback even when email delivery fails
  console.log(`\n🔐 [OTP] ${purpose.toUpperCase()} code for ${email}: \x1b[33m${otp}\x1b[0m\n`);
  
  let html;
  try {
    html = await renderOtpEmail({ name, otp, purpose });
  } catch (renderError) {
    // If template rendering fails, use simple fallback HTML
    console.error('[EMAIL] Template render failed, using plain fallback:', renderError.message);
    html = `<div style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:40px">
      <h2>HelpMeMan</h2>
      <p>Hi ${name || 'there'},</p>
      <p>Your ${purpose === 'reset' ? 'password reset' : 'verification'} code is:</p>
      <div style="font-size:40px;font-weight:bold;letter-spacing:10px;color:#4f46e5;padding:20px;background:#f5f5f5;border-radius:8px;text-align:center">${otp}</div>
      <p>This code expires in 10 minutes. Never share it with anyone.</p>
    </div>`;
  }

  const result = await sendEmail({
    to: email,
    subject:
      purpose === 'reset'
        ? 'Reset your password — HelpMeMan'
        : purpose === 'login'
          ? 'Your login code — HelpMeMan'
          : 'Verify your email — HelpMeMan',
    html,
    templateType: 'otp',
  });
  if (!result.success) {
    console.error(`[EMAIL] ❌ OTP email delivery failed for ${email}. Check the OTP printed above in the terminal.`);
  }
  return result;
}

async function sendNotificationEmail({ user, title, body, type, notificationId }) {
  const html = await renderNotificationEmail({ name: user.name, title, body, type });
  return sendEmail({
    to: user.email,
    subject: `${title} — HelpMeMan`,
    html,
    userId: user.id,
    templateType: type || 'notification',
    notificationId,
  });
}

async function sendWelcomeEmail(user) {
  const html = await renderWelcomeEmail({ name: user.name });
  return sendEmail({ to: user.email, subject: 'Welcome to HelpMeMan', html, userId: user.id, templateType: 'welcome' });
}

async function sendVerifyEmail(user, verificationUrl) {
  const html = await renderVerifyEmail({ name: user.name, verificationUrl });
  return sendEmail({ to: user.email, subject: 'Verify your email — HelpMeMan', html, userId: user.id, templateType: 'verify_email' });
}

async function sendPasswordResetEmail(user, resetUrl) {
  const html = await renderPasswordResetEmail({ name: user.name, resetUrl });
  return sendEmail({ to: user.email, subject: 'Reset your password — HelpMeMan', html, userId: user.id, templateType: 'password_reset' });
}

async function sendMentorApprovalEmail(user, approved, reason) {
  const html = await renderMentorApprovalEmail({ name: user.displayName || user.name, approved, reason });
  return sendEmail({
    to: user.email,
    subject: approved ? 'You are approved on HelpMeMan!' : 'Update on your mentor application',
    html,
    userId: user.userId || user.id,
    templateType: approved ? 'mentor_approved' : 'mentor_rejected',
  });
}

async function sendWeeklyUpdateEmail(user, highlights) {
  const html = await renderWeeklyUpdateEmail({ name: user.name, highlights });
  return sendEmail({ to: user.email, subject: 'Your weekly HelpMeMan update', html, userId: user.id, templateType: 'weekly_update' });
}

// Legacy template exports for backward compatibility
function welcomeEmailTemplate(user) {
  return `<p>Welcome ${user.name}</p>`;
}
function emailVerificationTemplate(user, verificationUrl) {
  return `<p>Verify: ${verificationUrl}</p>`;
}
function otpEmailTemplate(email, otp, purpose) {
  return `<p>OTP: ${otp}</p>`;
}
function approvalEmailTemplate(mentor) {
  return `<p>Approved ${mentor.displayName}</p>`;
}
function rejectionEmailTemplate(mentor, reason) {
  return `<p>Rejected: ${reason}</p>`;
}
function bookingConfirmedTemplate(user, mentor, booking) {
  return `<p>Booking confirmed</p>`;
}
function sessionReminderTemplate(user, booking) {
  return `<p>Session reminder</p>`;
}
function passwordResetTemplate(user, resetUrl) {
  return `<p>Reset: ${resetUrl}</p>`;
}

module.exports = {
  sendEmail,
  sendOtpEmail,
  sendNotificationEmail,
  sendWelcomeEmail,
  sendVerifyEmail,
  sendPasswordResetEmail,
  sendMentorApprovalEmail,
  sendWeeklyUpdateEmail,
  retryFailedEmails,
  logEmailDelivery,
  welcomeEmailTemplate,
  emailVerificationTemplate,
  otpEmailTemplate,
  approvalEmailTemplate,
  rejectionEmailTemplate,
  bookingConfirmedTemplate,
  sessionReminderTemplate,
  passwordResetTemplate,
};
