const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth');
const {
  getQuestions,
  getStatus,
  createAptitudeOrder,
  verifyAptitudePayment,
  submitTest,
} = require('../controllers/aptitudeTest.controller');

// Public question preview / structure
router.get('/questions', getQuestions);

// Protected routes requiring user login
router.get('/status', authenticate, getStatus);
router.post('/create-order', authenticate, createAptitudeOrder);
router.post('/verify-payment', authenticate, verifyAptitudePayment);
router.post('/submit', authenticate, submitTest);

module.exports = router;
