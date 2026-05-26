const nodemailer = require('nodemailer');
const config = require('./config/env');

console.log("Testing SMTP connection configurations...");
console.log("SMTP Host:", config.smtp.host);
console.log("SMTP Port:", config.smtp.port);
console.log("SMTP User:", config.smtp.user);
console.log("SMTP Pass Length:", config.smtp.pass ? config.smtp.pass.length : 0);
console.log("From Email:", config.smtp.fromEmail);

if (!config.smtp.pass || config.smtp.pass === "YOUR_GMAIL_APP_PASSWORD") {
  console.warn("\n⚠️ WARNING: Please update the SMTP_PASS variable in helpmeman-backend/.env with your Google App Password first!");
  process.exit(1);
}

const transporter = nodemailer.createTransport({
  host: config.smtp.host,
  port: config.smtp.port,
  secure: config.smtp.port === 465,
  auth: {
    user: config.smtp.user,
    pass: config.smtp.pass,
  },
});

transporter.verify(function(error, success) {
  if (error) {
    console.error("\n❌ SMTP Verification Failed:", error.message || error);
    if (error.code === 'EAUTH' || (error.message && error.message.includes('535'))) {
      console.log("\n==========================================================================");
      console.log("👉 DETECTED GMAIL AUTHENTICATION FAILURE (Bad Credentials)");
      console.log("Google blocks third-party apps from signing in with your main password.");
      console.log("You must use a 16-character Google App Password instead of your regular password.");
      console.log("\nFollow these steps to create one:");
      console.log("1. Open: https://myaccount.google.com/security");
      console.log("2. Enable '2-Step Verification' under 'How you sign in to Google'.");
      console.log("3. Search for 'App passwords' at the top of Google Account settings.");
      console.log("4. Create an App password named 'HelpMeMan'.");
      console.log("5. Copy the 16-character code (e.g. 'abcd efgh ijkl mnop').");
      console.log("6. Paste it into your 'helpmeman-backend/.env' as 'SMTP_PASS' (without spaces).");
      console.log("==========================================================================\n");
    }
  } else {
    console.log("\n✅ Success! SMTP server connection verified successfully. Ready to send emails.");
  }
  process.exit(0);
});
