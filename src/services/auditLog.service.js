/**
 * Audit Log Service
 *
 * Records privileged actions, logins, device details, and security events
 * to the AuditLog table for compliance, intrusion detection, and administrator review.
 */

const prisma = require('../config/prisma');
const { getClientIp, parseUserAgent, getSecurityContext } = require('../utils/deviceDetector');

/**
 * Log an action or security event to the audit trail.
 *
 * @param {object} params
 * @param {string} params.action      - Action type (e.g., 'USER_LOGIN', 'UNAUTHORIZED_ACCESS', 'ROLE_CHANGE', 'LOGIN_FAILED')
 * @param {string} params.actorId     - User ID or identifier of who performed the action ('SYSTEM', email, cuid)
 * @param {string} [params.targetId]  - User ID or resource affected
 * @param {string} [params.oldValue]  - Previous state
 * @param {string} [params.newValue]  - New state
 * @param {string} [params.endpoint]  - API endpoint path
 * @param {string} [params.ip]        - Request IP address (override)
 * @param {string} [params.userAgent] - Browser/client user agent string (override)
 * @param {string} [params.requestId] - Correlation ID
 * @param {boolean} [params.isSuspicious] - Flag if this event is suspicious
 * @param {string} [params.flagReason] - Reason for flagging as suspicious
 * @param {object} [params.metadata]  - Additional context (JSON)
 * @param {import('express').Request} [params.req] - Express request object (auto-extracts IP, Device, Browser, OS)
 */
async function logAuditEvent({
  action,
  actorId,
  targetId,
  oldValue,
  newValue,
  endpoint,
  ip,
  userAgent,
  requestId,
  isSuspicious,
  flagReason,
  metadata = {},
  req,
}) {
  try {
    const sec = req ? getSecurityContext(req) : null;
    const finalIp = ip || sec?.ip || (req ? getClientIp(req) : 'unknown');
    const finalUserAgent = userAgent || sec?.userAgent || (req ? req.headers?.['user-agent'] : null);
    const parsedUa = finalUserAgent ? parseUserAgent(finalUserAgent, req?.headers || {}) : null;

    const enrichedMetadata = {
      ...metadata,
      browser: metadata.browser || parsedUa?.browser || sec?.browser || 'Unknown',
      os: metadata.os || parsedUa?.os || sec?.os || 'Unknown',
      deviceType: metadata.deviceType || parsedUa?.deviceType || sec?.deviceType || 'Desktop',
      deviceModel: metadata.deviceModel || parsedUa?.deviceModel || sec?.deviceModel || 'Unknown',
      language: metadata.language || sec?.language || (req?.headers?.['accept-language']?.split(',')[0]) || null,
      country: metadata.country || sec?.country || null,
      isSuspicious: Boolean(isSuspicious || sec?.isSuspicious || metadata.isSuspicious),
      flagReason: flagReason || sec?.flagReason || metadata.flagReason || null,
    };

    await prisma.auditLog.create({
      data: {
        action,
        actorId: actorId || 'UNKNOWN_ACTOR',
        targetId: targetId || null,
        oldValue: oldValue || null,
        newValue: newValue || null,
        endpoint: endpoint || (req ? req.originalUrl || req.path : null),
        ip: finalIp,
        userAgent: finalUserAgent,
        requestId: requestId || null,
        metadata: enrichedMetadata,
      },
    });
  } catch (error) {
    // Audit logging should never crash the request — log and continue
    console.error('[AUDIT] Failed to write audit log:', error.message);
  }
}

/**
 * Query audit logs with rich filters, pagination, and enriched user profiles.
 *
 * @param {object} [filters]
 * @param {string} [filters.action]
 * @param {string} [filters.actorId]
 * @param {string} [filters.targetId]
 * @param {string} [filters.search]
 * @param {string|boolean} [filters.isSuspicious]
 * @param {number} [filters.page]
 * @param {number} [filters.limit]
 * @returns {Promise<{logs: object[], total: number, page: number, totalPages: number}>}
 */
async function getAuditLogs(filters = {}) {
  const { action, actorId, targetId, search, isSuspicious, page = 1, limit = 50 } = filters;

  const where = {};
  if (action && action !== 'All') where.action = action;
  if (actorId) where.actorId = actorId;
  if (targetId) where.targetId = targetId;

  if (search) {
    where.OR = [
      { action: { contains: search, mode: 'insensitive' } },
      { actorId: { contains: search, mode: 'insensitive' } },
      { targetId: { contains: search, mode: 'insensitive' } },
      { ip: { contains: search, mode: 'insensitive' } },
      { endpoint: { contains: search, mode: 'insensitive' } },
    ];
  }

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

  // Enrich with user names & emails for actor and target IDs
  const userIds = new Set();
  logs.forEach((log) => {
    if (log.actorId && log.actorId !== 'SYSTEM' && !log.actorId.includes('@')) {
      userIds.add(log.actorId);
    }
    if (log.targetId && !log.targetId.includes('@')) {
      userIds.add(log.targetId);
    }
  });

  let userMap = new Map();
  if (userIds.size > 0) {
    try {
      const users = await prisma.user.findMany({
        where: { id: { in: Array.from(userIds) } },
        select: { id: true, name: true, email: true, role: true, avatar: true },
      });
      userMap = new Map(users.map((u) => [u.id, u]));
    } catch (e) {
      console.warn('[AUDIT] Failed to enrich users:', e.message);
    }
  }

  const enrichedLogs = logs.map((log) => {
    const actorUser = userMap.get(log.actorId) || null;
    const targetUser = userMap.get(log.targetId) || null;

    return {
      ...log,
      actor: actorUser
        ? { id: actorUser.id, name: actorUser.name, email: actorUser.email, role: actorUser.role, avatar: actorUser.avatar }
        : { id: log.actorId, name: log.actorId, email: log.actorId.includes('@') ? log.actorId : null, role: 'SYSTEM' },
      target: targetUser
        ? { id: targetUser.id, name: targetUser.name, email: targetUser.email, role: targetUser.role }
        : log.targetId
        ? { id: log.targetId, name: log.targetId, email: log.targetId.includes('@') ? log.targetId : null }
        : null,
    };
  });

  return {
    logs: enrichedLogs,
    total,
    page: parsedPage,
    totalPages: Math.ceil(total / parsedLimit),
  };
}

module.exports = {
  logAuditEvent,
  getClientIp,
  parseUserAgent,
  getSecurityContext,
  getAuditLogs,
};
