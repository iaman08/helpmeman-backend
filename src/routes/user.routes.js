const express = require('express');
const router = express.Router();
const multer = require('multer');
const { authenticate } = require('../middleware/auth');
const { roleGuard } = require('../middleware/roleGuard');
const user = require('../controllers/user.controller');

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

router.use(authenticate);
router.use(roleGuard('USER', 'MENTOR', 'ADMIN'));

router.get('/me', user.getProfile);
router.put('/me', upload.single('avatar'), user.updateProfile);
router.put('/me/password', user.changePassword);
router.get('/me/username/check/:username', user.checkUsername);
router.put('/me/username', user.updateUsername);
router.get('/me/bookings', user.getBookings);
router.get('/me/bookings/:id', user.getBookingDetail);
router.post('/me/bookings/:id/cancel', user.cancelBooking);
router.post('/me/bookings/:id/review', user.submitReview);
router.get('/me/notifications', user.getNotifications);
router.put('/me/notifications/:id/read', user.markNotificationRead);
router.put('/me/notifications/read-all', user.markAllNotificationsRead);

module.exports = router;
