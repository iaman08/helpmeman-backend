/**
 * LinkedIn OAuth & Profile Data Service
 * 
 * Production-ready implementation of LinkedIn OAuth 2.0 (OpenID Connect):
 * - Secure HMAC-SHA256 signed state with CSRF protection & expiration
 * - Token exchange & AES-256-GCM encrypted persistence
 * - Userinfo retrieval & graceful normalization adapter
 * - Account-conflict detection & user isolation
 * - Strict logging without leaking sensitive tokens or secrets
 */

const crypto = require('crypto');
const config = require('../config/env');
const prisma = require('../config/prisma');
const { encrypt, decrypt } = require('./tokenEncryption.service');

const LINKEDIN_AUTH_URL = 'https://www.linkedin.com/oauth/v2/authorization';
const LINKEDIN_TOKEN_URL = 'https://www.linkedin.com/oauth/v2/accessToken';
const LINKEDIN_USERINFO_URL = 'https://api.linkedin.com/v2/userinfo';

// Approved standard OpenID Connect scopes
const APPROVED_SCOPES = 'openid profile email';

/**
 * Sign an OAuth state parameter to prevent CSRF attacks.
 * Format: base64url(payload).hmacSignature
 */
function signState(payload) {
  const secret = config.jwtSecret || 'linkedin_oauth_secret';
  const data = {
    ...payload,
    ts: Date.now(),
    nonce: crypto.randomBytes(16).toString('hex'),
  };
  const dataStr = Buffer.from(JSON.stringify(data)).toString('base64url');
  const signature = crypto.createHmac('sha256', secret).update(dataStr).digest('hex').slice(0, 32);
  return `${dataStr}.${signature}`;
}

/**
 * Verify signed OAuth state parameter.
 * Returns decoded payload if valid and not expired (15 min TTL), or null.
 */
function verifyState(state) {
  if (!state || typeof state !== 'string' || !state.includes('.')) return null;
  const lastDot = state.lastIndexOf('.');
  const dataStr = state.slice(0, lastDot);
  const providedSig = state.slice(lastDot + 1);
  const secret = config.jwtSecret || 'linkedin_oauth_secret';

  const expectedSig = crypto.createHmac('sha256', secret).update(dataStr).digest('hex').slice(0, 32);

  try {
    const valid = crypto.timingSafeEqual(
      Buffer.from(providedSig, 'utf8'),
      Buffer.from(expectedSig, 'utf8')
    );
    if (!valid) return null;

    const payload = JSON.parse(Buffer.from(dataStr, 'base64url').toString('utf8'));
    // State expires after 15 minutes
    if (Date.now() - payload.ts > 15 * 60 * 1000) {
      console.warn('[LinkedIn OAuth] State parameter expired');
      return null;
    }
    return payload;
  } catch (err) {
    console.error('[LinkedIn OAuth] State verification error:', err.message);
    return null;
  }
}

/**
 * Generate LinkedIn OAuth authorization URL.
 */
function generateAuthUrl({ userId = null, returnPath = '/onboarding', redirectUri = null }) {
  const clientId = config.linkedin.clientId;
  const effectiveRedirectUri = redirectUri || config.linkedin.redirectUri;
  const state = signState({ userId, returnPath, redirectUri: effectiveRedirectUri });

  // In development mode: if credentials are not configured yet, support seamless dev simulation
  if (!clientId) {
    if (config.nodeEnv === 'production') {
      throw new Error('LINKEDIN_CLIENT_ID is not configured in server environment.');
    }
    console.warn('[LinkedIn OAuth] LINKEDIN_CLIENT_ID not set. Using dev simulated OAuth redirect.');
    return `${effectiveRedirectUri}?code=dev_simulated_code&state=${encodeURIComponent(state)}`;
  }

  const params = new URLSearchParams({
    response_type: 'code',
    client_id: clientId,
    redirect_uri: effectiveRedirectUri,
    state,
    scope: APPROVED_SCOPES,
  });

  console.log(`[LinkedIn OAuth] OAuth started for user: ${userId || 'anonymous'}`);
  return `${LINKEDIN_AUTH_URL}?${params.toString()}`;
}

/**
 * Exchange OAuth authorization code for tokens.
 */
