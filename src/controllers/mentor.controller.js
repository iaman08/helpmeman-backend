const prisma = require('../config/prisma');
const { uploadImage, uploadDocument } = require('../services/upload.service');
const { getMentorNotifications } = require('../services/notification.service');

// Helper to map dynamic presence properties from the user model
function enrichPresence(mentor) {
  if (!mentor) return null;
  const user = mentor.user;
  if (!user) return mentor;

  const presenceStatus = user.presenceStatus || 'OFFLINE';
  const lastSeen = user.lastSeen;

  // ONLINE if they have interacted within 5 mins
  const isOnline = presenceStatus === 'ONLINE';

  let activeStatus = 'Offline';
  if (presenceStatus === 'ONLINE') {
    activeStatus = 'Online';
  } else if (presenceStatus === 'AWAY') {
    activeStatus = 'Away';
  } else if (lastSeen) {
    const diffMs = Date.now() - new Date(lastSeen).getTime();
    if (diffMs < 24 * 60 * 60 * 1000) {
      activeStatus = 'Active today';
    } else if (diffMs < 7 * 24 * 60 * 60 * 1000) {
      activeStatus = 'Active this week';
    } else {
      activeStatus = 'Active recently';
    }
  }

  return {
    ...mentor,
    isOnline,
    activeStatus,
    avatar: mentor.avatar || user.avatar || null
  };
}

// ─── Public ───
async function searchMentors(req, res) {
  try {
    const { q, category, institutionType, institution, minPrice, maxPrice, minRating, expertise, sortBy = 'rating', page = 1, limit = 12 } = req.query;
    const where = { approvalStatus: 'APPROVED', isActive: true };
    if (category) { const cat = await prisma.category.findUnique({ where: { slug: category } }); if (cat) where.categoryId = cat.id; }
    if (institutionType) where.institutionType = institutionType;
    if (institution) where.institutionName = { contains: institution, mode: 'insensitive' };
    if (minPrice) where.pricePerSession = { ...where.pricePerSession, gte: parseInt(minPrice) };
    if (maxPrice) where.pricePerSession = { ...where.pricePerSession, lte: parseInt(maxPrice) };
    if (minRating) where.rating = { gte: parseFloat(minRating) };
    if (expertise) where.expertise = { hasSome: Array.isArray(expertise) ? expertise : [expertise] };
    if (q) where.OR = [{ displayName: { contains: q, mode: 'insensitive' } }, { bio: { contains: q, mode: 'insensitive' } }, { institutionName: { contains: q, mode: 'insensitive' } }];

    const orderBy = sortBy === 'price' ? { pricePerSession: 'asc' } : sortBy === 'sessions' ? { totalSessions: 'desc' } : sortBy === 'newest' ? { createdAt: 'desc' } : { rating: 'desc' };

    const [mentorsList, total] = await Promise.all([
      prisma.mentor.findMany({
        where,
        include: {
          category: true,
          user: {
            select: { name: true, avatar: true, presenceStatus: true, lastSeen: true }
          }
        },
        orderBy,
        skip: (parseInt(page) - 1) * parseInt(limit),
        take: parseInt(limit)
      }),
      prisma.mentor.count({ where }),
    ]);

    const mentors = mentorsList.map(enrichPresence);

    res.json({ mentors, total, page: parseInt(page), totalPages: Math.ceil(total / parseInt(limit)) });
  } catch (e) { console.error(e); res.status(500).json({ error: 'Search failed' }); }
}

async function getMentorPublic(req, res) {
  try {
    const mentorRaw = await prisma.mentor.findFirst({
      where: { id: req.params.id, approvalStatus: 'APPROVED', isActive: true },
      include: {
        category: true,
        user: {
          select: { name: true, email: true, avatar: true, presenceStatus: true, lastSeen: true }
        },
        reviews: {
          where: { isVisible: true },
          take: 5,
          orderBy: { createdAt: 'desc' },
          include: {
            user: { select: { name: true, avatar: true } }
          }
        }
      },
    });
    if (!mentorRaw) return res.status(404).json({ error: 'Mentor not found' });
    const mentor = enrichPresence(mentorRaw);
    res.json({ mentor });
  } catch (e) { res.status(500).json({ error: 'Failed' }); }
}

