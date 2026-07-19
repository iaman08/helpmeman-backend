/**
 * Resource Ownership Middleware (Layer 2: Resource-Level Authorization)
 *
 * Reusable helpers that enforce "does this user own this resource?"
 * Ownership logic is NEVER mixed into roleGuard.
 *
 * Usage:
 *   const { requireOwnership, canAccessResource } = require('../middleware/ownership');
 *
 *   // As middleware:
 *   router.put('/:id', authenticate, roleGuard('MENTOR', 'SUPER_ADMIN'),
 *     requireOwnership(async (req) => {
 *       const resource = await prisma.availability.findUnique({ where: { id: req.params.id } });
 *       return resource?.mentorId; // returns the owner's mentor ID
 *     }, { ownerField: 'mentorId' }),
 *     controller.update
 *   );
 *
 *   // As a helper in controllers:
 *   if (!canAccessResource(req.user, booking.userId)) {
 *     return res.status(403).json({ error: 'Access denied' });
 *   }
 */

const { roleLevel } = require('./rbac');

/**
 * Checks if a user can access a resource owned by another user.
 *
 * @param {object} user - The authenticated user (req.user)
 * @param {string} resourceOwnerId - The ID of the resource owner
 * @param {object} [options]
 * @param {string[]} [options.bypassRoles] - Roles that bypass ownership checks (default: ['SUPER_ADMIN'])
 * @returns {boolean}
 */
function canAccessResource(user, resourceOwnerId, options = {}) {
  if (!user || !resourceOwnerId) return false;

  const bypassRoles = options.bypassRoles || ['SUPER_ADMIN'];

  // Users with bypass roles can access any resource
  if (bypassRoles.includes(user.role)) return true;

  // Otherwise, must be the owner
  return user.id === resourceOwnerId;
}

/**
 * Express middleware factory for resource ownership checks.
 *
 * @param {Function} getOwnerId - Async function that receives (req) and returns the owner's user ID
 * @param {object} [options]
 * @param {string[]} [options.bypassRoles] - Roles that bypass (default: ['SUPER_ADMIN'])
 * @param {string} [options.ownerField] - If the owner is identified by a field other than userId
 *                                         (e.g., 'mentorId'), pass the user field name here.
 *                                         The middleware will compare req.user[ownerField] instead of req.user.id.
 * @returns {Function} Express middleware
 */
function requireOwnership(getOwnerId, options = {}) {
  const bypassRoles = options.bypassRoles || ['SUPER_ADMIN'];

  return async (req, res, next) => {
    try {
      // Bypass roles skip ownership checks
      if (bypassRoles.includes(req.user.role)) {
        return next();
      }

      const ownerId = await getOwnerId(req);
      if (!ownerId) {
        return res.status(404).json({ error: 'Resource not found', code: 'NOT_FOUND' });
      }

      const userId = req.user.id;
      if (userId !== ownerId) {
        return res.status(403).json({ error: 'Access denied: you do not own this resource', code: 'FORBIDDEN' });
      }

      next();
    } catch (error) {
      console.error('[OWNERSHIP] Error checking resource ownership:', error.message);
      res.status(500).json({ error: 'Authorization check failed' });
    }
  };
}

module.exports = {
  canAccessResource,
  requireOwnership,
};
