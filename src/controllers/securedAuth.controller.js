/**
 * @file securedAuth.controller.js
 * @description Production-Hardened Authentication Controller implementing OWASP Defensive Engineering Best Practices.
 * 
 * =========================================================================================================================
 * DEFENSIVE ARCHITECTURE & OWASP COMPLIANCE OVERVIEW:
 * 1. OWASP A03:2021 - Injection & Mass Assignment Defense:
 *    - All incoming payloads (req.body, req.query, req.params) are validated & sanitized via Zod schemas BEFORE controller execution.
 *    - Controller consumes typed, sanitized data from `req.validData` or destructured params.
 *    - Database operations leverage Prisma ORM's strongly typed, parameterized queries (`prisma.user.findUnique`, `prisma.user.create`).
 *    - Explicit `select` blocks prevent leaking sensitive columns (passwordHash, resetTokens, secrets) in JSON responses.
 * 
 * 2. OWASP A05:2021 - Security Misconfiguration & Error Obfuscation:
 *    - Wrapped with `asyncHandler` to eliminate try-catch boilerplate and ensure unhandled rejections reach central error middleware.
 *    - Uses operational error classes (`BadRequestError`, `UnauthorizedError`, `ConflictError`, `InternalServerError`).
 *    - Internal stack traces, SQL error codes, and system internals are never returned in production HTTP responses.
 * 
 * 3. OWASP A07:2021 - Identification & Authentication Failures:
 *    - Password inputs are validated against complexity requirements (min 8 chars, upper, lower, digit).
 *    - Password verification uses constant-time hash comparisons via `bcryptjs`.
 *    - OTP tokens are single-use, rate-limited, and stored with expiration timestamps.
 * 
 * 4. OWASP A04:2021 - Insecure Design:
 *    - User status checks (ACTIVE vs DISABLED vs DELETED) enforced prior to issuing session credentials.
 * =========================================================================================================================
 */

const prisma = require('../config/prisma');
const supabase = require('../config/supabase');
const { hashPassword, comparePassword } = require('../utils/hash');
const { generateAccessToken, generateRefreshToken, verifyRefreshToken } = require('../utils/jwt');
const { generateOTP, storeOTP, verifyOTP } = require('../utils/otp');
const { sendOtpEmail } = require('../services/email.service');
const {
  AppError,
  BadRequestError,
  UnauthorizedError,
  ConflictError,
  InternalServerError,
  asyncHandler,
} = require('../utils/errors');
const config = require('../config/env');

/**
 * Sanitizes user database object for safe API responses by removing sensitive credential attributes.
 * 
 * @param {object} user - Prisma User database record
 * @returns {object} Safe user profile payload
 */
function sanitizeUserResponse(user) {
  if (!user) return null;
  const { password, passwordHash, otpSecret, resetToken, ...safeUser } = user;
  return safeUser;
}

/**
 * @route   POST /api/auth/register
 * @desc    Initiates user registration by validating input schema and issuing a single-use verification OTP.
 * @access  Public (Rate-limited via authLimiter)
 */
const register = asyncHandler(async (req, res) => {
  // Input payload parsed and sanitized via Zod middleware (validate.js)
  const { name, email, password } = req.validData.body;
  const normalizedEmail = email.toLowerCase().trim();

  // Parameterized Prisma query to check existing email registration (Prevents SQL Injection)
  const existingUser = await prisma.user.findUnique({
    where: { email: normalizedEmail },
    select: { id: true, role: true, onboardingRole: true },
  });

  if (existingUser) {
    const registeredRole = (existingUser.role === 'MENTOR' || existingUser.onboardingRole === 'MENTOR') ? 'Mentor' : 'Mentee';
    // Throw operational ConflictError (HTTP 409) without leaking database schema
    throw new ConflictError(`This email is already registered as a ${registeredRole} account.`);
  }

  // Generate cryptographically secure OTP token
  const otp = generateOTP();
  await storeOTP(normalizedEmail, otp, 'signup');
  await storeOTP(normalizedEmail, otp, 'verify');

  // Dispatch OTP verification email via mailer service
  const emailResult = await sendOtpEmail({ email: normalizedEmail, name, otp, purpose: 'signup' });
  
  if (!emailResult.success && config.nodeEnv === 'production') {
    console.error(`[AUTH HARDENED] Failed to deliver OTP email to ${normalizedEmail}: ${emailResult.error}`);
    throw new InternalServerError('Failed to deliver OTP email. Please verify your email address and try again.');
  }

  // Return clean, safe response payload
  res.status(200).json({
    success: true,
    message: 'Verification OTP sent to your email address.',
    data: {
      email: normalizedEmail,
      requiresOTP: true,
    },
  });
});

/**
 * @route   POST /api/auth/verify-signup-otp
 * @desc    Verifies 6-digit signup OTP token and creates user account in database and Supabase Auth safely.
 * @access  Public (Rate-limited via otpLimiter)
 */
