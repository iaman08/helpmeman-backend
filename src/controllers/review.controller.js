/**
 * Review Controller
 *
 * Endpoints:
 * POST   /api/reviews              — Submit a review (mentee only, completed booking, once per booking)
 * GET    /api/reviews/pending      — Check logged-in user's unreviewed completed bookings
 * GET    /api/reviews/mentor/:id   — Public paginated reviews for a mentor
 * GET    /api/reviews/mentor/:id/stats — Aggregate rating stats
 * PATCH  /api/reviews/:id          — Edit review (own, within 24h)
 * DELETE /api/reviews/:id          — Admin delete
 * GET    /api/reviews/admin        — Admin: all reviews with filters
 */

const prisma = require('../config/prisma');
const { sendNotification } = require('../services/notification.service');
const { randomUUID } = require('crypto');

// ── Helpers ─────────────────────────────────────────────────────────────────

/** Recalculate and persist aggregate rating stats on the Mentor row */
async function recalculateMentorRating(mentorId) {
  const reviews = await prisma.$queryRawUnsafe(
    `SELECT rating FROM "MentorReview" WHERE "mentorId" = $1`,
    mentorId
  );

  const total = reviews.length;
  if (total === 0) {
    await prisma.$executeRawUnsafe(
      `UPDATE "Mentor" SET "avgRating" = 0, "totalReviews" = 0,
       "ratingDistribution" = '{"1":0,"2":0,"3":0,"4":0,"5":0}'::jsonb
       WHERE id = $1`,
      mentorId
    );
    return;
  }

  const dist = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  let sum = 0;
  for (const r of reviews) {
    sum += r.rating;
    dist[r.rating] = (dist[r.rating] || 0) + 1;
  }
  const avg = Math.round((sum / total) * 10) / 10;

  await prisma.$executeRawUnsafe(
    `UPDATE "Mentor"
     SET "avgRating" = $1,
         "totalReviews" = $2,
         "ratingDistribution" = $3::jsonb
     WHERE id = $4`,
    avg,
    total,
    JSON.stringify(dist),
    mentorId
  );
}

// ── POST /api/reviews ────────────────────────────────────────────────────────
async function submitReview(req, res) {
  try {
    const userId = req.user.id;
    const { bookingId, rating, feedback, tags, anonymous } = req.body;

    if (!bookingId || !rating) {
      return res.status(400).json({ error: 'bookingId and rating are required' });
    }
    if (rating < 1 || rating > 5 || !Number.isInteger(Number(rating))) {
      return res.status(400).json({ error: 'Rating must be an integer from 1 to 5' });
    }

    // Fetch the booking
    const [booking] = await prisma.$queryRawUnsafe(
      `SELECT b.id, b."mentorId", b."userId", b.status, m."userId" as "mentorUserId"
       FROM "Booking" b
       JOIN "Mentor" m ON m.id = b."mentorId"
       WHERE b.id = $1`,
      bookingId
    );

    if (!booking) return res.status(404).json({ error: 'Booking not found' });
    if (booking.userId !== userId) return res.status(403).json({ error: 'Not your booking' });
    if (booking.status !== 'COMPLETED') return res.status(400).json({ error: 'Session must be completed before reviewing' });
    if (booking.mentorUserId === userId) return res.status(400).json({ error: 'You cannot review yourself' });

    // Check duplicate
    const [existing] = await prisma.$queryRawUnsafe(
      `SELECT id FROM "MentorReview" WHERE "bookingId" = $1`,
      bookingId
    );
    if (existing) return res.status(409).json({ error: 'You have already reviewed this session' });

    const id = randomUUID();
    const tagsArray = Array.isArray(tags) ? tags.slice(0, 10) : [];
    const isAnon = Boolean(anonymous);
    const feedbackText = feedback ? String(feedback).slice(0, 500) : null;

    await prisma.$executeRawUnsafe(
      `INSERT INTO "MentorReview" (id, "bookingId", "mentorId", "userId", rating, feedback, tags, anonymous, "createdAt", "updatedAt")
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW(), NOW())`,
      id,
      bookingId,
      booking.mentorId,
      userId,
      Number(rating),
      feedbackText,
      tagsArray,
      isAnon
    );

    // Update aggregates asynchronously
    recalculateMentorRating(booking.mentorId).catch(console.error);

    // Notify the mentor
    const notifMessage = isAnon
      ? `You received a new ${rating}-star anonymous review.`
      : `You received a new ${rating}-star review from a mentee.`;
    sendNotification({
      mentorId: booking.mentorId,
      type: 'REVIEW_RECEIVED',
      title: `New ${rating}★ Review`,
      message: notifMessage,
      actionUrl: '/mentor/reviews',
    }).catch(() => {});

    return res.status(201).json({ success: true, reviewId: id });
  } catch (err) {
    console.error('[Review] submitReview error:', err);
    return res.status(500).json({ error: 'Failed to submit review' });
  }
}

