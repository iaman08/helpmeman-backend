const express = require('express');
const router = express.Router();
const { authenticate, optionalAuth } = require('../middleware/auth');
const { authLimiter, generalLimiter } = require('../middleware/rateLimiter');
const controller = require('../controllers/linkedin.controller');

// ── OAuth Flow ─────────────────────────────────────────────────────────────
// Get authorization URL (supports both authenticated users linking accounts & new users)
router.get('/auth-url', generalLimiter, optionalAuth, controller.getAuthUrl);

// OAuth Callback from LinkedIn
router.get('/callback', authLimiter, controller.handleOAuthCallback);

// ── Profile & Ruth AI Endpoints ───────────────────────────────────────────
// Get imported profile
router.get('/profile', authenticate, controller.getImportedProfile);

// Disconnect LinkedIn
router.post('/disconnect', authenticate, controller.disconnect);

// Trigger Ruth AI analysis on imported or user-provided profile
router.post('/ruth/analyze', generalLimiter, authenticate, controller.analyzeWithRuth);

// Publish confirmed mentor profile
router.post('/publish', authenticate, controller.publishMentorProfile);

module.exports = router;
