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
  backgroundColor: '#0f172a', // Slate 900
  borderRadius: '12px',
  color: '#ffffff',
  fontSize: '15px',
  fontWeight: '600',
  padding: '14px 28px',
  textDecoration: 'none',
  display: 'inline-block',
  textAlign: 'center',
};

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
};
