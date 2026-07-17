const express = require('express');
const router = express.Router();
const multer = require('multer');
const { authenticate } = require('../middleware/auth');
const { roleGuard } = require('../middleware/roleGuard');
const team = require('../controllers/team.controller');

// Limit file size to 10MB to match server-wide maximum sizes
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }
});

// Public endpoints
router.get('/', team.getTeam);
router.get('/:username', team.getTeamMemberByUsername);

// Admin-only endpoints
router.post(
  '/',
  authenticate,
  roleGuard('ADMIN'),
  upload.fields([
    { name: 'image', maxCount: 1 },
    { name: 'cover', maxCount: 1 }
  ]),
  team.createTeamMember
);

router.put(
  '/:id',
  authenticate,
  roleGuard('ADMIN'),
  upload.fields([
    { name: 'image', maxCount: 1 },
    { name: 'cover', maxCount: 1 }
  ]),
  team.updateTeamMember
);

router.delete('/:id', authenticate, roleGuard('ADMIN'), team.deleteTeamMember);
router.patch('/order', authenticate, roleGuard('ADMIN'), team.updateTeamOrder);
router.patch('/status', authenticate, roleGuard('ADMIN'), team.updateTeamStatus);
router.patch('/archive', authenticate, roleGuard('ADMIN'), team.archiveTeamMember);
router.patch('/verify', authenticate, roleGuard('ADMIN'), team.verifyTeamMember);

module.exports = router;
