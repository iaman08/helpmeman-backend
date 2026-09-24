const prisma = require('../config/prisma');
const config = require('../config/env');
const { createClient } = require('@supabase/supabase-js');
const { logAuditEvent, getClientIp } = require('../services/auditLog.service');
const { invalidateCachedUser, findSupabaseUserByEmail } = require('../services/auth.service');

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
    
    if (!email || !name || !password) {
      return res.status(400).json({ error: 'Email, name, and password are required' });
    }

    if (role === 'SUPER_ADMIN') {
      return res.status(403).json({
        error: 'There can only be one Super Admin in the system. You can only create regular Admins.',
        code: 'SINGLE_SUPER_ADMIN_ONLY'
      });
    }
    const normalizedEmail = email.toLowerCase().trim();
    const targetRole = 'ADMIN';

    if (password.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters' });
    }

    // Check if user already exists in Prisma DB
    const existing = await prisma.user.findFirst({
      where: {
        OR: [
          { email: normalizedEmail },
          { email: { equals: normalizedEmail, mode: 'insensitive' } }
        ]
      }
    });

    let authUserId = null;

    // 1. Create or synchronize user in Supabase Auth
    const { data: authData, error: authError } = await adminSupabase.auth.admin.createUser({
      email: normalizedEmail,
      password,
      email_confirm: true,
      user_metadata: { name, role: targetRole }
    });

    if (authError) {
      const isAlreadyRegistered =
        authError.message?.toLowerCase().includes('already') ||
        authError.status === 422 ||
        authError.code === 'email_exists';

      if (isAlreadyRegistered) {
        // Find existing Supabase user by email across all pages
        const sbUser = await findSupabaseUserByEmail(normalizedEmail, adminSupabase);

        if (sbUser) {
          authUserId = sbUser.id;
          // Update password, metadata, unban, confirm email
          const { error: updateError } = await adminSupabase.auth.admin.updateUserById(sbUser.id, {
            password,
            email_confirm: true,
            user_metadata: { name, role: targetRole },
            ban_duration: 'none'
          });
          if (updateError) {
            console.warn('[ADMIN_MGMT] Supabase update user warning:', updateError.message);
          }
        } else if (existing) {
          authUserId = existing.id;
          await adminSupabase.auth.admin.updateUserById(existing.id, {
            password,
            email_confirm: true,
            user_metadata: { name, role: targetRole },
            ban_duration: 'none'
          }).catch((err) => {
            console.warn('[ADMIN_MGMT] Supabase update user by existing ID warning:', err.message);
          });
        }
      } else {
        return res.status(400).json({ error: authError.message });
      }
    } else if (authData?.user) {
      authUserId = authData.user.id;
    }

    // 2. If user exists in Prisma
    if (existing) {
      // If already an active administrator with the requested role
      if ((existing.role === 'ADMIN' || existing.role === 'SUPER_ADMIN') && existing.status === 'ACTIVE' && existing.role === targetRole) {
        return res.status(409).json({ error: `An active administrator with email "${normalizedEmail}" already exists.` });
      }

      // Promote / activate existing user to administrator
      const updatedAdmin = await prisma.user.update({
        where: { id: existing.id },
        data: {
          name,
          role: targetRole,
          status: 'ACTIVE',
          isEmailVerified: true,
          mustChangePassword: false
        },
        select: {
          id: true,
          name: true,
          email: true,
          role: true,
          status: true,
          lastSeen: true,
          createdAt: true
        }
      });

      invalidateCachedUser(existing.id);

      await logAuditEvent({
        action: 'ADMIN_PROMOTED_OR_UPDATED',
        actorId: req.user.id,
        targetId: updatedAdmin.id,
        newValue: targetRole,
        endpoint: req.originalUrl,
        ip: getClientIp(req),
        userAgent: req.headers['user-agent'] || null,
        metadata: { actorEmail: req.user.email, adminEmail: normalizedEmail, previousRole: existing.role }
      });

      return res.status(200).json({ data: updatedAdmin, message: 'Administrator account provisioned successfully' });
    }

    // 3. Create new admin in Prisma DB
    const newAdmin = await prisma.user.create({
      data: {
        ...(authUserId ? { id: authUserId } : {}),
        email: normalizedEmail,
        name,
        passwordHash: 'supabase',
        role: targetRole,
        status: 'ACTIVE',
        isEmailVerified: true,
        mustChangePassword: false
      },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        status: true,
        lastSeen: true,
        createdAt: true
      }
    });

    await logAuditEvent({
      action: 'ADMIN_CREATED',
      actorId: req.user.id,
      targetId: newAdmin.id,
      newValue: targetRole,
      endpoint: req.originalUrl,
      ip: getClientIp(req),
      userAgent: req.headers['user-agent'] || null,
      metadata: { actorEmail: req.user.email, newAdminEmail: normalizedEmail }
    });

    return res.status(201).json({ data: newAdmin, message: 'Administrator created successfully' });
  } catch (error) {
    console.error('Error creating admin:', error);
    res.status(500).json({ error: error.message || 'Failed to create admin' });
  }
}

