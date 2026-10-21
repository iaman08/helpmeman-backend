/**
 * Centralized Google Meet Microservice for HelpMeMan
 *
 * Provisions Google Meet meetings programmatically using a single central Google Account.
 * Passes mentor and mentee emails as attendees so participants bypass the knock / waiting room.
 * Stores tokens securely in DB (PlatformSetting) with automatic fallback to .env (GOOGLE_REFRESH_TOKEN).
 */

const { google } = require('googleapis');
const crypto = require('crypto');
const config = require('../config/env');
const prisma = require('../config/prisma');
const { encrypt, decrypt } = require('./tokenEncryption.service');
const { isValidMeetLink } = require('./googleMeet.service');

// In-memory idempotency cache (keyed by idempotencyKey)
const idempotencyCache = new Map();

// In-memory active OAuth2 client cache
let cachedAuthClient = null;
let cachedTokenExpiry = null;

/**
 * Build a base Google OAuth2 client using platform Google credentials
 */
function buildOAuth2Client(customRedirectUri) {
  const redirectUri = customRedirectUri || config.google?.redirectUri || 'http://localhost:3000/api/meetings/auth-callback';
  return new google.auth.OAuth2(
    config.google.clientId,
    config.google.clientSecret,
    redirectUri
  );
}

/**
 * Retrieve decrypted central tokens from database or fallback to environment variables
 */
async function getStoredCentralTokens() {
  try {
    if (prisma.platformSetting) {
      const setting = await prisma.platformSetting.findUnique({
        where: { key: 'central_google_tokens' },
      });

      if (setting?.value) {
        const parsed = JSON.parse(setting.value);
        return {
          source: 'database',
          refreshToken: parsed.refreshTokenEncrypted ? decrypt(parsed.refreshTokenEncrypted) : null,
          accessToken: parsed.accessTokenEncrypted ? decrypt(parsed.accessTokenEncrypted) : null,
          expiresAt: parsed.expiresAt ? new Date(parsed.expiresAt) : null,
          email: parsed.email || null,
          updatedAt: setting.updatedAt,
        };
      }
    } else {
      const rows = await prisma.$queryRawUnsafe(
        'SELECT "value", "updatedAt" FROM "PlatformSetting" WHERE "key" = $1 LIMIT 1',
        'central_google_tokens'
      );
      if (rows && rows[0]?.value) {
        const parsed = JSON.parse(rows[0].value);
        return {
          source: 'database',
          refreshToken: parsed.refreshTokenEncrypted ? decrypt(parsed.refreshTokenEncrypted) : null,
          accessToken: parsed.accessTokenEncrypted ? decrypt(parsed.accessTokenEncrypted) : null,
          expiresAt: parsed.expiresAt ? new Date(parsed.expiresAt) : null,
          email: parsed.email || null,
          updatedAt: rows[0].updatedAt,
        };
      }
    }
  } catch (dbErr) {
    // If table doesn't exist yet, fall back gracefully
  }

  // Fallback to environment variables
  if (config.google?.refreshToken) {
    return {
      source: 'environment',
      refreshToken: config.google.refreshToken,
      accessToken: null,
      expiresAt: null,
      email: config.google.centralEmail || 'admin.helpmeman@gmail.com',
      updatedAt: null,
    };
  }

  return null;
}

/**
 * Save freshly acquired central Google tokens to the database
 */
