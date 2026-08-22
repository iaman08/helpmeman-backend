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

const twoFactor = require('../controllers/twoFactor.controller');

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

// 2FA Routes (Google Authenticator TOTP)
router.get('/2fa/setup', authenticate, twoFactor.setup2FA);
router.post('/2fa/enable', authenticate, twoFactor.enable2FA);
router.post('/2fa/disable', authenticate, twoFactor.disable2FA);
router.post('/2fa/verify-login', authLimiter, twoFactor.verify2FALogin);

// Protected: must be authenticated.
router.post('/change-password', authenticate, validate(changePasswordSchema), auth.changePassword);

module.exports = router;
