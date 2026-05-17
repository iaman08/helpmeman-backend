const express = require('express');
const router = express.Router();
const { authLimiter } = require('../middleware/rateLimiter');
const auth = require('../controllers/auth.controller');

router.post('/register', authLimiter, auth.register);
router.post('/register/mentor', authLimiter, auth.registerMentor);
router.post('/verify-mentor-otp', authLimiter, auth.verifyMentorOTP);
router.post('/verify-email', auth.verifyEmail);
router.post('/login', authLimiter, auth.login);
router.post('/google', authLimiter, auth.googleLogin);
router.post('/refresh', auth.refresh);
router.post('/logout', auth.logout);
router.post('/forgot-password', authLimiter, auth.forgotPassword);
router.post('/reset-password', authLimiter, auth.resetPassword);

module.exports = router;
