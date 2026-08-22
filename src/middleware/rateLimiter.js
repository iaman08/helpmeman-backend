/**
 * @file rateLimiter.js
 * @description OWASP-Compliant Request Rate Limiting & Throttling Middleware.
 * 
 * OWASP Reference:
 * - A04:2021 Insecure Design (Rate Limiting & Resource Exhaustion Protection)
 * - A07:2021 Identification & Authentication Failures (Brute-Force Mitigation)
 */

const rateLimit = require('express-rate-limit');
const config = require('../config/env');

const isDev = (config.nodeEnv || process.env.NODE_ENV) === 'development';

/**
 * Custom handler to return standardized HTTP 429 response structure.
 */
const rateLimitHandler = (req, res, next, options) => {
  res.status(options.statusCode || 429).json({
    success: false,
    error: {
      code: 'RATE_LIMIT_EXCEEDED',
      message: options.message?.error || options.message || 'Too many requests, please try again later.',
      retryAfterSeconds: Math.ceil(options.windowMs / 1000),
    },
  });
};

/**
 * Key generator taking client IP into account safely behind reverse proxies.
 */
const keyGenerator = (req) => {
  // express-rate-limit uses req.ip when app.set('trust proxy', true) is set
  return req.ip || req.headers['x-forwarded-for'] || req.socket.remoteAddress;
};

const makeLimiter = (options) => {
  return rateLimit({
    standardHeaders: true, // Return RateLimit-* RFC 7231 headers
    legacyHeaders: false,  // Disable X-RateLimit-* headers
    keyGenerator: keyGenerator,
    handler: rateLimitHandler,
    skip: () => isDev && process.env.ENABLE_RATE_LIMIT_DEV !== 'true', // Skip rate limiting in local dev unless explicitly enabled
    ...options,
  });
};

/**
 * General API Limiter: Protects standard application endpoints (300 req / 15 min)
 */
const generalLimiter = makeLimiter({
  windowMs: 15 * 60 * 1000,
  max: 300,
  message: { error: 'General rate limit exceeded. Please throttle request frequency.' },
});

/**
 * Auth Limiter: Protects authentication endpoints (login/register) from brute-force (10 attempts / 15 min per IP)
 */
const authLimiter = makeLimiter({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { error: 'Too many authentication attempts. Please wait 15 minutes before trying again.' },
});

/**
 * OTP Limiter: Protects SMS/Email OTP generation routes (3 requests / 1 min per IP)
 */
const otpLimiter = makeLimiter({
  windowMs: 60 * 1000,
  max: 3,
  message: { error: 'Too many OTP requests. Please wait 60 seconds.' },
});

/**
 * Upload Limiter: Throttles multipart file upload endpoints (20 uploads / hour)
 */
const uploadLimiter = makeLimiter({
  windowMs: 60 * 60 * 1000,
  max: 20,
  message: { error: 'File upload quota reached. Please try again in an hour.' },
});

/**
 * Sensitive Mutation Limiter: Protects high-impact database actions (payment initiation, password changes)
 */
const sensitiveMutationLimiter = makeLimiter({
  windowMs: 5 * 60 * 1000,
  max: 15,
  message: { error: 'Too many sensitive operations requested. Please wait a few minutes.' },
});

module.exports = {
  generalLimiter,
  authLimiter,
  otpLimiter,
  uploadLimiter,
  sensitiveMutationLimiter,
};
