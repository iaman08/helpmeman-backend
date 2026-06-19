const React = require('react');
const {
  Html,
  Head,
  Preview,
  Body,
  Container,
  Section,
  Text,
  Link,
  Hr,
} = require('@react-email/components');

const BRAND = '#6366f1';
const BRAND_DARK = '#4f46e5';

function EmailLayout({ preview, title, children, footerNote }) {
  return React.createElement(
    Html,
    null,
    React.createElement(Head, null, React.createElement('title', null, title)),
    preview ? React.createElement(Preview, null, preview) : null,
    React.createElement(
      Body,
      { style: bodyStyle },
      React.createElement(
        Container,
        { style: containerStyle },
        React.createElement(
          Section,
          { style: headerStyle },
          React.createElement(Text, { style: logoStyle }, 'HelpMeMan'),
          title ? React.createElement(Text, { style: titleStyle }, title) : null
        ),
        React.createElement(Section, { style: contentStyle }, children),
        React.createElement(Hr, { style: hrStyle }),
        React.createElement(
          Text,
          { style: footerStyle },
          footerNote || 'You received this email because you have an account on HelpMeMan.',
          ' ',
          React.createElement(Link, { href: 'https://helpmeman.com/dashboard/settings', style: linkStyle }, 'Manage notifications')
        )
      )
    )
  );
}

const bodyStyle = {
  backgroundColor: '#f4f4f5',
  fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
  margin: 0,
  padding: '24px 0',
};

const containerStyle = {
  backgroundColor: '#ffffff',
  borderRadius: '16px',
  border: '1px solid #e4e4e7',
  margin: '0 auto',
  maxWidth: '560px',
  overflow: 'hidden',
};

const headerStyle = {
  background: `linear-gradient(135deg, ${BRAND}, #8b5cf6)`,
  padding: '32px 28px',
  textAlign: 'center',
};

const logoStyle = {
  color: '#ffffff',
  fontSize: '14px',
  fontWeight: 700,
  letterSpacing: '0.2em',
  margin: '0 0 8px',
  textTransform: 'uppercase',
};

const titleStyle = {
  color: '#ffffff',
  fontSize: '24px',
  fontWeight: 700,
  lineHeight: '1.3',
  margin: 0,
};

const contentStyle = {
  padding: '28px',
};

const hrStyle = {
  borderColor: '#e4e4e7',
  margin: '0 28px',
};

const footerStyle = {
  color: '#71717a',
  fontSize: '12px',
  lineHeight: '1.6',
  padding: '20px 28px 28px',
  margin: 0,
};

const linkStyle = {
  color: BRAND_DARK,
  textDecoration: 'underline',
};

module.exports = { EmailLayout, BRAND, BRAND_DARK };
