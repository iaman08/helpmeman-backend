const prisma = require('../config/prisma');
const { validateCoupon } = require('../services/coupon.service');

/**
 * Validate a coupon for an upcoming booking
 * POST /api/coupons/validate
 */
async function validateCouponCode(req, res) {
  try {
    const { code, mentorId, durationMinutes = 30 } = req.body;

    if (!code) {
      return res.status(400).json({ error: 'Coupon code is required.' });
    }

    if (!mentorId) {
      return res.status(400).json({ error: 'mentorId is required to calculate discount.' });
    }

    const mentor = await prisma.mentor.findFirst({
      where: { id: mentorId, isActive: true, approvalStatus: 'APPROVED' },
    });

    if (!mentor) {
      return res.status(404).json({ error: 'Mentor not found or unavailable.' });
    }

    const duration = Number(durationMinutes) || mentor.sessionDuration || 30;
    const sessionDuration = mentor.sessionDuration || 30;
    const amountInr = Math.round(mentor.pricePerSession * (duration / sessionDuration));

    const result = await validateCoupon({
      code,
      userId: req.user?.id,
      amountInr,
    });

    if (!result.valid) {
      return res.status(400).json({ error: result.error });
    }

    res.json({
      valid: true,
      coupon: result.coupon,
      originalAmount: result.originalAmount,
      discountAmount: result.discountAmount,
      finalAmount: result.finalAmount,
      isFree: result.isFree,
    });
  } catch (err) {
    console.error('[coupon.controller] validateCouponCode error:', err);
    res.status(500).json({ error: 'Failed to validate coupon code.' });
  }
}

/**
 * Get active publicly available coupons
 * GET /api/coupons/active
 */
async function getActiveCoupons(req, res) {
  try {
    const coupons = await prisma.coupon.findMany({
      where: { isActive: true },
      select: {
        code: true,
        discountType: true,
        discountValue: true,
        description: true,
        minOrderAmount: true,
      },
      orderBy: { createdAt: 'asc' },
    });

    res.json({ coupons });
  } catch (err) {
    console.error('[coupon.controller] getActiveCoupons error:', err);
    res.status(500).json({ error: 'Failed to fetch coupons.' });
  }
}

module.exports = {
  validateCouponCode,
  getActiveCoupons,
};
