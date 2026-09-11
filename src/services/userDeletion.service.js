const prisma = require('../config/prisma');
const config = require('../config/env');
const { createClient } = require('@supabase/supabase-js');
const { logAuditEvent, getClientIp } = require('./auditLog.service');
const { invalidateCachedUser } = require('./auth.service');
const { sendNotification } = require('./notification.service');

const adminSupabase = createClient(config.supabase.url, config.supabase.serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

/**
 * Submit a request to delete a user.
 * Restricted to ADMIN and SUPER_ADMIN roles.
 */
async function createDeletionRequest({ userId, requestedById, reason, req }) {
  if (!reason || !reason.trim()) {
    const err = new Error('Reason for deletion request is required');
    err.status = 400;
    throw err;
  }

  if (userId === requestedById) {
    const err = new Error('You cannot request deletion of your own account');
    err.status = 400;
    throw err;
  }

  const targetUser = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, name: true, email: true, role: true, status: true },
  });

  if (!targetUser) {
    const err = new Error('Target user not found');
    err.status = 404;
    throw err;
  }

  if (targetUser.status === 'DELETED') {
    const err = new Error('This user account is already deleted');
    err.status = 400;
    throw err;
  }

  if (targetUser.role === 'SUPER_ADMIN') {
    const err = new Error('Cannot request deletion of a Super Admin account');
    err.status = 403;
    throw err;
  }

  // Check if a pending deletion request already exists for this user
  const existingPending = await prisma.userDeletionRequest.findFirst({
    where: {
      userId,
      status: 'PENDING',
    },
  });

  if (existingPending) {
    const err = new Error('A deletion request is already pending for this user');
    err.status = 409;
    throw err;
  }

  const requester = await prisma.user.findUnique({
    where: { id: requestedById },
    select: { id: true, name: true, email: true, role: true },
  });

  const request = await prisma.userDeletionRequest.create({
    data: {
      userId,
      requestedById,
      reason: reason.trim(),
      status: 'PENDING',
    },
    include: {
      user: {
        select: { id: true, name: true, email: true, role: true, status: true, avatar: true },
      },
      requestedBy: {
        select: { id: true, name: true, email: true, role: true },
      },
    },
  });

  // Log audit event
  try {
    await logAuditEvent({
      action: 'USER_DELETION_REQUESTED',
      actorId: requestedById,
      targetId: userId,
      endpoint: req?.originalUrl || '/api/admin/users/:id/request-deletion',
      ip: req ? getClientIp(req) : null,
      userAgent: req?.headers ? req.headers['user-agent'] : null,
      metadata: {
        requestId: request.id,
        reason: reason.trim(),
        targetEmail: targetUser.email,
        targetRole: targetUser.role,
        requesterEmail: requester?.email,
      },
    });
  } catch (logErr) {
    console.warn('[USER_DELETION] Failed to log audit event:', logErr.message);
  }

  // Notify all Super Admins
  try {
    const superAdmins = await prisma.user.findMany({
      where: { role: 'SUPER_ADMIN' },
      select: { id: true },
    });

    for (const sa of superAdmins) {
      sendNotification({
        userId: sa.id,
        title: 'User Deletion Approval Required',
        body: `Admin ${requester?.name || 'Administrator'} has requested deletion of ${targetUser.name} (${targetUser.email}). Reason: ${reason.trim()}`,
        type: 'ACCOUNT_UPDATE',
      }).catch((notifErr) => {
        console.warn('[USER_DELETION] Failed to notify Super Admin:', notifErr.message);
      });
    }
  } catch (e) {
    console.warn('[USER_DELETION] Failed to query Super Admins for notification:', e.message);
  }

  return request;
}

/**
 * Super Admin approves a deletion request.
 */
