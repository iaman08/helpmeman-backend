const express = require('express');
const router = express.Router();
const { generalLimiter } = require('../middleware/rateLimiter');
const { analyzeResume } = require('../controllers/resumeRoast.controller');

// POST /api/resume-roast/analyze (Supports file upload or text payload)
router.post('/analyze', generalLimiter, analyzeResume);

module.exports = router;
