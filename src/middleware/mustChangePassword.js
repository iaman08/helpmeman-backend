/**
 * mustChangePassword Middleware
 *
 * Enforces a forced password reset for admin accounts that were provisioned
 * with a temporary password. Any request from a user who has
 * mustChangePassword === true is blocked with a 403 until they call
 * POST /api/auth/change-password.
 *
 * Apply this AFTER the `authenticate` middleware so req.user is populated.
 */

const ALLOWED_PATHS = [
  '/change-password',
  '/logout',
];

function mustChangePassword(req, res, next) {
  if (!req.user) {
    // authenticate middleware should have already rejected unauthenticated requests
    return res.status(401).json({ error: 'Authentication required', code: 'UNAUTHENTICATED' });
  }

  if (!req.user.mustChangePassword) {
    return next();
  }

  // Allow the change-password and logout endpoints even under force-change
  const pathAllowed = ALLOWED_PATHS.some((p) => req.path === p || req.path.endsWith(p));
  if (pathAllowed) {
    return next();
  }

  return res.status(403).json({
    error: 'You must change your temporary password before accessing the admin panel.',
    code: 'PASSWORD_CHANGE_REQUIRED',
  });
}

module.exports = { mustChangePassword };
