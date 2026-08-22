const express = require('express');
const router = express.Router();
const { authLimiter, otpLimiter } = require('../middleware/rateLimiter');
const { authenticate } = require('../middleware/auth');
const { validate } = require('../middleware/validate');
const {
  registerSchema,
  verifyOtpSchema,
  loginSchema,
  forgotPasswordSchema,
  verifyResetOtpSchema,
  resetPasswordSchema,
  refreshTokenSchema,
  changePasswordSchema,
} = require('../schemas/auth.schema');
const auth = require('../controllers/auth.controller');

router.post('/register', authLimiter, validate(registerSchema), auth.register);
router.post('/verify-signup-otp', otpLimiter, validate(verifyOtpSchema), auth.verifySignupOTP);
router.post('/register/mentor', authLimiter, validate(registerSchema), auth.registerMentor);
router.post('/verify-mentor-otp', authLimiter, validate(verifyOtpSchema), auth.verifyMentorOTP);
router.post('/verify-email', authLimiter, auth.verifyEmail);
router.post('/login', authLimiter, validate(loginSchema), auth.login);
router.post('/google', authLimiter, auth.googleLogin);
router.post('/refresh', authLimiter, validate(refreshTokenSchema), auth.refresh);
router.post('/logout', authLimiter, auth.logout);
router.post('/forgot-password', otpLimiter, validate(forgotPasswordSchema), auth.forgotPassword);
router.post('/verify-reset-otp', otpLimiter, validate(verifyResetOtpSchema), auth.verifyResetOTP);
router.post('/reset-password', authLimiter, validate(resetPasswordSchema), auth.resetPassword);
router.post('/resend-otp', otpLimiter, auth.resendOTP);

// Protected: must be authenticated.
router.post('/change-password', authenticate, validate(changePasswordSchema), auth.changePassword);

module.exports = router;
