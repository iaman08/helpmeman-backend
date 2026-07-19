const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth');
const { roleGuard } = require('../middleware/roleGuard');
const chat = require('../controllers/chat.controller');
const { upload, uploadAttachment } = require('../controllers/chatUpload.controller');

router.use(authenticate);
router.use(roleGuard('SUPER_ADMIN', 'ADMIN', 'MENTOR', 'STUDENT'));

// Thread management
router.get('/unread-count', chat.getUnreadCount);
router.post('/threads', chat.createThread);
router.get('/threads', chat.listThreads);
router.get('/threads/:threadId', chat.getThread);
router.post('/threads/:threadId/close', chat.closeThreadHandler);

// Messages (paginated)
router.get('/threads/:threadId/messages', chat.getMessages);
router.post('/threads/:threadId/messages', chat.postMessage);
router.patch('/threads/:threadId/messages/:messageId', chat.editMessageHandler);
router.delete('/threads/:threadId/messages/:messageId', chat.deleteMessageHandler);

// Reactions
router.post('/threads/:threadId/messages/:messageId/reactions', chat.addReactionHandler);
router.delete('/threads/:threadId/messages/:messageId/reactions/:emoji', chat.removeReactionHandler);

// Read receipts
router.put('/threads/:threadId/read', chat.markRead);

// File upload for chat attachments
router.post('/threads/:threadId/upload', upload.single('file'), uploadAttachment);

module.exports = router;
