/**
 * Role Synchronization Service
 *
 * Handles automatic role UPGRADE based on environment variables.
 * Key safety rule: this service may ONLY upgrade roles, never demote.
 * Demotion must go through the explicit Super Admin endpoint.
 *
 * Called only during login (not on every API request).
 */

const { roleLevel } = require('../middleware/rbac');
const { logAuditEvent } = require('./auditLog.service');

/**
 * Parses a comma-separated email list from an environment variable.
 * - Trims whitespace
 * - Lowercases everything
 * - Rejects empty values
 * - Rejects malformed emails
 * - Deduplicates
 *
 * @param {string|undefined} envValue - Raw environment variable value
 * @returns {string[]} Array of validated, unique, lowercase email addresses
 */
function parseEmailList(envValue) {
  if (!envValue || typeof envValue !== 'string') return [];

  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  return [...new Set(
    envValue
      .split(',')
      .map(e => e.trim().toLowerCase())
      .filter(e => e.length > 0 && emailRegex.test(e))
  )];
}

/**
 * Determines the expected role for an email address based on environment variables.
 *
 * Priority:
 *   1. SUPER_ADMIN_EMAILS → SUPER_ADMIN
 *   2. ADMIN_EMAILS → ADMIN
 *   3. Default → null (no env-based role assignment)
 *
 * Returns null (not 'STUDENT') so the caller can distinguish between
 * "env says this email should be X" and "env says nothing about this email".
 * This is critical for the upgrade-only rule.
 *
 * @param {string} email - Lowercase email address
 * @returns {string|null} Expected role or null if no env-based assignment
 */
function getExpectedRole(email) {
  const normalizedEmail = email.toLowerCase().trim();

  const superAdminEmails = parseEmailList(process.env.SUPER_ADMIN_EMAILS);
  if (superAdminEmails.includes(normalizedEmail)) {
    return 'SUPER_ADMIN';
  }

  const adminEmails = parseEmailList(process.env.ADMIN_EMAILS);
  if (adminEmails.includes(normalizedEmail)) {
    return 'ADMIN';
  }

  return null; // No env-based role — keep whatever DB role they have
}

/**
 * Synchronizes a user's role based on environment variables.
 *
 * CRITICAL SAFETY RULE: This function may ONLY UPGRADE a role, never demote.
 *
 * If env says SUPER_ADMIN and DB says STUDENT → upgrade to SUPER_ADMIN.
 * If env says nothing and DB says SUPER_ADMIN → DO NOTHING (keep SUPER_ADMIN).
 * If env says ADMIN and DB says SUPER_ADMIN → DO NOTHING (would be a demotion).
 *
 * @param {object} user - The user record from the database (must have id, email, role)
 * @param {object} [options]
 * @param {object} [options.prisma] - Prisma client (injected for testability)
 * @returns {Promise<object>} The (possibly updated) user record
 */
async function syncUserRole(user, options = {}) {
  const prisma = options.prisma || require('../config/prisma');

  if (!user || !user.email || !user.role) {
    return user;
  }

  const expectedRole = getExpectedRole(user.email);

  // If env vars don't specify a role for this email, keep current DB role
  if (!expectedRole) {
    return user;
  }

  const currentLevel = roleLevel(user.role);
  const expectedLevel = roleLevel(expectedRole);

  // UPGRADE ONLY: if expected role is higher than current, upgrade
  if (expectedLevel > currentLevel) {
    console.log(`[ROLE_SYNC] Upgrading ${user.email}: ${user.role} → ${expectedRole}`);

    try {
      const updatedUser = await prisma.user.update({
        where: { id: user.id },
        data: { role: expectedRole },
      });

      // Log the role change
      await logAuditEvent({
        action: 'ROLE_SYNC_UPGRADE',
        actorId: 'SYSTEM',
        targetId: user.id,
        oldValue: user.role,
        newValue: expectedRole,
        metadata: { trigger: 'login', email: user.email },
      });

      // Invalidate the auth token cache for this user
      try {
        const { invalidateCachedUser } = require('./auth.service');
        invalidateCachedUser(user.id);
      } catch (e) {
        // Cache invalidation is best-effort
      }

      return { ...user, ...updatedUser };
    } catch (error) {
      console.error(`[ROLE_SYNC] Failed to upgrade ${user.email}:`, error.message);
      return user; // Return unchanged user on error
    }
  }

  // Expected role is same or lower → no action (upgrade-only rule)
  return user;
}

module.exports = { parseEmailList, getExpectedRole, syncUserRole };