async function exchangeCodeForTokens(code, redirectUri = null) {
  const clientId = config.linkedin.clientId;
  const clientSecret = config.linkedin.clientSecret;
  const effectiveRedirectUri = redirectUri || config.linkedin.redirectUri;

  // Development simulation fallback
  if (code === 'dev_simulated_code' && (!clientId || !clientSecret)) {
    console.log('[LinkedIn OAuth] Development simulation: returning mock token data.');
    return {
      access_token: `mock_linkedin_dev_token_${Date.now()}`,
      expires_in: 5184000,
      scope: APPROVED_SCOPES,
      token_type: 'Bearer',
    };
  }

  if (!clientId || !clientSecret) {
    throw new Error('LinkedIn OAuth credentials not configured on server.');
  }

  const bodyParams = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    client_id: clientId,
    client_secret: clientSecret,
    redirect_uri: effectiveRedirectUri,
  });

  const response = await fetch(LINKEDIN_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: bodyParams.toString(),
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error('[LinkedIn OAuth] Token exchange failed with status', response.status);
    throw new Error(`LinkedIn token exchange failed: ${response.statusText}`);
  }

  const tokenData = await response.json();
  console.log('[LinkedIn OAuth] LinkedIn OAuth succeeded. Access token received.');
  return tokenData;
}

/**
 * Fetch profile information using permitted OpenID Connect endpoint.
 */
