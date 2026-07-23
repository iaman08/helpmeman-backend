const prisma = require('../config/prisma');
const crypto = require('crypto');

// ── Submit or Edit Platform Review ─────────────────────────────────────────
exports.submitPlatformReview = async (req, res) => {
  try {
    const userId = req.user.id;
    const { rating, feedback, tags = [], anonymous = false } = req.body;

    if (!rating || typeof rating !== 'number' || rating < 1 || rating > 5) {
      return res.status(400).json({ error: 'Rating must be an integer between 1 and 5.' });
    }

    const cleanFeedback = feedback ? String(feedback).trim().slice(0, 1000) : null;
    const cleanTags = Array.isArray(tags) ? tags.map((t) => String(t).trim()).filter(Boolean).slice(0, 10) : [];
    const isAnon = Boolean(anonymous);
    const now = new Date();

    const existingRows = await prisma.$queryRawUnsafe(
      `SELECT * FROM "PlatformReview" WHERE "userId" = $1 LIMIT 1`,
      userId
    );
    const existing = existingRows[0] || null;

    let review;
    if (existing) {
      await prisma.$executeRawUnsafe(
        `UPDATE "PlatformReview" SET "rating" = $1, "feedback" = $2, "tags" = $3, "anonymous" = $4, "approved" = true, "updatedAt" = $5 WHERE "id" = $6`,
        rating, cleanFeedback, cleanTags, isAnon, now, existing.id
      );
      review = { ...existing, rating, feedback: cleanFeedback, tags: cleanTags, anonymous: isAnon, approved: true, updatedAt: now };
    } else {
      const newId = 'pr_' + crypto.randomBytes(12).toString('hex');
      await prisma.$executeRawUnsafe(
        `INSERT INTO "PlatformReview" ("id", "userId", "rating", "feedback", "tags", "anonymous", "approved", "featured", "createdAt", "updatedAt") VALUES ($1, $2, $3, $4, $5, $6, true, false, $7, $8)`,
        newId, userId, rating, cleanFeedback, cleanTags, isAnon, now, now
      );
      review = { id: newId, userId, rating, feedback: cleanFeedback, tags: cleanTags, anonymous: isAnon, approved: true, featured: false, createdAt: now, updatedAt: now };
    }

    await prisma.$executeRawUnsafe(
      `UPDATE "User" SET "platformReviewSubmitted" = true, "reviewCooldownUntil" = NULL WHERE "id" = $1`,
      userId
    );

    return res.json({
      success: true,
      message: existing ? 'Review updated successfully!' : 'Thank you for your feedback!',
      review,
    });
  } catch (error) {
    console.error('[PlatformReview] submit error:', error);
    return res.status(500).json({ error: 'Failed to submit platform review.' });
  }
};

// ── Get My Platform Review & Prompt State ─────────────────────────────────
exports.getMyPlatformReview = async (req, res) => {
  try {
    const userId = req.user.id;

    const userRows = await prisma.$queryRawUnsafe(
      `SELECT "id", COALESCE("platformReviewSubmitted", false) AS "platformReviewSubmitted", "lastReviewPromptAt", COALESCE("reviewPromptDismissCount", 0) AS "reviewPromptDismissCount", "reviewCooldownUntil" FROM "User" WHERE "id" = $1 LIMIT 1`,
      userId
    );
    const userObj = userRows[0] || null;

    if (!userObj) {
      return res.status(404).json({ error: 'User not found.' });
    }

    const reviewRows = await prisma.$queryRawUnsafe(
      `SELECT * FROM "PlatformReview" WHERE "userId" = $1 LIMIT 1`,
      userId
    );
    const review = reviewRows[0] || null;

    const bRows = await prisma.$queryRawUnsafe(
      `SELECT COUNT(*)::int as count FROM "Booking" WHERE "userId" = $1 AND "status" = 'COMPLETED'`,
      userId
    );
    const completedBookingsCount = parseInt(bRows[0]?.count || '0', 10);

    return res.json({
      review: review || null,
      platformReviewSubmitted: Boolean(userObj.platformReviewSubmitted),
      reviewCooldownUntil: userObj.reviewCooldownUntil || null,
      lastReviewPromptAt: userObj.lastReviewPromptAt || null,
      dismissCount: Number(userObj.reviewPromptDismissCount || 0),
      completedBookingsCount,
    });
  } catch (error) {
    console.error('[PlatformReview] getMy error:', error);
    return res.status(500).json({ error: 'Failed to fetch user platform review.' });
  }
};

