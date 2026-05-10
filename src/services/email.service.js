const nodemailer = require('nodemailer');
const config = require('../config/env');

const transporter = nodemailer.createTransport({
  host: config.smtp.host,
  port: config.smtp.port,
  secure: config.smtp.port === 465,
  auth: {
    user: config.smtp.user,
    pass: config.smtp.pass,
  },
});

async function sendEmail({ to, subject, html, text }) {
  try {
    const info = await transporter.sendMail({
      from: `"HelpMeMan" <${config.smtp.fromEmail}>`,
      to,
      subject,
      html,
      text: text || html.replace(/<[^>]*>/g, ''),
    });
    console.log('Email sent:', info.messageId);
    return info;
  } catch (error) {
    console.error('Email send error:', error);
    // Don't throw — email failure shouldn't break the flow
    return null;
  }
}

// ─── Email Templates ───

function welcomeEmailTemplate(user) {
  return `
    <div style="font-family: 'Inter', Arial, sans-serif; max-width: 600px; margin: 0 auto; background: #ffffff; border-radius: 12px; overflow: hidden; border: 1px solid #e5e7eb;">
      <div style="background: linear-gradient(135deg, #6366f1, #8b5cf6); padding: 40px 30px; text-align: center;">
        <h1 style="color: #ffffff; margin: 0; font-size: 28px;">Welcome to HelpMeMan! 🎉</h1>
      </div>
      <div style="padding: 30px;">
        <p style="color: #374151; font-size: 16px; line-height: 1.6;">Hi <strong>${user.name}</strong>,</p>
        <p style="color: #374151; font-size: 16px; line-height: 1.6;">Welcome aboard! You now have access to India's most premium mentorship platform. Connect with mentors from IITs, AIIMS, FAANG, and top startups.</p>
        <div style="text-align: center; margin: 30px 0;">
          <a href="${config.frontendUrl}/mentors" style="background: #6366f1; color: #ffffff; padding: 14px 32px; border-radius: 8px; text-decoration: none; font-weight: 600; font-size: 16px; display: inline-block;">Browse Mentors</a>
        </div>
        <p style="color: #6b7280; font-size: 14px;">— Team HelpMeMan</p>
      </div>
    </div>
  `;
}

function emailVerificationTemplate(user, verificationUrl) {
  return `
    <div style="font-family: 'Inter', Arial, sans-serif; max-width: 600px; margin: 0 auto; background: #ffffff; border-radius: 12px; overflow: hidden; border: 1px solid #e5e7eb;">
      <div style="background: linear-gradient(135deg, #6366f1, #8b5cf6); padding: 40px 30px; text-align: center;">
        <h1 style="color: #ffffff; margin: 0; font-size: 28px;">Verify Your Email ✉️</h1>
      </div>
      <div style="padding: 30px;">
        <p style="color: #374151; font-size: 16px; line-height: 1.6;">Hi <strong>${user.name}</strong>,</p>
        <p style="color: #374151; font-size: 16px; line-height: 1.6;">Please verify your email address to activate your account:</p>
        <div style="text-align: center; margin: 30px 0;">
          <a href="${verificationUrl}" style="background: #6366f1; color: #ffffff; padding: 14px 32px; border-radius: 8px; text-decoration: none; font-weight: 600; font-size: 16px; display: inline-block;">Verify Email</a>
        </div>
        <p style="color: #6b7280; font-size: 14px;">This link expires in 24 hours.</p>
      </div>
    </div>
  `;
}

