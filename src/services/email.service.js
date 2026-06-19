const { Resend } = require('resend');
const nodemailer = require('nodemailer');
const { PrismaClient } = require('@prisma/client');
const config = require('../config/env');
const { renderOtpEmail } = require('../emails/otpEmail');
const { renderNotificationEmail } = require('../emails/notificationEmail');
const {
  renderVerifyEmail,
  renderPasswordResetEmail,
  renderMentorApprovalEmail,
  renderWelcomeEmail,
  renderWeeklyUpdateEmail,
} = require('../emails/transactionalEmails');

const prisma = new PrismaClient();

const resendClient = config.resend.apiKey ? new Resend(config.resend.apiKey) : null;

const smtpTransporter =
  config.smtp.host && config.smtp.user && config.smtp.pass
    ? nodemailer.createTransport({
        host: config.smtp.host,
        port: config.smtp.port,
        secure: config.smtp.port === 465,
        auth: { user: config.smtp.user, pass: config.smtp.pass },
      })
    : null;

async function logEmailDelivery({
  userId,
  toEmail,
  subject,
  templateType,
  status,
  resendId,
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
        resendId,
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

async function sendEmail({ to, subject, html, text, userId, templateType = 'generic', notificationId }) {
  const plainText = text || html.replace(/<[^>]*>/g, '');

  if (resendClient) {
    try {
      const result = await resendClient.emails.send({
        from: config.resend.fromEmail,
        to,
        subject,
        html,
        text: plainText,
      });

      await logEmailDelivery({
        userId,
        toEmail: to,
        subject,
        templateType,
        status: 'sent',
        resendId: result.data?.id || null,
        notificationId,
      });

      return { success: true, provider: 'resend', id: result.data?.id };
    } catch (error) {
      console.error('Resend send error:', error.message);
      await logEmailDelivery({
        userId,
        toEmail: to,
        subject,
        templateType,
        status: 'failed',
        errorMessage: error.message,
        notificationId,
      });
    }
  }

  if (smtpTransporter) {
    try {
      const info = await smtpTransporter.sendMail({
        from: `"HelpMeMan" <${config.smtp.fromEmail}>`,
        to,
        subject,
        html,
        text: plainText,
      });

      await logEmailDelivery({
        userId,
        toEmail: to,
        subject,
        templateType,
        status: 'sent',
        resendId: info.messageId,
        notificationId,
      });

      return { success: true, provider: 'smtp', id: info.messageId };
    } catch (error) {
      console.error('SMTP send error:', error.message);
      await logEmailDelivery({
        userId,
        toEmail: to,
        subject,
        templateType,
        status: 'failed',
        errorMessage: error.message,
        notificationId,
      });
    }
  }

  console.warn('No email provider configured — email not sent to', to);
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
  const html = await renderOtpEmail({ name, otp, purpose });
  return sendEmail({
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
