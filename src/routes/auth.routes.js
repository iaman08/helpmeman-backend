const express = require('express');
const router = express.Router();
const { authLimiter, otpLimiter } = require('../middleware/rateLimiter');
const { authenticate } = require('../middleware/auth');
const auth = require('../controllers/auth.controller');

router.post('/register', authLimiter, auth.register);
router.post('/verify-signup-otp', otpLimiter, auth.verifySignupOTP);
router.post('/register/mentor', authLimiter, auth.registerMentor);
router.post('/verify-mentor-otp', authLimiter, auth.verifyMentorOTP);
router.post('/verify-email', authLimiter, auth.verifyEmail);
router.post('/login', authLimiter, auth.login);
router.post('/google', authLimiter, auth.googleLogin);
router.post('/refresh', authLimiter, auth.refresh);
router.post('/logout', authLimiter, auth.logout);
router.post('/forgot-password', otpLimiter, auth.forgotPassword);
router.post('/verify-reset-otp', otpLimiter, auth.verifyResetOTP);
router.post('/reset-password', authLimiter, auth.resetPassword);
router.post('/resend-otp', otpLimiter, auth.resendOTP);

// Protected: must be authenticated. Allows first-login admins to set a permanent password.
router.post('/change-password', authenticate, auth.changePassword);

module.exports = router;
