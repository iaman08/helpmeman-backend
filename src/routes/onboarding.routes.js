const router = require('express').Router();
const { authenticate } = require('../middleware/auth');
const controller = require('../controllers/onboarding.controller');

router.use(authenticate);
router.get('/', controller.status);
router.post('/', controller.answer);
router.patch('/', controller.selectRole);

module.exports = router;