async function getMentorAvailability(req, res) {
  try {
    const availabilities = await prisma.availability.findMany({ where: { mentorId: req.params.id, isActive: true }, orderBy: { dayOfWeek: 'asc' } });
    const bookings = await prisma.booking.findMany({
      where: { mentorId: req.params.id, status: { in: ['CONFIRMED', 'PENDING'] }, scheduledAt: { gte: new Date() } },
      select: { scheduledAt: true, durationMinutes: true },
    });
    res.json({ availabilities, bookedSlots: bookings });
  } catch (e) { res.status(500).json({ error: 'Failed' }); }
}

async function getMentorReviews(req, res) {
  try {
    let mentorId = req.params.id;
    if (!mentorId && req.user) {
      const mentor = await prisma.mentor.findUnique({ where: { userId: req.user.id } });
      if (mentor) mentorId = mentor.id;
    }
    if (!mentorId) {
      return res.status(400).json({ error: 'Mentor ID is required' });
    }

    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(100, parseInt(req.query.limit) || 10);
    const offset = (page - 1) * limit;

    const [countRow] = await prisma.$queryRawUnsafe(
      `SELECT COUNT(*) as total FROM "MentorReview" WHERE "mentorId" = $1`,
      mentorId
    );
    const total = Number(countRow?.total ?? 0);

    const reviews = await prisma.$queryRawUnsafe(
      `SELECT r.id, r.rating, r.feedback, r.tags, r.anonymous,
              r."createdAt", r."updatedAt",
              CASE WHEN r.anonymous THEN NULL ELSE u.name END as "userName",
              CASE WHEN r.anonymous THEN NULL ELSE u.avatar END as "userAvatar",
              CASE WHEN r.anonymous THEN NULL ELSE u."currentRole" END as "userRole"
       FROM "MentorReview" r
       JOIN "User" u ON u.id = r."userId"
       WHERE r."mentorId" = $1
       ORDER BY r."createdAt" DESC
       LIMIT $2 OFFSET $3`,
      mentorId,
      limit,
      offset
    );

    res.json({
      reviews,
      total,
      page: parseInt(page),
      totalPages: Math.ceil(total / limit),
    });
  } catch (e) {
    console.error('[mentor.controller] getMentorReviews error:', e);
    res.status(500).json({ error: 'Failed to fetch reviews' });
  }
}

// ─── Mentor Dashboard ───
async function getOwnProfile(req, res) {
  try {
    const mentorRaw = await prisma.mentor.findUnique({
      where: { userId: req.user.id },
      include: {
        category: true,
        verificationDocs: true,
        user: {
          select: { avatar: true, presenceStatus: true, lastSeen: true }
        }
      }
    });
    if (!mentorRaw) return res.status(404).json({ error: 'Mentor profile not found' });
    const mentor = enrichPresence(mentorRaw);
    res.json({ mentor });
  } catch (e) { res.status(500).json({ error: 'Failed' }); }
}

