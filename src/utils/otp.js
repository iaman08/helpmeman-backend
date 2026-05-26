const crypto = require('crypto');

// ─── OTP Store ─────────────────────────────────────────────────
// Uses Upstash Redis in production, in-memory Map for development.
// Each entry stores: { otp, expiresAt, attempts, lastSentAt, sentCount }

let redisClient = null;

try {
  const config = require('../config/env');
  if (config.upstash?.url && config.upstash?.token) {
    const { Redis } = require('@upstash/redis');
    redisClient = new Redis({
      url: config.upstash.url,
      token: config.upstash.token,
    });
    console.log('✅ OTP store: Upstash Redis');
  }
} catch (e) {
  console.warn('⚠️ OTP store: falling back to in-memory (Redis unavailable)');
}

// In-memory fallback
const otpStore = new Map();

// ─── Constants ─────────────────────────────────────────────────
const OTP_EXPIRY_MS = 10 * 60 * 1000;        // 10 minutes
const OTP_COOLDOWN_MS = 60 * 1000;            // 1 request per 60 seconds
const MAX_ATTEMPTS = 5;                        // max verification attempts per OTP
const MAX_SENDS_PER_HOUR = 5;                  // max OTPs per email per hour
const HOUR_MS = 60 * 60 * 1000;

// ─── Generate a cryptographically random 6-digit OTP ───────────
function generateOTP(length = 6) {
  const digits = '0123456789';
  let otp = '';
  const bytes = crypto.randomBytes(length);
  for (let i = 0; i < length; i++) {
    otp += digits[bytes[i] % 10];
  }
  return otp;
}

// ─── Redis key helpers ─────────────────────────────────────────
function otpKey(email) { return `otp:${email.toLowerCase()}`; }
function rateKey(email) { return `otp_rate:${email.toLowerCase()}`; }

// ─── Store OTP ─────────────────────────────────────────────────
async function storeOTP(email, otp) {
  const key = email.toLowerCase();
  const now = Date.now();
  const entry = {
    otp,
    expiresAt: now + OTP_EXPIRY_MS,
    attempts: 0,
    lastSentAt: now,
  };

  if (redisClient) {
    try {
      await redisClient.set(otpKey(key), JSON.stringify(entry), { ex: Math.ceil(OTP_EXPIRY_MS / 1000) });
      // Increment hourly send counter
      const rk = rateKey(key);
      const current = await redisClient.incr(rk);
      if (current === 1) {
        await redisClient.expire(rk, Math.ceil(HOUR_MS / 1000));
      }
    } catch (e) {
      console.error('Redis storeOTP error, falling back to memory:', e.message);
      otpStore.set(key, entry);
    }
  } else {
    // In-memory: also track hourly sends
    const existing = otpStore.get(key);
    const hourlyCount = (existing && existing.hourlyResetAt > now) ? (existing.hourlySends || 0) : 0;
    entry.hourlySends = hourlyCount + 1;
    entry.hourlyResetAt = (existing && existing.hourlyResetAt > now) ? existing.hourlyResetAt : now + HOUR_MS;
    otpStore.set(key, entry);
  }
}

// ─── Rate limit check: can this email request a new OTP? ───────
async function canRequestOTP(email) {
  const key = email.toLowerCase();
  const now = Date.now();

  let sendCount = 0;
  let entry = null;

  if (redisClient) {
    try {
      // Check hourly limit
      const count = await redisClient.get(rateKey(key));
      if (count) sendCount = parseInt(count);

      // Check cooldown
      const raw = await redisClient.get(otpKey(key));
      if (raw) {
        entry = typeof raw === 'string' ? JSON.parse(raw) : raw;
      }
    } catch (e) {
      console.error('Redis canRequestOTP error, falling back to memory check:', e.message);
    }
  }

  // Fallback and combine checks with memory store
  const memEntry = otpStore.get(key);
  if (memEntry) {
    if (!entry) entry = memEntry;
    if (memEntry.hourlyResetAt > now) {
      sendCount = Math.max(sendCount, memEntry.hourlySends || 0);
    }
  }

  if (sendCount >= MAX_SENDS_PER_HOUR) {
    return { allowed: false, reason: 'Too many OTP requests. Try again in an hour.', cooldown: 0 };
  }

  if (entry) {
    const elapsed = now - entry.lastSentAt;
    if (elapsed < OTP_COOLDOWN_MS) {
      const remaining = Math.ceil((OTP_COOLDOWN_MS - elapsed) / 1000);
      return { allowed: false, reason: `Please wait ${remaining} seconds before requesting another OTP.`, cooldown: remaining };
    }
  }

  return { allowed: true, cooldown: 0 };
}

// ─── Get cooldown remaining (seconds) ──────────────────────────
async function getOTPCooldown(email) {
  const key = email.toLowerCase();
  const now = Date.now();

  let entry = null;

  if (redisClient) {
    try {
      const raw = await redisClient.get(otpKey(key));
      if (raw) {
        entry = typeof raw === 'string' ? JSON.parse(raw) : raw;
      }
    } catch (e) { /* silent */ }
  }

  if (!entry) {
    entry = otpStore.get(key);
  }

  if (entry) {
    const elapsed = now - entry.lastSentAt;
    if (elapsed < OTP_COOLDOWN_MS) {
      return Math.ceil((OTP_COOLDOWN_MS - elapsed) / 1000);
    }
  }
  return 0;
}

// ─── Verify OTP ────────────────────────────────────────────────
async function verifyOTP(email, otp) {
  const key = email.toLowerCase();
  const now = Date.now();

  let entry = null;

  if (redisClient) {
    try {
      const raw = await redisClient.get(otpKey(key));
      if (raw) {
        entry = typeof raw === 'string' ? JSON.parse(raw) : raw;
      }
    } catch (e) {
      console.error('Redis verifyOTP error, falling back to memory check:', e.message);
    }
  }

  // If not found in Redis, check local in-memory backup
  if (!entry) {
    entry = otpStore.get(key);
  }

  if (!entry) {
    return { valid: false, error: 'No OTP found. Please request a new one.' };
  }

  if (now > entry.expiresAt) {
    if (redisClient) {
      try { await redisClient.del(otpKey(key)); } catch (e) {}
    }
    otpStore.delete(key);
    return { valid: false, error: 'OTP has expired. Please request a new one.' };
  }

  if (entry.attempts >= MAX_ATTEMPTS) {
    if (redisClient) {
      try { await redisClient.del(otpKey(key)); } catch (e) {}
    }
    otpStore.delete(key);
    return { valid: false, error: 'Too many failed attempts. Please request a new OTP.' };
  }

  if (entry.otp !== otp) {
    entry.attempts += 1;
    const remaining = MAX_ATTEMPTS - entry.attempts;
    
    // Update attempts in both locations
    if (redisClient) {
      try {
        const ttl = Math.ceil((entry.expiresAt - now) / 1000);
        await redisClient.set(otpKey(key), JSON.stringify(entry), { ex: ttl > 0 ? ttl : 1 });
      } catch (e) {
        otpStore.set(key, entry);
      }
    } else {
      otpStore.set(key, entry);
    }
    return { valid: false, error: `Invalid OTP. ${remaining} attempt${remaining !== 1 ? 's' : ''} remaining.` };
  }

  // Success — delete OTP from both locations
  if (redisClient) {
    try { await redisClient.del(otpKey(key)); } catch (e) {}
  }
  otpStore.delete(key);
  return { valid: true };
}

module.exports = { generateOTP, storeOTP, verifyOTP, canRequestOTP, getOTPCooldown };
