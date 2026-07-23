const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth');
const { roleGuard } = require('../middleware/roleGuard');
const platformReview = require('../controllers/platformReview.controller');

// ── Public Routes (Landing Page Testimonials) ──────────────────────────────
router.get('/public', platformReview.getPublicPlatformReviews);

// ── Authenticated User Routes ──────────────────────────────────────────────
router.use(authenticate);

router.post('/', platformReview.submitPlatformReview);
router.get('/my', platformReview.getMyPlatformReview);
router.delete('/my', platformReview.deleteMyPlatformReview);
router.post('/dismiss', platformReview.dismissPrompt);

// ── Admin Moderation Routes ────────────────────────────────────────────────
router.get('/admin', roleGuard('SUPER_ADMIN', 'ADMIN'), platformReview.adminGetPlatformReviews);
router.get('/admin/export', roleGuard('SUPER_ADMIN', 'ADMIN'), platformReview.adminExportPlatformReviews);
router.patch('/admin/:id', roleGuard('SUPER_ADMIN', 'ADMIN'), platformReview.adminUpdatePlatformReview);
router.delete('/admin/:id', roleGuard('SUPER_ADMIN', 'ADMIN'), platformReview.adminDeletePlatformReview);

module.exports = router;
