/**
 * Google OAuth Routes
 * Handles the per-mentor Google Calendar connection flow.
 *
 * GET  /api/google/oauth/url        → Returns auth URL (mentor only)
 * GET  /api/google/oauth/callback   → Handles OAuth callback, saves tokens, redirects
 * DELETE /api/google/oauth/disconnect → Revokes Google Calendar connection
 * GET  /api/google/oauth/status     → Returns connection status
 */

const express = require('express');
const router = express.Router();
const prisma = require('../config/prisma');
const { authenticate } = require('../middleware/auth');
const { roleGuard } = require('../middleware/roleGuard');
const config = require('../config/env');
const {
  generateAuthUrl,
  exchangeCodeForTokens,
  saveMentorTokens,
  revokeMentorTokens,
  verifyState,
} = require('../services/googleOAuth.service');

// ── GET /api/google/oauth/url ─────────────────────────────────────────────────
// Returns the Google OAuth authorization URL for the requesting mentor.
router.get('/oauth/url', authenticate, roleGuard('SUPER_ADMIN', 'ADMIN', 'MENTOR'), async (req, res) => {
  try {
    let mentor = await prisma.mentor.findUnique({ where: { userId: req.user.id } });

    // Auto-provision an approved mentor profile if an admin or super admin connects
    if (!mentor && (req.user.role === 'ADMIN' || req.user.role === 'SUPER_ADMIN')) {
      let defaultCategory = await prisma.category.findFirst({ where: { isActive: true } });
      if (!defaultCategory) {
        defaultCategory = await prisma.category.create({
          data: {
            name: 'General Mentorship',
            slug: 'general-mentorship',
            description: 'General mentorship category',
          },
        });
      }

      mentor = await prisma.mentor.create({
        data: {
          userId: req.user.id,
          displayName: req.user.name || 'Admin Mentor',
          bio: 'Administrative preview profile for platform management and testing.',
          institutionType: 'OTHER',
          institutionName: 'HelpMeMan Platform',
          institutionEmail: req.user.email,
          categoryId: defaultCategory.id,
          approvalStatus: 'APPROVED',
          isActive: true,
          pricePerSession: 0,
          sessionDuration: 30,
        },
      });
    }

    if (!mentor) return res.status(404).json({ error: 'Mentor profile not found' });

    const returnPath = req.query.returnPath || '/mentor/calendar';
    const url = generateAuthUrl(mentor.id, { returnPath });
    res.json({ url });
  } catch (error) {
    console.error('[google.routes] /oauth/url error:', error.message);
    res.status(500).json({ error: 'Failed to generate authorization URL' });
  }
});

// ── GET /api/google/oauth/status ──────────────────────────────────────────────
// Returns whether the requesting mentor has connected Google Calendar.
router.get('/oauth/status', authenticate, roleGuard('SUPER_ADMIN', 'ADMIN', 'MENTOR'), async (req, res) => {
  try {
    const mentor = await prisma.mentor.findUnique({
      where: { userId: req.user.id },
      select: { googleCalendarConnected: true, googleCalendarTimezone: true },
    });

    if (!mentor) {
      if (req.user.role === 'ADMIN' || req.user.role === 'SUPER_ADMIN' || req.user.email?.toLowerCase().endsWith('@helpmeman.com')) {
        return res.json({
          connected: true,
          timezone: 'Asia/Kolkata',
          isAdminPreview: true,
        });
      }
      return res.status(404).json({ error: 'Mentor profile not found' });
    }

    res.json({
      connected: mentor.googleCalendarConnected ?? false,
      timezone: mentor.googleCalendarTimezone || 'Asia/Kolkata',
    });
  } catch (error) {
    console.error('[google.routes] /oauth/status error:', error.message);
    res.status(500).json({ error: 'Failed to get status' });
  }
});

// ── GET /api/google/oauth/callback ───────────────────────────────────────────
// Google redirects here after the mentor grants consent.
// State param = { mentorId, returnPath, redirectUri } (CSRF signed).
// Saves tokens, then redirects to the designated frontend returnPath (default /mentor/calendar).
async function handleOAuthCallback(req, res) {
  const { code, state, error: oauthError } = req.query;

  // Verify CSRF-signed state parameter
  const stateData = verifyState(state);
  const mentorId = typeof stateData === 'object' && stateData !== null ? stateData.mentorId : stateData;
  const returnPath = (typeof stateData === 'object' && stateData !== null && stateData.returnPath) || '/mentor/calendar';
  const redirectUri = typeof stateData === 'object' && stateData !== null ? stateData.redirectUri : undefined;

  const buildRedirect = (statusParam) => {
    const cleanPath = returnPath.startsWith('/') ? returnPath : `/${returnPath}`;
    const sep = cleanPath.includes('?') ? '&' : '?';
    return `${config.frontendUrl}${cleanPath}${sep}google=${statusParam}`;
  };

  if (oauthError) {
    console.warn(`[google.routes] OAuth denied: ${oauthError}`);
    return res.redirect(buildRedirect('denied'));
  }

  if (!code || !mentorId) {
    console.warn('[google.routes] Invalid or tampered state parameter');
    return res.redirect(buildRedirect('error'));
  }

  try {
    // Verify mentor exists before saving tokens
    const mentor = await prisma.mentor.findUnique({ where: { id: mentorId } });
    if (!mentor) {
      console.warn(`[google.routes] Mentor not found for ID: ${mentorId}`);
      return res.redirect(buildRedirect('error'));
    }

    const tokens = await exchangeCodeForTokens(code, redirectUri);
    await saveMentorTokens(mentorId, tokens);

    console.log(`[google.routes] Google Calendar connected for mentor ${mentorId}`);
    res.redirect(buildRedirect('connected'));
  } catch (err) {
    console.error('[google.routes] /oauth/callback error:', err.message);
    res.redirect(buildRedirect('error'));
  }
}

router.get('/oauth/callback', handleOAuthCallback);
router.get('/callback', handleOAuthCallback);
router.handleOAuthCallback = handleOAuthCallback;

// ── DELETE /api/google/oauth/disconnect ──────────────────────────────────────
// Revokes the mentor's Google Calendar connection.
router.delete('/oauth/disconnect', authenticate, roleGuard('SUPER_ADMIN', 'ADMIN', 'MENTOR'), async (req, res) => {
  try {
    const mentor = await prisma.mentor.findUnique({ where: { userId: req.user.id } });
    if (!mentor) return res.status(404).json({ error: 'Mentor profile not found' });

    await revokeMentorTokens(mentor.id);
    res.json({ success: true, message: 'Google Calendar disconnected successfully' });
  } catch (error) {
    console.error('[google.routes] /oauth/disconnect error:', error.message);
    res.status(500).json({ error: 'Failed to disconnect Google Calendar' });
  }
});

// ── PUT /api/google/calendar/timezone ─────────────────────────────────────────
// Let mentor update their calendar timezone preference.
router.put('/calendar/timezone', authenticate, roleGuard('SUPER_ADMIN', 'ADMIN', 'MENTOR'), async (req, res) => {
  try {
    const { timezone } = req.body;
    if (!timezone || typeof timezone !== 'string') {
      return res.status(400).json({ error: 'Timezone is required' });
    }

    const mentor = await prisma.mentor.update({
      where: { userId: req.user.id },
      data: { googleCalendarTimezone: timezone },
      select: { googleCalendarTimezone: true },
    });

    res.json({ timezone: mentor.googleCalendarTimezone });
  } catch (error) {
    console.error('[google.routes] /calendar/timezone error:', error.message);
    res.status(500).json({ error: 'Failed to update timezone' });
  }
});

module.exports = router;