// ── Delete My Platform Review ──────────────────────────────────────────────
exports.deleteMyPlatformReview = async (req, res) => {
  try {
    const userId = req.user.id;

    await prisma.$executeRawUnsafe(`DELETE FROM "PlatformReview" WHERE "userId" = $1`, userId);
    await prisma.$executeRawUnsafe(`UPDATE "User" SET "platformReviewSubmitted" = false WHERE "id" = $1`, userId);

    return res.json({
      success: true,
      message: 'Platform review deleted successfully.',
    });
  } catch (error) {
    console.error('[PlatformReview] deleteMy error:', error);
    return res.status(500).json({ error: 'Failed to delete platform review.' });
  }
};

// ── Dismiss Prompt (Maybe Later / No Thanks) ──────────────────────────────
exports.dismissPrompt = async (req, res) => {
  try {
    const userId = req.user.id;
    const { action } = req.body;

    let cooldownDays = action === 'no_thanks' ? 90 : 14;
    const cooldownUntil = new Date(Date.now() + cooldownDays * 24 * 60 * 60 * 1000);
    const now = new Date();

    await prisma.$executeRawUnsafe(
      `UPDATE "User" SET "lastReviewPromptAt" = $1, "reviewPromptDismissCount" = COALESCE("reviewPromptDismissCount", 0) + 1, "reviewCooldownUntil" = $2 WHERE "id" = $3`,
      now, cooldownUntil, userId
    );

    return res.json({
      success: true,
      action,
      cooldownUntil,
    });
  } catch (error) {
    console.error('[PlatformReview] dismiss error:', error);
    return res.status(500).json({ error: 'Failed to dismiss review prompt.' });
  }
};

// ── Public Approved Platform Reviews for Landing Page ──────────────────────
exports.getPublicPlatformReviews = async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 30, 100);

    const reviews = await prisma.$queryRawUnsafe(
      `SELECT r.id, r.rating, r.feedback, r.tags, r.anonymous, r.approved, r.featured, r."createdAt", u.name, u.avatar, u."currentRole"
       FROM "PlatformReview" r
       LEFT JOIN "User" u ON r."userId" = u.id
       ORDER BY r.featured DESC, r."createdAt" DESC
       LIMIT $1`,
      limit
    );

    const statsRows = await prisma.$queryRawUnsafe(
      `SELECT AVG(rating) as avg_rating, COUNT(id) as total_reviews FROM "PlatformReview"`
    );

    const avgRatingRaw = statsRows[0]?.avg_rating;
    const averageRating = avgRatingRaw ? Number(Number(avgRatingRaw).toFixed(1)) : 5.0;
    const totalReviews = parseInt(statsRows[0]?.total_reviews || '0', 10);

    const formattedReviews = (reviews || []).map((r) => {
      const isAnon = r.anonymous;
      return {
        id: r.id,
        rating: r.rating,
        feedback: r.feedback,
        tags: r.tags || [],
        createdAt: r.createdAt,
        verified: true,
        featured: r.featured,
        name: isAnon ? 'Verified Mentee' : (r.name || 'HelpMeMan User'),
        avatar: isAnon ? null : (r.avatar || null),
        role: isAnon ? 'HelpMeMan Community Member' : (r.currentRole || 'Student & Learner'),
      };
    });

    return res.json({
      reviews: formattedReviews,
      stats: {
        averageRating,
        totalReviews,
      },
    });
  } catch (error) {
    console.error('[PlatformReview] getPublic error:', error);
    return res.status(500).json({ error: 'Failed to fetch public platform reviews.' });
  }
};

