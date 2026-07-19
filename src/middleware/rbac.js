/**
 * RBAC Middleware — Role-Based Access Control (Layer 1: Route-Level)
 *
 * Central module for role hierarchy and route-level authorization.
 * This replaces the old roleGuard.js with a production-grade implementation.
 *
 * Usage:
 *   const { roleGuard } = require('../middleware/rbac');
 *   router.post('/', authenticate, roleGuard('SUPER_ADMIN', 'ADMIN'), handler);
 */

// ── Role hierarchy (higher number = more privilege) ─────────────────────────
const ROLE_LEVELS = {
  STUDENT:     1,
  MENTOR:      2,
  ADMIN:       3,
  SUPER_ADMIN: 4,
};

const VALID_ROLES = Object.keys(ROLE_LEVELS);

/**
 * Returns the numeric privilege level for a role.
 * @param {string} role
 * @returns {number} 0 if unknown role
 */
function roleLevel(role) {
  return ROLE_LEVELS[role] || 0;
}

/**
 * Returns true if roleA is strictly higher than roleB in the hierarchy.
 */
function isHigherRole(roleA, roleB) {
  return roleLevel(roleA) > roleLevel(roleB);
}

/**
 * Returns true if the actor's role can manage (modify/promote/demote) the target's role.
 * Only a strictly higher role can manage a lower one.
 * SUPER_ADMIN can manage everyone except the last remaining SUPER_ADMIN.
 * ADMIN cannot manage SUPER_ADMIN.
 */
function canManageRole(actorRole, targetRole) {
  return isHigherRole(actorRole, targetRole);
}

/**
 * Route-level authorization middleware.
 *
 * Checks if req.user.role is in the list of allowed roles.
 * SUPER_ADMIN is NOT auto-included — it must be explicitly listed (defense in depth).
 *
 * @param {...string} allowedRoles - One or more role names
 * @returns {Function} Express middleware
 *
 * @example
 *   roleGuard('SUPER_ADMIN', 'ADMIN')          // Only super admins and admins
 *   roleGuard('MENTOR')                         // Only mentors (super admin excluded unless listed)
 *   roleGuard('SUPER_ADMIN', 'ADMIN', 'MENTOR', 'STUDENT')  // All authenticated users
 */
function roleGuard(...allowedRoles) {
  // Flatten in case someone passes an array: roleGuard(['ADMIN', 'SUPER_ADMIN'])
  const roles = allowedRoles.flat();

  // Validate at startup — crash fast on typos
  for (const r of roles) {
    if (!VALID_ROLES.includes(r)) {
      throw new Error(`[RBAC] Invalid role "${r}" in roleGuard(). Valid roles: ${VALID_ROLES.join(', ')}`);
    }
  }

  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required', code: 'UNAUTHENTICATED' });
    }

    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'Insufficient permissions', code: 'FORBIDDEN' });
    }

    next();
  };
}

module.exports = {
  ROLE_LEVELS,
  VALID_ROLES,
  roleLevel,
  isHigherRole,
  canManageRole,
  roleGuard,
};
