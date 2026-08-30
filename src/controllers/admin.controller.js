const { approveMentor, rejectMentor } = require('../services/mentorApproval.service');
const prisma = require('../config/prisma');
const { logAuditEvent, getClientIp } = require('../services/auditLog.service');

async function getDashboard(req, res) {
  try {
    const now = new Date();
    const startOfDay = new Date(now.setHours(0, 0, 0, 0));
    const startOfWeek = new Date(now); startOfWeek.setDate(startOfWeek.getDate() - 7);
    const startOfMonth = new Date(now); startOfMonth.setMonth(startOfMonth.getMonth() - 1);
    
    const [totalUsers, totalMentors, pendingMentors, approvedMentors, rejectedMentors, totalBookings, todayBookings, weekBookings, totalRevenue, pendingApprovals] = await Promise.all([
      prisma.user.count(),
      prisma.mentor.count(),
      prisma.mentor.count({ where: { approvalStatus: 'PENDING' } }),
      prisma.mentor.count({ where: { approvalStatus: 'APPROVED' } }),
      prisma.mentor.count({ where: { approvalStatus: 'REJECTED' } }),
      prisma.booking.count({ where: { status: 'CONFIRMED' } }),
      prisma.booking.count({ where: { status: 'CONFIRMED', createdAt: { gte: startOfDay } } }),
      prisma.booking.count({ where: { status: 'CONFIRMED', createdAt: { gte: startOfWeek } } }),
      prisma.earning.aggregate({ _sum: { amount: true } }),
      prisma.mentor.count({ where: { approvalStatus: 'PENDING' } }),
    ]);

    res.json({ totalUsers, totalMentors, mentorBreakdown: { pending: pendingMentors, approved: approvedMentors, rejected: rejectedMentors }, totalBookings, todayBookings, weekBookings, totalRevenue: totalRevenue._sum.amount || 0, pendingApprovals });
  } catch (e) { console.error(e); res.status(500).json({ error: 'Failed' }); }
}

async function getPendingMentors(req, res) {
  try {
    const { page = 1, limit = 10 } = req.query;
    const [mentors, total] = await Promise.all([
      prisma.mentor.findMany({
        where: { approvalStatus: 'PENDING' },
        include: {
          user: {
            select: {
              id: true,
              name: true,
              email: true,
              phone: true,
              avatar: true,
              role: true,
              onboardingRole: true,
              mentorProfile: true,
              mentorOnboarding: true,
              createdAt: true,
            },
          },
          category: true,
          verificationDocs: true,
        },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: parseInt(limit),
      }),
      prisma.mentor.count({ where: { approvalStatus: 'PENDING' } }),
    ]);
    res.json({ mentors, total, page: parseInt(page), totalPages: Math.ceil(total / limit) });
  } catch (e) {
    console.error('[ADMIN] getPendingMentors error:', e);
    res.status(500).json({ error: 'Failed' });
  }
}

async function getMentorDetail(req, res) {
  try {
    const mentor = await prisma.mentor.findUnique({
      where: { id: req.params.id },
      include: {
        user: {
          select: {
            id: true,
            name: true,
            email: true,
            phone: true,
            avatar: true,
            role: true,
            onboardingRole: true,
            mentorProfile: true,
            mentorOnboarding: true,
            createdAt: true,
          },
        },
        category: true,
        verificationDocs: true,
        reviews: { take: 10 },
      },
    });
    if (!mentor) return res.status(404).json({ error: 'Mentor not found' });
    res.json({ mentor });
  } catch (e) {
    console.error('[ADMIN] getMentorDetail error:', e);
    res.status(500).json({ error: 'Failed' });
  }
}

async function approveMentorHandler(req, res) {
  try {
    const mentor = await approveMentor(req.params.id);
    await logAuditEvent({
      action: 'MENTOR_APPROVED',
      actorId: req.user.id,
      targetId: req.params.id,
      endpoint: req.originalUrl,
      ip: getClientIp(req),
      userAgent: req.headers['user-agent'] || null,
      metadata: { actorEmail: req.user.email },
    });
    res.json({ mentor });
  } catch (e) {
    console.error('[ADMIN] Mentor approval handler crashed:', e);
    res.status(500).json({ error: 'Mentor approval failed' });
  }
}

async function rejectMentorHandler(req, res) {
  try {
    const { reason } = req.body;
    if (!reason) return res.status(400).json({ error: 'Reason required' });
    const mentor = await rejectMentor(req.params.id, reason);
    await logAuditEvent({
      action: 'MENTOR_REJECTED',
      actorId: req.user.id,
      targetId: req.params.id,
      endpoint: req.originalUrl,
      ip: getClientIp(req),
      userAgent: req.headers['user-agent'] || null,
      metadata: { actorEmail: req.user.email, reason },
    });
    res.json({ mentor });
  } catch (e) {
    console.error('[ADMIN] Mentor rejection handler crashed:', e);
    res.status(500).json({ error: 'Mentor rejection failed' });
  }
}

