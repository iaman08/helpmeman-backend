const rateLimit = require('express-rate-limit');

const isDev = process.env.NODE_ENV === 'development';

const makeLimiter = (options) => {
  if (isDev) {
    return (req, res, next) => next();
  }
  return rateLimit(options);
};

const generalLimiter = makeLimiter({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, please try again later.' },
});

const authLimiter = makeLimiter({
  windowMs: 15 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many auth attempts, please try again later.' },
});

const otpLimiter = makeLimiter({
  windowMs: 60 * 1000, // 1 minute
  max: 3,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many OTP requests. Please wait a moment.' },
});

const uploadLimiter = makeLimiter({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 20,
  message: { error: 'Upload limit reached, try again later.' },
});

module.exports = { generalLimiter, authLimiter, otpLimiter, uploadLimiter };
