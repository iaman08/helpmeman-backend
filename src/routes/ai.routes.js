const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth');
const { generalLimiter } = require('../middleware/rateLimiter');
const ai = require('../controllers/ai.controller');

router.use(authenticate);

// Chat
router.post('/chat', generalLimiter, ai.chatWithAI);
router.post('/clear', ai.clearChat); // legacy

// Sessions
router.post('/sessions', ai.createSession);
router.get('/sessions', ai.getSessions);
router.get('/sessions/:id/resume', ai.resumeSession);
router.post('/sessions/:id/end', ai.endSession);
router.delete('/sessions/:id', ai.deleteSession);
router.put('/sessions/:id/rename', ai.renameSession);

// Meetings
router.get('/meetings', ai.getMeetings);
router.post('/meetings/:bookingId/session', ai.getMeetingSession);

module.exports = router;
