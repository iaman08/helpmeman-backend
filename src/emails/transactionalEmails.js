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
      { style: { textAlign: 'center', margin: '28px 0' } },
      React.createElement(Button, { href: verificationUrl, style: buttonStyle }, 'Verify email address')
    ),
    React.createElement(Text, { style: metaStyle }, 'This link expires in 24 hours.')
  );
}

function PasswordResetEmail({ name, resetUrl }) {
  return React.createElement(
    EmailLayout,
    { preview: 'Reset your HelpMeMan password', title: 'Reset your password' },
    React.createElement(Text, { style: greetingStyle }, `Hi ${name},`),
    React.createElement(Text, { style: bodyStyle }, 'We received a request to reset your password. Click the button below to choose a new one.'),
    React.createElement(
      Section,
      { style: { textAlign: 'center', margin: '28px 0' } },
      React.createElement(Button, { href: resetUrl, style: buttonStyle }, 'Reset password')
    ),
    React.createElement(Text, { style: metaStyle }, 'This link expires in 1 hour. If you did not request this, ignore this email.')
  );
}

function MentorApprovalEmail({ name, approved }) {
  const title = approved ? "You're approved!" : 'Application update';
  const body = approved
    ? 'Congratulations! Your mentor profile has been approved. Students can now discover and book sessions with you.'
    : 'We reviewed your mentor application and cannot approve it at this time. You can update your profile and reapply.';
  const url = approved ? `${config.frontendUrl}/mentor` : `${config.frontendUrl}/mentor/status`;

  return React.createElement(
    EmailLayout,
    { preview: body, title },
    React.createElement(Text, { style: greetingStyle }, `Hi ${name},`),
    React.createElement(Text, { style: bodyStyle }, body),
    React.createElement(
      Section,
      { style: { textAlign: 'center', margin: '28px 0' } },
      React.createElement(Button, { href: url, style: buttonStyle }, approved ? 'Go to mentor workspace' : 'View status')
    )
  );
}

function WelcomeEmail({ name }) {
  return React.createElement(
    EmailLayout,
    { preview: 'Welcome to HelpMeMan', title: 'Welcome aboard' },
    React.createElement(Text, { style: greetingStyle }, `Hi ${name},`),
    React.createElement(Text, { style: bodyStyle }, 'Welcome to HelpMeMan — connect with mentors from top institutions and companies across India.'),
    React.createElement(
      Section,
      { style: { textAlign: 'center', margin: '28px 0' } },
      React.createElement(Button, { href: `${config.frontendUrl}/mentors`, style: buttonStyle }, 'Browse mentors')
    )
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
      { style: { textAlign: 'center', margin: '28px 0' } },
      React.createElement(Button, { href: `${config.frontendUrl}/mentors`, style: buttonStyle }, 'Explore mentors')
    )
  );
}

const greetingStyle = { color: '#18181b', fontSize: '16px', lineHeight: '1.6', margin: '0 0 12px' };
const bodyStyle = { color: '#3f3f46', fontSize: '15px', lineHeight: '1.7', margin: '0 0 12px' };
const metaStyle = { color: '#71717a', fontSize: '13px', lineHeight: '1.5', margin: 0 };
const listStyle = { color: '#3f3f46', fontSize: '14px', lineHeight: '1.7', margin: '0 0 6px' };
const buttonStyle = {
  backgroundColor: '#6366f1',
  borderRadius: '10px',
  color: '#ffffff',
  fontSize: '15px',
  fontWeight: 600,
  padding: '14px 28px',
  textDecoration: 'none',
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
