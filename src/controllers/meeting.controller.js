/**
 * Central Meeting Controller
 * Handles HTTP requests for the centralized Google Meet microservice.
 */

const {
  createCentralMeeting,
  checkCentralAccountStatus,
  generateCentralAuthUrl,
  saveCentralTokens,
  provisionMeetingForBooking,
} = require('../services/centralMeet.service');
const { google } = require('googleapis');
const config = require('../config/env');
const prisma = require('../config/prisma');

/**
 * Helper to verify microservice API key or fallback to req.user JWT authentication
 */
function isAuthorizedCaller(req) {
  const authHeader = req.headers['authorization'];
  const xApiKey = req.headers['x-api-key'];
  const configuredApiKey = config.google?.meetApiKey || process.env.MEET_SERVICE_API_KEY || process.env.CENTRAL_MEET_API_KEY;

  // 1. Check API Key
  if (configuredApiKey) {
    if (xApiKey && xApiKey === configuredApiKey) return true;
    if (authHeader && authHeader === `Bearer ${configuredApiKey}`) return true;
  }

  // 2. Check JWT User
  if (req.user && (req.user.role === 'SUPER_ADMIN' || req.user.role === 'ADMIN' || req.user.role === 'MENTOR' || req.user.role === 'STUDENT')) {
    return true;
  }

  return false;
}

/**
 * POST /api/meetings
 * Central endpoint to generate Google Meet meetings on demand for clients and mentor-mentee pairs.
 */
async function createMeeting(req, res) {
  try {
    if (!isAuthorizedCaller(req)) {
      return res.status(401).json({
        error: 'Unauthorized: Missing or invalid API key or session token.',
      });
    }

    const {
      clientId = 'default-client',
      mentorId,
      menteeId,
      mentorEmail,
      menteeEmail,
      topic,
      startTime,
      durationMinutes = 60,
      idempotencyKey,
    } = req.body;

    if (!mentorId || !menteeId) {
      return res.status(400).json({
        error: 'Validation failed: mentorId and menteeId are required fields.',
      });
    }

    if (!mentorEmail || !menteeEmail) {
      return res.status(400).json({
        error: 'Validation failed: mentorEmail and menteeEmail are required to ensure participants bypass Google Meet knocking.',
      });
    }

    const meeting = await createCentralMeeting({
      clientId,
      mentorId,
      menteeId,
      mentorEmail,
      menteeEmail,
      topic,
      startTime,
      durationMinutes,
      idempotencyKey,
    });

    return res.status(201).json(meeting);
  } catch (error) {
    console.error('[meeting.controller] createMeeting error:', error.message);
    const statusCode = error.message.includes('Validation failed') || error.message.includes('required') ? 400 : 500;
    return res.status(statusCode).json({
      error: 'Failed to create meeting',
      details: error.message,
    });
  }
}

/**
 * GET /api/meetings/status
 * Returns health and connection status of the central Google account.
 */
async function getStatus(req, res) {
  try {
    const status = await checkCentralAccountStatus();
    return res.json(status);
  } catch (error) {
    console.error('[meeting.controller] getStatus error:', error.message);
    return res.status(500).json({ error: 'Failed to check meeting service status', details: error.message });
  }
}

/**
 * POST /api/meetings/provision/:bookingId
 * On-demand endpoint to auto-provision a fresh centralized Google Meet link for a booking.
 */
