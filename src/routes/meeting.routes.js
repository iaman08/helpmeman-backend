const express = require('express');
const router = express.Router();
const { optionalAuth, authenticate } = require('../middleware/auth');
const meetingController = require('../controllers/meeting.controller');

// Public/M2M or JWT-authenticated meeting creation
router.post('/', optionalAuth, meetingController.createMeeting);

// Service health and connection status
router.get('/status', meetingController.getStatus);

// Provision or re-generate Google Meet link for an existing booking
router.post('/provision/:bookingId', optionalAuth, meetingController.provisionBookingMeeting);

// SuperAdmin OAuth consent URL generation
router.get('/auth-url', authenticate, meetingController.getAuthUrl);

// OAuth callback endpoint for central account authorization
router.get('/auth-callback', meetingController.handleAuthCallback);

module.exports = router;
