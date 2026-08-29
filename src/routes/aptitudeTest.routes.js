const express = require('express');
const router = express.Router();
const { authenticateToken } = require('../middlewares/auth.middleware');
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
router.get('/status', authenticateToken, getStatus);
router.post('/create-order', authenticateToken, createAptitudeOrder);
router.post('/verify-payment', authenticateToken, verifyAptitudePayment);
router.post('/submit', authenticateToken, submitTest);

module.exports = router;
