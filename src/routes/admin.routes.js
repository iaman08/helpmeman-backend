const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth');
const { roleGuard } = require('../middleware/roleGuard');
const admin = require('../controllers/admin.controller');

router.use(authenticate);
router.use(roleGuard('ADMIN'));

router.get('/dashboard', admin.getDashboard);
router.get('/mentors/pending', admin.getPendingMentors);
router.get('/mentors/:id', admin.getMentorDetail);
router.post('/mentors/:id/approve', admin.approveMentorHandler);
router.post('/mentors/:id/reject', admin.rejectMentorHandler);
router.get('/mentors', admin.getAllMentors);
router.put('/mentors/:id/toggle-active', admin.toggleMentorActive);
router.get('/users', admin.getAllUsers);
router.get('/bookings', admin.getAllBookings);
router.get('/categories', admin.getCategories);
router.post('/categories', admin.createCategory);
router.put('/categories/:id', admin.updateCategory);
router.get('/earnings', admin.getEarnings);
router.get('/reviews', admin.getAllReviews);
router.get('/chats/stats', admin.getChatStats);

module.exports = router;
