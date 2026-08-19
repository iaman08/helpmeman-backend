const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth');
const { roleGuard } = require('../middleware/rbac');
const dev = require('../controllers/dev.controller');

// Unprotected dev login route
router.post('/auth/login', dev.devLogin);

// Protected developer endpoints (require DEVELOPER or SUPER_ADMIN role)
router.get('/stats', authenticate, roleGuard('DEVELOPER', 'SUPER_ADMIN'), dev.getDevStats);
router.post('/test-email', authenticate, roleGuard('DEVELOPER', 'SUPER_ADMIN'), dev.sendTestEmail);
router.post('/trigger-job', authenticate, roleGuard('DEVELOPER', 'SUPER_ADMIN'), dev.triggerDevJob);

module.exports = router;
