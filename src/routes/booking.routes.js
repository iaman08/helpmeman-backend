const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth');
const booking = require('../controllers/booking.controller');

router.use(authenticate);
router.post('/', booking.createBooking);
router.post('/:id/verify-payment', booking.verifyPayment);
router.get('/:id/meet-link', booking.getMeetLink);
router.patch('/:id/reschedule', booking.rescheduleBooking);

module.exports = router;
