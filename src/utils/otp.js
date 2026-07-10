/**
 * OTP Utility — Production-Grade Implementation
 *
 * Storage strategy:
 *  PRIMARY  → PostgreSQL (OtpCode table via Prisma) — mandatory, always written
 *  CACHE    → Upstash Redis (optional) — written after DB succeeds, used for fast reads
 *  MEMORY   → REMOVED (wiped on restart, causes stale-state bugs)
 *
 * Key invariant: DB is always the source of truth.
 * If DB write fails → throw error immediately (do NOT silently fall back).
 * If Redis fails    → log warning, continue using DB. No error to the user.
 */

const crypto = require('crypto');
const prisma = require('../config/prisma');

// ─── Constants ────────────────────────────────────────────────────────────────
const OTP_EXPIRY_MS     = 10 * 60 * 1000;   // 10 minutes
const OTP_COOLDOWN_MS   = 60 * 1000;         // 60s between requests
const MAX_ATTEMPTS      = 5;
const MAX_SENDS_PER_HOUR = 5;
const HOUR_MS           = 60 * 60 * 1000;
const isDev             = process.env.NODE_ENV !== 'production';

// Lightweight performance timer
const t = () => process.hrtime.bigint();
const ms = (start) => `${Number(process.hrtime.bigint() - start) / 1e6 | 0}ms`;

// ─── Redis Setup (optional cache) ────────────────────────────────────────────
let redisClient   = null;
let redisOk       = false;   // true only when Redis is reachable & not rate-limited