async function saveCentralTokens(tokens, email = null) {
  if (!tokens || (!tokens.refresh_token && !tokens.access_token)) return;

  const existingTokens = await getStoredCentralTokens();
  const refreshTokenToSave = tokens.refresh_token || existingTokens?.refreshToken;

  const payload = {
    refreshTokenEncrypted: refreshTokenToSave ? encrypt(refreshTokenToSave) : null,
    accessTokenEncrypted: tokens.access_token ? encrypt(tokens.access_token) : null,
    expiresAt: tokens.expiry_date ? new Date(tokens.expiry_date).toISOString() : null,
    email: email || existingTokens?.email || config.google.centralEmail || 'admin.helpmeman@gmail.com',
    updatedAt: new Date().toISOString(),
  };

  const payloadStr = JSON.stringify(payload);

  try {
    if (prisma.platformSetting) {
      await prisma.platformSetting.upsert({
        where: { key: 'central_google_tokens' },
        create: {
          key: 'central_google_tokens',
          value: payloadStr,
        },
        update: {
          value: payloadStr,
        },
      });
    } else {
      await prisma.$executeRawUnsafe(
        `INSERT INTO "PlatformSetting" ("id", "key", "value", "updatedAt")
         VALUES ($1, $2, $3, CURRENT_TIMESTAMP)
         ON CONFLICT ("key") DO UPDATE SET "value" = $3, "updatedAt" = CURRENT_TIMESTAMP`,
        crypto.randomUUID(),
        'central_google_tokens',
        payloadStr
      );
    }
    console.log('[centralMeet] Central Google tokens securely stored in PlatformSetting');
  } catch (err) {
    console.error('[centralMeet] Error saving tokens to DB:', err.message);
  }

  // Invalidate cached client so fresh tokens take effect immediately
  cachedAuthClient = null;
  cachedTokenExpiry = null;
}

/**
 * Get an authorized OAuth2 client for the central account.
 * Automatically refreshes access tokens and persists them.
 */
async function getCentralAuthedClient() {
  if (!config.google?.clientId || !config.google?.clientSecret) {
    return { client: null, error: 'MISSING_CLIENT_CREDENTIALS', message: 'GOOGLE_CLIENT_ID or GOOGLE_CLIENT_SECRET is missing.' };
  }

  const stored = await getStoredCentralTokens();
  if (!stored || !stored.refreshToken) {
    return {
      client: null,
      error: 'NO_REFRESH_TOKEN',
      message: 'No Google refresh token found for central account. Please authorize via /api/meetings/auth-url',
    };
  }

  // Return cached client if still valid
  if (cachedAuthClient && cachedTokenExpiry && Date.now() < cachedTokenExpiry - 60000) {
    return { client: cachedAuthClient, error: null, email: stored.email };
  }

  const oauth2Client = buildOAuth2Client();
  oauth2Client.setCredentials({
    access_token: stored.accessToken || undefined,
    refresh_token: stored.refreshToken,
    expiry_date: stored.expiresAt ? stored.expiresAt.getTime() : undefined,
  });

  // Automatically capture and persist token refresh events
  oauth2Client.on('tokens', async (newTokens) => {
    console.log('[centralMeet] Access token refreshed automatically for central account');
    if (newTokens.expiry_date) {
      cachedTokenExpiry = newTokens.expiry_date;
    }
    await saveCentralTokens(newTokens, stored.email);
  });

  cachedAuthClient = oauth2Client;
  return { client: oauth2Client, error: null, email: stored.email };
}

/**
 * Generate OAuth authorization URL for the central platform account
 */
function generateCentralAuthUrl(returnPath = '/superadmin/settings') {
  const oauth2Client = buildOAuth2Client();
  const stateData = Buffer.from(JSON.stringify({ returnPath, isCentral: true, ts: Date.now() })).toString('base64url');
  const secret = config.jwtSecret || config.google.clientSecret || 'central-meet-secret';
  const sig = crypto.createHmac('sha256', secret).update(stateData).digest('hex').slice(0, 16);
  const state = `${stateData}.${sig}`;

  return oauth2Client.generateAuthUrl({
    access_type: 'offline', // Mandatory for refresh_token
    prompt: 'consent',      // Mandatory to ensure refresh_token is re-issued
    scope: [
      'https://www.googleapis.com/auth/calendar.events',
      'https://www.googleapis.com/auth/calendar.readonly',
      'https://www.googleapis.com/auth/userinfo.email',
    ],
    state,
  });
}

/**
 * Check connection status of the central Google account
 */