async function updateOwnProfile(req, res) {
  try {
    const {
      bio,
      expertise,
      pricePerSession,
      sessionDuration,
      linkedinUrl,
      displayName,
      languages,
      experienceYears,
      isOnline,
      country,
      state,
      city,
      locality,
      postalCode
    } = req.body;

    const data = {};
    if (bio !== undefined) data.bio = bio;
    if (expertise !== undefined) data.expertise = expertise;
    if (pricePerSession !== undefined) data.pricePerSession = pricePerSession;
    if (sessionDuration !== undefined) data.sessionDuration = sessionDuration;
    if (linkedinUrl !== undefined) data.linkedinUrl = linkedinUrl;
    if (displayName !== undefined) data.displayName = displayName;
    if (experienceYears !== undefined) data.experienceYears = experienceYears !== null ? parseInt(experienceYears) : null;
    if (isOnline !== undefined) data.isOnline = isOnline === true || isOnline === 'true';

    // Structured Address Fields
    if (country !== undefined) data.country = country;
    if (state !== undefined) data.state = state;
    if (city !== undefined) data.city = city;
    if (locality !== undefined) data.locality = locality;
    if (postalCode !== undefined) data.postalCode = postalCode;

    // Concatenate address into location string
    if (city || state || country) {
      data.location = [city, state, country].filter(Boolean).join(', ');
    }

    // Languages array mapping
    if (languages !== undefined) {
      if (Array.isArray(languages)) {
        data.languages = languages;
      } else if (typeof languages === 'string') {
        data.languages = languages.split(',').map(s => s.trim()).filter(Boolean);
      }
    }

    // If mentor updates displayName, also sync it with the parent User record's name
    if (displayName !== undefined) {
      await prisma.user.update({
        where: { id: req.user.id },
        data: { name: displayName }
      });
    }

    const mentorRaw = await prisma.mentor.update({
      where: { userId: req.user.id },
      data,
      include: {
        category: true,
        user: { select: { avatar: true, presenceStatus: true, lastSeen: true } }
      }
    });

    const mentor = enrichPresence(mentorRaw);
    res.json({ mentor });
  } catch (e) {
    console.error('[MENTOR_CONTROLLER] Update error:', e);
    res.status(500).json({ error: 'Update failed' });
  }
}

async function updateAvatar(req, res) {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file' });
    const url = await uploadImage(req.file, 'avatars');
    const mentor = await prisma.mentor.update({ where: { userId: req.user.id }, data: { avatar: url } });
    await prisma.user.update({ where: { id: req.user.id }, data: { avatar: url } });
    res.json({ avatar: url });
  } catch (e) { res.status(500).json({ error: 'Upload failed' }); }
}

async function uploadDoc(req, res) {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file' });
    const { docType } = req.body;
    const url = await uploadDocument(req.file, 'docs');
    const mentor = await prisma.mentor.findUnique({ where: { userId: req.user.id } });
    const doc = await prisma.verificationDoc.create({ data: { mentorId: mentor.id, docType: docType || 'id_card', fileUrl: url } });
    res.json({ doc });
  } catch (e) { res.status(500).json({ error: 'Upload failed' }); }
}

async function getAvailability(req, res) {
  try {
    const mentor = await prisma.mentor.findUnique({ where: { userId: req.user.id } });
    const avail = await prisma.availability.findMany({ where: { mentorId: mentor.id }, orderBy: { dayOfWeek: 'asc' } });
    res.json({ availabilities: avail });
  } catch (e) { res.status(500).json({ error: 'Failed' }); }
}

async function setAvailability(req, res) {
  try {
    const { slots } = req.body; // [{ dayOfWeek, startTime, endTime }]
    const mentor = await prisma.mentor.findUnique({ where: { userId: req.user.id } });
    await prisma.availability.deleteMany({ where: { mentorId: mentor.id } });
    const created = await Promise.all(slots.map(s => prisma.availability.create({ data: { mentorId: mentor.id, ...s } })));
    res.json({ availabilities: created });
  } catch (e) { res.status(500).json({ error: 'Failed' }); }
}

async function getMentorBookings(req, res) {
  try {
    const mentor = await prisma.mentor.findUnique({ where: { userId: req.user.id } });
    const { filter = 'upcoming', page = 1, limit = 10 } = req.query;
    const where = { mentorId: mentor.id };
    if (filter === 'upcoming') { where.scheduledAt = { gte: new Date() }; where.status = { in: ['CONFIRMED', 'PENDING'] }; }
    else if (filter === 'past') { where.scheduledAt = { lt: new Date() }; }
    else if (filter === 'cancelled') { where.status = 'CANCELLED'; }
    const [bookings, total] = await Promise.all([
      prisma.booking.findMany({ where, include: { user: { select: { name: true, email: true, avatar: true } } }, orderBy: { scheduledAt: filter === 'upcoming' ? 'asc' : 'desc' }, skip: (page - 1) * limit, take: parseInt(limit) }),
      prisma.booking.count({ where }),
    ]);
    res.json({ bookings, total, page: parseInt(page), totalPages: Math.ceil(total / limit) });
  } catch (e) { res.status(500).json({ error: 'Failed' }); }
}

