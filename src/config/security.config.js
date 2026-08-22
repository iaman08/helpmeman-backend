/**
 * @file security.config.js
 * @description Centralized Security Headers (Helmet) & CORS Configuration for OWASP Hardening.
 * 
 * OWASP Reference:
 * - A05:2021 Security Misconfiguration (Secure Headers, Strict CORS Whitelisting)
 * - Clickjacking (X-Frame-Options: DENY)
 * - XSS & Content Injection (Content Security Policy)
 * - Protocol Security (HSTS Preloading)
 */

const config = require('./env');

// Normalize configured frontend domain URL
const configuredFrontend = config.frontendUrl ? config.frontendUrl.replace(/\/+$/, '') : null;

// Whitelisted production and development origins
const ALLOWED_ORIGINS = [
  configuredFrontend,
  'https://helpmeman.com',
  'https://www.helpmeman.com',
  'https://helpmeman-frontend.vercel.app',
  'http://localhost:3000',
  'http://localhost:8081',
  'http://127.0.0.1:3000',
  'http://127.0.0.1:8081',
].filter(Boolean);

/**
 * Strict CORS Origin Checker Callback.
 * Validates incoming origin against authorized domain white-list and dynamic Vercel / DigitalOcean origins.
 */
const corsOriginCheck = (origin, callback) => {
  // Allow server-to-server or non-browser tools in non-production (e.g. mobile apps / curl without origin header)
  if (!origin) return callback(null, true);

  const cleanOrigin = origin.replace(/\/+$/, '');

  // Check explicit whitelist
  if (ALLOWED_ORIGINS.includes(cleanOrigin)) {
    return callback(null, true);
  }

  // Check development localhost/LAN IP pattern
  const isDevLocalhost =
    cleanOrigin.startsWith('http://localhost:') ||
    cleanOrigin.startsWith('http://127.0.0.1:') ||
    cleanOrigin.startsWith('http://192.168.') ||
    cleanOrigin.startsWith('http://10.');

  // Check official production subdomains
  const isCustomDomain =
    cleanOrigin.endsWith('.helpmeman.com') ||
    cleanOrigin.endsWith('.ondigitalocean.app') ||
    /^https:\/\/helpmeman-frontend-[a-z0-9-]+\.vercel\.app$/.test(cleanOrigin);

  if (isDevLocalhost || isCustomDomain) {
    return callback(null, true);
  }

  console.warn(`[SECURITY] [CORS BLOCKED] Unauthorized origin attempted connection: ${origin}`);
  return callback(new Error(`CORS Policy Violation: Origin '${origin}' is not allowed by Access-Control-Allow-Origin.`));
};

/**
 * CORS Options Configuration Object
 */
const corsOptions = {
  origin: corsOriginCheck,
  credentials: true, // Allow cookies & authorization headers
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: [
    'Content-Type',
    'Authorization',
    'X-Requested-With',
    'X-Request-ID',
    'x-show-loader',
    'Cache-Control',
    'Pragma',
    'Expires',
  ],
  exposedHeaders: ['X-Response-Time', 'RateLimit-Limit', 'RateLimit-Remaining', 'RateLimit-Reset'],
  maxAge: 86400, // Cache preflight response for 24 hours (86400s) to reduce preflight overhead
};

/**
 * Helmet Security Headers Directives Configuration
 */
const helmetConfig = {
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'", "https:"],
      styleSrc: ["'self'", "'unsafe-inline'", "https:"],
      imgSrc: ["'self'", "data:", "https:", "blob:"],
      connectSrc: ["'self'", "https:", "wss:", "ws:"],
      fontSrc: ["'self'", "https:", "data:"],
      objectSrc: ["'none'"],
      mediaSrc: ["'self'"],
      frameAncestors: ["'none'"], // Prevent site framing (Clickjacking protection)
      baseUri: ["'self'"],
      formAction: ["'self'"],
    },
  },
  crossOriginEmbedderPolicy: false,
  crossOriginOpenerPolicy: { policy: "same-origin" },
  crossOriginResourcePolicy: { policy: "same-origin" },
  referrerPolicy: { policy: "strict-origin-when-cross-origin" },
  hsts: {
    maxAge: 31536000, // 1 Year HSTS retention
    includeSubDomains: true,
    preload: true,
  },
  noSniff: true, // Prevent X-Content-Type-Options MIME sniffing
  xssFilter: true,
};

module.exports = {
  corsOriginCheck,
  corsOptions,
  helmetConfig,
  ALLOWED_ORIGINS,
};
