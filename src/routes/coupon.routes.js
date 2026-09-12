const express = require('express');
const router = express.Router();
const { optionalAuth } = require('../middleware/auth');
const couponController = require('../controllers/coupon.controller');

router.use(optionalAuth);

router.post('/validate', couponController.validateCouponCode);
router.get('/active', couponController.getActiveCoupons);

module.exports = router;