async function addBookingNotes(req, res) {
  try {
    const mentor = await prisma.mentor.findUnique({ where: { userId: req.user.id } });
    if (!mentor) return res.status(403).json({ error: 'Mentor profile not found' });

    const booking = await prisma.booking.findFirst({ where: { id: req.params.id, mentorId: mentor.id } });
    if (!booking) return res.status(404).json({ error: 'Booking not found' });

    const updated = await prisma.booking.update({ where: { id: req.params.id }, data: { mentorNotes: req.body.notes } });
    res.json({ booking: updated });
  } catch (e) { res.status(500).json({ error: 'Failed' }); }
}

async function getEarnings(req, res) {
  try {
    const mentor = await prisma.mentor.findUnique({ where: { userId: req.user.id } });
    const earnings = await prisma.earning.findMany({ where: { mentorId: mentor.id }, orderBy: { createdAt: 'desc' } });
    const total = earnings.reduce((sum, e) => sum + e.amount, 0);
    const pending = earnings.filter(e => e.status === 'PENDING').reduce((sum, e) => sum + e.amount, 0);
    res.json({ earnings, totalEarned: total, pendingPayout: pending });
  } catch (e) { res.status(500).json({ error: 'Failed' }); }
}

async function getMentorStats(req, res) {
  try {
    const mentor = await prisma.mentor.findUnique({ where: { userId: req.user.id } });
    if (!mentor) return res.status(404).json({ error: 'Mentor not found' });

    const [statsRow] = await prisma.$queryRawUnsafe(
      `SELECT COUNT(*)::int as total_reviews FROM "MentorReview" WHERE "mentorId" = $1`,
      mentor.id
    );
    const totalReviews = statsRow?.total_reviews || 0;

    res.json({
      mentorId: mentor.id,
      id: mentor.id,
      totalSessions: mentor.totalSessions,
      rating: mentor.rating, // rating column holds avg rating on Mentor table
      totalReviews: totalReviews,
    });
  } catch (e) {
    console.error('[mentor.controller] getMentorStats error:', e);
    res.status(500).json({ error: 'Failed to fetch mentor stats' });
  }
}

async function getMentorNotifs(req, res) {
  try {
    const mentor = await prisma.mentor.findUnique({ where: { userId: req.user.id } });
    const result = await getMentorNotifications(mentor.id, req.query);
    res.json(result);
  } catch (e) { res.status(500).json({ error: 'Failed' }); }
}

// ── Google Calendar Status ────────────────────────────────────────────────────
async function getGoogleCalendarStatus(req, res) {
  try {
    const mentor = await prisma.mentor.findUnique({
      where: { userId: req.user.id },
      select: { googleCalendarConnected: true, googleCalendarTimezone: true },
    });
    if (!mentor) return res.status(404).json({ error: 'Mentor profile not found' });
    res.json({
      connected: mentor.googleCalendarConnected ?? false,
      timezone: mentor.googleCalendarTimezone || 'Asia/Kolkata',
    });
  } catch (e) { res.status(500).json({ error: 'Failed' }); }
}

// ── Blocked Dates ─────────────────────────────────────────────────────────────
async function getBlockedDates(req, res) {
  try {
    const mentor = await prisma.mentor.findUnique({ where: { userId: req.user.id } });
    if (!mentor) return res.status(404).json({ error: 'Mentor not found' });

    const dates = await prisma.blockedDate.findMany({
      where: { mentorId: mentor.id, date: { gte: new Date() } },
      orderBy: { date: 'asc' },
    });
    res.json({ blockedDates: dates });
  } catch (e) { res.status(500).json({ error: 'Failed' }); }
}