async function updateAdmin(req, res) {
  try {
    const { id } = req.params;
    const { name, role } = req.body;
    
    if (id === req.user.id && role && role !== req.user.role) {
      return res.status(400).json({ error: 'Cannot change your own role' });
    }
    
    const adminToUpdate = await prisma.user.findUnique({ where: { id } });
    if (!adminToUpdate) {
      return res.status(404).json({ error: 'Admin not found' });
    }

    if (adminToUpdate.role === 'SUPER_ADMIN') {
      return res.status(403).json({
        error: 'The Super Admin account is protected and cannot be modified here.',
        code: 'SUPER_ADMIN_IMMUTABLE'
      });
    }

    if (role === 'SUPER_ADMIN') {
      return res.status(403).json({
        error: 'There can only be one Super Admin in the system. Promoting to Super Admin is disabled.',
        code: 'SINGLE_SUPER_ADMIN_ONLY'
      });
    }
    
    if (role && role !== 'ADMIN') {
      return res.status(400).json({ error: 'Role must be ADMIN' });
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
        status: true,
        lastSeen: true,
        createdAt: true
      }
    });
    
    // Update Supabase metadata if role or name changed
    await adminSupabase.auth.admin.updateUserById(id, {
      user_metadata: {
        ...(name ? { name } : {}),
        ...(role ? { role } : {})
      }
    }).catch(err => console.warn('[ADMIN_MGMT] Supabase update metadata warning:', err.message));
    
    invalidateCachedUser(id);

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
    
    let { error: authError } = await adminSupabase.auth.admin.updateUserById(id, { password: newPassword });
    if (authError && admin.email) {
      // Fallback: If ID mismatch between Prisma and Supabase Auth, look up by email
      const sbUser = await findSupabaseUserByEmail(admin.email, adminSupabase);
      if (sbUser) {
        const retryRes = await adminSupabase.auth.admin.updateUserById(sbUser.id, { password: newPassword });
        authError = retryRes.error;
      }
    }
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

