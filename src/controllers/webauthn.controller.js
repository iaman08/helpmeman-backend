const jwt = require('jsonwebtoken');
const prisma = require('../config/prisma');
const config = require('../config/env');
const { generateAccessToken, generateRefreshToken } = require('../utils/jwt');
const webauthnService = require('../services/webauthn.service');

/**
 * Helper to resolve user from standard auth (req.user) or tempToken in header/body.
 */
async function resolveUser(req) {
  if (req.user && req.user.id) {
    return prisma.user.findUnique({
      where: { id: req.user.id },
      include: { mentor: true },
    });
  }

  let token = null;
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    token = authHeader.substring(7);
  } else if (req.body?.tempToken) {
    token = req.body.tempToken;
  }

  if (token) {
    try {
      const decoded = jwt.verify(token, config.jwtSecret);
      const targetId = decoded?.userId || decoded?.id;
      if (targetId) {
        return prisma.user.findUnique({
          where: { id: targetId },
          include: { mentor: true },
        });
      }
    } catch {
      // Invalid/expired token
    }
  }

  return null;
}

/**
 * GET /api/auth/webauthn/register-options
 * Generates registration challenge and options for an admin.
 */
async function getRegistrationOptions(req, res) {
  try {
    const user = await resolveUser(req);
    if (!user) {
      return res.status(401).json({ error: 'Unauthorized or session expired' });
    }

    const options = await webauthnService.generateRegOptions(user, req);
    res.json(options);
  } catch (error) {
    console.error('[WEBAUTHN] Failed to generate registration options:', error);
    res.status(500).json({ error: error.message || 'Failed to initialize security key registration' });
  }
}

/**
 * POST /api/auth/webauthn/register-verify
 * Verifies WebAuthn attestation response and saves the new Passkey.
 */
async function verifyRegistration(req, res) {
  try {
    const user = await resolveUser(req);
    if (!user) {
      return res.status(401).json({ error: 'Unauthorized or session expired' });
    }

    const { response, nickname } = req.body;
    if (!response) {
      return res.status(400).json({ error: 'Security key response data is required' });
    }

    const passkey = await webauthnService.verifyRegResponse(user, response, nickname, req);

    try {
      const { logAuditEvent } = require('../services/auditLog.service');
      logAuditEvent({
        action: 'WEBAUTHN_KEY_REGISTERED',
        actorId: user.email.toLowerCase(),
        req,
        metadata: {
          passkeyId: passkey.id,
          nickname: passkey.nickname,
          deviceType: passkey.deviceType,
        },
      }).catch(() => {});
    } catch {}

    res.json({
      success: true,
      message: 'Security key registered successfully!',
      passkey: {
        id: passkey.id,
        nickname: passkey.nickname,
        transports: passkey.transports,
        createdAt: passkey.createdAt,
      },
    });
  } catch (error) {
    console.error('[WEBAUTHN] Failed to verify registration:', error);
    res.status(400).json({ error: error.message || 'Failed to verify security key registration' });
  }
}

/**
 * POST /api/auth/webauthn/login-options
 * Generates authentication options for an admin attempting 2FA login.
 */
async function getLoginOptions(req, res) {
  try {
    const { tempToken, email } = req.body;
    let user = null;

    if (tempToken) {
      try {
        const decoded = jwt.verify(tempToken, config.jwtSecret);
        if (decoded?.userId) {
          user = await prisma.user.findUnique({ where: { id: decoded.userId } });
        }
      } catch {
        return res.status(401).json({ error: 'Login session expired. Please sign in again.' });
      }
    } else if (email) {
      user = await prisma.user.findUnique({ where: { email: email.toLowerCase().trim() } });
    }

    if (!user) {
      return res.status(404).json({ error: 'User account not found' });
    }

    const options = await webauthnService.generateAuthOptions(user, req);
    res.json(options);
  } catch (error) {
    console.error('[WEBAUTHN] Failed to generate login options:', error);
    res.status(400).json({ error: error.message || 'Failed to prepare security key authentication' });
  }
}

/**
 * POST /api/auth/webauthn/login-verify
 * Verifies WebAuthn assertion signature during 2FA login.
 */
