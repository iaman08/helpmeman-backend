/**
 * @file validate.js
 * @description Zod Schema Validation & Input Sanitization Middleware.
 * 
 * OWASP Reference:
 * - A03:2021 Injection (Input Data Validation & Sanitization)
 * - A04:2021 Insecure Design (Strict Schema Enforcement)
 * 
 * Ensures all incoming payloads (req.body, req.query, req.params) strictly conform to Zod definitions,
 * stripping unauthorized unexpected keys and injecting parsed/sanitized data into req.validData.
 */

const { ZodError } = require('zod');
const { BadRequestError } = require('../utils/errors');

/**
 * Creates Express middleware to validate request payloads against a Zod schema.
 * 
 * @param {import('zod').ZodSchema} schema - Zod schema expecting { body?, query?, params? }
 * @returns {Function} Express middleware function
 */
function validate(schema) {
  return (req, res, next) => {
    try {
      // Parse & sanitize request segments against Zod schema
      const parsed = schema.parse({
        body: req.body || {},
        query: req.query || {},
        params: req.params || {},
      });

      // Attach sanitized & typed payload to req.validData for downstream controller consumption
      req.validData = parsed;
      
      // Update req segments with sanitized inputs (stripping extra fields)
      if (parsed.body) req.body = parsed.body;
      if (parsed.query) req.query = parsed.query;
      if (parsed.params) req.params = parsed.params;

      next();
    } catch (error) {
      if (error instanceof ZodError) {
        // Format Zod issues into clean, field-keyed validation feedback
        const formattedErrors = error.errors.map((e) => ({
          field: e.path.filter((p) => p !== 'body' && p !== 'query' && p !== 'params').join('.') || e.path.join('.'),
          message: e.message,
          rule: e.code,
        }));

        return next(new BadRequestError('Validation failed: invalid input parameters', formattedErrors));
      }
      next(error);
    }
  };
}

module.exports = { validate };
