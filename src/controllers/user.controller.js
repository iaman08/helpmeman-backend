const { PrismaClient } = require('@prisma/client');
const { hashPassword, comparePassword } = require('../utils/hash');
const { uploadImage } = require('../services/upload.service');
const { getUserNotifications, markAsRead, markAllReadForUser, deleteNotification, getNotificationAnalytics, registerDevice, removeDevice, updatePreferences, getPreferences } = require('../services/notification.service');
const { saveUserToFirestore, getUserFromFirestore, isUsernameAvailable, setUsername } = require('../services/firestore.service');
const prisma = new PrismaClient();

async function getProfile(req, res) {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.user.id }, select: { id: true, name: true, email: true, phone: true, avatar: true, role: true, isEmailVerified: true, createdAt: true } });

    // Enrich with Firestore data (username, etc.)
    let firestoreData = null;
    try { firestoreData = await getUserFromFirestore(req.user.id); } catch (e) { /* silent */ }

    const enrichedUser = {
      ...user,
      name: firestoreData?.name || user.name,
      phone: firestoreData?.phone || user.phone || null,
      avatar: firestoreData?.avatar || user.avatar || null,
      username: firestoreData?.username || null,
      currentRole: firestoreData?.currentRole || null,
    };

    res.json({ user: enrichedUser });
  } catch (e) { res.status(500).json({ error: 'Failed to get profile' }); }
}

async function updateProfile(req, res) {
  try {
    const { name, phone, username, currentRole } = req.body;
    const data = {};
    if (name) data.name = name;
    if (phone !== undefined) data.phone = phone;
    if (req.file) data.avatar = await uploadImage(req.file, 'avatars');
    
    // Update basic info in Postgres
    const user = await prisma.user.update({ where: { id: req.user.id }, data, select: { id: true, name: true, email: true, phone: true, avatar: true } });

    // Handle Username Uniqueness (if requested)
    if (username) {
      const usernameResult = await setUsername(req.user.id, username);
      if (!usernameResult.success) {
        return res.status(400).json({ error: usernameResult.error });
      }
    }

    // Prepare Firestore Extra Data
    const extraData = {};
    if (currentRole !== undefined) extraData.currentRole = currentRole;

    // Sync updated profile to Firestore
    try { await saveUserToFirestore({ id: req.user.id, ...data }, extraData); } catch (e) { console.warn('Firestore sync failed (updateProfile):', e.message); }

    // Fetch final enriched user
    let firestoreData = null;
    try { firestoreData = await getUserFromFirestore(req.user.id); } catch (e) { /* silent */ }

    const enrichedUser = {
      ...user,
      name: firestoreData?.name || user.name,
      phone: firestoreData?.phone || user.phone || null,
      avatar: firestoreData?.avatar || user.avatar || null,
      username: firestoreData?.username || null,
      currentRole: firestoreData?.currentRole || null,
    };

    res.json({ user: enrichedUser });
  } catch (e) { console.error('Update failed:', e); res.status(500).json({ error: 'Update failed' }); }
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
  try {
    const updated = await markAsRead(req.params.id, req.user.id);
    if (!updated) return res.status(404).json({ error: 'Notification not found' });
    res.json({ message: 'Marked as read', notification: updated });
  }
  catch (e) { res.status(500).json({ error: 'Failed' }); }
}

async function deleteUserNotification(req, res) {
  try {
    const deleted = await deleteNotification(req.params.id, req.user.id);
    if (!deleted) return res.status(404).json({ error: 'Notification not found' });
    res.json({ message: 'Notification deleted' });
  } catch (e) { res.status(500).json({ error: 'Failed to delete notification' }); }
}

async function getNotificationPrefs(req, res) {
  try {
    const preferences = await getPreferences(req.user.id);
    res.json({ preferences });
  } catch (e) { res.status(500).json({ error: 'Failed to load preferences' }); }
}

async function updateNotificationPrefs(req, res) {
  try {
    const allowed = [
      'emailNotifications',
      'pushNotifications',
      'marketingEmails',
      'accountUpdates',
      'messages',
      'mentorUpdates',
    ];
    const data = {};
    for (const key of allowed) {
      if (typeof req.body[key] === 'boolean') data[key] = req.body[key];
    }
    const preferences = await updatePreferences(req.user.id, data);
    res.json({ preferences });
  } catch (e) { res.status(500).json({ error: 'Failed to update preferences' }); }
}

async function registerUserDevice(req, res) {
  try {
    const { fcmToken, deviceType = 'web' } = req.body;
    if (!fcmToken) return res.status(400).json({ error: 'FCM token required' });
    const device = await registerDevice(req.user.id, fcmToken, deviceType);
    res.json({ device });
  } catch (e) { res.status(500).json({ error: 'Failed to register device' }); }
}

async function removeUserDevice(req, res) {
  try {
    const { fcmToken } = req.body;
    if (!fcmToken) return res.status(400).json({ error: 'FCM token required' });
    await removeDevice(req.user.id, fcmToken);
    res.json({ message: 'Device removed' });
  } catch (e) { res.status(500).json({ error: 'Failed to remove device' }); }
}

async function getUserNotificationAnalytics(req, res) {
  try {
    const analytics = await getNotificationAnalytics(req.user.id);
    res.json({ analytics });
  } catch (e) { res.status(500).json({ error: 'Failed to load analytics' }); }
}

async function markAllNotificationsRead(req, res) {
  try { await markAllReadForUser(req.user.id); res.json({ message: 'All marked as read' }); }
  catch (e) { res.status(500).json({ error: 'Failed' }); }
}

async function checkUsername(req, res) {
  try {
    const { username } = req.params;
    if (!username || username.length < 3) {
      return res.status(400).json({ available: false, error: 'Username must be at least 3 characters' });
    }
    const available = await isUsernameAvailable(username.toLowerCase());
    res.json({ available, username: username.toLowerCase() });
  } catch (e) { res.status(500).json({ error: 'Username check failed' }); }
}

async function updateUsername(req, res) {
  try {
    const { username } = req.body;
    const result = await setUsername(req.user.id, username);
    if (!result.success) {
      return res.status(400).json({ error: result.error });
    }
    res.json({ message: 'Username updated', username: username.toLowerCase() });
  } catch (e) { res.status(500).json({ error: 'Username update failed' }); }
}

module.exports = {
  getProfile,
  updateProfile,
  changePassword,
  getBookings,
  getBookingDetail,
  cancelBooking,
  submitReview,
  getNotifications,
  markNotificationRead,
  markAllNotificationsRead,
  deleteUserNotification,
  getNotificationPrefs,
  updateNotificationPrefs,
  registerUserDevice,
  removeUserDevice,
  getUserNotificationAnalytics,
  checkUsername,
  updateUsername,
};
