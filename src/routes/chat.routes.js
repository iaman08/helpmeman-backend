const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth');
const { roleGuard } = require('../middleware/roleGuard');
const chat = require('../controllers/chat.controller');

router.use(authenticate);
router.use(roleGuard('USER', 'MENTOR'));

router.post('/threads', chat.createThread);
router.get('/threads', chat.listThreads);
router.get('/threads/:threadId', chat.getThread);
router.post('/threads/:threadId/messages', chat.postMessage);
router.put('/threads/:threadId/read', chat.markRead);
router.post('/threads/:threadId/close', chat.closeThreadHandler);

module.exports = router;