async function addBlockedDate(req, res) {
  try {
    const { date, reason } = req.body;
    if (!date) return res.status(400).json({ error: 'Date is required' });

    const mentor = await prisma.mentor.findUnique({ where: { userId: req.user.id } });
    if (!mentor) return res.status(404).json({ error: 'Mentor not found' });

    // Store as UTC midnight of the given date
    const blockedDay = new Date(date);
    blockedDay.setUTCHours(0, 0, 0, 0);

    // Prevent duplicates
    const existing = await prisma.blockedDate.findFirst({
      where: { mentorId: mentor.id, date: blockedDay },
    });
    if (existing) return res.status(409).json({ error: 'This date is already blocked' });

    const blocked = await prisma.blockedDate.create({
      data: { mentorId: mentor.id, date: blockedDay, reason: reason || null },
    });
    res.status(201).json({ blockedDate: blocked });
  } catch (e) { res.status(500).json({ error: 'Failed' }); }
}

async function deleteBlockedDate(req, res) {
  try {
    const mentor = await prisma.mentor.findUnique({ where: { userId: req.user.id } });
    if (!mentor) return res.status(404).json({ error: 'Mentor not found' });

    const blocked = await prisma.blockedDate.findFirst({
      where: { id: req.params.dateId, mentorId: mentor.id },
    });
    if (!blocked) return res.status(404).json({ error: 'Blocked date not found' });

    await prisma.blockedDate.delete({ where: { id: req.params.dateId } });
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: 'Failed' }); }
}

async function logInteraction(req, res) {
  try {
    const { actionType, mentorId, timeSpent, matchScore, filters } = req.body;

    if (!actionType || !mentorId) {
      return res.status(400).json({ error: 'actionType and mentorId are required' });
    }

    const log = await prisma.auditLog.create({
      data: {
        action: 'MENTOR_SWIPE_INTERACTION',
        actorId: req.user ? req.user.id : 'anonymous',
        targetId: mentorId,
        metadata: {
          type: actionType, // skipped, interested, priority, saved, viewed, profile_opened, chat_started, session_booked
          timeSpent: timeSpent || null,
          matchScore: matchScore || null,
          filters: filters || null,
        },
      },
    });

    res.status(201).json({ success: true, logId: log.id });
  } catch (error) {
    console.error('Failed to log mentor interaction:', error);
    res.status(500).json({ error: 'Failed to save interaction' });
  }
}

