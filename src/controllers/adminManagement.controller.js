const prisma = require('../config/prisma');
const config = require('../config/env');
const { createClient } = require('@supabase/supabase-js');
const { logAuditEvent, getClientIp } = require('../services/auditLog.service');
const { invalidateCachedUser } = require('../services/auth.service');

const adminSupabase = createClient(config.supabase.url, config.supabase.serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false }
});

async function listAdmins(req, res) {
  try {
    const { q, status, page = 1, limit = 20 } = req.query;
    const pageNum = parseInt(page);
    const limitNum = parseInt(limit);
    
    const where = {
      role: { in: ['ADMIN', 'SUPER_ADMIN'] }
    };
    
    if (status) {
      where.status = status;
    }
    
    if (q) {
      where.OR = [
        { name: { contains: q, mode: 'insensitive' } },
        { email: { contains: q, mode: 'insensitive' } }
      ];
    }
    
    const [admins, total] = await Promise.all([
      prisma.user.findMany({
        where,
        select: {
          id: true,
          name: true,
          email: true,
          role: true,
          status: true,
          lastSeen: true,
          createdAt: true
        },
        skip: (pageNum - 1) * limitNum,
        take: limitNum,
        orderBy: { createdAt: 'desc' }
      }),
      prisma.user.count({ where })
    ]);
    
    res.json({
      data: {
        items: admins,
        total,
        page: pageNum,
        totalPages: Math.ceil(total / limitNum)
      }
    });
  } catch (error) {
    console.error('Error listing admins:', error);
    res.status(500).json({ error: 'Failed to list admins' });
  }
}

async function createAdmin(req, res) {
  try {
    const { email, name, password, role } = req.body;
    
    if (role !== 'ADMIN') {
      return res.status(400).json({ error: 'Can only create users with ADMIN role' });
    }
    
    if (!email || !name || !password) {
      return res.status(400).json({ error: 'Email, name, and password are required' });
    }
    
    // Check if user already exists
    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
      return res.status(400).json({ error: 'Email is already in use' });
    }
    
    // Create in Supabase
    const { data: authData, error: authError } = await adminSupabase.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { name, role }
    });
    
    if (authError) {
      return res.status(400).json({ error: authError.message });
    }
    
    // Create in local DB
    const newAdmin = await prisma.user.create({
      data: {
        id: authData.user.id,
        email,
        name,
        passwordHash: 'supabase', // We don't store passwords
        role: 'ADMIN',
        isEmailVerified: true
      },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        status: true
      }
    });
    
    await logAuditEvent({
      action: 'ADMIN_CREATED',
      actorId: req.user.id,
      targetId: newAdmin.id,
      newValue: 'ADMIN',
      endpoint: req.originalUrl,
      ip: getClientIp(req),
      userAgent: req.headers['user-agent'] || null,
      metadata: { actorEmail: req.user.email, newAdminEmail: email }
    });
    
    res.status(201).json({ data: newAdmin });
  } catch (error) {
    console.error('Error creating admin:', error);
    res.status(500).json({ error: 'Failed to create admin' });
  }
}

async function updateAdmin(req, res) {
  try {
    const { id } = req.params;
    const { name, role } = req.body;
    
    if (id === req.user.id) {
      return res.status(400).json({ error: 'Cannot modify your own account' });
    }
    
    const adminToUpdate = await prisma.user.findUnique({ where: { id } });
    if (!adminToUpdate) {
      return res.status(404).json({ error: 'Admin not found' });
    }
    
    if (adminToUpdate.role === 'SUPER_ADMIN') {
      return res.status(403).json({ error: 'Cannot modify a SUPER_ADMIN account' });
    }
    
    if (role && role === 'SUPER_ADMIN') {
      return res.status(403).json({ error: 'Cannot grant SUPER_ADMIN role' });
    }
    
    const dataToUpdate = {};
    if (name) dataToUpdate.name = name;
    if (role) dataToUpdate.role = role;
    
    const updatedAdmin = await prisma.user.update({
      where: { id },
      data: dataToUpdate,
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        status: true
      }
    });
    
    // Update Supabase metadata if role changed
    if (role) {
      await adminSupabase.auth.admin.updateUserById(id, { user_metadata: { role } });
    }
    
    await logAuditEvent({
      action: 'ADMIN_UPDATED',
      actorId: req.user.id,
      targetId: id,
      oldValue: adminToUpdate.role,
      newValue: updatedAdmin.role,
      endpoint: req.originalUrl,
      ip: getClientIp(req),
      userAgent: req.headers['user-agent'] || null,
      metadata: { actorEmail: req.user.email, updatedName: name }
    });
    
    res.json({ data: updatedAdmin });
  } catch (error) {
    console.error('Error updating admin:', error);
    res.status(500).json({ error: 'Failed to update admin' });
  }
}

