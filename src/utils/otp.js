const crypto = require('crypto');

function generateOTP(length = 6) {
  const digits = '0123456789';
  let otp = '';
  const bytes = crypto.randomBytes(length);
  for (let i = 0; i < length; i++) {
    otp += digits[bytes[i] % 10];
  }
  return otp;
}

// In-memory OTP store (use Redis in production)
const otpStore = new Map();

function storeOTP(email, otp, expiresInMs = 10 * 60 * 1000) {
  otpStore.set(email.toLowerCase(), {
    otp,
    expiresAt: Date.now() + expiresInMs,
  });
}

function verifyOTP(email, otp) {
  const entry = otpStore.get(email.toLowerCase());
  if (!entry) return false;
  if (Date.now() > entry.expiresAt) {
    otpStore.delete(email.toLowerCase());
    return false;
  }
  if (entry.otp !== otp) return false;
  otpStore.delete(email.toLowerCase());
  return true;
}

module.exports = { generateOTP, storeOTP, verifyOTP };