function otpEmailTemplate(email, otp) {
  return `
    <div style="font-family: 'Inter', Arial, sans-serif; max-width: 600px; margin: 0 auto; background: #ffffff; border-radius: 12px; overflow: hidden; border: 1px solid #e5e7eb;">
      <div style="background: linear-gradient(135deg, #6366f1, #8b5cf6); padding: 40px 30px; text-align: center;">
        <h1 style="color: #ffffff; margin: 0; font-size: 28px;">Your Verification Code 🔐</h1>
      </div>
      <div style="padding: 30px; text-align: center;">
        <p style="color: #374151; font-size: 16px; line-height: 1.6;">Use this OTP to verify your institution email:</p>
        <div style="background: #f3f4f6; border-radius: 12px; padding: 20px; margin: 20px 0; display: inline-block;">
          <span style="font-size: 36px; font-weight: 700; letter-spacing: 8px; color: #6366f1;">${otp}</span>
        </div>
        <p style="color: #6b7280; font-size: 14px;">This code expires in 10 minutes.</p>
      </div>
    </div>
  `;
}

function approvalEmailTemplate(mentor) {
  return `
    <div style="font-family: 'Inter', Arial, sans-serif; max-width: 600px; margin: 0 auto; background: #ffffff; border-radius: 12px; overflow: hidden; border: 1px solid #e5e7eb;">
      <div style="background: linear-gradient(135deg, #10b981, #059669); padding: 40px 30px; text-align: center;">
        <h1 style="color: #ffffff; margin: 0; font-size: 28px;">You're Approved! 🎉</h1>
      </div>
      <div style="padding: 30px;">
        <p style="color: #374151; font-size: 16px; line-height: 1.6;">Congratulations <strong>${mentor.displayName}</strong>,</p>
        <p style="color: #374151; font-size: 16px; line-height: 1.6;">Your mentor profile on HelpMeMan has been approved! Students can now discover and book sessions with you.</p>
        <div style="text-align: center; margin: 30px 0;">
          <a href="${config.frontendUrl}/mentor/dashboard" style="background: #10b981; color: #ffffff; padding: 14px 32px; border-radius: 8px; text-decoration: none; font-weight: 600; font-size: 16px; display: inline-block;">Go Live →</a>
        </div>
      </div>
    </div>
  `;
}

function rejectionEmailTemplate(mentor, reason) {
  return `
    <div style="font-family: 'Inter', Arial, sans-serif; max-width: 600px; margin: 0 auto; background: #ffffff; border-radius: 12px; overflow: hidden; border: 1px solid #e5e7eb;">
      <div style="background: #6366f1; padding: 40px 30px; text-align: center;">
        <h1 style="color: #ffffff; margin: 0; font-size: 28px;">Application Update</h1>
      </div>
      <div style="padding: 30px;">
        <p style="color: #374151; font-size: 16px; line-height: 1.6;">Hi <strong>${mentor.displayName}</strong>,</p>
        <p style="color: #374151; font-size: 16px; line-height: 1.6;">We've reviewed your mentor application and unfortunately, we're unable to approve it at this time.</p>
        <div style="background: #fef3c7; border-left: 4px solid #f59e0b; padding: 16px; border-radius: 0 8px 8px 0; margin: 20px 0;">
          <p style="color: #92400e; font-size: 14px; margin: 0;"><strong>Reason:</strong> ${reason}</p>
        </div>
        <p style="color: #374151; font-size: 16px; line-height: 1.6;">You're welcome to update your profile and reapply.</p>
        <div style="text-align: center; margin: 30px 0;">
          <a href="${config.frontendUrl}/mentor/signup" style="background: #6366f1; color: #ffffff; padding: 14px 32px; border-radius: 8px; text-decoration: none; font-weight: 600; font-size: 16px; display: inline-block;">Reapply</a>
        </div>
      </div>
    </div>
  `;
}

