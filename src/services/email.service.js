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
  renderAccountStatusEmail,
  renderBookingConfirmationEmail,
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
          pass: config.gmail.appPassword.replace(/\s+/g, ''),
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
          const err = new Error(`Resend API returned status ${res.statusCode}: ${body}`);
          err.statusCode = res.statusCode;
          reject(err);
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
    if (error.statusCode === 401 || error.statusCode === 403 || retries <= 0) throw error;
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

async function sendEmail({ to, subject, html, text, userId, templateType = 'generic', notificationId, logDelivery = true }) {
  // Validate email address before sending
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!to || !emailRegex.test(to)) {
    console.error(`[EMAIL] ❌ Invalid recipient email address: "${to}"`);
    return { success: false, provider: null, error: 'Invalid email address' };
  }

  console.log(`[EMAIL] 📤 Attempting to send "${subject}" to ${to}`);
  const plainText = text || html.replace(/<[^>]*>/g, '');
  const errors = [];

  // Try Resend first
  if (config.resend.apiKey) {
    console.log(`[EMAIL] 🔑 Trying Resend (key: ${config.resend.apiKey.substring(0, 10)}...)`);
    try {
      const res = await sendResendEmailWithRetry({ to, subject, html, from: config.smtp.fromEmail });
      console.log(`[EMAIL] ✅ Resend delivered successfully! ID: ${res.id}`);
      if (logDelivery) {
        await logEmailDelivery({
          userId,
          toEmail: to,
          subject,
          templateType,
          status: 'sent',
          providerId: res.id,
          notificationId,
        });
      }
      return { success: true, provider: 'resend', id: res.id };
    } catch (error) {
      console.error(`[EMAIL] ⚠️ Resend failed: ${error.message}`);
      errors.push(`Resend failed: ${error.message}`);
    }
  }

  // --- Gmail SMTP fallback ---
  if (gmailTransporter) {
    console.log(`[EMAIL] 🔑 Trying Gmail SMTP...`);
    try {
      const gmailFrom = config.gmail?.user || config.smtp?.fromEmail || 'admin.helpmeman@gmail.com';
      const info = await gmailTransporter.sendMail({
        from: `"HelpMeMan" <${gmailFrom}>`,
        to,
        subject,
        html,
        text: plainText,
      });
      console.log(`[EMAIL] ✅ Gmail delivered! Message ID: ${info.messageId}`);
      if (logDelivery) {
        await logEmailDelivery({ userId, toEmail: to, subject, templateType, status: 'sent', providerId: info.messageId, notificationId });
      }
      return { success: true, provider: 'gmail', id: info.messageId };
    } catch (error) {
      console.error(`[EMAIL] ❌ Gmail failed: ${error.message}`);
      errors.push(`Gmail failed: ${error.message}`);
    }
  }

  // --- Brevo SMTP fallback ---
  if (smtpTransporter) {
    console.log(`[EMAIL] 🔑 Trying Brevo SMTP...`);
    try {
      const info = await smtpTransporter.sendMail({
        from: `"HelpMeMan" <${config.smtp.fromEmail}>`,
        to,
        subject,
        html,
        text: plainText,
      });
      console.log(`[EMAIL] ✅ Brevo SMTP delivered! Message ID: ${info.messageId}`);
      if (logDelivery) {
        await logEmailDelivery({ userId, toEmail: to, subject, templateType, status: 'sent', providerId: info.messageId, notificationId });
      }
      return { success: true, provider: 'brevo-smtp', id: info.messageId };
    } catch (error) {
      console.error(`[EMAIL] ❌ Brevo SMTP failed: ${error.message}`);
      errors.push(`Brevo SMTP failed: ${error.message}`);
    }
  }

  const errorMessage = errors.length > 0 ? errors.join(' | ') : 'No SMTP transporters configured';
  console.error(`[EMAIL] ❌ All delivery methods exhausted for ${to}: ${errorMessage}`);
  
  if (logDelivery) {
    await logEmailDelivery({
      userId,
      toEmail: to,
      subject,
      templateType,
      status: 'failed',
      errorMessage: `${errorMessage} | storedHtml:${html}`,
      notificationId,
    });
  }

  return { success: false, provider: null, error: errorMessage };
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
      logDelivery: false, // Prevent creating new log entries during retry
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
        data: { retryCount: entry.retryCount + 1, errorMessage: result.error || 'Retry failed' },
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
  let html;
  try {
    html = await renderMentorApprovalEmail({ name: user.displayName || user.name, approved, reason });
  } catch (error) {
    console.error('[EMAIL] Mentor approval template render failed, using plain fallback:', error.message);
    const title = approved ? "Congratulations! You're approved!" : 'Update on your mentor application';
    const body = approved
      ? 'Congratulations! Your mentor profile has been reviewed and approved. Mentees can now discover your profile, view your schedule, and book 1-on-1 mentorship sessions with you.'
      : `Thank you for applying to be a mentor on HelpMeMan. We reviewed your profile details and are unable to approve your application at this time.\n\nFeedback/Reason:\n"${reason || 'Please verify that your profile fields, LinkedIn URL, and expertise tags are complete.'}"`;

    html = `<div style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:40px;line-height:1.6;color:#334155;">
      <h2 style="color:#0f172a;">${title}</h2>
      <p>Hi ${user.displayName || user.name || 'there'},</p>
      <p>${body}</p>
      <p style="margin-top:30px;font-size:13px;color:#64748b;">HelpMeMan Team</p>
    </div>`;
  }

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