async function checkCentralAccountStatus() {
  const configured = Boolean(config.google?.clientId && config.google?.clientSecret);
  const stored = await getStoredCentralTokens();

  if (!configured || !stored?.refreshToken) {
    return {
      configured,
      connected: false,
      tokenSource: stored?.source || 'none',
      email: stored?.email || null,
      error: 'Refresh token not configured. Authorize via /api/meetings/auth-url',
    };
  }

  try {
    const { client, error, message } = await getCentralAuthedClient();
    if (error || !client) {
      return { configured, connected: false, tokenSource: stored.source, email: stored.email, error: message || error };
    }

    const calendar = google.calendar({ version: 'v3', auth: client });
    const calList = await calendar.calendarList.get({ calendarId: 'primary' });

    return {
      configured: true,
      connected: true,
      tokenSource: stored.source,
      email: calList.data.id || stored.email,
      calendarSummary: calList.data.summary,
      error: null,
    };
  } catch (testErr) {
    const errMsg = testErr.response?.data?.error_description || testErr.response?.data?.error || testErr.message;
    return {
      configured: true,
      connected: false,
      tokenSource: stored.source,
      email: stored.email,
      error: `Google Calendar verification failed: ${errMsg}`,
    };
  }
}

/**
 * Programmatically create a Google Meet meeting via the central platform account.
 *
 * @param {Object} params
 * @param {string} params.clientId - Client or tenant identifier (e.g. 'client-123' or 'helpmeman-core')
 * @param {string} params.mentorId - Mentor user or entity ID
 * @param {string} params.menteeId - Mentee user or entity ID
 * @param {string} params.mentorEmail - Mentor's email address (for knocking bypass)
 * @param {string} params.menteeEmail - Mentee's email address (for knocking bypass)
 * @param {string} [params.topic] - Meeting topic or summary
 * @param {string|Date} [params.startTime] - Meeting start time (defaults to 2 minutes from now)
 * @param {number} [params.durationMinutes] - Session length (defaults to 60)
 * @param {string} [params.idempotencyKey] - Unique key to prevent duplicate meetings
 *
 * @returns {Promise<Object>} Meeting response object
 */
