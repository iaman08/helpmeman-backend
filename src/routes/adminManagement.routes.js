const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth');
const { roleGuard } = require('../middleware/rbac');
const { mustChangePassword } = require('../middleware/mustChangePassword');
const ctrl = require('../controllers/adminManagement.controller');

router.use(authenticate);
router.use(mustChangePassword);
router.use(roleGuard('SUPER_ADMIN'));

router.get('/admins', ctrl.listAdmins);
router.post('/admins', ctrl.createAdmin);
router.put('/admins/:id', ctrl.updateAdmin);
router.post('/admins/:id/disable', ctrl.disableAdmin);
router.post('/admins/:id/enable', ctrl.enableAdmin);
router.delete('/admins/:id', ctrl.deleteAdmin);
router.post('/admins/:id/reset-password', ctrl.resetAdminPassword);

module.exports = router;
