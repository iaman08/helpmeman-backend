const { PrismaClient } = require('@prisma/client');
const { uploadImage, uploadDocument } = require('../services/upload.service');
const { getMentorNotifications } = require('../services/notification.service');
const prisma = new PrismaClient();

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

    const [mentors, total] = await Promise.all([
      prisma.mentor.findMany({ where, include: { category: true, user: { select: { name: true } } }, orderBy, skip: (parseInt(page) - 1) * parseInt(limit), take: parseInt(limit) }),
      prisma.mentor.count({ where }),
    ]);
    res.json({ mentors, total, page: parseInt(page), totalPages: Math.ceil(total / parseInt(limit)) });
  } catch (e) { console.error(e); res.status(500).json({ error: 'Search failed' }); }
}

async function getMentorPublic(req, res) {
  try {
    const mentor = await prisma.mentor.findFirst({
      where: { id: req.params.id, approvalStatus: 'APPROVED', isActive: true },
      include: { category: true, user: { select: { name: true, email: true } }, reviews: { where: { isVisible: true }, take: 5, orderBy: { createdAt: 'desc' }, include: { user: { select: { name: true, avatar: true } } } } },
    });
    if (!mentor) return res.status(404).json({ error: 'Mentor not found' });
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
    const { page = 1, limit = 10 } = req.query;
    const [reviews, total] = await Promise.all([
      prisma.review.findMany({ where: { mentorId: req.params.id, isVisible: true }, include: { user: { select: { name: true, avatar: true } } }, orderBy: { createdAt: 'desc' }, skip: (page - 1) * limit, take: parseInt(limit) }),
      prisma.review.count({ where: { mentorId: req.params.id, isVisible: true } }),
    ]);
    res.json({ reviews, total, page: parseInt(page), totalPages: Math.ceil(total / limit) });
  } catch (e) { res.status(500).json({ error: 'Failed' }); }
}

// ─── Mentor Dashboard ───
async function getOwnProfile(req, res) {
  try {
    const mentor = await prisma.mentor.findUnique({ where: { userId: req.user.id }, include: { category: true, verificationDocs: true } });
    if (!mentor) return res.status(404).json({ error: 'Mentor profile not found' });
    res.json({ mentor });
  } catch (e) { res.status(500).json({ error: 'Failed' }); }
}

async function updateOwnProfile(req, res) {
  try {
    const { bio, expertise, pricePerSession, sessionDuration, linkedinUrl, displayName } = req.body;
    const data = {};
    if (bio) data.bio = bio;
    if (expertise) data.expertise = expertise;
    if (pricePerSession) data.pricePerSession = pricePerSession;
    if (sessionDuration) data.sessionDuration = sessionDuration;
    if (linkedinUrl) data.linkedinUrl = linkedinUrl;
    if (displayName) data.displayName = displayName;
    const mentor = await prisma.mentor.update({ where: { userId: req.user.id }, data });
    res.json({ mentor });
  } catch (e) { res.status(500).json({ error: 'Update failed' }); }
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
    const booking = await prisma.booking.update({ where: { id: req.params.id }, data: { mentorNotes: req.body.notes } });
    res.json({ booking });
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
    const reviews = await prisma.review.findMany({ where: { mentorId: mentor.id } });
    res.json({ totalSessions: mentor.totalSessions, rating: mentor.rating, totalReviews: reviews.length });
  } catch (e) { res.status(500).json({ error: 'Failed' }); }
}

async function getMentorNotifs(req, res) {
  try {
    const mentor = await prisma.mentor.findUnique({ where: { userId: req.user.id } });
    const result = await getMentorNotifications(mentor.id, req.query);
    res.json(result);
  } catch (e) { res.status(500).json({ error: 'Failed' }); }
}

module.exports = { searchMentors, getMentorPublic, getMentorAvailability, getMentorReviews, getOwnProfile, updateOwnProfile, updateAvatar, uploadDoc, getAvailability, setAvailability, getMentorBookings, addBookingNotes, getEarnings, getMentorStats, getMentorNotifs };
