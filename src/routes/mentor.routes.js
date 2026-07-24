const express = require('express');
const router = express.Router();
const multer = require('multer');
const { authenticate, optionalAuth } = require('../middleware/auth');
const { roleGuard } = require('../middleware/roleGuard');
const mentor = require('../controllers/mentor.controller');

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

// Interaction tracking (authenticated / optional)
router.post('/interactions', optionalAuth, mentor.logInteraction);

// Interaction analytics (Admin / Super Admin only)
router.get('/analytics', authenticate, roleGuard('ADMIN', 'SUPER_ADMIN'), mentor.getInteractionAnalytics);

// Public routes
router.get('/', mentor.searchMentors);
router.get('/:id', mentor.getMentorPublic);
router.get('/:id/availability', mentor.getMentorAvailability);
router.get('/:id/reviews', mentor.getMentorReviews);

module.exports = router;