async function revokeAdminRole(req, res) {
  try {
    const { id } = req.params;
    
    if (id === req.user.id) {
      return res.status(400).json({ error: 'Cannot remove your own admin privileges' });
    }
    
    const admin = await prisma.user.findUnique({ where: { id } });
    if (!admin) {
      return res.status(404).json({ error: 'Admin not found' });
    }
    
    if (admin.role === 'SUPER_ADMIN') {
      return res.status(403).json({ error: 'Cannot revoke role of the Super Admin' });
    }
    
    if (admin.role !== 'ADMIN') {
      return res.status(400).json({ error: 'User is not an administrator' });
    }
    
    // Demote to STUDENT
    const updatedUser = await prisma.user.update({
      where: { id },
      data: { role: 'STUDENT' },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        status: true,
        lastSeen: true,
        createdAt: true
      }
    });
    
    // Update Supabase metadata
    await adminSupabase.auth.admin.updateUserById(id, {
      user_metadata: { role: 'STUDENT' }
    }).catch(err => console.warn('[ADMIN_MGMT] Supabase update metadata warning:', err.message));
    
    invalidateCachedUser(id);
    
    await logAuditEvent({
      action: 'ADMIN_ROLE_REVOKED',
      actorId: req.user.id,
      targetId: id,
      oldValue: 'ADMIN',
      newValue: 'STUDENT',
      endpoint: req.originalUrl,
      ip: getClientIp(req),
      userAgent: req.headers['user-agent'] || null,
      metadata: { actorEmail: req.user.email, targetEmail: admin.email }
    });
    
    res.json({
      data: updatedUser,
      message: `Admin privileges removed for ${admin.name}. Account reverted to regular user.`
    });
  } catch (error) {
    console.error('Error revoking admin role:', error);
    res.status(500).json({ error: 'Failed to revoke admin role' });
  }
}

async function promoteToAdmin(req, res) {
  try {
    const { userId, email } = req.body;
    if (!userId && !email) {
      return res.status(400).json({ error: 'userId or email is required' });
    }
    
    const where = userId
      ? { id: userId }
      : { email: email.toLowerCase().trim() };
      
    const user = await prisma.user.findFirst({ where });
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    if (user.role === 'SUPER_ADMIN') {
      return res.status(400).json({ error: 'User is already Super Admin' });
    }
    
    if (user.role === 'ADMIN') {
      return res.status(400).json({ error: 'User is already an Admin' });
    }
    
    const updatedUser = await prisma.user.update({
      where: { id: user.id },
      data: { role: 'ADMIN' },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        status: true,
        lastSeen: true,
        createdAt: true
      }
    });
    
    await adminSupabase.auth.admin.updateUserById(user.id, {
      user_metadata: { role: 'ADMIN' }
    }).catch(err => console.warn('[ADMIN_MGMT] Supabase update metadata warning:', err.message));
    
    invalidateCachedUser(user.id);
    
    await logAuditEvent({
      action: 'ADMIN_ROLE_GRANTED',
      actorId: req.user.id,
      targetId: user.id,
      oldValue: user.role,
      newValue: 'ADMIN',
      endpoint: req.originalUrl,
      ip: getClientIp(req),
      userAgent: req.headers['user-agent'] || null,
      metadata: { actorEmail: req.user.email, targetEmail: user.email }
    });
    
    res.json({
      data: updatedUser,
      message: `User ${user.name} has been made an Admin successfully.`
    });
  } catch (error) {
    console.error('Error promoting user to admin:', error);
    res.status(500).json({ error: 'Failed to promote user to admin' });
  }
}

async function searchUsersToPromote(req, res) {
  try {
    const { q = '' } = req.query;
    if (!q || q.trim().length < 2) {
      return res.json({ data: [] });
    }
    const query = q.trim();
    const users = await prisma.user.findMany({
      where: {
        role: { notIn: ['ADMIN', 'SUPER_ADMIN'] },
        status: 'ACTIVE',
        OR: [
          { name: { contains: query, mode: 'insensitive' } },
          { email: { contains: query, mode: 'insensitive' } }
        ]
      },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        avatar: true
      },
      take: 10
    });
    res.json({ data: users });
  } catch (error) {
    console.error('Error searching users to promote:', error);
    res.status(500).json({ error: 'Failed to search users' });
  }
}

module.exports = {
  listAdmins,
  createAdmin,
  updateAdmin,
  disableAdmin,
  enableAdmin,
  deleteAdmin,
  resetAdminPassword,
  revokeAdminRole,
  promoteToAdmin,
  searchUsersToPromote
};