async function approveDeletionRequest({ requestId, reviewerId, reviewNotes, req }) {
  const request = await prisma.userDeletionRequest.findUnique({
    where: { id: requestId },
    include: {
      user: {
        include: { mentor: true },
      },
      requestedBy: true,
    },
  });

  if (!request) {
    const err = new Error('Deletion request not found');
    err.status = 404;
    throw err;
  }

  if (request.status !== 'PENDING') {
    const err = new Error(`Request has already been ${request.status.toLowerCase()}`);
    err.status = 400;
    throw err;
  }

  const userId = request.userId;

  // Execute deletion in transaction
  await prisma.$transaction(async (tx) => {
    // 1. Update target user status to DELETED
    await tx.user.update({
      where: { id: userId },
      data: {
        status: 'DELETED',
        presenceStatus: 'OFFLINE',
      },
    });

    // 2. Clear tokens and sessions
    await tx.refreshToken.deleteMany({ where: { userId } });
    await tx.userDevice.deleteMany({ where: { userId } });
    if (request.user?.email) {
      await tx.otpCode.deleteMany({ where: { email: request.user.email } });
    }
    await tx.passkeyCredential.deleteMany({ where: { userId } });

    // 3. If user is a mentor, deactivate profile & delete availabilities
    if (request.user?.mentor) {
      const mentorId = request.user.mentor.id;
      await tx.mentor.update({
        where: { id: mentorId },
        data: {
          isActive: false,
          activeStatus: 'DEACTIVATED',
        },
      });
      await tx.availability.deleteMany({ where: { mentorId } });
      await tx.blockedDate.deleteMany({ where: { mentorId } });
    }

    // 4. Update the deletion request to APPROVED
    await tx.userDeletionRequest.update({
      where: { id: requestId },
      data: {
        status: 'APPROVED',
        reviewedById: reviewerId,
        reviewNotes: reviewNotes?.trim() || null,
        reviewedAt: new Date(),
      },
    });
  });

  // Ban user in Supabase Auth if applicable (only for UUID-based Supabase users)
  const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (UUID_REGEX.test(userId)) {
    try {
      await adminSupabase.auth.admin.updateUserById(userId, { ban_duration: '876000h' });
    } catch (sbErr) {
      console.warn('[USER_DELETION] Supabase ban failed:', sbErr.message);
    }
  }

  // Invalidate cached auth user
  invalidateCachedUser(userId);

  // Log audit event
  try {
    const reviewer = await prisma.user.findUnique({
      where: { id: reviewerId },
      select: { email: true },
    });
    await logAuditEvent({
      action: 'USER_DELETION_APPROVED',
      actorId: reviewerId,
      targetId: userId,
      endpoint: req?.originalUrl || '/api/super-admin/deletion-requests/:id/approve',
      ip: req ? getClientIp(req) : null,
      userAgent: req?.headers ? req.headers['user-agent'] : null,
      metadata: {
        requestId,
        reviewNotes: reviewNotes?.trim() || null,
        targetEmail: request.user?.email,
        requestedById: request.requestedById,
        reviewerEmail: reviewer?.email,
      },
    });
  } catch (logErr) {
    console.warn('[USER_DELETION] Failed to log audit event:', logErr.message);
  }

  // Notify the admin who made the request
  if (request.requestedById) {
    sendNotification({
      userId: request.requestedById,
      title: 'User Deletion Request Approved',
      body: `Your request to delete user ${request.user.name} (${request.user.email}) has been approved and executed by Super Admin.`,
      type: 'ACCOUNT_UPDATE',
    }).catch((notifErr) => {
      console.warn('[USER_DELETION] Failed to notify requester:', notifErr.message);
    });
  }

  return { success: true, message: 'User deletion request approved successfully' };
}

/**
 * Super Admin rejects a deletion request.
 */
