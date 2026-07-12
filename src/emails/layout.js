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

const BRAND = '#000000'; // Black
const BRAND_DARK = '#000000';
const TEXT_MAIN = '#334155'; // Slate 700
const TEXT_DARK = '#0f172a'; // Slate 900
const TEXT_MUTED = '#64748b'; // Slate 500

function EmailLayout({ preview, title, children, footerNote }) {
  return React.createElement(
    Html,
    null,
    React.createElement(
      Head,
      null,
      React.createElement('title', null, title || 'HelpMeMan')
    ),
    preview ? React.createElement(Preview, null, preview) : null,
    React.createElement(
      Body,
      { style: bodyStyle },
      React.createElement(
        Container,
        { style: containerStyle },
        // Header / Logo
        React.createElement(
          Section,
          { style: headerStyle },
          React.createElement(
            Link,
            { href: 'https://helpmeman.com', style: logoLinkStyle },
            'HelpMeMan',
            React.createElement('span', { style: logoDotStyle }, '.')
          )
        ),
        
        // Main Content Card
        React.createElement(
          Section,
          { style: cardStyle },
          title ? React.createElement(Text, { style: titleStyle }, title) : null,
          React.createElement(Section, { style: contentStyle }, children)
        ),
        
        // Footer Area
        React.createElement(
          Section,
          { style: footerContainerStyle },
          React.createElement(Hr, { style: hrStyle }),
          React.createElement(
            Text,
            { style: footerTextStyle },
            footerNote || 'You received this email because you have a registered account on HelpMeMan.'
          ),
          React.createElement(
            Text,
            { style: footerLinksStyle },
            React.createElement(Link, { href: 'https://helpmeman.com', style: footerLinkStyle }, 'Website'),
            '  •  ',
            React.createElement(Link, { href: 'mailto:support@helpmeman.com', style: footerLinkStyle }, 'Contact Support')
          ),
          React.createElement(Hr, { style: hrStyle }),
          React.createElement(
            Text,
            { style: securityNoticeStyle },
            '🔒 SECURITY NOTICE: HelpMeMan staff will never ask you for your login credentials or OTP. Keep your account secure.'
          ),
          React.createElement(
            Text,
            { style: copyrightStyle },
            `© ${new Date().getFullYear()} HelpMeMan. All rights reserved.`
          )
        )
      )
    )
  );
}

const bodyStyle = {
  backgroundColor: '#f8fafc', // Slate 50
  fontFamily: "Outfit, Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
  margin: 0,
  padding: '40px 16px',
};

const containerStyle = {
  margin: '0 auto',
  maxWidth: '560px',
};

const headerStyle = {
  padding: '0 0 28px',
  textAlign: 'center',
};

const logoLinkStyle = {
  color: TEXT_DARK,
  fontSize: '28px',
  fontWeight: 800,
  letterSpacing: '-0.03em',
  textDecoration: 'none',
  fontFamily: "Outfit, Inter, sans-serif",
};

const logoDotStyle = {
  color: BRAND,
};

const cardStyle = {
  backgroundColor: '#ffffff',
  borderRadius: '24px',
  border: '1px solid #e2e8f0', // Slate 200
  boxShadow: '0 10px 40px rgba(15, 23, 42, 0.03)',
  padding: '40px 32px',
  overflow: 'hidden',
};

const titleStyle = {
  color: TEXT_DARK,
  fontSize: '22px',
  fontWeight: 700,
  lineHeight: '1.3',
  margin: '0 0 24px',
  textAlign: 'left',
};

const contentStyle = {
  margin: 0,
};

const hrStyle = {
  borderColor: '#f1f5f9', // Slate 100
  margin: '20px 0',
};

const footerContainerStyle = {
  textAlign: 'center',
  padding: '24px 0 0',
};

const footerTextStyle = {
  color: TEXT_MUTED,
  fontSize: '12px',
  lineHeight: '1.6',
  margin: '0 0 12px',
};

const footerLinksStyle = {
  color: TEXT_MUTED,
  fontSize: '12px',
  margin: '0 0 20px',
};

const footerLinkStyle = {
  color: BRAND,
  textDecoration: 'none',
  fontWeight: 500,
};

const securityNoticeStyle = {
  color: '#94a3b8', // Slate 400
  fontSize: '11px',
  lineHeight: '1.5',
  margin: '0 0 16px',
};

const copyrightStyle = {
  color: '#94a3b8',
  fontSize: '11px',
  margin: 0,
};

module.exports = { EmailLayout, BRAND, BRAND_DARK, TEXT_MAIN, TEXT_DARK, TEXT_MUTED };