// ── GET /api/reviews/pending ─────────────────────────────────────────────────
async function getPendingReviews(req, res) {
  try {
    const userId = req.user.id;
    const pending = await prisma.$queryRawUnsafe(
      `SELECT b.id as "bookingId", b."scheduledAt", b."durationMinutes",
              m."displayName", m."avatar", m.id as "mentorId"
       FROM "Booking" b
       JOIN "Mentor" m ON m.id = b."mentorId"
       WHERE b."userId" = $1
         AND b.status = 'COMPLETED'
         AND NOT EXISTS (
           SELECT 1 FROM "MentorReview" r WHERE r."bookingId" = b.id
         )
       ORDER BY b."scheduledAt" DESC
       LIMIT 5`,
      userId
    );
    return res.json({ pending });
  } catch (err) {
    console.error('[Review] getPendingReviews error:', err);
    return res.status(500).json({ error: 'Failed to fetch pending reviews' });
  }
}

// ── GET /api/reviews/mentor/:mentorId ────────────────────────────────────────
async function getMentorReviews(req, res) {
  try {
    const { mentorId } = req.params;
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

    return res.json({
      reviews,
      total,
      page,
      pages: Math.ceil(total / limit),
    });
  } catch (err) {
    console.error('[Review] getMentorReviews error:', err);
    return res.status(500).json({ error: 'Failed to fetch reviews' });
  }
}

// ── GET /api/reviews/mentor/:mentorId/stats ──────────────────────────────────
async function getMentorRatingStats(req, res) {
  try {
    const { mentorId } = req.params;
    const [mentor] = await prisma.$queryRawUnsafe(
      `SELECT "avgRating", "totalReviews", "ratingDistribution"
       FROM "Mentor" WHERE id = $1`,
      mentorId
    );
    if (!mentor) return res.status(404).json({ error: 'Mentor not found' });
    return res.json({
      avgRating: mentor.avgRating,
      totalReviews: mentor.totalReviews,
      distribution: mentor.ratingDistribution,
    });
  } catch (err) {
    console.error('[Review] getMentorRatingStats error:', err);
    return res.status(500).json({ error: 'Failed to fetch rating stats' });
  }
}

// ── PATCH /api/reviews/:id ───────────────────────────────────────────────────
async function editReview(req, res) {
  try {
    const userId = req.user.id;
    const { id } = req.params;
    const { rating, feedback, tags, anonymous } = req.body;

    const [review] = await prisma.$queryRawUnsafe(
      `SELECT * FROM "MentorReview" WHERE id = $1`,
      id
    );
    if (!review) return res.status(404).json({ error: 'Review not found' });
    if (review.userId !== userId) return res.status(403).json({ error: 'Not your review' });

    // 24 hour edit window
    const hoursElapsed = (Date.now() - new Date(review.createdAt).getTime()) / 3600000;
    if (hoursElapsed > 24) {
      return res.status(403).json({ error: 'Reviews can only be edited within 24 hours of submission' });
    }

    const newRating = rating !== undefined ? Number(rating) : review.rating;
    if (newRating < 1 || newRating > 5) return res.status(400).json({ error: 'Rating must be 1–5' });

    const newFeedback = feedback !== undefined ? String(feedback).slice(0, 500) : review.feedback;
    const newTags = Array.isArray(tags) ? tags.slice(0, 10) : review.tags;
    const newAnon = anonymous !== undefined ? Boolean(anonymous) : review.anonymous;

    await prisma.$executeRawUnsafe(
      `UPDATE "MentorReview"
       SET rating = $1, feedback = $2, tags = $3, anonymous = $4, "updatedAt" = NOW()
       WHERE id = $5`,
      newRating,
      newFeedback,
      newTags,
      newAnon,
      id
    );

    recalculateMentorRating(review.mentorId).catch(console.error);

    return res.json({ success: true });
  } catch (err) {
    console.error('[Review] editReview error:', err);
    return res.status(500).json({ error: 'Failed to edit review' });
  }
}