async function provisionBookingMeeting(req, res) {
  try {
    const { bookingId } = req.params;
    if (!bookingId) {
      return res.status(400).json({ error: 'bookingId parameter is required' });
    }

    // Verify booking permissions
    const booking = await prisma.booking.findUnique({
      where: { id: bookingId },
      include: { mentor: true },
    });

    if (!booking) {
      return res.status(404).json({ error: 'Booking not found' });
    }

    // Must be admin, or the mentor, or the mentee of the booking
    const isOwner = req.user && (
      req.user.id === booking.userId ||
      req.user.id === booking.mentor?.userId ||
      req.user.role === 'SUPER_ADMIN' ||
      req.user.role === 'ADMIN'
    );

    if (!isOwner && !isAuthorizedCaller(req)) {
      return res.status(403).json({ error: 'Forbidden: You do not have permission to provision meetings for this booking' });
    }

    const result = await provisionMeetingForBooking(bookingId);
    return res.json({
      success: true,
      message: 'Google Meet meeting successfully provisioned for booking',
      meetUrl: result.meeting.meetUrl,
      meeting: result.meeting,
      booking: result.booking,
    });
  } catch (error) {
    console.error('[meeting.controller] provisionBookingMeeting error:', error.message);
    return res.status(500).json({ error: 'Failed to provision booking meeting', details: error.message });
  }
}

/**
 * GET /api/meetings/auth-url
 * Returns OAuth consent URL to authorize or re-authorize the central platform Google account.
 */
async function getAuthUrl(req, res) {
  try {
    // Only admins or authorized developers can request the central account auth URL
    if (req.user && req.user.role !== 'SUPER_ADMIN' && req.user.role !== 'ADMIN') {
      return res.status(403).json({ error: 'Forbidden: Only administrators can configure the central meeting account' });
    }

    const returnPath = req.query.returnPath || '/superadmin/settings';
    const url = generateCentralAuthUrl(returnPath);
    return res.json({ url });
  } catch (error) {
    console.error('[meeting.controller] getAuthUrl error:', error.message);
    return res.status(500).json({ error: 'Failed to generate authorization URL', details: error.message });
  }
}

/**
 * GET /api/meetings/auth-callback
 * OAuth callback endpoint specifically for the central platform Google account.
 */
async function handleAuthCallback(req, res) {
  const { code, state, error: oauthError } = req.query;

  let returnPath = '/superadmin/settings';
  try {
    if (state && state.includes('.')) {
      const dataStr = state.split('.')[0];
      const jsonStr = Buffer.from(dataStr, 'base64url').toString('utf8');
      const parsed = JSON.parse(jsonStr);
      if (parsed.returnPath) returnPath = parsed.returnPath;
    }
  } catch {}

  const buildRedirect = (statusParam) => {
    const cleanPath = returnPath.startsWith('/') ? returnPath : `/${returnPath}`;
    const sep = cleanPath.includes('?') ? '&' : '?';
    return `${config.frontendUrl}${cleanPath}${sep}google_central=${statusParam}`;
  };

  if (oauthError) {
    console.warn(`[meeting.controller] Central OAuth denied: ${oauthError}`);
    return res.redirect(buildRedirect('denied'));
  }

  if (!code) {
    return res.redirect(buildRedirect('missing_code'));
  }

  try {
    const redirectUri = `${config.frontendUrl || 'http://localhost:3000'}/api/meetings/auth-callback`;
    const oauth2Client = new google.auth.OAuth2(
      config.google.clientId,
      config.google.clientSecret,
      redirectUri
    );

    const { tokens } = await oauth2Client.getToken(code);
    oauth2Client.setCredentials(tokens);

    // Fetch user info email
    let userEmail = config.google.centralEmail;
    try {
      const oauth2 = google.oauth2({ version: 'v2', auth: oauth2Client });
      const userInfo = await oauth2.userinfo.get();
      if (userInfo.data.email) userEmail = userInfo.data.email;
    } catch {}

    await saveCentralTokens(tokens, userEmail);
    console.log(`[meeting.controller] Central Google account successfully authorized (${userEmail})`);
    return res.redirect(buildRedirect('connected'));
  } catch (err) {
    console.error('[meeting.controller] handleAuthCallback error:', err.message);
    return res.redirect(buildRedirect('error'));
  }
}

module.exports = {
  createMeeting,
  getStatus,
  provisionBookingMeeting,
  getAuthUrl,
  handleAuthCallback,
};
