const express = require('express');
const router = express.Router();
const multer = require('multer');
const { authenticate, optionalAuth } = require('../middleware/auth');
const { roleGuard } = require('../middleware/roleGuard');
const user = require('../controllers/user.controller');
const privacy = require('../controllers/privacy.controller');

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

// Public Profile & Follow Status (unauthenticated or authenticated)
router.get('/profile/:identifier', optionalAuth, user.getPublicProfileCard);
router.get('/:id/follow-status', optionalAuth, user.getFollowStatus);

router.use(authenticate);
router.use(roleGuard('SUPER_ADMIN', 'ADMIN', 'MENTOR', 'STUDENT'));

router.get('/me', user.getProfile);
router.put('/me', upload.single('avatar'), user.updateProfile);
router.delete('/me/avatar', user.removeAvatar);
router.delete('/avatar', user.removeAvatar);

// Cover Banner
router.put('/me/banner', upload.single('banner'), user.updateBanner);
router.delete('/me/banner', user.removeBanner);

// Languages Spoken (Section 11)
router.get('/me/languages', user.getUserLanguages);
router.put('/me/languages', user.updateUserLanguages);

// Follow / Unfollow
router.post('/:id/follow', user.followUser);
router.post('/:id/unfollow', user.unfollowUser);
router.delete('/:id/follow', user.unfollowUser);
router.put('/me/password', user.changePassword);
router.get('/me/username/check/:username', user.checkUsername);
router.put('/me/username', user.updateUsername);
router.get('/me/bookings', user.getBookings);
router.get('/me/bookings/:id', user.getBookingDetail);
router.post('/me/bookings/:id/cancel', user.cancelBooking);
router.post('/me/bookings/:id/review', user.submitReview);
router.get('/me/notifications', user.getNotifications);
router.get('/me/notifications/analytics', user.getUserNotificationAnalytics);
router.put('/me/notifications/read-all', user.markAllNotificationsRead);
router.put('/me/notifications/:id/read', user.markNotificationRead);
router.delete('/me/notifications/:id', user.deleteUserNotification);
router.get('/me/notification-preferences', user.getNotificationPrefs);
router.put('/me/notification-preferences', user.updateNotificationPrefs);
router.post('/me/devices', user.registerUserDevice);
router.delete('/me/devices', user.removeUserDevice);
router.post('/me/complaints', upload.single('proof'), user.submitComplaint);

// DPDP Act 2023 Statutory Privacy Routes
router.get('/me/data-export', privacy.exportPersonalData);
router.get('/me/privacy-preferences', privacy.getPrivacyPreferences);
router.put('/me/privacy-preferences', privacy.updatePrivacyPreferences);
router.delete('/me/ai-memory', privacy.clearAiMemory);
router.post('/me/privacy-grievance', privacy.submitPrivacyGrievance);
router.post('/me/delete-account', privacy.deleteAccount);

module.exports = router;
