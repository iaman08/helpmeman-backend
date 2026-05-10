const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth');
const { generalLimiter } = require('../middleware/rateLimiter');
const ai = require('../controllers/ai.controller');

router.use(authenticate);

router.post('/chat', generalLimiter, ai.chatWithAI);
router.post('/clear', ai.clearChat);

module.exports = router;