// ── DELETE /api/reviews/:id (admin) ──────────────────────────────────────────
async function deleteReview(req, res) {
  try {
    const { id } = req.params;
    const [review] = await prisma.$queryRawUnsafe(
      `SELECT "mentorId" FROM "MentorReview" WHERE id = $1`,
      id
    );
    if (!review) return res.status(404).json({ error: 'Review not found' });

    await prisma.$executeRawUnsafe(
      `DELETE FROM "MentorReview" WHERE id = $1`,
      id
    );
    recalculateMentorRating(review.mentorId).catch(console.error);

    return res.json({ success: true });
  } catch (err) {
    console.error('[Review] deleteReview error:', err);
    return res.status(500).json({ error: 'Failed to delete review' });
  }
}

// ── GET /api/reviews/admin ───────────────────────────────────────────────────
async function adminGetReviews(req, res) {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(50, parseInt(req.query.limit) || 20);
    const offset = (page - 1) * limit;
    const mentorId = req.query.mentorId || null;
    const search = req.query.search ? `%${req.query.search}%` : null;
    const minRating = req.query.minRating ? parseInt(req.query.minRating) : null;
    const maxRating = req.query.maxRating ? parseInt(req.query.maxRating) : null;

    let where = 'WHERE 1=1';
    const params = [];
    let idx = 1;

    if (mentorId) { where += ` AND r."mentorId" = $${idx++}`; params.push(mentorId); }
    if (search) { where += ` AND (r.feedback ILIKE $${idx++} OR u.name ILIKE $${idx++})`; params.push(search, search); idx--; idx++; }
    if (minRating) { where += ` AND r.rating >= $${idx++}`; params.push(minRating); }
    if (maxRating) { where += ` AND r.rating <= $${idx++}`; params.push(maxRating); }

    const countQuery = `SELECT COUNT(*) as total FROM "MentorReview" r JOIN "User" u ON u.id = r."userId" ${where}`;
    const [countRow] = await prisma.$queryRawUnsafe(countQuery, ...params);
    const total = Number(countRow?.total ?? 0);

    const dataQuery = `
      SELECT r.id, r.rating, r.feedback, r.tags, r.anonymous, r."createdAt",
             u.name as "userName", u.email as "userEmail",
             m."displayName" as "mentorName", m.id as "mentorId"
      FROM "MentorReview" r
      JOIN "User" u ON u.id = r."userId"
      JOIN "Mentor" m ON m.id = r."mentorId"
      ${where}
      ORDER BY r."createdAt" DESC
      LIMIT $${idx++} OFFSET $${idx++}
    `;
    const reviews = await prisma.$queryRawUnsafe(dataQuery, ...params, limit, offset);

    return res.json({ reviews, total, page, pages: Math.ceil(total / limit) });
  } catch (err) {
    console.error('[Review] adminGetReviews error:', err);
    return res.status(500).json({ error: 'Failed to fetch reviews' });
  }
}

// ── GET /api/reviews/mentor/:mentorId/my ─────────────────────────────────────
// Returns the current user's review for this mentor (for "edit" flow)
async function getMyReviewForMentor(req, res) {
  try {
    const userId = req.user.id;
    const { mentorId } = req.params;
    const [review] = await prisma.$queryRawUnsafe(
      `SELECT r.* FROM "MentorReview" r
       WHERE r."mentorId" = $1 AND r."userId" = $2
       ORDER BY r."createdAt" DESC LIMIT 1`,
      mentorId,
      userId
    );
    return res.json({ review: review || null });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to fetch your review' });
  }
}

module.exports = {
  submitReview,
  getPendingReviews,
  getMentorReviews,
  getMentorRatingStats,
  editReview,
  deleteReview,
  adminGetReviews,
  getMyReviewForMentor,
};
