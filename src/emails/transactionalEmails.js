const React = require('react');
const { render } = require('@react-email/render');
const { Text, Button, Section } = require('@react-email/components');
const { EmailLayout } = require('./layout');
const config = require('../config/env');

function VerifyEmail({ name, verificationUrl }) {
  return React.createElement(
    EmailLayout,
    { preview: 'Confirm your email to activate your HelpMeMan account', title: 'Verify your email' },
    React.createElement(Text, { style: greetingStyle }, `Hi ${name},`),
    React.createElement(Text, { style: bodyStyle }, 'Please confirm your email address to activate your account and start connecting with mentors.'),
    React.createElement(
      Section,
      { style: { textAlign: 'center', margin: '32px 0 20px' } },
      React.createElement(Button, { href: verificationUrl, style: buttonStyle }, 'Verify Email Address')
    ),
    React.createElement(Text, { style: metaStyle }, '⏳ This verification link is valid for 24 hours.')
  );
}

function PasswordResetEmail({ name, resetUrl }) {
  return React.createElement(
    EmailLayout,
    { preview: 'Reset your HelpMeMan password safely', title: 'Reset your password' },
    React.createElement(Text, { style: greetingStyle }, `Hi ${name},`),
    React.createElement(Text, { style: bodyStyle }, 'We received a request to reset your password. Click the button below to secure your account and choose a new password:'),
    React.createElement(
      Section,
      { style: { textAlign: 'center', margin: '32px 0 20px' } },
      React.createElement(Button, { href: resetUrl, style: buttonStyle }, 'Reset My Password')
    ),
    React.createElement(Text, { style: metaStyle }, '⏳ This link is valid for 1 hour. If you did not request this, you can safely ignore this email.')
  );
}

function MentorApprovalEmail({ name, approved, reason }) {
  const title = approved ? "Congratulations! You're approved!" : 'Update on your mentor application';
  const body = approved
    ? 'Congratulations! Your mentor profile has been reviewed and approved. Mentees can now discover your profile, view your schedule, and book 1-on-1 mentorship sessions with you.'
    : `Thank you for applying to be a mentor on HelpMeMan. We reviewed your profile details and are unable to approve your application at this time.\n\nFeedback/Reason:\n"${reason || 'Please verify that your profile fields, LinkedIn URL, and expertise tags are complete.'}"`;
  const url = approved ? `${config.frontendUrl}/mentor` : `${config.frontendUrl}/mentor/status`;

  return React.createElement(
    EmailLayout,
    { preview: approved ? "Your HelpMeMan mentor profile is approved!" : "Update on your mentor application", title },
    React.createElement(Text, { style: greetingStyle }, `Hi ${name},`),
    React.createElement(Text, { style: bodyStyle }, body),
    React.createElement(
      Section,
      { style: { textAlign: 'center', margin: '32px 0 20px' } },
      React.createElement(Button, { href: url, style: buttonStyle }, approved ? 'Go to Mentor Panel' : 'Check Application Status')
    ),
    !approved ? React.createElement(Text, { style: metaStyle }, 'You can update your application profile settings and re-submit it for approval at any time.') : null
  );
}

function WelcomeEmail({ name }) {
  return React.createElement(
    EmailLayout,
    { preview: 'Welcome to HelpMeMan! Start connecting with top industry mentors.', title: 'Welcome to HelpMeMan' },
    React.createElement(Text, { style: greetingStyle }, `Hi ${name},`),
    React.createElement(Text, { style: bodyStyle }, 'We are thrilled to welcome you to HelpMeMan! Our platform connects students and professionals directly with top industry mentors from premier companies and institutions across India.'),
    React.createElement(Text, { style: bodyStyle }, 'Here is what you can do on HelpMeMan:'),
    React.createElement(Text, { style: listStyle }, '🚀 Book 1-on-1 sessions with verified mentors.'),
    React.createElement(Text, { style: listStyle }, '💼 Ask questions and get real-world career guidance.'),
    React.createElement(Text, { style: listStyle }, '📈 Get portfolio reviews and resume feedback.'),
    React.createElement(
      Section,
      { style: { textAlign: 'center', margin: '32px 0 20px' } },
      React.createElement(Button, { href: `${config.frontendUrl}/mentors`, style: buttonStyle }, 'Explore Verified Mentors')
    ),
    React.createElement(Text, { style: metaStyle }, 'If you have any questions or need assistance, feel free to reply to this email to contact our support team.')
  );
}