async function fetchLinkedInProfile(accessToken) {
  if (!accessToken) throw new Error('Access token required to fetch LinkedIn profile');

  // Development simulation profile
  if (accessToken.startsWith('mock_linkedin_dev_token_')) {
    console.log('[LinkedIn OAuth] Development simulation: returning mock profile.');
    return {
      sub: 'dev_mock_linkedin_sub_101',
      name: 'Dilkhush Kumar',
      given_name: 'Dilkhush',
      family_name: 'Kumar',
      email: 'dilkhushj.ce.26@nitj.ac.in',
      picture: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=400&auto=format&fit=crop&q=80',
      headline: 'Full Stack Engineer & Tech Lead | Systems Architecture & React / Node.js',
    };
  }

  const response = await fetch(LINKEDIN_USERINFO_URL, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  if (!response.ok) {
    console.error('[LinkedIn OAuth] Failed to fetch userinfo:', response.status);
    throw new Error(`Failed to fetch LinkedIn profile: ${response.statusText}`);
  }

  const userInfo = await response.json();
  console.log('[LinkedIn OAuth] LinkedIn profile imported for subject:', userInfo.sub ? `${userInfo.sub.slice(0, 6)}...` : 'unknown');
  return userInfo;
}

/**
 * Adapter / Normalization Layer:
 * Normalizes raw LinkedIn API response into structured mentor-ready profile.
 * Gracefully handles missing fields.
 */
function normalizeLinkedInProfile(rawUserInfo, extraProfileData = {}) {
  if (!rawUserInfo) return null;

  const linkedinId = rawUserInfo.sub || rawUserInfo.id || '';
  const firstName = rawUserInfo.given_name || rawUserInfo.localizedFirstName || '';
  const lastName = rawUserInfo.family_name || rawUserInfo.localizedLastName || '';
  const fullName = rawUserInfo.name || `${firstName} ${lastName}`.trim() || 'Mentor';
  const email = rawUserInfo.email || '';
  const profileImage = rawUserInfo.picture || '';

  // Extract locale or location if available
  let location = '';
  if (rawUserInfo.locale) {
    const country = typeof rawUserInfo.locale === 'object' ? rawUserInfo.locale.country : '';
    location = country || '';
  }

  // Handle potential extended data if available through enterprise permissions
  const headline = extraProfileData.headline || rawUserInfo.headline || '';
  const about = extraProfileData.summary || rawUserInfo.summary || '';
  const currentPosition = extraProfileData.currentPosition || '';
  const company = extraProfileData.company || '';
  const profileUrl = extraProfileData.profileUrl || (linkedinId ? `https://www.linkedin.com/in/${linkedinId}` : '');

  const experiences = Array.isArray(extraProfileData.positions) ? extraProfileData.positions : [];
  const education = Array.isArray(extraProfileData.education) ? extraProfileData.education : [];
  const skills = Array.isArray(extraProfileData.skills) ? extraProfileData.skills : [];
  const certifications = Array.isArray(extraProfileData.certifications) ? extraProfileData.certifications : [];

  return {
    linkedinId,
    name: fullName,
    firstName,
    lastName,
    email,
    headline,
    profileImage,
    about,
    location,
    profileUrl,
    currentPosition,
    company,
    experiences,
    education,
    skills,
    certifications,
    rawData: {
      userinfo: rawUserInfo,
      extra: extraProfileData,
    },
  };
}

/**
 * Save or update LinkedIn data for the user.
 * Enforces separation between raw imported LinkedIn data and user-approved mentor profile.
 * Checks for account conflict (if LinkedIn is already connected to another user).
 */
async function saveLinkedInData({ userId, tokens, normalizedProfile }) {
  if (!userId) throw new Error('User ID is required to associate LinkedIn data');
  if (!normalizedProfile || !normalizedProfile.linkedinId) {
    throw new Error('Valid LinkedIn profile data is required');
  }

  // 1. Account conflict check: Verify this LinkedIn ID is not connected to a DIFFERENT HelpMeMan user
  const existingConnection = await prisma.linkedInConnection.findUnique({
    where: { linkedinUserId: normalizedProfile.linkedinId },
  });

  if (existingConnection && existingConnection.userId !== userId) {
    console.warn(`[LinkedIn OAuth] Conflict: LinkedIn ID ${normalizedProfile.linkedinId} is already connected to user ${existingConnection.userId}`);
    const err = new Error('This LinkedIn account is already connected to another HelpMeMan account.');
    err.code = 'LINKEDIN_ACCOUNT_CONFLICT';
    throw err;
  }

  // 2. Encrypt token if persistence is requested
  const accessTokenEncrypted = encrypt(tokens.access_token);
  const refreshTokenEncrypted = tokens.refresh_token ? encrypt(tokens.refresh_token) : null;
  const tokenExpiresAt = tokens.expires_in ? new Date(Date.now() + tokens.expires_in * 1000) : null;

  // 3. Upsert LinkedInConnection
  const connection = await prisma.linkedInConnection.upsert({
    where: { userId },
    update: {
      linkedinUserId: normalizedProfile.linkedinId,
      accessTokenEncrypted,
      refreshTokenEncrypted,
      tokenExpiresAt,
      updatedAt: new Date(),
    },
    create: {
      userId,
      linkedinUserId: normalizedProfile.linkedinId,
      accessTokenEncrypted,
      refreshTokenEncrypted,
      tokenExpiresAt,
    },
  });

  // 4. Upsert LinkedInProfile (clean separation from user-approved MentorProfile)
  const profile = await prisma.linkedInProfile.upsert({
    where: { userId },
    update: {
      linkedinConnectionId: connection.id,
      name: normalizedProfile.name,
      headline: normalizedProfile.headline || null,
      about: normalizedProfile.about || null,
      profileImage: normalizedProfile.profileImage || null,
      location: normalizedProfile.location || null,
      profileUrl: normalizedProfile.profileUrl || null,
      currentPosition: normalizedProfile.currentPosition || null,
      company: normalizedProfile.company || null,
      rawData: normalizedProfile.rawData,
      updatedAt: new Date(),
    },
    create: {
      userId,
      linkedinConnectionId: connection.id,
      name: normalizedProfile.name,
      headline: normalizedProfile.headline || null,
      about: normalizedProfile.about || null,
      profileImage: normalizedProfile.profileImage || null,
      location: normalizedProfile.location || null,
      profileUrl: normalizedProfile.profileUrl || null,
      currentPosition: normalizedProfile.currentPosition || null,
      company: normalizedProfile.company || null,
      rawData: normalizedProfile.rawData,
    },
  });

  console.log(`[LinkedIn OAuth] LinkedIn data saved for user: ${userId}`);
  return { connection, profile };
}

/**
 * Get imported LinkedIn profile for an authenticated user.
 * IDOR Protected: User can only access their own imported profile.
 */
async function getImportedProfile(userId) {
  const [connection, profile] = await Promise.all([
    prisma.linkedInConnection.findUnique({
      where: { userId },
      select: { id: true, connectedAt: true, updatedAt: true, tokenExpiresAt: true },
    }),
    prisma.linkedInProfile.findUnique({
      where: { userId },
    }),
  ]);

  if (!connection && !profile) return null;

  return {
    connected: Boolean(connection),
    connectedAt: connection?.connectedAt,
    profile: profile || null,
  };
}

/**
 * Disconnect LinkedIn account for the user.
 * Revokes stored credentials while preserving any published mentor profile.
 */
async function disconnectLinkedIn(userId) {
  const connection = await prisma.linkedInConnection.findUnique({ where: { userId } });
  if (connection) {
    await prisma.linkedInConnection.delete({ where: { userId } });
  }

  // Clear connection link from imported profile record
  await prisma.linkedInProfile.updateMany({
    where: { userId },
    data: { linkedinConnectionId: null },
  });

  console.log(`[LinkedIn OAuth] Disconnected LinkedIn credentials for user: ${userId}`);
  return { success: true };
}

module.exports = {
  generateAuthUrl,
  verifyState,
  exchangeCodeForTokens,
  fetchLinkedInProfile,
  normalizeLinkedInProfile,
  saveLinkedInData,
  getImportedProfile,
  disconnectLinkedIn,
};
