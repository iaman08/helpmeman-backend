const express = require('express');
const router = express.Router();
const cpProfileController = require('../controllers/cpProfile.controller');
const { authenticate, optionalAuth } = require('../middleware/auth');
const { generalLimiter } = require('../middleware/rateLimiter');

// Public & Authenticated CP Stats Aggregator
router.post('/fetch-stats', generalLimiter, optionalAuth, cpProfileController.fetchStats);

// User Linked Profiles
router.get('/profile', optionalAuth, cpProfileController.getSavedProfile);
router.post('/save-handles', authenticate, cpProfileController.saveHandles);

module.exports = router;
