/**
 * Google OAuth Service
 * Manages the per-mentor Google Calendar OAuth 2.0 flow:
 * - Generating the consent URL
 * - Exchanging auth codes for tokens
 * - Saving / reading / revoking tokens securely
 */

const { google } = require('googleapis');
const crypto = require('crypto');
const config = require('../config/env');
const prisma = require('../config/prisma');
const { encrypt, decrypt } = require('./tokenEncryption.service');

/**
 * Build a per-request OAuth2 client using the platform credentials.
 * @param {string} [customRedirectUri] - Optional override for callback redirect URI
 */
function buildOAuth2Client(customRedirectUri) {
  return new google.auth.OAuth2(
    config.google.clientId,
    config.google.clientSecret,
    customRedirectUri || config.google.redirectUri
  );
}

/**
 * Create a signed state parameter for OAuth CSRF protection.
 * Format: data.signature
 * Accepts a mentorId string or an object { mentorId, returnPath, redirectUri }.
 */
function signState(payload) {
  const secret = config.jwtSecret || config.google.clientSecret;
  let dataStr;
  if (typeof payload === 'object' && payload !== null) {
    dataStr = Buffer.from(JSON.stringify(payload)).toString('base64url');
  } else {
    dataStr = String(payload);
  }
  const signature = crypto.createHmac('sha256', secret).update(dataStr).digest('hex').slice(0, 16);
  return `${dataStr}.${signature}`;
}

/**
 * Verify and extract payload from a signed state parameter.
 * Returns decoded object { mentorId, returnPath, redirectUri } or { mentorId } if valid, null otherwise.
 */
function verifyState(state) {
  if (!state || !state.includes('.')) return null;
  const lastDot = state.lastIndexOf('.');
  const dataStr = state.slice(0, lastDot);
  const providedSig = state.slice(lastDot + 1);
  const secret = config.jwtSecret || config.google.clientSecret;
  const expectedSig = crypto.createHmac('sha256', secret).update(dataStr).digest('hex').slice(0, 16);
  try {
    const valid = crypto.timingSafeEqual(Buffer.from(providedSig), Buffer.from(expectedSig));
    if (!valid) return null;

    // Try decoding base64url payload
    try {
      const jsonStr = Buffer.from(dataStr, 'base64url').toString('utf8');
      if (jsonStr.startsWith('{') && jsonStr.endsWith('}')) {
        return JSON.parse(jsonStr);
      }
    } catch {}

    // Fallback if plain mentorId string was signed
    return { mentorId: dataStr };
  } catch {
    return null;
  }
}

/**
 * Generate the Google OAuth consent URL for a mentor.
 * @param {string} mentorId  - The mentor's DB id (embedded in state param for security)
 * @param {Object} [options] - { returnPath, redirectUri }
 * @returns {string} The authorization URL to redirect the mentor to.
 */
function generateAuthUrl(mentorId, options = {}) {
  const { returnPath, redirectUri } = options;
  const oauth2Client = buildOAuth2Client(redirectUri);
  return oauth2Client.generateAuthUrl({
    access_type: 'offline',    // Request refresh_token
    prompt: 'consent',         // Always show consent — ensures refresh token is issued
    scope: [
      'https://www.googleapis.com/auth/calendar.events',
      'https://www.googleapis.com/auth/calendar.readonly',
    ],
    state: signState({ mentorId, returnPath, redirectUri }), // CSRF-protected signed state
  });
}

/**
 * Exchange a Google authorization code for access + refresh tokens.
 * @param {string} code - The `code` query param from Google's callback.
 * @param {string} [customRedirectUri] - Matching redirect URI if different from config
 * @returns {Object} tokens — { access_token, refresh_token, expiry_date, ... }
 */
async function exchangeCodeForTokens(code, customRedirectUri) {
  const oauth2Client = buildOAuth2Client(customRedirectUri);
  const { tokens } = await oauth2Client.getToken(code);
  return tokens;
}