const verifySignupOTP = asyncHandler(async (req, res) => {
  const { name, email, password, otp, role, onboardingRole } = req.validData.body;
  const normalizedEmail = email.toLowerCase().trim();

  const isMentorSignup = role === 'MENTOR' || onboardingRole === 'MENTOR';

  // Check existing user conflict safely using parameterized Prisma ORM
  const existingUser = await prisma.user.findUnique({
    where: { email: normalizedEmail },
    select: { id: true, role: true, onboardingRole: true },
  });

  if (existingUser) {
    throw new ConflictError('This email address is already registered.');
  }

  // Verify OTP token against store
  const otpValidation = await verifyOTP(normalizedEmail, otp, 'signup');
  if (!otpValidation.valid) {
    throw new BadRequestError(otpValidation.error || 'Invalid or expired verification OTP.');
  }

  // Hash password using bcryptjs with strong cost factor
  const hashedPassword = password ? await hashPassword(password) : null;

  // Provision user in Supabase Auth via admin interface (email verified via OTP)
  let supabaseUserId = null;
  if (password && supabase?.auth?.admin) {
    const { data: sbData, error: sbError } = await supabase.auth.admin.createUser({
      email: normalizedEmail,
      password: password,
      email_confirm: true,
      user_metadata: { name, role: isMentorSignup ? 'MENTOR' : 'STUDENT' },
    });

    if (sbError && !sbError.message.includes('already registered')) {
      console.error('[AUTH HARDENED] Supabase user creation error:', sbError.message);
      // Suppress raw Supabase stack details in client response
    } else if (sbData?.user) {
      supabaseUserId = sbData.user.id;
    }
  }

  // Create database user using parameterized Prisma transaction with explicit field selections
  const user = await prisma.user.create({
    data: {
      email: normalizedEmail,
      name: name || normalizedEmail.split('@')[0],
      role: isMentorSignup ? 'MENTOR' : 'STUDENT',
      onboardingRole: isMentorSignup ? 'MENTOR' : 'MENTEE',
      passwordHash: hashedPassword,
      supabaseId: supabaseUserId,
      emailVerified: true,
      emailVerifiedAt: new Date(),
      status: 'ACTIVE',
    },
    select: {
      id: true,
      email: true,
      name: true,
      role: true,
      onboardingRole: true,
      status: true,
      createdAt: true,
    },
  });

  // Generate JWT Access & Refresh Tokens
  const accessToken = generateAccessToken(user);
  const refreshToken = generateRefreshToken(user);

  res.status(201).json({
    success: true,
    message: 'Account successfully registered and verified.',
    data: {
      user,
      accessToken,
      refreshToken,
    },
  });
});

/**
 * @route   POST /api/auth/login
 * @desc    Authenticates user credentials using constant-time hash comparison and issues signed JWT tokens.
 * @access  Public (Strictly rate-limited via authLimiter)
 */
const login = asyncHandler(async (req, res) => {
  const { email, password } = req.validData.body;
  const normalizedEmail = email.toLowerCase().trim();

  // Query user safely with explicit selection of passwordHash and status
  const user = await prisma.user.findUnique({
    where: { email: normalizedEmail },
    select: {
      id: true,
      email: true,
      name: true,
      role: true,
      onboardingRole: true,
      passwordHash: true,
      status: true,
      emailVerified: true,
    },
  });

  // Standardized failure response for invalid email OR password (OWASP Anti-Account Enumeration)
  if (!user || !user.passwordHash) {
    throw new UnauthorizedError('Invalid email or password credentials.', 'INVALID_CREDENTIALS');
  }

  // Account status validation guards
  if (user.status === 'DISABLED') {
    throw new UnauthorizedError('Your account has been disabled. Please contact support.', 'ACCOUNT_DISABLED');
  }
  if (user.status === 'DELETED') {
    throw new UnauthorizedError('Account no longer exists.', 'ACCOUNT_DELETED');
  }

  // Constant-time password hash verification
  const isValidPassword = await comparePassword(password, user.passwordHash);
  if (!isValidPassword) {
    throw new UnauthorizedError('Invalid email or password credentials.', 'INVALID_CREDENTIALS');
  }

  // Generate cryptographically signed JWT tokens
  const accessToken = generateAccessToken(user);
  const refreshToken = generateRefreshToken(user);

  res.status(200).json({
    success: true,
    message: 'Authentication successful.',
    data: {
      user: sanitizeUserResponse(user),
      accessToken,
      refreshToken,
    },
  });
});

/**
 * @route   POST /api/auth/refresh
 * @desc    Rotates JWT refresh tokens securely.
 * @access  Public
 */
const refresh = asyncHandler(async (req, res) => {
  const { refreshToken } = req.validData.body;

  const payload = verifyRefreshToken(refreshToken);
  if (!payload || !payload.id) {
    throw new UnauthorizedError('Invalid or expired refresh token.', 'TOKEN_EXPIRED');
  }

  const user = await prisma.user.findUnique({
    where: { id: payload.id },
    select: { id: true, email: true, role: true, onboardingRole: true, status: true },
  });

  if (!user || user.status !== 'ACTIVE') {
    throw new UnauthorizedError('User session is no longer active.', 'INACTIVE_SESSION');
  }

  const newAccessToken = generateAccessToken(user);
  const newRefreshToken = generateRefreshToken(user);

  res.status(200).json({
    success: true,
    message: 'Token refreshed successfully.',
    data: {
      accessToken: newAccessToken,
      refreshToken: newRefreshToken,
    },
  });
});

module.exports = {
  register,
  verifySignupOTP,
  login,
  refresh,
  sanitizeUserResponse,
};