async function getInteractionAnalytics(req, res) {
  try {
    const logs = await prisma.auditLog.findMany({
      where: { action: 'MENTOR_SWIPE_INTERACTION' },
    });

    let totalSwipes = 0;
    let skippedCount = 0;
    let interestedCount = 0;
    let priorityCount = 0;
    let savedCount = 0;
    let viewedCount = 0;
    let profileOpenedCount = 0;
    let chatStartedCount = 0;
    let sessionBookedCount = 0;
    let totalTimeSpent = 0;
    let timeSpentCount = 0;

    const mentorLikes = {}; // mentorId -> count
    const filterUsage = {}; // filterKey -> count
    const scoreBuckets = { '0-20': 0, '21-40': 0, '41-60': 0, '61-80': 0, '81-100': 0 };

    let highMatchCount = 0;
    let highMatchInterestedCount = 0;

    for (const log of logs) {
      const meta = log.metadata || {};
      const type = meta.type || '';
      
      if (type === 'skipped' || type === 'interested' || type === 'priority') {
        totalSwipes++;
        if (type === 'skipped') skippedCount++;
        if (type === 'interested') interestedCount++;
        if (type === 'priority') priorityCount++;

        const score = meta.matchScore;
        if (typeof score === 'number') {
          if (score >= 80) {
            highMatchCount++;
            if (type === 'interested' || type === 'priority') {
              highMatchInterestedCount++;
            }
          }
          if (score <= 20) scoreBuckets['0-20']++;
          else if (score <= 40) scoreBuckets['21-40']++;
          else if (score <= 60) scoreBuckets['41-60']++;
          else if (score <= 80) scoreBuckets['61-80']++;
          else scoreBuckets['81-100']++;
        }
      }

      if (type === 'saved') savedCount++;
      if (type === 'viewed') viewedCount++;
      if (type === 'profile_opened') profileOpenedCount++;
      if (type === 'chat_started') chatStartedCount++;
      if (type === 'session_booked') sessionBookedCount++;

      if (typeof meta.timeSpent === 'number' && meta.timeSpent > 0) {
        totalTimeSpent += meta.timeSpent;
        timeSpentCount++;
      }

      if ((type === 'interested' || type === 'priority') && log.targetId) {
        mentorLikes[log.targetId] = (mentorLikes[log.targetId] || 0) + 1;
      }

      if (meta.filters && typeof meta.filters === 'object') {
        Object.keys(meta.filters).forEach(key => {
          if (meta.filters[key] !== undefined && meta.filters[key] !== '' && meta.filters[key] !== null) {
            filterUsage[key] = (filterUsage[key] || 0) + 1;
          }
        });
      }
    }

    const swipeConversionRate = totalSwipes > 0 ? ((interestedCount + priorityCount) / totalSwipes) * 100 : 0;
    const likeRate = totalSwipes > 0 ? (interestedCount / totalSwipes) * 100 : 0;
    const bookingRate = (interestedCount + priorityCount) > 0 ? (sessionBookedCount / (interestedCount + priorityCount)) * 100 : 0;
    const avgTimeSpent = timeSpentCount > 0 ? totalTimeSpent / timeSpentCount : 0;
    const aiRecommendationAccuracy = highMatchCount > 0 ? (highMatchInterestedCount / highMatchCount) * 100 : 0;

    // Get most liked mentors profiles
    const topMentorIds = Object.keys(mentorLikes)
      .sort((a, b) => mentorLikes[b] - mentorLikes[a])
      .slice(0, 5);

    const topMentors = await prisma.mentor.findMany({
      where: { id: { in: topMentorIds } },
      select: { id: true, displayName: true, currentRole: true, avatar: true },
    });

    const topMentorsWithCount = topMentors.map(m => ({
      ...m,
      likesCount: mentorLikes[m.id] || 0,
    })).sort((a, b) => b.likesCount - a.likesCount);

    res.json({
      totalSwipes,
      skippedCount,
      interestedCount,
      priorityCount,
      savedCount,
      viewedCount,
      profileOpenedCount,
      chatStartedCount,
      sessionBookedCount,
      swipeConversionRate: Math.round(swipeConversionRate * 10) / 10,
      likeRate: Math.round(likeRate * 10) / 10,
      bookingRate: Math.round(bookingRate * 10) / 10,
      avgTimeSpentSeconds: Math.round(avgTimeSpent),
      aiRecommendationAccuracy: Math.round(aiRecommendationAccuracy * 10) / 10,
      topLikedMentors: topMentorsWithCount,
      filterUsage,
      matchScoreDistribution: scoreBuckets,
    });
  } catch (error) {
    console.error('Failed to get interaction analytics:', error);
    res.status(500).json({ error: 'Failed to process analytics data' });
  }
}

module.exports = {
  searchMentors,
  getMentorPublic,
  getMentorAvailability,
  getMentorReviews,
  getOwnProfile,
  updateOwnProfile,
  updateAvatar,
  uploadDoc,
  getAvailability,
  setAvailability,
  getMentorBookings,
  addBookingNotes,
  getEarnings,
  getMentorStats,
  getMentorNotifs,
  getGoogleCalendarStatus,
  getBlockedDates,
  addBlockedDate,
  deleteBlockedDate,
  logInteraction,
  getInteractionAnalytics,
};