// ── Admin: Get All Reviews with Search and Filters ──────────────────────────
exports.adminGetPlatformReviews = async (req, res) => {
  try {
    const page = Math.max(parseInt(req.query.page) || 1, 1);
    const limit = Math.min(parseInt(req.query.limit) || 20, 100);
    const offset = (page - 1) * limit;

    const { search, rating, approved, featured } = req.query;

    let whereConditions = [];
    let params = [];
    let paramIdx = 1;

    if (rating && rating !== 'ALL') {
      whereConditions.push(`r.rating = $${paramIdx++}`);
      params.push(parseInt(rating));
    }

    if (approved === 'true') {
      whereConditions.push(`r.approved = true`);
    } else if (approved === 'false') {
      whereConditions.push(`r.approved = false`);
    }

    if (featured === 'true') {
      whereConditions.push(`r.featured = true`);
    } else if (featured === 'false') {
      whereConditions.push(`r.featured = false`);
    }

    if (search && search.trim()) {
      whereConditions.push(`(r.feedback ILIKE $${paramIdx} OR u.name ILIKE $${paramIdx} OR u.email ILIKE $${paramIdx})`);
      params.push(`%${search.trim()}%`);
      paramIdx++;
    }

    const whereClause = whereConditions.length > 0 ? `WHERE ${whereConditions.join(' AND ')}` : '';

    const listQuery = `
      SELECT r.id, r.rating, r.feedback, r.tags, r.anonymous, r.approved, r.featured, r."createdAt", r."updatedAt",
             u.id as "userId", u.name as "userName", u.email as "userEmail", u.avatar as "userAvatar", u.role as "userRole"
      FROM "PlatformReview" r
      LEFT JOIN "User" u ON r."userId" = u.id
      ${whereClause}
      ORDER BY r."createdAt" DESC
      LIMIT $${paramIdx++} OFFSET $${paramIdx++}
    `;

    const countQuery = `
      SELECT COUNT(r.id) as total
      FROM "PlatformReview" r
      LEFT JOIN "User" u ON r."userId" = u.id
      ${whereClause}
    `;

    const [rows, countRows, totalAllRows, approvedRows, featuredRows, avgRows] = await Promise.all([
      prisma.$queryRawUnsafe(listQuery, ...params, limit, offset),
      prisma.$queryRawUnsafe(countQuery, ...params),
      prisma.$queryRawUnsafe(`SELECT COUNT(*) as total FROM "PlatformReview"`),
      prisma.$queryRawUnsafe(`SELECT COUNT(*) as total FROM "PlatformReview" WHERE approved = true`),
      prisma.$queryRawUnsafe(`SELECT COUNT(*) as total FROM "PlatformReview" WHERE featured = true`),
      prisma.$queryRawUnsafe(`SELECT AVG(rating) as avg_rating FROM "PlatformReview"`),
    ]);

    const totalCount = parseInt(countRows[0]?.total || '0', 10);
    const reviews = (rows || []).map((r) => ({
      id: r.id,
      rating: r.rating,
      feedback: r.feedback,
      tags: r.tags || [],
      anonymous: r.anonymous,
      approved: r.approved,
      featured: r.featured,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
      user: {
        id: r.userId,
        name: r.userName || 'Unknown',
        email: r.userEmail || '',
        avatar: r.userAvatar || null,
        role: r.userRole || 'STUDENT',
      },
    }));

    return res.json({
      reviews,
      pagination: {
        page,
        limit,
        totalCount,
        totalPages: Math.ceil(totalCount / limit) || 1,
      },
      stats: {
        totalReviews: parseInt(totalAllRows[0]?.total || '0', 10),
        approvedCount: parseInt(approvedRows[0]?.total || '0', 10),
        featuredCount: parseInt(featuredRows[0]?.total || '0', 10),
        avgRating: avgRows[0]?.avg_rating ? Number(Number(avgRows[0].avg_rating).toFixed(1)) : 0,
      },
    });
  } catch (error) {
    console.error('[PlatformReview] adminGet error:', error);
    return res.status(500).json({ error: 'Failed to fetch admin platform reviews.' });
  }
};