function WeeklyUpdateEmail({ name, highlights }) {
  const items = highlights || [
    'New mentors joined across product, engineering, and design.',
    'Session booking is faster with improved availability views.',
    'Your notification preferences are now fully customizable.',
  ];

  return React.createElement(
    EmailLayout,
    { preview: 'Your weekly HelpMeMan update', title: 'This week on HelpMeMan' },
    React.createElement(Text, { style: greetingStyle }, `Hi ${name},`),
    React.createElement(Text, { style: bodyStyle }, 'Here is a quick look at what is new on the platform:'),
    ...items.map((item, i) =>
      React.createElement(Text, { key: i, style: listStyle }, `• ${item}`)
    ),
    React.createElement(
      Section,
      { style: { textAlign: 'center', margin: '32px 0 20px' } },
      React.createElement(Button, { href: `${config.frontendUrl}/mentors`, style: buttonStyle }, 'Explore Mentors')
    )
  );
}

const greetingStyle = { color: '#0f172a', fontSize: '16px', fontWeight: '600', lineHeight: '1.6', margin: '0 0 16px' };
const bodyStyle = { color: '#334155', fontSize: '15px', lineHeight: '1.7', margin: '0 0 16px' };
const metaStyle = { color: '#64748b', fontSize: '13px', lineHeight: '1.5', margin: 0 };
const listStyle = { color: '#334155', fontSize: '14px', lineHeight: '1.7', margin: '0 0 8px' };
const buttonStyle = {
  backgroundColor: '#000000',
  borderRadius: '12px',
  color: '#ffffff',
  fontSize: '15px',
  fontWeight: '600',
  padding: '14px 28px',
  textDecoration: 'none',
  display: 'inline-block',
  textAlign: 'center',
};

/**
 * Booking Confirmation Email
 * Sent to both mentor and mentee after a successful payment + calendar event creation.
 *
 * @param {Object} props
 * @param {string} props.recipientName      - Name of the recipient
 * @param {string} props.role               - 'mentor' | 'mentee'
 * @param {string} props.mentorName
 * @param {string} props.menteeName
 * @param {string} props.scheduledAt        - ISO date string
 * @param {number} props.durationMinutes
 * @param {string} props.meetLink           - Google Meet URL (may be null)
 * @param {string} props.timezone           - IANA timezone
 * @param {string} props.bookingId
 */