async function rejectDeletionRequest({ requestId, reviewerId, rejectionReason, req }) {
  if (!rejectionReason || !rejectionReason.trim()) {
    const err = new Error('Rejection reason is required');
    err.status = 400;
    throw err;
  }

  const request = await prisma.userDeletionRequest.findUnique({
    where: { id: requestId },
    include: {
      user: { select: { id: true, name: true, email: true } },
    },
  });

  if (!request) {
    const err = new Error('Deletion request not found');
    err.status = 404;
    throw err;
  }

  if (request.status !== 'PENDING') {
    const err = new Error(`Request has already been ${request.status.toLowerCase()}`);
    err.status = 400;
    throw err;
  }

  const updatedRequest = await prisma.userDeletionRequest.update({
    where: { id: requestId },
    data: {
      status: 'REJECTED',
      reviewedById: reviewerId,
      reviewNotes: rejectionReason.trim(),
      reviewedAt: new Date(),
    },
  });

  // Log audit event
  try {
    const reviewer = await prisma.user.findUnique({
      where: { id: reviewerId },
      select: { email: true },
    });
    await logAuditEvent({
      action: 'USER_DELETION_REJECTED',
      actorId: reviewerId,
      targetId: request.userId,
      endpoint: req?.originalUrl || '/api/super-admin/deletion-requests/:id/reject',
      ip: req ? getClientIp(req) : null,
      userAgent: req?.headers ? req.headers['user-agent'] : null,
      metadata: {
        requestId,
        rejectionReason: rejectionReason.trim(),
        targetEmail: request.user?.email,
        requestedById: request.requestedById,
        reviewerEmail: reviewer?.email,
      },
    });
  } catch (logErr) {
    console.warn('[USER_DELETION] Failed to log audit event:', logErr.message);
  }

  // Notify requesting admin
  if (request.requestedById) {
    sendNotification({
      userId: request.requestedById,
      title: 'User Deletion Request Rejected',
      body: `Your request to delete user ${request.user.name} (${request.user.email}) was rejected by Super Admin. Reason: ${rejectionReason.trim()}`,
      type: 'ACCOUNT_UPDATE',
    }).catch((notifErr) => {
      console.warn('[USER_DELETION] Failed to notify requester:', notifErr.message);
    });
  }

  return { success: true, message: 'User deletion request rejected successfully', request: updatedRequest };
}

/**
 * Get count of pending deletion requests.
 */
async function getPendingRequestsCount() {
  return prisma.userDeletionRequest.count({
    where: { status: 'PENDING' },
  });
}

/**
 * List deletion requests with pagination, status filter, and search.
 */
async function listDeletionRequests({ status, q, page = 1, limit = 20, requestedById = null }) {
  const parsedPage = Math.max(1, parseInt(page) || 1);
  const parsedLimit = Math.min(Math.max(1, parseInt(limit) || 20), 100);

  const where = {};
  if (status && ['PENDING', 'APPROVED', 'REJECTED'].includes(status)) {
    where.status = status;
  }
  if (requestedById) {
    where.requestedById = requestedById;
  }
  if (q && q.trim()) {
    const query = q.trim();
    where.OR = [
      { user: { name: { contains: query, mode: 'insensitive' } } },
      { user: { email: { contains: query, mode: 'insensitive' } } },
      { requestedBy: { name: { contains: query, mode: 'insensitive' } } },
      { requestedBy: { email: { contains: query, mode: 'insensitive' } } },
      { reason: { contains: query, mode: 'insensitive' } },
    ];
  }

  const [items, total] = await Promise.all([
    prisma.userDeletionRequest.findMany({
      where,
      include: {
        user: {
          select: {
            id: true,
            name: true,
            email: true,
            role: true,
            status: true,
            avatar: true,
            createdAt: true,
          },
        },
        requestedBy: {
          select: {
            id: true,
            name: true,
            email: true,
            role: true,
          },
        },
        reviewedBy: {
          select: {
            id: true,
            name: true,
            email: true,
            role: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
      skip: (parsedPage - 1) * parsedLimit,
      take: parsedLimit,
    }),
    prisma.userDeletionRequest.count({ where }),
  ]);

  return {
    items,
    total,
    page: parsedPage,
    totalPages: Math.ceil(total / parsedLimit),
  };
}

module.exports = {
  createDeletionRequest,
  approveDeletionRequest,
  rejectDeletionRequest,
  getPendingRequestsCount,
  listDeletionRequests,
};
