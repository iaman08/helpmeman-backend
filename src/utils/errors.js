/**
 * @file errors.js
 * @description Centralized Operational Error Classes & Async Handler Wrapper for OWASP Defensive Error Management.
 * 
 * OWASP Reference:
 * - A05:2021 Security Misconfiguration (Preventing Stack Trace / Detail Leakage)
 * - A04:2021 Insecure Design (Standardized Exception Flow)
 */

/**
 * Base Application Error class representing expected operational failures.
 * Operational errors are predictable errors (e.g. invalid input, unauthorized access)
 * distinct from programmer bugs or unhandled systemic exceptions.
 */
class AppError extends Error {
  /**
   * @param {string} message - Human readable error message suitable for client consumption.
   * @param {number} statusCode - Corresponding HTTP status code.
   * @param {string} [errorCode='BAD_REQUEST'] - Standardized application error code for client handling.
   * @param {Array|object} [details=null] - Additional safe details (e.g. schema validation errors).
   */
  constructor(message, statusCode = 400, errorCode = 'BAD_REQUEST', details = null) {
    super(message);
    this.name = this.constructor.name;
    this.statusCode = statusCode;
    this.errorCode = errorCode;
    this.details = details;
    this.isOperational = true; // Flag identifying predictable, handled errors

    Error.captureStackTrace(this, this.constructor);
  }
}

/**
 * 400 Bad Request Error
 */
class BadRequestError extends AppError {
  constructor(message = 'Invalid request parameters', details = null) {
    super(message, 400, 'BAD_REQUEST', details);
  }
}

/**
 * 401 Unauthorized Error (Authentication Required / Failed)
 */
class UnauthorizedError extends AppError {
  constructor(message = 'Authentication required', errorCode = 'UNAUTHORIZED') {
    super(message, 401, errorCode, null);
  }
}

/**
 * 403 Forbidden Error (Insufficient Permissions)
 */
class ForbiddenError extends AppError {
  constructor(message = 'Access denied: insufficient permissions', errorCode = 'FORBIDDEN') {
    super(message, 403, errorCode, null);
  }
}

/**
 * 404 Not Found Error
 */
class NotFoundError extends AppError {
  constructor(message = 'Resource not found', errorCode = 'NOT_FOUND') {
    super(message, 404, errorCode, null);
  }
}

/**
 * 409 Conflict Error (e.g., duplicate email/resource)
 */
class ConflictError extends AppError {
  constructor(message = 'Resource conflict detected', errorCode = 'CONFLICT') {
    super(message, 409, errorCode, null);
  }
}

/**
 * 429 Too Many Requests Error (Rate limit hit)
 */
class TooManyRequestsError extends AppError {
  constructor(message = 'Too many requests. Please try again later.', errorCode = 'RATE_LIMIT_EXCEEDED') {
    super(message, 429, errorCode, null);
  }
}

/**
 * 500 Internal Server Error (Unexpected system/database failure)
 */
class InternalServerError extends AppError {
  constructor(message = 'An unexpected internal error occurred.', errorCode = 'INTERNAL_SERVER_ERROR') {
    super(message, 500, errorCode, null);
  }
}

/**
 * Higher-order function wrapping async route handlers to catch unhandled promise rejections
 * and seamlessly forward them to the global Express error middleware.
 * Eliminates repetitive try-catch blocks in controller endpoints.
 * 
 * @param {Function} fn - Async controller function (req, res, next)
 * @returns {Function} Express middleware handler
 */
const asyncHandler = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};

module.exports = {
  AppError,
  BadRequestError,
  UnauthorizedError,
  ForbiddenError,
  NotFoundError,
  ConflictError,
  TooManyRequestsError,
  InternalServerError,
  asyncHandler,
};