function bookingConfirmedTemplate(user, mentor, booking) {
  const date = new Date(booking.scheduledAt).toLocaleDateString('en-IN', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
  });
  const time = new Date(booking.scheduledAt).toLocaleTimeString('en-IN', {
    hour: '2-digit', minute: '2-digit',
  });

  return `
    <div style="font-family: 'Inter', Arial, sans-serif; max-width: 600px; margin: 0 auto; background: #ffffff; border-radius: 12px; overflow: hidden; border: 1px solid #e5e7eb;">
      <div style="background: linear-gradient(135deg, #10b981, #059669); padding: 40px 30px; text-align: center;">
        <h1 style="color: #ffffff; margin: 0; font-size: 28px;">Session Confirmed! ✅</h1>
      </div>
      <div style="padding: 30px;">
        <div style="background: #f0fdf4; border-radius: 12px; padding: 20px; margin-bottom: 20px;">
          <p style="margin: 4px 0; color: #374151;"><strong>Mentor:</strong> ${mentor.displayName}</p>
          <p style="margin: 4px 0; color: #374151;"><strong>Date:</strong> ${date}</p>
          <p style="margin: 4px 0; color: #374151;"><strong>Time:</strong> ${time}</p>
          <p style="margin: 4px 0; color: #374151;"><strong>Duration:</strong> ${booking.durationMinutes} minutes</p>
        </div>
        ${booking.meetLink ? `
          <div style="text-align: center; margin: 30px 0;">
            <a href="${booking.meetLink}" style="background: #10b981; color: #ffffff; padding: 16px 40px; border-radius: 8px; text-decoration: none; font-weight: 700; font-size: 18px; display: inline-block;">Join Google Meet</a>
          </div>
        ` : ''}
        <p style="color: #6b7280; font-size: 14px; text-align: center;">You'll receive a reminder 1 hour before the session.</p>
      </div>
    </div>
  `;
}

function sessionReminderTemplate(user, booking) {
  return `
    <div style="font-family: 'Inter', Arial, sans-serif; max-width: 600px; margin: 0 auto; background: #ffffff; border-radius: 12px; overflow: hidden; border: 1px solid #e5e7eb;">
      <div style="background: linear-gradient(135deg, #f59e0b, #d97706); padding: 40px 30px; text-align: center;">
        <h1 style="color: #ffffff; margin: 0; font-size: 28px;">Session in 1 Hour ⏰</h1>
      </div>
      <div style="padding: 30px;">
        <p style="color: #374151; font-size: 16px; line-height: 1.6;">Hi <strong>${user.name}</strong>, your mentorship session is starting in 1 hour!</p>
        ${booking.meetLink ? `
          <div style="text-align: center; margin: 30px 0;">
            <a href="${booking.meetLink}" style="background: #10b981; color: #ffffff; padding: 16px 40px; border-radius: 8px; text-decoration: none; font-weight: 700; font-size: 18px; display: inline-block;">Join Google Meet</a>
          </div>
        ` : ''}
      </div>
    </div>
  `;
}

function passwordResetTemplate(user, resetUrl) {
  return `
    <div style="font-family: 'Inter', Arial, sans-serif; max-width: 600px; margin: 0 auto; background: #ffffff; border-radius: 12px; overflow: hidden; border: 1px solid #e5e7eb;">
      <div style="background: #6366f1; padding: 40px 30px; text-align: center;">
        <h1 style="color: #ffffff; margin: 0; font-size: 28px;">Reset Your Password 🔑</h1>
      </div>
      <div style="padding: 30px;">
        <p style="color: #374151; font-size: 16px; line-height: 1.6;">Hi <strong>${user.name}</strong>,</p>
        <p style="color: #374151; font-size: 16px; line-height: 1.6;">Click the button below to reset your password:</p>
        <div style="text-align: center; margin: 30px 0;">
          <a href="${resetUrl}" style="background: #6366f1; color: #ffffff; padding: 14px 32px; border-radius: 8px; text-decoration: none; font-weight: 600; font-size: 16px; display: inline-block;">Reset Password</a>
        </div>
        <p style="color: #6b7280; font-size: 14px;">This link expires in 1 hour. If you didn't request this, please ignore.</p>
      </div>
    </div>
  `;
}

module.exports = {
  sendEmail,
  welcomeEmailTemplate,
  emailVerificationTemplate,
  otpEmailTemplate,
  approvalEmailTemplate,
  rejectionEmailTemplate,
  bookingConfirmedTemplate,
  sessionReminderTemplate,
  passwordResetTemplate,
};
