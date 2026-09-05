/**
 * Bug Report Routes
 * Handles user bug submissions with photos/videos
 * and admin oversight of reports and Google Drive links.
 */

const express = require('express');
const router = express.Router();
const multer = require('multer');
const { authenticate } = require('../middleware/auth');
const { roleGuard } = require('../middleware/roleGuard');
const { mustChangePassword } = require('../middleware/mustChangePassword');
const {
  submitBugReport,
  getBugReports,
  updateBugReportStatus,
  deleteBugReport,
} = require('../controllers/bugReport.controller');

// Configure multer for photos and videos (up to 50MB)
const storage = multer.memoryStorage();
const upload = multer({
  storage,
  limits: {
    fileSize: 50 * 1024 * 1024, // 50MB for video/photos
  },
  fileFilter: (req, file, cb) => {
    // Accept images, videos, and zip files
    if (
      file.mimetype.startsWith('image/') ||
      file.mimetype.startsWith('video/') ||
      file.mimetype === 'application/zip' ||
      file.mimetype === 'application/x-zip-compressed'
    ) {
      cb(null, true);
    } else {
      cb(new Error('Only photo or video files are allowed (image/*, video/*).'), false);
    }
  },
});

// ── Public submission endpoint ────────────────────────────────────────────────
router.post('/report', upload.single('media'), submitBugReport);

// ── Admin protected endpoints ─────────────────────────────────────────────────
router.get('/admin', authenticate, mustChangePassword, roleGuard('SUPER_ADMIN', 'ADMIN'), getBugReports);
router.patch('/admin/:id/status', authenticate, mustChangePassword, roleGuard('SUPER_ADMIN', 'ADMIN'), updateBugReportStatus);
router.delete('/admin/:id', authenticate, mustChangePassword, roleGuard('SUPER_ADMIN', 'ADMIN'), deleteBugReport);

module.exports = router;