/**
 * Encrypt and persist mentor's Google OAuth tokens in the DB.
 * @param {string} mentorId - The mentor DB record id.
 * @param {Object} tokens   - { access_token, refresh_token, expiry_date }
 */
async function saveMentorTokens(mentorId, tokens) {
  const data = {
    googleCalendarConnected: true,
    googleAccessToken: encrypt(tokens.access_token),
    googleTokenExpiresAt: tokens.expiry_date ? new Date(tokens.expiry_date) : null,
  };

  // Only overwrite refresh token if one was provided (Google only returns it on first consent)
  if (tokens.refresh_token) {
    data.googleRefreshToken = encrypt(tokens.refresh_token);
  }

  await prisma.mentor.update({ where: { id: mentorId }, data });
  console.log(`[googleOAuth] Tokens saved for mentor ${mentorId}`);
}

/**
 * Decrypt and return mentor's stored tokens.
 * @param {Object} mentor - Mentor DB record (must include googleAccessToken, googleRefreshToken, googleTokenExpiresAt)
 * @returns {{ accessToken: string|null, refreshToken: string|null, expiresAt: Date|null }}
 */
function getMentorDecryptedTokens(mentor) {
  return {
    accessToken: decrypt(mentor.googleAccessToken),
    refreshToken: decrypt(mentor.googleRefreshToken),
    expiresAt: mentor.googleTokenExpiresAt,
  };
}

/**
 * Build an OAuth2Client pre-configured with the mentor's stored tokens.
 * Automatically refreshes the access token if expired and persists new token.
 * Returns null if the mentor hasn't connected Google Calendar.
 *
 * @param {Object} mentor - Full mentor DB record
 * @returns {google.auth.OAuth2|null}
 */
async function getAuthedClientForMentor(mentor) {
  if (!mentor.googleCalendarConnected || !mentor.googleRefreshToken) {
    return null;
  }

  const { accessToken, refreshToken, expiresAt } = getMentorDecryptedTokens(mentor);
  if (!refreshToken) {
    console.warn(`[googleOAuth] Mentor ${mentor.id} has no decryptable refresh token`);
    return null;
  }

  const oauth2Client = buildOAuth2Client();
  oauth2Client.setCredentials({
    access_token: accessToken,
    refresh_token: refreshToken,
    expiry_date: expiresAt ? new Date(expiresAt).getTime() : undefined,
  });

  // Listen for token refreshes and save the new access token
  oauth2Client.on('tokens', async (newTokens) => {
    console.log(`[googleOAuth] Access token refreshed for mentor ${mentor.id}`);
    await saveMentorTokens(mentor.id, newTokens);
  });

  return oauth2Client;
}

/**
 * Revoke the mentor's Google Calendar connection.
 * Clears all stored tokens from DB.
 * @param {string} mentorId
 */
async function revokeMentorTokens(mentorId) {
  const mentor = await prisma.mentor.findUnique({ where: { id: mentorId } });
  if (!mentor) return;

  const { accessToken } = getMentorDecryptedTokens(mentor);

  // Best-effort revoke at Google's server
  if (accessToken) {
    try {
      const oauth2Client = buildOAuth2Client();
      await oauth2Client.revokeToken(accessToken);
    } catch (err) {
      console.warn(`[googleOAuth] Revoke token call failed (may already be expired): ${err.message}`);
    }
  }

  // Clear from DB regardless
  await prisma.mentor.update({
    where: { id: mentorId },
    data: {
      googleCalendarConnected: false,
      googleAccessToken: null,
      googleRefreshToken: null,
      googleTokenExpiresAt: null,
    },
  });
  console.log(`[googleOAuth] Tokens revoked for mentor ${mentorId}`);
}

module.exports = {
  generateAuthUrl,
  exchangeCodeForTokens,
  saveMentorTokens,
  getMentorDecryptedTokens,
  getAuthedClientForMentor,
  revokeMentorTokens,
  verifyState,
};