function BookingConfirmationEmail({
  recipientName,
  role,
  mentorName,
  menteeName,
  scheduledAt,
  durationMinutes,
  meetLink,
  timezone,
  bookingId,
}) {
  const date = new Date(scheduledAt);
  const formattedDate = date.toLocaleDateString('en-IN', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
    timeZone: timezone || 'Asia/Kolkata',
  });
  const formattedTime = date.toLocaleTimeString('en-IN', {
    hour: '2-digit', minute: '2-digit',
    timeZone: timezone || 'Asia/Kolkata',
  });
  const formattedTz = timezone || 'Asia/Kolkata';
  const dashboardUrl = `${config.frontendUrl}/dashboard/bookings`;

  const sessionTitle = role === 'mentor'
    ? `New session booked with ${menteeName}`
    : `Your session with ${mentorName} is confirmed!`;

  const introText = role === 'mentor'
    ? `${menteeName} has successfully booked a mentorship session with you. All details are below.`
    : `Your payment was successful and your mentorship session has been confirmed. Here are the details:`;

  const detailsHtml = `
    <table style="width:100%;border-collapse:collapse;margin:20px 0;font-size:14px;color:#334155;">
      <tr style="border-bottom:1px solid #e2e8f0;">
        <td style="padding:12px 0;font-weight:600;color:#64748b;width:40%;">Session with</td>
        <td style="padding:12px 0;">${role === 'mentor' ? menteeName : mentorName}</td>
      </tr>
      <tr style="border-bottom:1px solid #e2e8f0;">
        <td style="padding:12px 0;font-weight:600;color:#64748b;">Date</td>
        <td style="padding:12px 0;">${formattedDate}</td>
      </tr>
      <tr style="border-bottom:1px solid #e2e8f0;">
        <td style="padding:12px 0;font-weight:600;color:#64748b;">Time</td>
        <td style="padding:12px 0;">${formattedTime} (${formattedTz})</td>
      </tr>
      <tr style="border-bottom:1px solid #e2e8f0;">
        <td style="padding:12px 0;font-weight:600;color:#64748b;">Duration</td>
        <td style="padding:12px 0;">${durationMinutes} minutes</td>
      </tr>
      <tr>
        <td style="padding:12px 0;font-weight:600;color:#64748b;">Booking ID</td>
        <td style="padding:12px 0;font-family:monospace;font-size:12px;">${bookingId}</td>
      </tr>
    </table>
  `;

  const meetSection = meetLink
    ? `
      <div style="background:#f0fdf4;border:1px solid #86efac;border-radius:12px;padding:20px;margin:24px 0;text-align:center;">
        <p style="margin:0 0 8px;font-size:13px;color:#16a34a;font-weight:600;text-transform:uppercase;letter-spacing:0.05em;">✅ Google Meet Link Ready</p>
        <p style="margin:0 0 16px;font-size:14px;color:#334155;">Your session will take place over Google Meet.</p>
        <a href="${meetLink}" style="background:#000;color:#fff;padding:12px 28px;border-radius:10px;text-decoration:none;font-weight:600;font-size:14px;display:inline-block;">
          🎥 Join Google Meet
        </a>
        <p style="margin:12px 0 0;font-size:12px;color:#64748b;">Or copy the link: <span style="font-family:monospace;">${meetLink}</span></p>
      </div>
    `
    : `
      <div style="background:#fefce8;border:1px solid #fde047;border-radius:12px;padding:20px;margin:24px 0;">
        <p style="margin:0;font-size:14px;color:#854d0e;">⏳ The Google Meet link will be shared separately by your mentor before the session.</p>
      </div>
    `;

  const html = `
    <div style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:40px 24px;color:#0f172a;line-height:1.6;">
      <div style="margin-bottom:32px;">
        <h1 style="font-size:24px;font-weight:700;margin:0 0 8px;color:#0f172a;">HelpMeMan</h1>
        <p style="margin:0;font-size:13px;color:#64748b;text-transform:uppercase;letter-spacing:0.08em;">Mentorship Platform</p>
      </div>

      <h2 style="font-size:20px;font-weight:700;margin:0 0 16px;color:#0f172a;">${sessionTitle}</h2>
      <p style="font-size:15px;color:#334155;margin:0 0 20px;">${introText}</p>

      ${detailsHtml}
      ${meetSection}

      <div style="text-align:center;margin:28px 0;">
        <a href="${dashboardUrl}" style="background:#000;color:#fff;padding:12px 28px;border-radius:10px;text-decoration:none;font-weight:600;font-size:14px;display:inline-block;">
          View in Dashboard
        </a>
      </div>

      <div style="margin-top:40px;padding-top:20px;border-top:1px solid #e2e8f0;">
        <p style="font-size:13px;color:#64748b;margin:0;">
          📅 This session has also been added to the mentor's Google Calendar.<br/>
          If you need to reschedule or cancel, please do so at least 24 hours in advance.
        </p>
      </div>

      <p style="font-size:12px;color:#94a3b8;margin-top:24px;">— The HelpMeMan Team</p>
    </div>
  `;

  return html;
}

async function renderBookingConfirmationEmail(props) {
  // Returns raw HTML (not React-email render, for simplicity and email client compatibility)
  return BookingConfirmationEmail(props);
}

async function renderVerifyEmail(props) {
  return render(React.createElement(VerifyEmail, props));
}
async function renderPasswordResetEmail(props) {
  return render(React.createElement(PasswordResetEmail, props));
}
async function renderMentorApprovalEmail(props) {
  return render(React.createElement(MentorApprovalEmail, props));
}
async function renderWelcomeEmail(props) {
  return render(React.createElement(WelcomeEmail, props));
}
async function renderWeeklyUpdateEmail(props) {
  return render(React.createElement(WeeklyUpdateEmail, props));
}

module.exports = {
  renderVerifyEmail,
  renderPasswordResetEmail,
  renderMentorApprovalEmail,
  renderWelcomeEmail,
  renderWeeklyUpdateEmail,
  renderBookingConfirmationEmail,
};