// ── Admin: Update Review (Approve/Hide/Feature) ─────────────────────────────
exports.adminUpdatePlatformReview = async (req, res) => {
  try {
    const { id } = req.params;
    const { approved, featured } = req.body;

    const updates = [];
    const params = [];
    let idx = 1;

    if (typeof approved === 'boolean') {
      updates.push(`"approved" = $${idx++}`);
      params.push(approved);
    }
    if (typeof featured === 'boolean') {
      updates.push(`"featured" = $${idx++}`);
      params.push(featured);
    }

    if (updates.length === 0) {
      return res.status(400).json({ error: 'No update fields provided.' });
    }

    updates.push(`"updatedAt" = $${idx++}`);
    params.push(new Date());

    params.push(id);
    await prisma.$executeRawUnsafe(
      `UPDATE "PlatformReview" SET ${updates.join(', ')} WHERE "id" = $${idx}`,
      ...params
    );

    const rows = await prisma.$queryRawUnsafe(
      `SELECT r.*, u.name as "userName", u.email as "userEmail" FROM "PlatformReview" r LEFT JOIN "User" u ON r."userId" = u.id WHERE r.id = $1 LIMIT 1`,
      id
    );

    return res.json({
      success: true,
      review: rows[0] || null,
    });
  } catch (error) {
    console.error('[PlatformReview] adminUpdate error:', error);
    return res.status(500).json({ error: 'Failed to update platform review.' });
  }
};

// ── Admin: Delete Review ───────────────────────────────────────────────────
exports.adminDeletePlatformReview = async (req, res) => {
  try {
    const { id } = req.params;

    const existingRows = await prisma.$queryRawUnsafe(`SELECT * FROM "PlatformReview" WHERE id = $1 LIMIT 1`, id);
    const existing = existingRows[0];

    if (!existing) {
      return res.status(404).json({ error: 'Platform review not found.' });
    }

    await prisma.$executeRawUnsafe(`DELETE FROM "PlatformReview" WHERE id = $1`, id);

    const remainingRows = await prisma.$queryRawUnsafe(`SELECT COUNT(*) as count FROM "PlatformReview" WHERE "userId" = $1`, existing.userId);
    const remainingCount = parseInt(remainingRows[0]?.count || '0', 10);

    if (remainingCount === 0) {
      await prisma.$executeRawUnsafe(`UPDATE "User" SET "platformReviewSubmitted" = false WHERE id = $1`, existing.userId);
    }

    return res.json({
      success: true,
      message: 'Platform review deleted.',
    });
  } catch (error) {
    console.error('[PlatformReview] adminDelete error:', error);
    return res.status(500).json({ error: 'Failed to delete platform review.' });
  }
};

// ── Admin: Export Reviews to CSV ───────────────────────────────────────────
exports.adminExportPlatformReviews = async (req, res) => {
  try {
    const reviews = await prisma.$queryRawUnsafe(`
      SELECT r.id, r.rating, r.feedback, r.tags, r.anonymous, r.approved, r.featured, r."createdAt", u.name, u.email
      FROM "PlatformReview" r
      LEFT JOIN "User" u ON r."userId" = u.id
      ORDER BY r."createdAt" DESC
    `);

    const headers = ['ID', 'User Name', 'User Email', 'Rating', 'Tags', 'Feedback', 'Anonymous', 'Approved', 'Featured', 'Created At'];
    const rows = (reviews || []).map((r) => [
      r.id,
      `"${(r.name || '').replace(/"/g, '""')}"`,
      `"${(r.email || '').replace(/"/g, '""')}"`,
      r.rating,
      `"${(r.tags || []).join('; ')}"`,
      `"${(r.feedback || '').replace(/"/g, '""')}"`,
      r.anonymous ? 'Yes' : 'No',
      r.approved ? 'Yes' : 'No',
      r.featured ? 'Yes' : 'No',
      new Date(r.createdAt).toISOString(),
    ]);

    const csvContent = [headers.join(','), ...rows.map((row) => row.join(','))].join('\n');

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="helpmeman-platform-reviews.csv"');
    return res.send(csvContent);
  } catch (error) {
    console.error('[PlatformReview] adminExport error:', error);
    return res.status(500).json({ error: 'Failed to export platform reviews.' });
  }
};
