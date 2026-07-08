const React = require('react');
const { render } = require('@react-email/render');
const { Text, Section } = require('@react-email/components');
const { EmailLayout, BRAND } = require('./layout');

function OtpEmail({ name, otp, purpose = 'verify' }) {
  const isReset = purpose === 'reset';
  const isLogin = purpose === 'login';
  const title = isReset ? 'Reset your password' : isLogin ? 'Your login code' : 'Verify your email';
  
  const description = isReset
    ? 'We received a request to reset your password. Use the following 6-digit one-time code to proceed:'
    : isLogin
      ? 'Use this secure one-time code to sign in to your HelpMeMan account:'
      : 'Thank you for signing up for HelpMeMan. Use this secure one-time code to verify your email and activate your account:';

  return React.createElement(
    EmailLayout,
    {
      preview: `Your HelpMeMan code is ${otp}`,
      title,
      footerNote: "If you didn't request this code, you can safely ignore this email. Someone may have typed your email by mistake.",
    },
    React.createElement(Text, { style: greetingStyle }, name ? `Hi ${name},` : 'Hi there,'),
    React.createElement(Text, { style: bodyStyle }, description),
    
    // Large Centered OTP Card
    React.createElement(
      Section,
      { style: otpBoxStyle },
      React.createElement(Text, { style: otpLabelStyle }, 'ONE-TIME PASSWORD'),
      React.createElement(Text, { style: otpStyle }, otp)
    ),
    
    React.createElement(Text, { style: metaStyle }, '⏳ This code is valid for exactly 10 minutes.'),
    React.createElement(
      Text,
      { style: warningStyle },
      '⚠️ Never share this code with anyone. HelpMeMan support will never ask for this code.'
    )
  );
}

const greetingStyle = { color: '#0f172a', fontSize: '16px', fontWeight: '600', lineHeight: '1.6', margin: '0 0 16px' };
const bodyStyle = { color: '#334155', fontSize: '15px', lineHeight: '1.6', margin: '0 0 28px' };
const otpBoxStyle = {
  backgroundColor: '#f8fafc', // Slate 50
  borderRadius: '16px',
  border: '1px solid #e2e8f0', // Slate 200
  margin: '16px 0 28px',
  padding: '24px',
  textAlign: 'center',
};
const otpLabelStyle = {
  color: '#64748b',
  fontSize: '11px',
  fontWeight: '700',
  letterSpacing: '0.15em',
  margin: '0 0 12px',
};
const otpStyle = {
  color: BRAND,
  fontSize: '44px',
  fontWeight: '850',
  letterSpacing: '12px',
  fontFamily: "monospace, Courier, sans-serif",
  margin: 0,
  paddingLeft: '12px', // centers the letterSpacing!
};
const metaStyle = { color: '#64748b', fontSize: '13px', lineHeight: '1.5', margin: '0 0 8px' };
const warningStyle = { color: '#ef4444', fontSize: '13px', fontWeight: '500', lineHeight: '1.5', margin: 0 };

async function renderOtpEmail(props) {
  return render(React.createElement(OtpEmail, props));
}

module.exports = { OtpEmail, renderOtpEmail };
