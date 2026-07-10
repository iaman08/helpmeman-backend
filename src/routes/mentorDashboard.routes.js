const express = require('express');
const router = express.Router();
const multer = require('multer');
const { authenticate } = require('../middleware/auth');
const { roleGuard } = require('../middleware/roleGuard');
const mentor = require('../controllers/mentor.controller');

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

router.use(authenticate);
router.use(roleGuard('MENTOR'));

router.get('/me', mentor.getOwnProfile);
router.put('/me', mentor.updateOwnProfile);
router.put('/me/avatar', upload.single('avatar'), mentor.updateAvatar);
router.post('/me/docs', upload.single('document'), mentor.uploadDoc);
router.get('/me/availability', mentor.getAvailability);
router.put('/me/availability', mentor.setAvailability);
router.get('/me/bookings', mentor.getMentorBookings);
router.put('/me/bookings/:id/notes', mentor.addBookingNotes);
router.get('/me/earnings', mentor.getEarnings);
router.get('/me/reviews', mentor.getMentorReviews);
router.get('/me/stats', mentor.getMentorStats);
router.get('/me/notifications', mentor.getMentorNotifs);

module.exports = router;
