const React = require('react');
const { render } = require('@react-email/render');
const { Text, Section } = require('@react-email/components');
const { EmailLayout } = require('./layout');

function OtpEmail({ name, otp, purpose = 'verify' }) {
  const isReset = purpose === 'reset';
  const isLogin = purpose === 'login';
  const title = isReset ? 'Reset your password' : isLogin ? 'Your login code' : 'Verify your email';
  const description = isReset
    ? 'Use this one-time code to reset your HelpMeMan password:'
    : isLogin
      ? 'Use this one-time code to sign in to HelpMeMan:'
      : 'Use this one-time code to verify your email and activate your account:';

  return React.createElement(
    EmailLayout,
    {
      preview: `Your HelpMeMan code is ${otp}`,
      title,
      footerNote: "If you didn't request this code, you can safely ignore this email.",
    },
    React.createElement(Text, { style: greetingStyle }, name ? `Hi ${name},` : 'Hi there,'),
    React.createElement(Text, { style: bodyStyle }, description),
    React.createElement(
      Section,
      { style: otpBoxStyle },
      React.createElement(Text, { style: otpStyle }, otp)
    ),
    React.createElement(Text, { style: metaStyle }, 'This code expires in 10 minutes.'),
    React.createElement(Text, { style: metaStyle }, 'For your security, never share this code with anyone.')
  );
}

const greetingStyle = { color: '#18181b', fontSize: '16px', lineHeight: '1.6', margin: '0 0 12px' };
const bodyStyle = { color: '#3f3f46', fontSize: '15px', lineHeight: '1.6', margin: '0 0 20px' };
const otpBoxStyle = {
  backgroundColor: '#f4f4f5',
  borderRadius: '12px',
  margin: '8px 0 20px',
  padding: '20px',
  textAlign: 'center',
};
const otpStyle = {
  color: '#4f46e5',
  fontSize: '36px',
  fontWeight: 700,
  letterSpacing: '10px',
  margin: 0,
};
const metaStyle = { color: '#71717a', fontSize: '13px', lineHeight: '1.5', margin: '0 0 8px' };

async function renderOtpEmail(props) {
  return render(React.createElement(OtpEmail, props));
}

module.exports = { OtpEmail, renderOtpEmail };