async function createCentralMeeting({
  clientId = 'helpmeman-core',
  mentorId,
  menteeId,
  mentorEmail,
  menteeEmail,
  topic,
  startTime,
  durationMinutes = 60,
  idempotencyKey,
}) {
  // 1. Validation
  if (!mentorId || !menteeId) {
    throw new Error('mentorId and menteeId are required.');
  }
  if (!mentorEmail || !menteeEmail) {
    throw new Error('mentorEmail and menteeEmail are required so participants can bypass the Google Meet waiting room.');
  }

  // 2. Idempotency Check
  if (idempotencyKey && idempotencyCache.has(idempotencyKey)) {
    console.log(`[centralMeet] Returning cached meeting for idempotencyKey: ${idempotencyKey}`);
    return idempotencyCache.get(idempotencyKey);
  }

  // 3. Obtain Central Google OAuth2 Client
  const { client, error, message } = await getCentralAuthedClient();
  if (error || !client) {
    throw new Error(`Central Google Meet service unavailable: ${message || error}`);
  }

  // 4. Calculate start and end times
  const start = startTime ? new Date(startTime) : new Date(Date.now() + 2 * 60 * 1000);
  if (isNaN(start.getTime())) {
    throw new Error('Invalid startTime provided.');
  }
  const duration = Number(durationMinutes) > 0 ? Number(durationMinutes) : 60;
  const end = new Date(start.getTime() + duration * 60 * 1000);

  const calendar = google.calendar({ version: 'v3', auth: client });
  const requestId = idempotencyKey ? `hmm-${idempotencyKey}` : `hmm-${crypto.randomUUID()}`;

  const summary = topic || `Mentorship Session: Mentor [${mentorId}] & Mentee [${menteeId}]`;
  const description = [
    `Mentorship Session on HelpMeMan.`,
    `Client: ${clientId}`,
    `Mentor ID: ${mentorId}`,
    `Mentee ID: ${menteeId}`,
    `Duration: ${duration} minutes`,
    ``,
    `Please join on time. Participants on this invite enter directly without knocking.`,
  ].join('\n');

  // 5. Call Google Calendar API to provision Google Meet conference
  const response = await calendar.events.insert({
    calendarId: 'primary',
    conferenceDataVersion: 1, // Mandatory for Google Meet link generation
    sendUpdates: 'all',       // Dispatches Google Calendar invite to mentor & mentee
    requestBody: {
      summary,
      description,
      start: { dateTime: start.toISOString() },
      end: { dateTime: end.toISOString() },
      attendees: [
        { email: mentorEmail.trim(), displayName: `Mentor (${mentorId})` },
        { email: menteeEmail.trim(), displayName: `Mentee (${menteeId})` },
      ],
      conferenceData: {
        createRequest: {
          requestId,
          conferenceSolutionKey: { type: 'hangoutsMeet' },
        },
      },
      reminders: { useDefault: false },
      guestsCanModify: false,
      guestsCanInviteOthers: false,
    },
  });

  const createdEvent = response.data;
  const meetEntryPoint = createdEvent.conferenceData?.entryPoints?.find(
    (ep) => ep.entryPointType === 'video'
  );
  const meetUrl = meetEntryPoint?.uri || createdEvent.hangoutLink || null;

  if (!meetUrl || !isValidMeetLink(meetUrl)) {
    throw new Error(`Google Calendar created the event, but did not return a valid Google Meet link. Received: ${meetUrl}`);
  }

  const result = {
    meetingId: `meet_${createdEvent.id}`,
    meetUrl,
    googleEventId: createdEvent.id,
    clientId,
    mentorId,
    menteeId,
    mentorEmail,
    menteeEmail,
    topic: summary,
    startTime: start.toISOString(),
    endTime: end.toISOString(),
    durationMinutes: duration,
    status: 'created',
    createdAt: new Date().toISOString(),
  };

  // Cache for idempotency
  if (idempotencyKey) {
    idempotencyCache.set(idempotencyKey, result);
    // Auto-evict from cache after 24 hours
    setTimeout(() => idempotencyCache.delete(idempotencyKey), 24 * 60 * 60 * 1000);
  }

  console.log(`[centralMeet] Successfully provisioned Google Meet: ${meetUrl} for Mentor: ${mentorEmail}, Mentee: ${menteeEmail}`);
  return result;
}

/**
 * Helper to auto-provision a Google Meet meeting for an existing HelpMeMan booking
 */
async function provisionMeetingForBooking(bookingId) {
  const booking = await prisma.booking.findUnique({
    where: { id: bookingId },
    include: {
      user: true,
      mentor: {
        include: {
          user: { select: { id: true, name: true, email: true } },
        },
      },
    },
  });

  if (!booking) {
    throw new Error(`Booking ${bookingId} not found.`);
  }

  const mentorEmail = booking.mentor?.user?.email || booking.mentor?.institutionEmail;
  const menteeEmail = booking.user?.email;

  if (!mentorEmail || !menteeEmail) {
    throw new Error('Both mentor and mentee must have valid emails associated with this booking.');
  }

  const meeting = await createCentralMeeting({
    clientId: 'helpmeman-booking',
    mentorId: booking.mentorId,
    menteeId: booking.userId,
    mentorEmail,
    menteeEmail,
    topic: `HelpMeMan: 1:1 Session with ${booking.mentor?.displayName || 'Mentor'}`,
    startTime: booking.scheduledAt,
    durationMinutes: booking.durationMinutes || 30,
    idempotencyKey: `booking-${booking.id}`,
  });

  // Update booking record in DB
  const updatedBooking = await prisma.booking.update({
    where: { id: bookingId },
    data: {
      meetLink: meeting.meetUrl,
      googleEventId: meeting.googleEventId,
    },
    include: {
      mentor: { select: { id: true, displayName: true } },
      user: { select: { id: true, name: true, email: true } },
    },
  });

  return { meeting, booking: updatedBooking };
}

module.exports = {
  getCentralAuthedClient,
  getStoredCentralTokens,
  saveCentralTokens,
  generateCentralAuthUrl,
  checkCentralAccountStatus,
  createCentralMeeting,
  provisionMeetingForBooking,
};
