/**
 * Audit Log Service
 *
 * Records privileged actions (role changes, mentor approvals, etc.)
 * to the AuditLog table for compliance and security review.
 */

const prisma = require('../config/prisma');

/**
 * Log a privileged action to the audit trail.
 *
 * @param {object} params
 * @param {string} params.action    - Action type (e.g., 'ROLE_CHANGE', 'MENTOR_APPROVED')
 * @param {string} params.actorId   - User ID of who performed the action
 * @param {string} [params.targetId]  - User ID of who was affected
 * @param {string} [params.oldValue]  - Previous state
 * @param {string} [params.newValue]  - New state
 * @param {string} [params.endpoint]  - API endpoint path
 * @param {string} [params.ip]        - Request IP address
 * @param {string} [params.requestId] - Correlation ID
 * @param {object} [params.metadata]  - Additional context (JSON)
 */
async function logAuditEvent({ action, actorId, targetId, oldValue, newValue, endpoint, ip, requestId, metadata }) {
  try {
    await prisma.auditLog.create({
      data: {
        action,
        actorId,
        targetId: targetId || null,
        oldValue: oldValue || null,
        newValue: newValue || null,
        endpoint: endpoint || null,
        ip: ip || null,
        requestId: requestId || null,
        metadata: metadata || null,
      },
    });
  } catch (error) {
    // Audit logging should never crash the request — log and continue
    console.error('[AUDIT] Failed to write audit log:', error.message);
  }
}

/**
 * Extract the client IP address from a request.
 * Handles X-Forwarded-For (load balancers), X-Real-IP, and direct connection.
 */
function getClientIp(req) {
  const forwarded = req.headers['x-forwarded-for'];
  if (forwarded) {
    return forwarded.split(',')[0].trim();
  }
  return req.headers['x-real-ip'] || req.connection?.remoteAddress || req.ip || 'unknown';
}

/**
 * Query audit logs with filters and pagination.
 *
 * @param {object} [filters]
 * @param {string} [filters.action]
 * @param {string} [filters.actorId]
 * @param {string} [filters.targetId]
 * @param {number} [filters.page]
 * @param {number} [filters.limit]
 * @returns {Promise<{logs: object[], total: number, page: number, totalPages: number}>}
 */
async function getAuditLogs(filters = {}) {
  const { action, actorId, targetId, page = 1, limit = 50 } = filters;

  const where = {};
  if (action) where.action = action;
  if (actorId) where.actorId = actorId;
  if (targetId) where.targetId = targetId;

  const parsedPage = parseInt(page) || 1;
  const parsedLimit = Math.min(parseInt(limit) || 50, 200);

  const [logs, total] = await Promise.all([
    prisma.auditLog.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (parsedPage - 1) * parsedLimit,
      take: parsedLimit,
    }),
    prisma.auditLog.count({ where }),
  ]);

  return {
    logs,
    total,
    page: parsedPage,
    totalPages: Math.ceil(total / parsedLimit),
  };
}

module.exports = { logAuditEvent, getClientIp, getAuditLogs };