async function verifyLogin(req, res) {
  try {
    const { tempToken, email, response } = req.body;
    if (!response) {
      return res.status(400).json({ error: 'Security key response data is required' });
    }

    let user = null;
    if (tempToken) {
      try {
        const decoded = jwt.verify(tempToken, config.jwtSecret);
        if (decoded?.userId) {
          user = await prisma.user.findUnique({
            where: { id: decoded.userId },
            include: { mentor: true },
          });
        }
      } catch {
        return res.status(401).json({ error: 'Login session expired. Please sign in again.' });
      }
    } else if (email) {
      user = await prisma.user.findUnique({
        where: { email: email.toLowerCase().trim() },
        include: { mentor: true },
      });
    }

    if (!user) {
      return res.status(404).json({ error: 'User account not found' });
    }

    const result = await webauthnService.verifyAuthResponse(user, response, req);
    if (!result.verified) {
      return res.status(400).json({ error: 'Invalid security key verification signature' });
    }

    // Complete login — generate access & refresh tokens
    const tokenPayload = {
      userId: user.id,
      email: user.email,
      role: user.role,
    };
    const accessToken = generateAccessToken(tokenPayload);
    const refreshToken = generateRefreshToken(tokenPayload);

    let mentorData = null;
    if (user.mentor) {
      mentorData = {
        id: user.mentor.id,
        approvalStatus: user.mentor.approvalStatus,
        isActive: user.mentor.isActive,
      };
    }

    prisma.user.update({ where: { id: user.id }, data: { lastSeen: new Date() } }).catch(() => {});

    try {
      const { logAuditEvent } = require('../services/auditLog.service');
      logAuditEvent({
        action: 'LOGIN_2FA_PASSKEY_SUCCESS',
        actorId: user.email.toLowerCase(),
        req,
        metadata: {
          keyId: result.credential.id,
          nickname: result.credential.nickname,
        },
      }).catch(() => {});
    } catch {}

    console.log(`[WEBAUTHN AUTH] 2FA Login verified with passkey for ${user.email} (${user.role})`);

    res.json({
      message: 'Passkey Verification Successful',
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        avatar: user.avatar,
        onboardingRole: user.onboardingRole || null,
        username: user.username || null,
        currentRole: user.currentRole || null,
        twoFactorEnabled: true,
      },
      mentor: mentorData,
      accessToken,
      refreshToken,
    });
  } catch (error) {
    console.error('[WEBAUTHN] Login verification error:', error);
    res.status(400).json({ error: error.message || 'Passkey verification failed' });
  }
}

/**
 * GET /api/auth/webauthn/credentials
 * Returns list of registered keys for the authenticated user.
 */
async function listCredentials(req, res) {
  try {
    if (!req.user || !req.user.id) {
      return res.status(401).json({ error: 'Unauthorized user session' });
    }

    const passkeys = await prisma.passkeyCredential.findMany({
      where: { userId: req.user.id },
      select: {
        id: true,
        nickname: true,
        deviceType: true,
        backedUp: true,
        transports: true,
        lastUsedAt: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'desc' },
    });

    const user = await prisma.user.findUnique({
      where: { id: req.user.id },
      select: { twoFactorEnabled: true, twoFactorSecret: true },
    });

    res.json({
      passkeys,
      hasAuthenticatorApp: Boolean(user?.twoFactorSecret),
      twoFactorEnabled: Boolean(user?.twoFactorEnabled),
    });
  } catch (error) {
    console.error('[WEBAUTHN] Failed to list credentials:', error);
    res.status(500).json({ error: 'Failed to retrieve registered security keys' });
  }
}

/**
 * DELETE /api/auth/webauthn/credentials/:id
 * Revokes a registered passkey.
 */
async function deleteCredential(req, res) {
  try {
    if (!req.user || !req.user.id) {
      return res.status(401).json({ error: 'Unauthorized user session' });
    }

    const { id } = req.params;
    const credential = await prisma.passkeyCredential.findFirst({
      where: { id, userId: req.user.id },
    });

    if (!credential) {
      return res.status(404).json({ error: 'Security key not found or does not belong to you' });
    }

    await prisma.passkeyCredential.delete({ where: { id } });

    // Check remaining methods
    const remainingPasskeys = await prisma.passkeyCredential.count({
      where: { userId: req.user.id },
    });

    const user = await prisma.user.findUnique({
      where: { id: req.user.id },
      select: { twoFactorSecret: true },
    });

    if (remainingPasskeys === 0 && !user?.twoFactorSecret) {
      await prisma.user.update({
        where: { id: req.user.id },
        data: { twoFactorEnabled: false },
      });
    }

    try {
      const { logAuditEvent } = require('../services/auditLog.service');
      logAuditEvent({
        action: 'WEBAUTHN_KEY_REVOKED',
        actorId: (req.user.email || 'admin').toLowerCase(),
        req,
        metadata: {
          keyId: id,
          nickname: credential.nickname,
          remainingKeys: remainingPasskeys,
        },
      }).catch(() => {});
    } catch {}

    res.json({
      message: 'Security key deleted successfully',
      remainingKeys: remainingPasskeys,
    });
  } catch (error) {
    console.error('[WEBAUTHN] Failed to delete credential:', error);
    res.status(500).json({ error: 'Failed to remove security key' });
  }
}

module.exports = {
  getRegistrationOptions,
  verifyRegistration,
  getLoginOptions,
  verifyLogin,
  listCredentials,
  deleteCredential,
};