async function getAllMentors(req, res) {
  try {
    const { status, category, institutionType, q, page = 1, limit = 20 } = req.query;
    const where = {};
    if (status && status !== 'All') where.approvalStatus = status;
    if (category) where.categoryId = category;
    if (institutionType) where.institutionType = institutionType;
    if (q && q.trim()) {
      const term = q.trim();
      where.OR = [
        { displayName: { contains: term, mode: 'insensitive' } },
        { institutionName: { contains: term, mode: 'insensitive' } },
        { company: { contains: term, mode: 'insensitive' } },
        { user: { name: { contains: term, mode: 'insensitive' } } },
        { user: { email: { contains: term, mode: 'insensitive' } } },
      ];
    }
    const [mentors, total] = await Promise.all([
      prisma.mentor.findMany({
        where,
        include: {
          user: {
            select: {
              id: true,
              name: true,
              email: true,
              phone: true,
              avatar: true,
              role: true,
              onboardingRole: true,
              mentorProfile: true,
              mentorOnboarding: true,
              createdAt: true,
            },
          },
          category: true,
          verificationDocs: true,
        },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: parseInt(limit),
      }),
      prisma.mentor.count({ where }),
    ]);
    res.json({ mentors, total, page: parseInt(page), totalPages: Math.ceil(total / limit) });
  } catch (e) {
    console.error('[ADMIN] getAllMentors error:', e);
    res.status(500).json({ error: 'Failed' });
  }
}

async function toggleMentorActive(req, res) {
  try {
    const mentor = await prisma.mentor.findUnique({ where: { id: req.params.id } });
    const updated = await prisma.mentor.update({ where: { id: req.params.id }, data: { isActive: !mentor.isActive } });
    await logAuditEvent({
      action: 'MENTOR_TOGGLED',
      actorId: req.user.id,
      targetId: req.params.id,
      endpoint: req.originalUrl,
      ip: getClientIp(req),
      userAgent: req.headers['user-agent'] || null,
      metadata: { actorEmail: req.user.email, isActive: updated.isActive },
    });
    res.json({ mentor: updated });
  } catch (e) { res.status(500).json({ error: 'Failed' }); }
}

const { sendAccountStatusEmail } = require('../services/email.service');

async function getAllUsers(req, res) {
  try {
    const { q, status, page = 1, limit = 20 } = req.query;
    const where = {};
    if (q) where.OR = [{ name: { contains: q, mode: 'insensitive' } }, { email: { contains: q, mode: 'insensitive' } }];
    if (status && ['ACTIVE', 'ON_HOLD', 'DISABLED', 'DELETED'].includes(status)) where.status = status;
    const parsedPage = parseInt(page) || 1;
    const parsedLimit = Math.min(parseInt(limit) || 20, 100);
    const [rawUsers, total] = await Promise.all([
      prisma.user.findMany({
        where,
        select: {
          id: true,
          name: true,
          email: true,
          role: true,
          status: true,
          createdAt: true,
          isEmailVerified: true,
          lastSeen: true,
          presenceStatus: true,
        },
        orderBy: { createdAt: 'desc' },
        skip: (parsedPage - 1) * parsedLimit,
        take: parsedLimit,
      }),
      prisma.user.count({ where }),
    ]);

    // Lookup latest audit event per user for last IP and browser
    const userIds = rawUsers.map(u => u.id);
    let logMap = new Map();
    if (userIds.length > 0) {
      try {
        const latestLogs = await prisma.auditLog.findMany({
          where: { actorId: { in: userIds } },
          orderBy: { createdAt: 'desc' },
          distinct: ['actorId'],
          select: { actorId: true, ip: true, userAgent: true, metadata: true, createdAt: true },
        });
        logMap = new Map(latestLogs.map(l => [l.actorId, l]));
      } catch (logErr) {
        console.warn('[ADMIN] Could not fetch latest user logs:', logErr.message);
      }
    }

    const users = rawUsers.map(u => {
      const log = logMap.get(u.id);
      const meta = (log?.metadata && typeof log.metadata === 'object') ? log.metadata : {};
      return {
        ...u,
        lastIp: log?.ip || null,
        lastBrowser: meta.browser || null,
        lastOs: meta.os || null,
        lastDeviceType: meta.deviceType || null,
        lastLoginAt: log?.createdAt || u.lastSeen,
      };
    });

    res.json({ users, total, page: parsedPage, totalPages: Math.ceil(total / parsedLimit) });
  } catch (e) {
    console.error('[ADMIN] getAllUsers error:', e);
    res.status(500).json({ error: 'Failed to retrieve users' });
  }
}

