const supabase = require('../config/supabase');
const userService = require('./user.service');

// ─── In-memory token cache to avoid repeated Supabase network round-trips ───
// Verified token data is cached for up to 30 seconds. This means a returning
// user's session verification costs one Supabase call every 30s max instead
// of on every single request.
const tokenCache = new Map();
const TOKEN_CACHE_TTL_MS = 30_000; // 30 seconds

function getCachedUser(token) {
  const entry = tokenCache.get(token);
  if (!entry) return null;
  if (Date.now() - entry.ts > TOKEN_CACHE_TTL_MS) {
    tokenCache.delete(token);
    return null;
  }
  return entry.user;
}

function setCachedUser(token, user) {
  // Prevent unbounded memory growth — max 500 cached tokens
  if (tokenCache.size >= 500) {
    const oldest = tokenCache.keys().next().value;
    tokenCache.delete(oldest);
  }
  tokenCache.set(token, { user, ts: Date.now() });
}

function invalidateCachedUser(userId) {
  for (const [token, entry] of tokenCache.entries()) {
    if (entry.user?.id === userId) tokenCache.delete(token);
  }
}

/**
 * Verifies a Supabase Auth access token and returns the synced application user.
 *
 * Strategy:
 * 1. Check in-memory cache — if the same token was verified within the last 30s,
 *    return the cached user immediately (zero network cost).
 * 2. If not cached, call supabase.auth.getUser() to validate remotely.
 * 3. Sync / create the local DB record via findOrCreateUser (with needsUpdate guard).
 * 4. Cache the result before returning.
 *
 * @param {string} token - The Bearer access token sent by the client
 * @returns {Promise<object>} The synced application user record
 */
// Track concurrent authentication promises to deduplicate them
const activePromises = new Map();

/**
 * Verifies a Supabase Auth access token and returns the synced application user.
 *
 * Strategy:
 * 1. Check in-memory cache — if the same token was verified within the last 30s,
 *    return the cached user immediately (zero network cost).
 * 2. Deduplicate concurrent requests verifying the same token concurrently.
 * 3. Call supabase.auth.getUser() to validate remotely.
 * 4. Sync / create the local DB record via findOrCreateUser.
 * 5. Cache the result before returning.
 *
 * @param {string} token - The Bearer access token sent by the client
 * @returns {Promise<object>} The synced application user record
 */
async function verifySession(token) {
  if (!token) {
    throw new Error('Access token is required');
  }

  // ── 1. Local dev bypass for seeded demo accounts ──────────────────────────
  if (process.env.NODE_ENV === 'development' && token.startsWith('demo_')) {
    console.warn('[AUTH] [verifySession] ⚠️ Demo bypass active (dev only):', token);
    const prisma = require('../config/prisma');
    const email = token === 'demo_admin_token'   ? 'admin@helpmeman.com'   :
                  token === 'demo_mentor_token'  ? 'mentor@helpmeman.com'  :
                  token === 'demo_student_token' ? 'student@helpmeman.com' :
                  'student@helpmeman.com';
    const localUser = await prisma.user.findFirst({ where: { email } });
    if (localUser) return localUser;
  }

  // ── 2. Cache hit — skip Supabase network call entirely ────────────────────
  const cached = getCachedUser(token);
  if (cached) {
    console.log('[AUTH] [verifySession] Cache hit for token. Skipping Supabase request.');
    return cached;
  }

  // ── 3. Promise Coalescing — deduplicate concurrent getUser requests ───────
  if (activePromises.has(token)) {
    console.log('[AUTH] [verifySession] Duplicate verification request in flight. Coalescing.');
    return activePromises.get(token);
  }

  const promise = (async () => {
    try {
      // Re-check cache inside promise in case it hit while queueing
      const innerCached = getCachedUser(token);
      if (innerCached) return innerCached;

      const t0 = Date.now();
      const supabaseConfig = require('../config/env').supabase;
      console.log(`[AUTH] [verifySession] Invoking supabase.auth.getUser. URL: ${supabaseConfig?.url}`);
      
      const { data: { user }, error } = await supabase.auth.getUser(token);
      const elapsed = Date.now() - t0;
      console.log(`[AUTH] [verifySession] supabase.auth.getUser call completed in ${elapsed}ms`);

      if (error) {
        console.error('[AUTH] [verifySession] Supabase returned error:', {
          message: error.message,
          status: error.status,
          name: error.name
        });
        throw new Error(error.message || 'Invalid or expired session');
      }

      if (!user) {
        console.error('[AUTH] [verifySession] Supabase did not return an error but returned null user.');
        throw new Error('Invalid or expired session: user object is null');
      }

      console.log(`[AUTH] [verifySession] Supabase token successfully verified. Email: ${user.email}, Supabase ID: ${user.id}`);

      console.log('[AUTH] [verifySession] Syncing/Creating local database profile...');
      const localUser = await userService.findOrCreateUser(user);
      console.log(`[AUTH] [verifySession] Database sync completed successfully. Local User ID: ${localUser.id}`);

      setCachedUser(token, localUser);
      return localUser;
    } catch (err) {
      console.error('[AUTH] [verifySession] Error during session verification:', err.message);
      throw err;
    } finally {
      activePromises.delete(token);
    }
  })();

  activePromises.set(token, promise);
  return promise;
}

module.exports = { verifySession, invalidateCachedUser };
