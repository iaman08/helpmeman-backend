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
    const mentor = await prisma.mentor.findUnique({ where: { userId: req.user.id } });
    if (!mentor) return res.status(404).json({ error: 'Mentor profile not found' });

    const url = generateAuthUrl(mentor.id);
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
    if (!mentor) return res.status(404).json({ error: 'Mentor profile not found' });

    res.json({
      connected: mentor.googleCalendarConnected ?? false,
      timezone: mentor.googleCalendarTimezone,
    });
  } catch (error) {
    console.error('[google.routes] /oauth/status error:', error.message);
    res.status(500).json({ error: 'Failed to get status' });
  }
});

// ── GET /api/google/oauth/callback ───────────────────────────────────────────
// Google redirects here after the mentor grants consent.
// State param = mentorId (set by generateAuthUrl).
// Saves tokens, then redirects to the mentor dashboard settings page.
router.get('/oauth/callback', async (req, res) => {
  const { code, state, error: oauthError } = req.query;

  if (oauthError) {
    console.warn(`[google.routes] OAuth denied: ${oauthError}`);
    return res.redirect(`${config.frontendUrl}/mentor/settings?google=denied`);
  }

  // Verify CSRF-signed state parameter
  const mentorId = verifyState(state);
  if (!code || !mentorId) {
    console.warn('[google.routes] Invalid or tampered state parameter');
    return res.redirect(`${config.frontendUrl}/mentor/settings?google=error`);
  }

  try {
    // Verify mentor exists before saving tokens
    const mentor = await prisma.mentor.findUnique({ where: { id: mentorId } });
    if (!mentor) {
      return res.redirect(`${config.frontendUrl}/mentor/settings?google=error`);
    }

    const tokens = await exchangeCodeForTokens(code);
    await saveMentorTokens(mentorId, tokens);

    console.log(`[google.routes] Google Calendar connected for mentor ${mentorId}`);
    res.redirect(`${config.frontendUrl}/mentor/settings?google=connected`);
  } catch (err) {
    console.error('[google.routes] /oauth/callback error:', err.message);
    res.redirect(`${config.frontendUrl}/mentor/settings?google=error`);
  }
});

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
