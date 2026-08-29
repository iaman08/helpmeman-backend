const express = require('express');
const router = express.Router();
const { handleTawkWebhook } = require('../controllers/tawkWebhook.controller');

// POST /api/webhooks/tawk
router.post('/tawk', handleTawkWebhook);

module.exports = router;