async function setUserStatusHandler(req, res) {
  try {
    const { status, reason } = req.body;
    if (!['ACTIVE', 'ON_HOLD', 'DISABLED'].includes(status)) {
      return res.status(400).json({ error: 'Invalid status' });
    }

    const targetUser = await prisma.user.findUnique({
      where: { id: req.params.id },
      include: { mentor: true },
    });

    if (!targetUser) {
      return res.status(404).json({ error: 'User not found' });
    }

    const updatedUser = await prisma.user.update({
      where: { id: req.params.id },
      data: { status },
    });

    if (targetUser.mentor) {
      await prisma.mentor.update({
        where: { id: targetUser.mentor.id },
        data: { isActive: status === 'ACTIVE' },
      });
    }

    await logAuditEvent({
      action: 'USER_STATUS_CHANGED',
      actorId: req.user.id,
      targetId: req.params.id,
      endpoint: req.originalUrl,
      ip: getClientIp(req),
      userAgent: req.headers['user-agent'] || null,
      metadata: { actorEmail: req.user.email, newStatus: status, reason },
    });

    try {
      await sendAccountStatusEmail(targetUser, status, reason);
    } catch (emailError) {
      console.error('[EMAIL] Account status update email failed:', emailError.message);
    }

    res.json({ user: updatedUser });
  } catch (e) {
    console.error('[ADMIN] setUserStatusHandler error:', e);
    res.status(500).json({ error: 'Failed to update user status' });
  }
}

async function getAllBookings(req, res) {
  try {
    const { status, page = 1, limit = 20 } = req.query;
    const where = {};
    if (status) where.status = status;
    const [bookings, total] = await Promise.all([
      prisma.booking.findMany({ where, include: { user: { select: { name: true } }, mentor: { select: { displayName: true } } }, orderBy: { createdAt: 'desc' }, skip: (page - 1) * limit, take: parseInt(limit) }),
      prisma.booking.count({ where }),
    ]);
    res.json({ bookings, total, page: parseInt(page), totalPages: Math.ceil(total / limit) });
  } catch (e) { res.status(500).json({ error: 'Failed' }); }
}

async function getCategories(req, res) {
  try { const cats = await prisma.category.findMany({ orderBy: { name: 'asc' } }); res.json({ categories: cats }); }
  catch (e) { res.status(500).json({ error: 'Failed' }); }
}

async function createCategory(req, res) {
  try {
    const { name, slug, icon, description } = req.body;
    const cat = await prisma.category.create({ data: { name, slug: slug || name.toLowerCase().replace(/\s+/g, '-'), icon, description } });
    await logAuditEvent({
      action: 'CATEGORY_CREATED',
      actorId: req.user.id,
      targetId: cat.id,
      endpoint: req.originalUrl,
      ip: getClientIp(req),
      userAgent: req.headers['user-agent'] || null,
      metadata: { actorEmail: req.user.email, categoryName: cat.name },
    });
    res.json({ category: cat });
  } catch (e) { res.status(500).json({ error: 'Failed' }); }
}

async function updateCategory(req, res) {
  try {
    const { name, slug, icon, description, isActive } = req.body;
    const data = {};
    if (name !== undefined) data.name = name;
    if (slug !== undefined) data.slug = slug;
    if (icon !== undefined) data.icon = icon;
    if (description !== undefined) data.description = description;
    if (isActive !== undefined) data.isActive = isActive;

    const cat = await prisma.category.update({ where: { id: req.params.id }, data });
    await logAuditEvent({
      action: 'CATEGORY_UPDATED',
      actorId: req.user.id,
      targetId: req.params.id,
      endpoint: req.originalUrl,
      ip: getClientIp(req),
      userAgent: req.headers['user-agent'] || null,
      metadata: { actorEmail: req.user.email, categoryName: cat.name },
    });
    res.json({ category: cat });
  } catch (e) { res.status(500).json({ error: 'Failed' }); }
}

async function getEarnings(req, res) {
  try {
    const earnings = await prisma.earning.findMany({ include: { mentor: { select: { displayName: true } } }, orderBy: { createdAt: 'desc' }, take: 100 });
    const total = await prisma.earning.aggregate({ _sum: { amount: true } });
    res.json({ earnings, totalRevenue: total._sum.amount || 0 });
  } catch (e) { res.status(500).json({ error: 'Failed' }); }
}

async function getAllReviews(req, res) {
  try {
    const reviews = await prisma.review.findMany({ include: { user: { select: { name: true } }, mentor: { select: { displayName: true } } }, orderBy: { createdAt: 'desc' }, take: 100 });
    res.json({ reviews });
  } catch (e) { res.status(500).json({ error: 'Failed' }); }
}

async function getChatStats(req, res) {
  try {
    const totalThreads = await prisma.chatThread.count();
    const bookedThreads = await prisma.chatThread.count({ where: { status: 'BOOKED' } });
    const conversionRate = totalThreads > 0 ? ((bookedThreads / totalThreads) * 100).toFixed(1) : 0;
    res.json({ totalThreads, bookedThreads, conversionRate });
  } catch (e) { res.status(500).json({ error: 'Failed' }); }
}

module.exports = { getDashboard, getPendingMentors, getMentorDetail, approveMentorHandler, rejectMentorHandler, getAllMentors, toggleMentorActive, getAllUsers, setUserStatusHandler, getAllBookings, getCategories, createCategory, updateCategory, getEarnings, getAllReviews, getChatStats };
