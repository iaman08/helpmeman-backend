/**
 * @file errorHandler.js
 * @description Centralized OWASP-Compliant Global Error Middleware for Express.
 * 
 * OWASP Reference:
 * - A05:2021 Security Misconfiguration
 *   Prevents leaking internal stack traces, DB connection strings, file paths, or third-party exceptions.
 * - Obfuscates 500 level unhandled errors in production while capturing full internal diagnostics.
 */

const { AppError } = require('../utils/errors');
const config = require('../config/env');

/**
 * Global Express Error Handling Middleware.
 * Must be registered AFTER all routes in index.js with 4 parameters (err, req, res, next).
 */
function errorHandler(err, req, res, next) {
  const isDev = (config.nodeEnv || process.env.NODE_ENV) === 'development';
  const requestId = req.headers['x-request-id'] || req.id || Date.now().toString(36);

  // Default error state for unhandled/unexpected system errors
  let statusCode = err.statusCode || 500;
  let errorCode = err.errorCode || 'INTERNAL_SERVER_ERROR';
  let message = err.message || 'An unexpected internal server error occurred.';
  let details = err.details || null;

  // Log full error stack internally for debugging/auditing
  console.error(`[ERROR] [${new Date().toISOString()}] [ReqID: ${requestId}] Path: ${req.method} ${req.originalUrl}`);
  console.error(err.stack || err);

  // If this is an operational error (AppError subclass), return safe structured message
  if (err instanceof AppError || err.isOperational) {
    return res.status(statusCode).json({
      success: false,
      error: {
        code: errorCode,
        message: message,
        ...(details && { details }),
      },
    });
  }

  // Handle Prisma Known Request Errors safely without leaking SQL/schema details
  if (err.code && typeof err.code === 'string' && err.code.startsWith('P')) {
    statusCode = 400;
    errorCode = 'DATABASE_CONSTRAINT_ERROR';
    
    if (err.code === 'P2002') {
      statusCode = 409;
      errorCode = 'UNIQUE_CONSTRAINT_VIOLATION';
      message = 'A record with this information already exists.';
    } else if (err.code === 'P2025') {
      statusCode = 404;
      errorCode = 'RECORD_NOT_FOUND';
      message = 'Requested record was not found.';
    } else {
      message = 'Database operation failed validation.';
    }
  }

  // Handle JWT error instances
  if (err.name === 'JsonWebTokenError' || err.name === 'TokenExpiredError') {
    statusCode = 401;
    errorCode = err.name === 'TokenExpiredError' ? 'TOKEN_EXPIRED' : 'INVALID_TOKEN';
    message = err.name === 'TokenExpiredError' ? 'Token expired' : 'Invalid authorization token';
  }

  // OWASP Defense: In production, obfuscate all unhandled 500 server stack traces
  const responsePayload = {
    success: false,
    error: {
      code: errorCode,
      message: isDev ? message : (statusCode === 500 ? 'An internal server error occurred. Please try again later.' : message),
      requestId: requestId,
      ...(isDev && err.stack && { stack: err.stack }),
    },
  };

  return res.status(statusCode).json(responsePayload);
}

module.exports = errorHandler;
