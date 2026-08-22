/**
 * @file securedAuth.routes.js
 * @description Production-Hardened Authentication Express Router.
 * 
 * OWASP Reference:
 * - A04:2021 Insecure Design (Rate Limit Throttling per Endpoint)
 * - A03:2021 Injection (Zod Schema Validation Middleware Integration)
 * - A07:2021 Identification & Authentication Failures (Protected Endpoint Guards)
 */

const express = require('express');
const router = express.Router();

// Middleware Dependencies
const { validate } = require('../middleware/validate');
const { authLimiter, otpLimiter } = require('../middleware/rateLimiter');
const { authenticate } = require('../middleware/auth');

// Zod Request Validation Schemas
const {
  registerSchema,
  verifyOtpSchema,
  loginSchema,
  refreshTokenSchema,
} = require('../schemas/auth.schema');

// Hardened Controller Actions
const securedAuth = require('../controllers/securedAuth.controller');

/**
 * @route POST /api/v2/auth/register
 * @desc  Register new account initiation (issues OTP)
 */
router.post(
  '/register',
  authLimiter,              // 1. OWASP Throttling Rate Limiter (Max 10 requests / 15 min)
  validate(registerSchema), // 2. OWASP Input Validation & Schema Sanitization
  securedAuth.register       // 3. Hardened Async Handler Controller
);

/**
 * @route POST /api/v2/auth/verify-signup-otp
 * @desc  Verify OTP code and complete user registration
 */
router.post(
  '/verify-signup-otp',
  otpLimiter,               // 1. OWASP OTP Rate Limiter (Max 3 requests / min)
  validate(verifyOtpSchema), // 2. OWASP Input Validation & Schema Sanitization
  securedAuth.verifySignupOTP
);

/**
 * @route POST /api/v2/auth/login
 * @desc  Authenticate credentials and issue JWT tokens
 */
router.post(
  '/login',
  authLimiter,              // 1. OWASP Brute-Force Rate Limiter
  validate(loginSchema),    // 2. OWASP Input Validation
  securedAuth.login
);

/**
 * @route POST /api/v2/auth/refresh
 * @desc  Rotate JWT access and refresh tokens
 */
router.post(
  '/refresh',
  authLimiter,
  validate(refreshTokenSchema),
  securedAuth.refresh
);

module.exports = router;
