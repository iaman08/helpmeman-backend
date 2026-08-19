/**
 * Super Admin Controller
 *
 * Endpoints restricted to SUPER_ADMIN role only.
 * Handles user role management, audit log viewing, and system configuration.
 */

const prisma = require('../config/prisma');
const { canManageRole, ROLE_LEVELS, VALID_ROLES } = require('../middleware/rbac');
const { logAuditEvent, getClientIp, getAuditLogs } = require('../services/auditLog.service');
const { invalidateCachedUser } = require('../services/auth.service');

/**
 * GET /api/super-admin/users
 * List all users with role information.
 */
async function listAllUsers(req, res) {
  try {
    const { q, role, status, page = 1, limit = 50 } = req.query;
    const where = {};

    if (q) {
      where.OR = [
        { name: { contains: q, mode: 'insensitive' } },
        { email: { contains: q, mode: 'insensitive' } },
      ];
    }
    if (role && VALID_ROLES.includes(role)) {
      where.role = role;
    }
    if (status && ['ACTIVE', 'ON_HOLD', 'DISABLED', 'DELETED'].includes(status)) {
      where.status = status;
    }

    const parsedPage = parseInt(page) || 1;
    const parsedLimit = Math.min(parseInt(limit) || 50, 200);

    const [users, total] = await Promise.all([
      prisma.user.findMany({
        where,
        select: {
          id: true,
          name: true,
          email: true,
          role: true,
          status: true,
          isEmailVerified: true,
          createdAt: true,
          updatedAt: true,
        },
        orderBy: { createdAt: 'desc' },
        skip: (parsedPage - 1) * parsedLimit,
        take: parsedLimit,
      }),
      prisma.user.count({ where }),
    ]);

    res.json({
      users,
      total,
      page: parsedPage,
      totalPages: Math.ceil(total / parsedLimit),
    });
  } catch (error) {
    console.error('[SUPER_ADMIN] listAllUsers error:', error);
    res.status(500).json({ error: 'Failed to list users' });
  }
}

/**
 * POST /api/super-admin/users/:id/role
 * Change a user's role. Only SUPER_ADMIN can call this.
 *
 * Body: { role: 'ADMIN' | 'MENTOR' | 'STUDENT' | 'SUPER_ADMIN' }
 *
 * Guards:
 *  - Cannot promote to a role equal or higher than the actor's own role
 *    (exception: SUPER_ADMIN can promote to SUPER_ADMIN)
 *  - Cannot demote a user with an equal or higher role
 *    (exception: SUPER_ADMIN can demote ADMIN, MENTOR, STUDENT)
 *  - Cannot demote the LAST remaining SUPER_ADMIN
 *  - Cannot change own role (prevents self-demotion lockout)
 */
async function changeUserRole(req, res) {
  try {
    const { id: targetId } = req.params;
    const { role: newRole } = req.body;
    const actor = req.user;

    // Validate new role
    if (!newRole || !VALID_ROLES.includes(newRole)) {
      return res.status(400).json({
        error: `Invalid role. Must be one of: ${VALID_ROLES.join(', ')}`,
        code: 'INVALID_ROLE',
      });
    }

    // Fetch target user
    const targetUser = await prisma.user.findUnique({
      where: { id: targetId },
      select: { id: true, email: true, role: true, name: true },
    });

    if (!targetUser) {
      return res.status(404).json({ error: 'User not found', code: 'NOT_FOUND' });
    }

    // No-op if role is unchanged
    if (targetUser.role === newRole) {
      return res.json({
        message: 'Role unchanged',
        user: { id: targetUser.id, email: targetUser.email, role: targetUser.role },
      });
    }

    // Guard: cannot change own role (prevents self-demotion lockout)
    if (actor.id === targetId) {
      return res.status(403).json({
        error: 'Cannot change your own role. Ask another Super Admin.',
        code: 'SELF_ROLE_CHANGE',
      });
    }

    // Guard: actor must be able to manage the target's CURRENT role
    if (!canManageRole(actor.role, targetUser.role)) {
      return res.status(403).json({
        error: `Cannot modify a user with role ${targetUser.role}`,
        code: 'INSUFFICIENT_PRIVILEGE',
      });
    }

    // Guard: actor must be able to assign the NEW role
    // SUPER_ADMIN can assign any role; others can only assign roles below their own
    if (actor.role !== 'SUPER_ADMIN' && ROLE_LEVELS[newRole] >= ROLE_LEVELS[actor.role]) {
      return res.status(403).json({
        error: `Cannot promote to ${newRole}: exceeds your privilege level`,
        code: 'INSUFFICIENT_PRIVILEGE',
      });
    }

    // Guard: cannot demote the last SUPER_ADMIN
    if (targetUser.role === 'SUPER_ADMIN' && newRole !== 'SUPER_ADMIN') {
      const superAdminCount = await prisma.user.count({ where: { role: 'SUPER_ADMIN' } });
      if (superAdminCount <= 1) {
        return res.status(403).json({
          error: 'Cannot demote the last remaining Super Admin. Promote another user first.',
          code: 'LAST_SUPER_ADMIN',
        });
      }
    }

    // Execute the role change
    const updatedUser = await prisma.user.update({
      where: { id: targetId },
      data: { role: newRole },
      select: { id: true, email: true, role: true, name: true },
    });

    // Invalidate the token cache for the target user so their next API call picks up the new role
    invalidateCachedUser(targetId);

    // Audit log
    await logAuditEvent({
      action: 'ROLE_CHANGE',
      actorId: actor.id,
      targetId: targetId,
      oldValue: targetUser.role,
      newValue: newRole,
      endpoint: req.originalUrl,
      ip: getClientIp(req),
      metadata: {
        actorEmail: actor.email,
        targetEmail: targetUser.email,
      },
    });

    console.log(`[SUPER_ADMIN] Role changed: ${targetUser.email} ${targetUser.role} → ${newRole} by ${actor.email}`);

    res.json({
      message: `Role updated: ${targetUser.role} → ${newRole}`,
      user: updatedUser,
    });
  } catch (error) {
    console.error('[SUPER_ADMIN] changeUserRole error:', error);
    res.status(500).json({ error: 'Failed to change role' });
  }
}