/**
 * Send booking confirmation emails to BOTH mentor and mentee.
 * Called immediately after payment is verified and Meet event is created.
 *
 * @param {Object} params
 * @param {Object} params.booking   - Full booking with user + mentor
 * @param {Object} params.mentor    - Mentor object (with displayName, user.email, googleCalendarTimezone)
 * @param {Object} params.user      - Mentee user object
 * @param {string} params.meetLink  - Google Meet URL (may be null)
 */
async function sendBookingConfirmationEmails({ booking, mentor, user, meetLink }) {
  const timezone = mentor.googleCalendarTimezone || 'Asia/Kolkata';
  const commonProps = {
    mentorName: mentor.displayName,
    menteeName: user.name,
    scheduledAt: booking.scheduledAt,
    durationMinutes: booking.durationMinutes,
    meetLink,
    timezone,
    bookingId: booking.id,
  };

  // Send to mentee
  try {
    const menteeHtml = await renderBookingConfirmationEmail({
      ...commonProps,
      recipientName: user.name,
      role: 'mentee',
    });
    await sendEmail({
      to: user.email,
      subject: `Your session with ${mentor.displayName} is confirmed! — HelpMeMan`,
      html: menteeHtml,
      userId: user.id,
      templateType: 'booking_confirmed_mentee',
    });
  } catch (err) {
    console.error('[EMAIL] Failed to send mentee confirmation:', err.message);
  }

  // Send to mentor
  try {
    const mentorEmail = mentor.user?.email || mentor.institutionEmail;
    const mentorUserId = mentor.userId;
    const mentorHtml = await renderBookingConfirmationEmail({
      ...commonProps,
      recipientName: mentor.displayName,
      role: 'mentor',
    });
    await sendEmail({
      to: mentorEmail,
      subject: `New session booked: ${user.name} — HelpMeMan`,
      html: mentorHtml,
      userId: mentorUserId,
      templateType: 'booking_confirmed_mentor',
    });
  } catch (err) {
    console.error('[EMAIL] Failed to send mentor confirmation:', err.message);
  }
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

async function sendMentorUnderReviewEmail(user) {
  const name = user.displayName || user.name;
  const html = `<div style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:40px;color:#0f172a;line-height:1.6;">
    <h2 style="color:#4f46e5;margin-bottom:20px;">Mentor Onboarding Completed!</h2>
    <p>Hi ${name},</p>
    <p>Thank you for completing your mentor onboarding on HelpMeMan! Your profile details are now under review by our administrator team.</p>
    <p>We are currently reviewing your profile information, skills, and experience. You will receive an email notification as soon as your profile has been approved and is live on the platform.</p>
    <p>Typically, reviews are completed within 24-48 hours. If we need any additional details, we will reach out to you.</p>
    <br/>
    <p>Best regards,<br/>The HelpMeMan Team</p>
  </div>`;

  return sendEmail({
    to: user.email,
    subject: 'Your mentor application is in review — HelpMeMan',
    html,
    userId: user.id || user.userId,
    templateType: 'mentor_under_review',
  });
}

async function sendMentorApplicationToAdminEmail(mentorUser, answers) {
  const name = mentorUser.displayName || mentorUser.name;
  const email = mentorUser.email;
  const adminEmail = config.admin.notificationEmail || config.admin.email || 'admin@helpmeman.com';

  const answersHtml = answers
    .map(a => `<div style="margin-bottom: 16px; border-bottom: 1px solid #f1f5f9; padding-bottom: 12px;">
      <p style="margin: 0 0 4px 0; font-weight: bold; color: #334155;">Q: ${a.question}</p>
      <p style="margin: 0; color: #475569;">A: ${a.skipped ? '<span style="color: #94a3b8; font-style: italic;">Skipped</span>' : a.answer}</p>
    </div>`)
    .join('');

  const html = `<div style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:40px;color:#0f172a;line-height:1.6;">
    <h2 style="color:#4f46e5;margin-bottom:16px;">New Mentor Application Submitted</h2>
    <p>A new mentor has completed their onboarding and is awaiting review.</p>
    
    <h3 style="border-bottom:1px solid #e2e8f0;padding-bottom:8px;margin-top:24px;color:#0f172a;">Mentor Details</h3>
    <table style="width:100%;border-collapse:collapse;margin-top:10px;">
      <tr><td style="padding:6px 0;font-weight:bold;width:30%;color:#475569;">Name:</td><td style="padding:6px 0;color:#0f172a;">${name}</td></tr>
      <tr><td style="padding:6px 0;font-weight:bold;color:#475569;">Email:</td><td style="padding:6px 0;color:#0f172a;">${email}</td></tr>
    </table>

    <h3 style="border-bottom:1px solid #e2e8f0;padding-bottom:8px;margin-top:24px;color:#0f172a;">Onboarding Answers</h3>
    <div style="background:#f8fafc;padding:20px;border-radius:8px;margin-top:10px;">
      ${answersHtml}
    </div>
    
    <div style="margin-top:32px;text-align:center;">
      <a href="${config.frontendUrl}/admin" style="background:#4f46e5;color:#ffffff;padding:12px 24px;text-decoration:none;border-radius:6px;font-weight:bold;display:inline-block;">Go to Admin Dashboard</a>
    </div>
  </div>`;

  return sendEmail({
    to: adminEmail,
    subject: `New Mentor Application: ${name} — HelpMeMan`,
    html,
async function sendAccountStatusEmail(user, status, reason) {
  let html;
  const isOnHold = status === 'ON_HOLD';
  const name = user.name || user.displayName || 'there';

  try {
    html = await renderAccountStatusEmail({ name, status, reason });
  } catch (error) {
    console.error('[EMAIL] Account status template render failed, using fallback:', error.message);
    const title = isOnHold ? 'Notice: Your HelpMeMan account is on hold' : 'Your HelpMeMan account is active!';
    const body = isOnHold
      ? `Hi ${name},\n\nYour HelpMeMan account has been temporarily placed on hold by platform administration.` +
        (reason ? `\n\nReason: "${reason}"` : '') +
        `\n\nIf you have any questions or believe this is an error, please reply to this email to contact support.`
      : `Hi ${name},\n\nGood news! Your HelpMeMan account has been reactivated. You can now log in and access your account features.`;

    html = `<div style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:40px;line-height:1.6;color:#334155;">
      <h2 style="color:#0f172a;">${title}</h2>
      <p style="white-space:pre-wrap;">${body}</p>
      <p style="margin-top:30px;font-size:13px;color:#64748b;">HelpMeMan Team</p>
    </div>`;
  }

  return sendEmail({
    to: user.email,
    subject: isOnHold ? 'Notice: Your HelpMeMan account is on hold' : 'Your HelpMeMan account has been reactivated',
    html,
    userId: user.id || user.userId,
    templateType: isOnHold ? 'account_on_hold' : 'account_active',
  });
}

module.exports = {
  sendEmail,
  sendOtpEmail,
  sendNotificationEmail,
  sendWelcomeEmail,
  sendVerifyEmail,
  sendPasswordResetEmail,
  sendMentorApprovalEmail,
  sendMentorUnderReviewEmail,
  sendMentorApplicationToAdminEmail,
  sendAccountStatusEmail,
  sendWeeklyUpdateEmail,
  sendBookingConfirmationEmails,
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
