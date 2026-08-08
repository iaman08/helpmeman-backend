/**
 * Super Admin Routes
 *
 * All endpoints require SUPER_ADMIN role.
 * Rate limited to prevent brute-force role escalation attempts.
 */

const express = require('express');
const router = express.Router();
const rateLimit = require('express-rate-limit');
const { authenticate } = require('../middleware/auth');
const { roleGuard } = require('../middleware/rbac');
const { mustChangePassword } = require('../middleware/mustChangePassword');
const superAdmin = require('../controllers/superAdmin.controller');

// ── Middleware: authenticate + force-password-check + SUPER_ADMIN only ───────
router.use(authenticate);
router.use(mustChangePassword);
router.use(roleGuard('SUPER_ADMIN'));

// ── Rate limiter for role change endpoint (5 req/min) ────────────────────────
const roleChangeLimiter = process.env.NODE_ENV === 'development'
  ? (req, res, next) => next()
  : rateLimit({
      windowMs: 60 * 1000,
      max: 5,
      standardHeaders: true,
      legacyHeaders: false,
      message: { error: 'Role change rate limit reached. Please wait.' },
    });

// ── Routes ───────────────────────────────────────────────────────────────────
router.get('/users', superAdmin.listAllUsers);
router.post('/users/:id/role', roleChangeLimiter, superAdmin.changeUserRole);
router.get('/audit-logs', superAdmin.viewAuditLogs);
router.get('/role-counts', superAdmin.getRoleCounts);

router.get('/dashboard-stats', superAdmin.getDashboardStats);
router.get('/system-health', superAdmin.getSystemHealth);

module.exports = router;