/**
 * GET /api/super-admin/audit-logs
 * Query audit logs with optional filters.
 *
 * Query params: action, actorId, targetId, page, limit
 */
async function viewAuditLogs(req, res) {
  try {
    const result = await getAuditLogs(req.query);
    res.json(result);
  } catch (error) {
    console.error('[SUPER_ADMIN] viewAuditLogs error:', error);
    res.status(500).json({ error: 'Failed to fetch audit logs' });
  }
}

/**
 * GET /api/super-admin/role-counts
 * Returns a count of users per role.
 */
async function getRoleCounts(req, res) {
  try {
    const counts = await prisma.user.groupBy({
      by: ['role'],
      _count: { id: true },
    });

    const result = {};
    for (const role of VALID_ROLES) {
      const entry = counts.find(c => c.role === role);
      result[role] = entry ? entry._count.id : 0;
    }

    res.json({ roleCounts: result, total: Object.values(result).reduce((a, b) => a + b, 0) });
  } catch (error) {
    console.error('[SUPER_ADMIN] getRoleCounts error:', error);
    res.status(500).json({ error: 'Failed to fetch role counts' });
  }
}

async function getDashboardStats(req, res) {
  try {
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    
    const [
      totalUsers,
      totalStudents,
      totalMentors,
      totalAdmins,
      totalBookings,
      pendingMentorApplications,
      totalRevenueAgg,
      monthlyRevenueAgg,
      recentActivities
    ] = await Promise.all([
      prisma.user.count(),
      prisma.user.count({ where: { role: 'STUDENT' } }),
      prisma.user.count({ where: { role: 'MENTOR' } }),
      prisma.user.count({ where: { role: { in: ['ADMIN', 'SUPER_ADMIN'] } } }),
      prisma.booking.count(),
      prisma.mentor.count({ where: { approvalStatus: 'PENDING' } }),
      prisma.earning.aggregate({ _sum: { amount: true } }),
      prisma.earning.aggregate({ where: { createdAt: { gte: startOfMonth } }, _sum: { amount: true } }),
      prisma.auditLog.findMany({ orderBy: { createdAt: 'desc' }, take: 10 })
    ]);
    
    res.json({
      data: {
        totalUsers,
        totalStudents,
        totalMentors,
        totalAdmins,
        activeSessions: totalUsers, // For now, just return totalUsers
        totalRevenue: totalRevenueAgg._sum.amount || 0,
        monthlyRevenue: monthlyRevenueAgg._sum.amount || 0,
        totalBookings,
        pendingMentorApplications,
        recentActivities
      }
    });
  } catch (error) {
    console.error('Error fetching super admin stats:', error);
    res.status(500).json({ error: 'Failed to fetch dashboard stats' });
  }
}

async function getSystemHealth(req, res) {
  try {
    let dbStatus = 'healthy';
    try {
      await prisma.$queryRaw`SELECT 1`;
    } catch (e) {
      dbStatus = 'degraded';
    }
    
    let supabaseStatus = 'healthy';
    try {
      const config = require('../config/env');
      const { createClient } = require('@supabase/supabase-js');
      const supabase = createClient(config.supabase.url, config.supabase.serviceRoleKey);
      await supabase.auth.getSession();
    } catch (e) {
      supabaseStatus = 'degraded';
    }
    
    res.json({
      data: {
        database: dbStatus,
        api: 'healthy',
        supabase: supabaseStatus,
        uptime: process.uptime(),
        memoryUsage: process.memoryUsage(),
        timestamp: new Date().toISOString()
      }
    });
  } catch (error) {
    console.error('Error checking system health:', error);
    res.status(500).json({ error: 'Failed to check system health' });
  }
}

module.exports = { listAllUsers, changeUserRole, viewAuditLogs, getRoleCounts, getDashboardStats, getSystemHealth };
