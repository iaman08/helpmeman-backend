const express = require('express');
const router = express.Router();
const payment = require('../controllers/payment.controller');

router.post('/webhook', payment.handleWebhook);

module.exports = router;
