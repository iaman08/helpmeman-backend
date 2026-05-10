const { PrismaClient } = require('@prisma/client');
const { hashPassword, comparePassword } = require('../utils/hash');
const { uploadImage } = require('../services/upload.service');
const { getUserNotifications, markAsRead, markAllReadForUser } = require('../services/notification.service');
const prisma = new PrismaClient();

async function getProfile(req, res) {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.user.id }, select: { id: true, name: true, email: true, phone: true, avatar: true, role: true, isEmailVerified: true, createdAt: true } });
    res.json({ user });
  } catch (e) { res.status(500).json({ error: 'Failed to get profile' }); }
}

async function updateProfile(req, res) {
  try {
    const { name, phone } = req.body;
    const data = {};
    if (name) data.name = name;
    if (phone !== undefined) data.phone = phone;
    if (req.file) data.avatar = await uploadImage(req.file, 'avatars');
    const user = await prisma.user.update({ where: { id: req.user.id }, data, select: { id: true, name: true, email: true, phone: true, avatar: true } });
    res.json({ user });
  } catch (e) { res.status(500).json({ error: 'Update failed' }); }
}

async function changePassword(req, res) {
  try {
    const { currentPassword, newPassword } = req.body;
    const user = await prisma.user.findUnique({ where: { id: req.user.id } });
    const valid = await comparePassword(currentPassword, user.passwordHash);
    if (!valid) return res.status(400).json({ error: 'Current password incorrect' });
    const passwordHash = await hashPassword(newPassword);
    await prisma.user.update({ where: { id: req.user.id }, data: { passwordHash } });
    res.json({ message: 'Password changed' });
  } catch (e) { res.status(500).json({ error: 'Password change failed' }); }
}

async function getBookings(req, res) {
  try {
    const { status, page = 1, limit = 10 } = req.query;
    const where = { userId: req.user.id };
    if (status) where.status = status;
    const [bookings, total] = await Promise.all([
      prisma.booking.findMany({ where, include: { mentor: { select: { displayName: true, avatar: true, institutionName: true } } }, orderBy: { scheduledAt: 'desc' }, skip: (page - 1) * limit, take: parseInt(limit) }),
      prisma.booking.count({ where }),
    ]);
    res.json({ bookings, total, page: parseInt(page), totalPages: Math.ceil(total / limit) });
  } catch (e) { res.status(500).json({ error: 'Failed to get bookings' }); }
}

async function getBookingDetail(req, res) {
  try {
    const booking = await prisma.booking.findFirst({
      where: { id: req.params.id, userId: req.user.id },
      include: { mentor: { include: { user: { select: { email: true } } } }, review: true },
    });
    if (!booking) return res.status(404).json({ error: 'Booking not found' });
    res.json({ booking });
  } catch (e) { res.status(500).json({ error: 'Failed to get booking' }); }
}

async function cancelBooking(req, res) {
  try {
    const booking = await prisma.booking.findFirst({ where: { id: req.params.id, userId: req.user.id } });
    if (!booking) return res.status(404).json({ error: 'Booking not found' });
    if (booking.status !== 'CONFIRMED' && booking.status !== 'PENDING') return res.status(400).json({ error: 'Cannot cancel this booking' });

    const hoursUntil = (new Date(booking.scheduledAt) - Date.now()) / (1000 * 60 * 60);
    const refundEligible = hoursUntil > 24;

    await prisma.booking.update({
      where: { id: booking.id },
      data: { status: 'CANCELLED', cancelledBy: req.user.id, paymentStatus: refundEligible ? 'REFUNDED' : booking.paymentStatus },
    });
    res.json({ message: 'Booking cancelled', refunded: refundEligible });
  } catch (e) { res.status(500).json({ error: 'Cancellation failed' }); }
}

async function submitReview(req, res) {
  try {
    const { rating, comment } = req.body;
    const booking = await prisma.booking.findFirst({ where: { id: req.params.id, userId: req.user.id, status: 'COMPLETED' } });
    if (!booking) return res.status(400).json({ error: 'Can only review completed sessions' });

    const existingReview = await prisma.review.findUnique({ where: { bookingId: booking.id } });
    if (existingReview) return res.status(400).json({ error: 'Already reviewed' });

    const review = await prisma.review.create({ data: { bookingId: booking.id, userId: req.user.id, mentorId: booking.mentorId, rating, comment } });

    // Update mentor average rating
    const reviews = await prisma.review.findMany({ where: { mentorId: booking.mentorId, isVisible: true } });
    const avgRating = reviews.reduce((sum, r) => sum + r.rating, 0) / reviews.length;
    await prisma.mentor.update({ where: { id: booking.mentorId }, data: { rating: Math.round(avgRating * 10) / 10 } });

    res.json({ review });
  } catch (e) { res.status(500).json({ error: 'Review failed' }); }
}

async function getNotifications(req, res) {
  try {
    const result = await getUserNotifications(req.user.id, req.query);
    res.json(result);
  } catch (e) { res.status(500).json({ error: 'Failed to get notifications' }); }
}

async function markNotificationRead(req, res) {
  try { await markAsRead(req.params.id); res.json({ message: 'Marked as read' }); }
  catch (e) { res.status(500).json({ error: 'Failed' }); }
}

async function markAllNotificationsRead(req, res) {
  try { await markAllReadForUser(req.user.id); res.json({ message: 'All marked as read' }); }
  catch (e) { res.status(500).json({ error: 'Failed' }); }
}

module.exports = { getProfile, updateProfile, changePassword, getBookings, getBookingDetail, cancelBooking, submitReview, getNotifications, markNotificationRead, markAllNotificationsRead };
