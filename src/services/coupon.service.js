const prisma = require('../config/prisma');

/**
 * Default coupons seeded automatically on startup
 */
const DEFAULT_COUPONS = [
  {
    code: 'FREE100',
    discountType: 'PERCENTAGE',
    discountValue: 100,
    minOrderAmount: 0,
    maxDiscount: null,
    maxUses: null,
    maxUsesPerUser: null, // Unlimited for easy testing
    description: 'Special test coupon: 100% discount (zero amount booking)',
    isActive: true,
  },
  {
    code: 'TESTFREE',
    discountType: 'PERCENTAGE',
    discountValue: 100,
    minOrderAmount: 0,
    maxDiscount: null,
    maxUses: null,
    maxUsesPerUser: null, // Unlimited for easy testing
    description: 'Special test coupon: 100% discount (zero amount booking)',
    isActive: true,
  },
  {
    code: 'WELCOME20',
    discountType: 'PERCENTAGE',
    discountValue: 20,
    minOrderAmount: 0,
    maxDiscount: 100000, // Up to ₹1,000 off
    maxUses: 1000,
    maxUsesPerUser: 1,
    description: 'Welcome discount: 20% off your mentorship session',
    isActive: true,
  },
  {
    code: 'FLAT500',
    discountType: 'FLAT',
    discountValue: 50000, // ₹500 off (in paise)
    minOrderAmount: 100000, // Min ₹1,000 order
    maxDiscount: null,
    maxUses: 500,
    maxUsesPerUser: 1,
    description: 'Flat ₹500 discount on sessions above ₹1,000',
    isActive: true,
  },
];

/**
 * Seed default coupons if they do not exist
 */
async function ensureDefaultCoupons() {
  try {
    for (const c of DEFAULT_COUPONS) {
      await prisma.coupon.upsert({
        where: { code: c.code },
        update: {
          isActive: c.isActive,
          discountType: c.discountType,
          discountValue: c.discountValue,
          description: c.description,
        },
        create: c,
      });
    }
    console.log('[coupons] Default coupons initialized (including FREE100 & TESTFREE)');
  } catch (err) {
    console.error('[coupons] Failed to ensure default coupons:', err.message);
  }
}

/**
 * Validate a coupon code and calculate discount
 * @param {Object} params
 * @param {string} params.code
 * @param {string} params.userId
 * @param {number} params.amountInr - Session amount in INR paise
 * @returns {Promise<{ valid: boolean, error?: string, coupon?: Object, discountAmount?: number, finalAmount?: number, isFree?: boolean }>}
 */
async function validateCoupon({ code, userId, amountInr }) {
  if (!code || typeof code !== 'string') {
    return { valid: false, error: 'Please provide a valid coupon code.' };
  }

  const normalizedCode = code.trim().toUpperCase();

  const coupon = await prisma.coupon.findUnique({
    where: { code: normalizedCode },
  });

  if (!coupon || !coupon.isActive) {
    return { valid: false, error: 'Invalid or inactive coupon code.' };
  }

  if (coupon.expiresAt && new Date() > coupon.expiresAt) {
    return { valid: false, error: 'This coupon code has expired.' };
  }

  if (coupon.maxUses && coupon.usedCount >= coupon.maxUses) {
    return { valid: false, error: 'This coupon has reached its maximum redemptions.' };
  }

  if (coupon.minOrderAmount && amountInr < coupon.minOrderAmount) {
    const minRupees = Math.round(coupon.minOrderAmount / 100);
    return {
      valid: false,
      error: `This coupon requires a minimum booking amount of ₹${minRupees}.`,
    };
  }

  // Check per-user limit
  if (userId && coupon.maxUsesPerUser) {
    const userUsageCount = await prisma.couponUsage.count({
      where: { couponId: coupon.id, userId },
    });
    if (userUsageCount >= coupon.maxUsesPerUser) {
      return {
        valid: false,
        error: 'You have already redeemed this coupon code.',
      };
    }
  }

  // Calculate discount in INR paise
  let discount = 0;
  if (coupon.discountType === 'PERCENTAGE') {
    discount = Math.round((amountInr * coupon.discountValue) / 100);
    if (coupon.maxDiscount && discount > coupon.maxDiscount) {
      discount = coupon.maxDiscount;
    }
  } else if (coupon.discountType === 'FLAT') {
    discount = Math.round(coupon.discountValue);
  }

  // Cap discount at total amount
  discount = Math.min(discount, amountInr);
  const finalAmount = Math.max(0, amountInr - discount);
  const isFree = finalAmount === 0;

  return {
    valid: true,
    coupon: {
      id: coupon.id,
      code: coupon.code,
      discountType: coupon.discountType,
      discountValue: coupon.discountValue,
      description: coupon.description,
    },
    originalAmount: amountInr,
    discountAmount: discount,
    finalAmount,
    isFree,
  };
}

/**
 * Record coupon usage upon successful booking
 */
async function recordCouponUsage({ couponId, userId, bookingId }) {
  if (!couponId || !userId) return;

  try {
    await prisma.$transaction([
      prisma.couponUsage.create({
        data: {
          couponId,
          userId,
          bookingId,
        },
      }),
      prisma.coupon.update({
        where: { id: couponId },
        data: {
          usedCount: { increment: 1 },
        },
      }),
    ]);
  } catch (err) {
    console.error('[coupons] Error recording coupon usage:', err.message);
  }
}

module.exports = {
  ensureDefaultCoupons,
  validateCoupon,
  recordCouponUsage,
};
