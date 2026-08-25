/**
 * @file auth.schema.js
 * @description Zod Schemas for Authentication Request Input Validation & Sanitization.
 * 
 * OWASP Reference:
 * - A03:2021 Injection (Input Validation)
 * - A07:2021 Identification & Authentication Failures (Strict Password Rules & Normalized Inputs)
 */

const { z } = require('zod');

// Password complexity pattern: Min 8 chars, 1 uppercase, 1 lowercase, 1 digit
const passwordRegex = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).{8,}$/;

/**
 * Register User Schema
 */
const registerSchema = z.object({
  body: z.object({
    name: z.string().trim().min(2, 'Name must be at least 2 characters').max(100, 'Name cannot exceed 100 characters'),
    email: z.string().trim().toLowerCase().email('Invalid email address format'),
    password: z.string()
      .min(8, 'Password must be at least 8 characters long')
      .max(128, 'Password cannot exceed 128 characters')
      .regex(passwordRegex, 'Password must contain at least one uppercase letter, one lowercase letter, and one number'),
    role: z.enum(['STUDENT', 'MENTOR', 'ADMIN']).optional().default('STUDENT'),
  }),
});

/**
 * Verify Signup OTP Schema
 */
const verifyOtpSchema = z.object({
  body: z.object({
    name: z.string().trim().min(2).max(100).optional(),
    email: z.string().trim().toLowerCase().email('Invalid email address format'),
    password: z.string().min(8).max(128).optional(),
    otp: z.string().trim().length(6, 'OTP code must be exactly 6 digits').regex(/^\d+$/, 'OTP must contain digits only'),
    role: z.enum(['STUDENT', 'MENTOR', 'ADMIN', 'SUPER_ADMIN']).optional(),
    onboardingRole: z.enum(['STUDENT', 'MENTOR', 'MENTEE']).optional(),
  }),
});

/**
 * Login Schema
 */
const loginSchema = z.object({
  body: z.object({
    email: z.string().trim().toLowerCase().email('Invalid email address format'),
    password: z.string().min(1, 'Password is required'),
  }),
});

/**
 * Forgot Password Schema
 */
const forgotPasswordSchema = z.object({
  body: z.object({
    email: z.string().trim().toLowerCase().email('Invalid email address format'),
  }),
});

/**
 * Verify Reset OTP Schema
 */
const verifyResetOtpSchema = z.object({
  body: z.object({
    email: z.string().trim().toLowerCase().email('Invalid email address format'),
    otp: z.string().trim().length(6, 'OTP must be 6 digits').regex(/^\d+$/),
  }),
});

/**
 * Reset Password Schema
 */
const resetPasswordSchema = z.object({
  body: z.object({
    email: z.string().trim().toLowerCase().email('Invalid email address format'),
    otp: z.string().trim().length(6, 'OTP must be 6 digits').regex(/^\d+$/),
    newPassword: z.string()
      .min(8, 'Password must be at least 8 characters long')
      .max(128)
      .regex(passwordRegex, 'Password must contain at least one uppercase letter, one lowercase letter, and one number'),
  }),
});

/**
 * Refresh Token Schema
 */
const refreshTokenSchema = z.object({
  body: z.object({
    refreshToken: z.string().min(1, 'Refresh token is required'),
  }),
});

/**
 * Change Password Schema (Authenticated User)
 */
const changePasswordSchema = z.object({
  body: z.object({
    oldPassword: z.string().optional(),
    newPassword: z.string()
      .min(8, 'New password must be at least 8 characters')
      .max(128)
      .regex(passwordRegex, 'New password must contain at least one uppercase letter, one lowercase letter, and one number'),
  }),
});

module.exports = {
  registerSchema,
  verifyOtpSchema,
  loginSchema,
  forgotPasswordSchema,
  verifyResetOtpSchema,
  resetPasswordSchema,
  refreshTokenSchema,
  changePasswordSchema,
};