async function disableAdmin(req, res) {
  try {
    const { id } = req.params;
    
    if (id === req.user.id) {
      return res.status(400).json({ error: 'Cannot disable your own account' });
    }
    
    const admin = await prisma.user.findUnique({ where: { id } });
    if (!admin || !['ADMIN', 'SUPER_ADMIN'].includes(admin.role)) {
      return res.status(404).json({ error: 'Admin not found' });
    }
    
    if (admin.role === 'SUPER_ADMIN') {
      return res.status(403).json({ error: 'Cannot disable a SUPER_ADMIN account' });
    }
    
    await prisma.user.update({
      where: { id },
      data: { status: 'DISABLED' }
    });
    
    await adminSupabase.auth.admin.updateUserById(id, { ban_duration: '87600h' }); // 10 years ban
    
    invalidateCachedUser(id);
    
    await logAuditEvent({
      action: 'ADMIN_DISABLED',
      actorId: req.user.id,
      targetId: id,
      endpoint: req.originalUrl,
      ip: getClientIp(req),
      userAgent: req.headers['user-agent'] || null,
      metadata: { actorEmail: req.user.email, targetEmail: admin.email }
    });
    
    res.json({ data: { success: true, message: 'Admin disabled successfully' } });
  } catch (error) {
    console.error('Error disabling admin:', error);
    res.status(500).json({ error: 'Failed to disable admin' });
  }
}

async function enableAdmin(req, res) {
  try {
    const { id } = req.params;
    
    const admin = await prisma.user.findUnique({ where: { id } });
    if (!admin || !['ADMIN', 'SUPER_ADMIN'].includes(admin.role)) {
      return res.status(404).json({ error: 'Admin not found' });
    }
    
    await prisma.user.update({
      where: { id },
      data: { status: 'ACTIVE' }
    });
    
    await adminSupabase.auth.admin.updateUserById(id, { ban_duration: 'none' });
    
    await logAuditEvent({
      action: 'ADMIN_ENABLED',
      actorId: req.user.id,
      targetId: id,
      endpoint: req.originalUrl,
      ip: getClientIp(req),
      userAgent: req.headers['user-agent'] || null,
      metadata: { actorEmail: req.user.email, targetEmail: admin.email }
    });
    
    res.json({ data: { success: true, message: 'Admin enabled successfully' } });
  } catch (error) {
    console.error('Error enabling admin:', error);
    res.status(500).json({ error: 'Failed to enable admin' });
  }
}

async function deleteAdmin(req, res) {
  try {
    const { id } = req.params;
    
    if (id === req.user.id) {
      return res.status(400).json({ error: 'Cannot delete your own account' });
    }
    
    const admin = await prisma.user.findUnique({ where: { id } });
    if (!admin || !['ADMIN', 'SUPER_ADMIN'].includes(admin.role)) {
      return res.status(404).json({ error: 'Admin not found' });
    }
    
    if (admin.role === 'SUPER_ADMIN') {
      return res.status(403).json({ error: 'Cannot delete a SUPER_ADMIN account' });
    }
    
    await prisma.user.update({
      where: { id },
      data: { status: 'DELETED' }
    });
    
    await adminSupabase.auth.admin.updateUserById(id, { ban_duration: '876000h' });
    invalidateCachedUser(id);
    
    await logAuditEvent({
      action: 'ADMIN_DELETED',
      actorId: req.user.id,
      targetId: id,
      endpoint: req.originalUrl,
      ip: getClientIp(req),
      userAgent: req.headers['user-agent'] || null,
      metadata: { actorEmail: req.user.email, targetEmail: admin.email }
    });
    
    res.json({ data: { success: true, message: 'Admin deleted successfully' } });
  } catch (error) {
    console.error('Error deleting admin:', error);
    res.status(500).json({ error: 'Failed to delete admin' });
  }
}

function generateRandomPassword() {
  const chars = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%^&*()_+";
  let password = "";
  for (let i = 0; i < 16; i++) {
    password += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return password;
}

async function resetAdminPassword(req, res) {
  try {
    const { id } = req.params;
    
    const admin = await prisma.user.findUnique({ where: { id } });
    if (!admin || !['ADMIN', 'SUPER_ADMIN'].includes(admin.role)) {
      return res.status(404).json({ error: 'Admin not found' });
    }
    
    if (admin.role === 'SUPER_ADMIN' && id !== req.user.id) {
      return res.status(403).json({ error: 'Cannot reset password for another SUPER_ADMIN' });
    }
    
    const newPassword = generateRandomPassword();
    
    const { error: authError } = await adminSupabase.auth.admin.updateUserById(id, { password: newPassword });
    if (authError) {
      return res.status(400).json({ error: authError.message });
    }
    
    invalidateCachedUser(id);
    
    await logAuditEvent({
      action: 'ADMIN_PASSWORD_RESET',
      actorId: req.user.id,
      targetId: id,
      endpoint: req.originalUrl,
      ip: getClientIp(req),
      userAgent: req.headers['user-agent'] || null,
      metadata: { actorEmail: req.user.email, targetEmail: admin.email }
    });
    
    res.json({ data: { password: newPassword, message: 'Password reset successfully' } });
  } catch (error) {
    console.error('Error resetting admin password:', error);
    res.status(500).json({ error: 'Failed to reset password' });
  }
}

module.exports = {
  listAdmins,
  createAdmin,
  updateAdmin,
  disableAdmin,
  enableAdmin,
  deleteAdmin,
  resetAdminPassword
};
