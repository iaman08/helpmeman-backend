const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth');
const { roleGuard } = require('../middleware/roleGuard');
const review = require('../controllers/review.controller');

// ── Public routes (no auth needed) ─────────────────────────────────────────
router.get('/mentor/:mentorId', review.getMentorReviews);
router.get('/mentor/:mentorId/stats', review.getMentorRatingStats);

// ── Authenticated routes ─────────────────────────────────────────────────────
router.use(authenticate);

router.post('/', review.submitReview);
router.get('/pending', review.getPendingReviews);
router.get('/mentor/:mentorId/my', review.getMyReviewForMentor);
router.patch('/:id', review.editReview);

// ── Admin-only routes ────────────────────────────────────────────────────────
router.get('/admin', roleGuard('SUPER_ADMIN', 'ADMIN'), review.adminGetReviews);
router.delete('/:id', roleGuard('SUPER_ADMIN', 'ADMIN'), review.deleteReview);

module.exports = router;
