const router = require('express').Router();
const { authenticate } = require('../middleware/auth');
const controller = require('../controllers/onboarding.controller');

router.use(authenticate);
router.get('/status', controller.status);
router.post('/role', controller.selectRole);
router.post('/answer', controller.answer);

module.exports = router;