try {
  const config = require('../config/env');
  if (config.upstash?.url && config.upstash?.token) {
    const { Redis } = require('@upstash/redis');
    redisClient = new Redis({ url: config.upstash.url, token: config.upstash.token });
    redisOk = true;
    console.log('✅ OTP cache: Upstash Redis (DB is primary store)');
  } else {
    console.log('✅ OTP store: Database only (Redis not configured)');
  }
} catch (e) {
  console.warn('⚠️ OTP store: Database only (Redis init failed)');
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function generateOTP(length = 6) {
  const digits = '0123456789';
  const bytes  = crypto.randomBytes(length);
  let otp = '';
  for (let i = 0; i < length; i++) otp += digits[bytes[i] % 10];
  return otp;
}

function hashOTP(otp) {
  return crypto.createHash('sha256').update(String(otp).trim()).digest('hex');
}

function otpKey(email)  { return `otp:${email.toLowerCase().trim()}`; }
function rateKey(email) { return `otp_rate:${email.toLowerCase().trim()}`; }

/** Try a Redis operation. On rate-limit or network error, disable Redis and warn. */
async function tryRedis(fn, label) {
  if (!redisOk || !redisClient) return null;
  try {
    return await fn();
  } catch (err) {
    const isRateLimit = err?.message?.includes('max requests limit exceeded');
    if (isRateLimit && redisOk) {
      console.warn('[OTP] ⚠️ Upstash rate-limit hit — switching to DB-only mode.');
      redisOk = false;
    } else if (isDev) {
      console.warn(`[OTP] Redis ${label} failed (non-fatal): ${err.message}`);
    }
    return null;
  }
}

/** Fire-and-forget Redis write — never blocks the request. */
function fireRedis(fn) {
  if (!redisOk || !redisClient) return;
  tryRedis(fn, 'fire').catch(() => {});
}

// ─── Store OTP ────────────────────────────────────────────────────────────────
/**
 * Stores the OTP.
 * 1. ALWAYS writes to DB first. If DB fails → throws (caller gets a 500).
 * 2. Optionally caches in Redis. If Redis fails → warns, continues normally.
 */
async function storeOTP(email, otp, purpose = 'verify') {
  const t0       = t();
  const normalized = email.toLowerCase().trim();
  const codeHash   = hashOTP(otp);
  const expiresAt  = new Date(Date.now() + OTP_EXPIRY_MS);

  if (isDev) console.log(`[OTP] Storing for ${normalized} (purpose=${purpose})`);

  // ── 1. Write to DB (mandatory) ───────────────────────────────────────────
  const tDb = t();
  try {
    // Single transaction: delete stale + create new (2 ops, 1 round-trip)
    await prisma.$transaction([
      prisma.otpCode.deleteMany({ where: { email: normalized, purpose } }),
      prisma.otpCode.create({
        data: { email: normalized, codeHash, purpose, expiresAt, lastSentAt: new Date(), attempts: 0 },
      }),
    ]);
    console.log(`[OTP] ✅ Stored (DB ${ms(tDb)}, total ${ms(t0)})`);
  } catch (dbErr) {
    console.error(`[OTP] ❌ DB store FAILED for ${normalized}:`, dbErr.message);
    throw new Error('OTP service temporarily unavailable. Please try again in a moment.');
  }

  // ── 2. Cache in Redis (fire-and-forget — never blocks response) ──────────
  fireRedis(async () => {
    const entry = { codeHash, expiresAt: Date.now() + OTP_EXPIRY_MS, attempts: 0, lastSentAt: Date.now(), purpose };
    await redisClient.set(otpKey(normalized), JSON.stringify(entry), { ex: Math.ceil(OTP_EXPIRY_MS / 1000) });
    const rk = rateKey(normalized);
    const count = await redisClient.incr(rk);
    if (count === 1) await redisClient.expire(rk, Math.ceil(HOUR_MS / 1000));
  });
}

// ─── Verify OTP ───────────────────────────────────────────────────────────────
/**
 * Verifies the OTP.
 * Fast path: check Redis cache first.
 * Authoritative path: always DB (authoritative, persistent).
 * The DB record is always the final arbiter.
 */
async function verifyOTP(email, otp, purpose = 'verify') {
  const normalized = email.toLowerCase().trim();
  console.log(`[OTP] Verifying for ${normalized} (purpose=${purpose})`);

  // ── Try Redis fast-path ──────────────────────────────────────────────────
  const redisCacheEntry = await tryRedis(async () => {
    const raw = await redisClient.get(otpKey(normalized));
    if (!raw) return null;
    return typeof raw === 'string' ? JSON.parse(raw) : raw;
  }, 'verify-lookup');

  if (redisCacheEntry) {
    console.log(`[OTP] Found in Redis for ${normalized} (purpose=${redisCacheEntry.purpose})`);

    // Purpose mismatch → stale Redis cache, fall through to DB
    if (redisCacheEntry.purpose !== purpose) {
      console.warn(`[OTP] Redis entry purpose mismatch (cache=${redisCacheEntry.purpose}, want=${purpose}) — using DB`);
    } else {
      // Try Redis-based verification
      const redisResult = await verifyFromRedisEntry(redisCacheEntry, normalized, otp, purpose);
      if (redisResult !== null) return redisResult; // null means "fall through to DB"
    }
  } else {
    console.log(`[OTP] Not in Redis cache for ${normalized} — checking DB`);
  }

  // ── DB path (authoritative) ──────────────────────────────────────────────
  return await verifyFromDB(normalized, otp, purpose);
}

/**
 * Redis fast-path verification.
 * Returns null to signal "fall through to DB" on any ambiguity.
 */
async function verifyFromRedisEntry(entry, email, otp, purpose) {
  const now = Date.now();

  if (now > entry.expiresAt) {
    // Expired in cache — DB will confirm and clean up
    console.warn(`[OTP] Redis entry expired for ${email}`);
    return null; // Fall through to DB for authoritative expiry check
  }

  if (entry.attempts >= MAX_ATTEMPTS) {
    // Locked in cache — fall through to DB
    return null;
  }

  if (entry.codeHash !== hashOTP(otp)) {
    // Wrong code — increment attempts in both Redis and DB
    entry.attempts += 1;
    const remaining = MAX_ATTEMPTS - entry.attempts;

    await tryRedis(async () => {
      const ttl = Math.ceil((entry.expiresAt - now) / 1000);
      await redisClient.set(
        otpKey(email),
        JSON.stringify(entry),
        { ex: Math.max(ttl, 1) }
      );
    }, 'attempts-update');

    // Also update DB attempts (best-effort)
    prisma.otpCode.updateMany({
      where: { email, purpose },
      data:  { attempts: { increment: 1 } },
    }).catch((e) => console.warn('[OTP] DB attempts sync failed:', e.message));

    console.warn(`[OTP] ❌ Wrong OTP for ${email} via Redis (${remaining} attempts left)`);
    return {
      valid: false,
      error: `Invalid OTP. ${remaining} attempt${remaining !== 1 ? 's' : ''} remaining.`,
    };
  }

  // ✅ Correct code — delete everywhere
  await tryRedis(() => redisClient.del(otpKey(email)), 'delete');
  prisma.otpCode.deleteMany({ where: { email, purpose } })
    .catch((e) => console.warn('[OTP] DB delete after Redis verify failed:', e.message));

  console.log(`[OTP] ✅ Verified via Redis cache for ${email}`);
  return { valid: true };
}

/**
 * DB-authoritative verification.
 * This is the fallback and final arbiter.
 */
async function verifyFromDB(email, otp, purpose) {
  const tDb = t();
  try {
    // Fetch only required fields — avoids transferring unnecessary data
    const record = await prisma.otpCode.findFirst({
      where:   { email, purpose },
      orderBy: { createdAt: 'desc' },
      select:  { id: true, codeHash: true, expiresAt: true, attempts: true },
    });

    if (!record) {
      console.warn(`[OTP] Not found in DB for ${email} (purpose=${purpose}) ${ms(tDb)}`);
      return { valid: false, error: 'OTP not found or already used. Please request a new one.' };
    }

    if (isDev) console.log(`[OTP] DB record found ${ms(tDb)} (expires=${record.expiresAt.toISOString()}, attempts=${record.attempts})`);

    // Expired?
    if (Date.now() > record.expiresAt.getTime()) {
      prisma.otpCode.delete({ where: { id: record.id } }).catch(() => {});
      fireRedis(() => redisClient.del(otpKey(email)));
      return { valid: false, error: 'OTP has expired. Please request a new one.' };
    }

    // Too many attempts?
    if (record.attempts >= MAX_ATTEMPTS) {
      prisma.otpCode.delete({ where: { id: record.id } }).catch(() => {});
      fireRedis(() => redisClient.del(otpKey(email)));
      return { valid: false, error: 'Too many failed attempts. Please request a new OTP.' };
    }

    // Wrong code?
    if (record.codeHash !== hashOTP(otp)) {
      const newAttempts = record.attempts + 1;
      // Fire-and-forget attempt increment — don't block the response
      prisma.otpCode.update({ where: { id: record.id }, data: { attempts: { increment: 1 } } }).catch(() => {});
      const remaining = MAX_ATTEMPTS - newAttempts;
      console.warn(`[OTP] Wrong OTP for ${email} (${remaining} left)`);
      return { valid: false, error: `Invalid OTP. ${remaining} attempt${remaining !== 1 ? 's' : ''} remaining.` };
    }

    // ✅ Correct — fire-and-forget cleanup so response is immediate
    prisma.otpCode.delete({ where: { id: record.id } }).catch(() => {});
    fireRedis(() => redisClient.del(otpKey(email)));

    console.log(`[OTP] ✅ Verified via DB for ${email} (${ms(tDb)})`);
    return { valid: true };

  } catch (dbErr) {
    console.error(`[OTP] DB verify error for ${email}:`, dbErr.message);
    return { valid: false, error: 'Verification service temporarily unavailable. Please try again.' };
  }
}

// ─── Rate Limiting ────────────────────────────────────────────────────────────
/**
 * Checks if a new OTP can be requested.
 * Uses DB for cooldown (reliable, persistent).
 * Uses Redis for hourly limit when available.
 */
async function canRequestOTP(email) {
  const normalized = email.toLowerCase().trim();
  const now        = Date.now();

  // ── Cooldown check via DB ─────────────────────────────────────────────────
  try {
    const recent = await prisma.otpCode.findFirst({
      where:   { email: normalized },
      orderBy: { lastSentAt: 'desc' },
    });

    if (recent) {
      const elapsed = now - recent.lastSentAt.getTime();
      if (elapsed < OTP_COOLDOWN_MS) {
        const remaining = Math.ceil((OTP_COOLDOWN_MS - elapsed) / 1000);
        return {
          allowed:  false,
          reason:   `Please wait ${remaining} seconds before requesting another OTP.`,
          cooldown: remaining,
        };
      }
    }
  } catch (dbErr) {
    console.warn('[OTP] Cooldown DB check failed (allowing request):', dbErr.message);
  }

  // ── Hourly limit via Redis ────────────────────────────────────────────────
  const hourlyCount = await tryRedis(async () => {
    const count = await redisClient.get(rateKey(normalized));
    return count ? parseInt(count, 10) : 0;
  }, 'rate-check');

  if (hourlyCount !== null && hourlyCount >= MAX_SENDS_PER_HOUR) {
    return {
      allowed:  false,
      reason:   'Too many OTP requests. Try again in an hour.',
      cooldown: 0,
    };
  }

  return { allowed: true, cooldown: 0 };
}

// ─── Get cooldown seconds remaining ──────────────────────────────────────────
async function getOTPCooldown(email) {
  const normalized = email.toLowerCase().trim();
  try {
    const recent = await prisma.otpCode.findFirst({
      where:   { email: normalized },
      orderBy: { lastSentAt: 'desc' },
    });
    if (recent) {
      const elapsed = Date.now() - recent.lastSentAt.getTime();
      if (elapsed < OTP_COOLDOWN_MS) {
        return Math.ceil((OTP_COOLDOWN_MS - elapsed) / 1000);
      }
    }
  } catch (e) {
    console.warn('[OTP] Cooldown lookup failed:', e.message);
  }
  return 0;
}

// ─── Exports ──────────────────────────────────────────────────────────────────
module.exports = { generateOTP, storeOTP, verifyOTP, canRequestOTP, getOTPCooldown };
