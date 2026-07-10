const React = require('react');
const { render } = require('@react-email/render');
const { Text, Button, Section } = require('@react-email/components');
const { EmailLayout } = require('./layout');
const config = require('../config/env');

function NotificationEmail({ name, title, body, actionUrl, actionLabel, badge }) {
  return React.createElement(
    EmailLayout,
    { preview: body, title },
    badge
      ? React.createElement(
          Section,
          { style: badgeWrapStyle },
          React.createElement(Text, { style: badgeStyle }, badge)
        )
      : null,
    React.createElement(Text, { style: greetingStyle }, name ? `Hi ${name},` : 'Hi there,'),
    React.createElement(Text, { style: bodyStyle }, body),
    actionUrl
      ? React.createElement(
          Section,
          { style: { textAlign: 'center', marginTop: '24px' } },
          React.createElement(Button, { href: actionUrl, style: buttonStyle }, actionLabel || 'View in HelpMeMan')
        )
      : null
  );
}

const badgeWrapStyle = { marginBottom: '12px' };
const badgeStyle = {
  backgroundColor: '#eef2ff',
  borderRadius: '999px',
  color: '#4338ca',
  display: 'inline-block',
  fontSize: '11px',
  fontWeight: 700,
  letterSpacing: '0.08em',
  margin: 0,
  padding: '6px 12px',
  textTransform: 'uppercase',
};
const greetingStyle = { color: '#18181b', fontSize: '16px', lineHeight: '1.6', margin: '0 0 12px' };
const bodyStyle = { color: '#3f3f46', fontSize: '15px', lineHeight: '1.7', margin: 0 };
const buttonStyle = {
  backgroundColor: '#6366f1',
  borderRadius: '10px',
  color: '#ffffff',
  fontSize: '15px',
  fontWeight: 600,
  padding: '14px 28px',
  textDecoration: 'none',
};

function actionUrlForType(type) {
  const base = config.frontendUrl;
  const map = {
    CHAT_MESSAGE: `${base}/mentor/bookings`,
    CHAT_REPLY: `${base}/dashboard/chat`,
    NEW_BOOKING: `${base}/mentor/bookings`,
    BOOKING_CONFIRMED: `${base}/dashboard/bookings`,
    SESSION_REMINDER: `${base}/dashboard/bookings`,
    MENTOR_APPROVED: `${base}/mentor`,
    MENTOR_REJECTED: `${base}/mentor/status`,
    SECURITY_ALERT: `${base}/dashboard/settings`,
    ACCOUNT_UPDATE: `${base}/dashboard/settings`,
    PLATFORM_ANNOUNCEMENT: `${base}/dashboard`,
  };
  return map[type] || `${base}/dashboard/notifications`;
}

function badgeForType(type) {
  const map = {
    CHAT_MESSAGE: 'New message',
    CHAT_REPLY: 'New reply',
    NEW_BOOKING: 'Booking',
    SESSION_REMINDER: 'Reminder',
    MENTOR_APPROVED: 'Approved',
    MENTOR_REJECTED: 'Update',
    SECURITY_ALERT: 'Security',
    MARKETING: 'Updates',
  };
  return map[type] || 'Notification';
}

async function renderNotificationEmail({ name, title, body, type }) {
  return render(
    React.createElement(NotificationEmail, {
      name,
      title,
      body,
      type,
      badge: badgeForType(type),
      actionUrl: actionUrlForType(type),
    })
  );
}

module.exports = { NotificationEmail, renderNotificationEmail, actionUrlForType, badgeForType };
