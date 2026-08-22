/**
 * Two-Factor Authentication (2FA / TOTP) Controller
 * Supports Google Authenticator, Authy, etc. for Admin & Super Admin accounts.
 * Compatible with otplib v13+ (generateSecret, generateURI, verifySync)
 */

const { generateSecret, generateURI, verifySync } = require('otplib');
const QRCode = require('qrcode');
const prisma = require('../config/prisma');
const jwt = require('jsonwebtoken');
const config = require('../config/env');
const { generateAccessToken, generateRefreshToken } = require('../utils/jwt');

/**
 * 1. Setup 2FA: Generates a TOTP secret and QR code for scanning
 * GET /api/auth/2fa/setup
 */
async function setup2FA(req, res) {
  try {
    if (!req.user || !req.user.id) {
      return res.status(401).json({ error: 'Unauthorized user session' });
    }

    const user = await prisma.user.findUnique({
      where: { id: req.user.id },
      select: { id: true, email: true, role: true, twoFactorEnabled: true, twoFactorSecret: true },
    });

    if (!user) return res.status(404).json({ error: 'User profile not found' });

    // Generate new secret or reuse existing setup secret if not enabled yet
    let secret = user.twoFactorSecret;
    if (!secret || !user.twoFactorEnabled) {
      secret = generateSecret();
      await prisma.user.update({
        where: { id: user.id },
        data: { twoFactorSecret: secret },
      });
    }

    const otpAuthUrl = generateURI({
      secret,
      label: user.email,
      issuer: 'HelpMeMan',
    });

    const qrCodeUrl = await QRCode.toDataURL(otpAuthUrl);

    console.log(`[2FA Setup] Successfully generated QR code and secret for ${user.email}`);

    res.json({
      secret,
      qrCodeUrl,
      otpAuthUrl,
      twoFactorEnabled: user.twoFactorEnabled,
    });
  } catch (error) {
    console.error('[2FA Setup] Error details:', error);
    res.status(500).json({ error: error.message || 'Failed to generate 2FA setup details' });
  }
}

/**
 * 2. Enable 2FA: Verifies initial 6-digit Google Authenticator code and enables 2FA
 * POST /api/auth/2fa/enable
 */
async function enable2FA(req, res) {
  try {
    const { code } = req.body;
    if (!code || code.trim().length !== 6) {
      return res.status(400).json({ error: 'Please enter a valid 6-digit code from Google Authenticator' });
    }

    const user = await prisma.user.findUnique({
      where: { id: req.user.id },
      select: { id: true, twoFactorSecret: true, twoFactorEnabled: true },
    });

    if (!user || !user.twoFactorSecret) {
      return res.status(400).json({ error: '2FA setup not initiated. Please generate a QR code first.' });
    }

    const verifyResult = verifySync({ token: code.trim(), secret: user.twoFactorSecret });
    if (!verifyResult || !verifyResult.valid) {
      return res.status(400).json({ error: 'Invalid verification code. Please check your Google Authenticator app.' });
    }

    await prisma.user.update({
      where: { id: user.id },
      data: { twoFactorEnabled: true },
    });

    res.json({
      message: 'Google Authenticator 2FA enabled successfully!',
      twoFactorEnabled: true,
    });
  } catch (error) {
    console.error('[2FA Enable] Error:', error);
    res.status(500).json({ error: error.message || 'Failed to enable 2FA' });
  }
}

/**
 * 3. Disable 2FA: Verifies 6-digit code and disables 2FA
 * POST /api/auth/2fa/disable
 */
async function disable2FA(req, res) {
  try {
    const { code } = req.body;
    if (!code || code.trim().length !== 6) {
      return res.status(400).json({ error: 'Please enter your current 6-digit 2FA code' });
    }

    const user = await prisma.user.findUnique({
      where: { id: req.user.id },
      select: { id: true, twoFactorSecret: true, twoFactorEnabled: true },
    });

    if (!user || !user.twoFactorEnabled || !user.twoFactorSecret) {
      return res.status(400).json({ error: '2FA is not enabled on this account' });
    }

    const verifyResult = verifySync({ token: code.trim(), secret: user.twoFactorSecret });
    if (!verifyResult || !verifyResult.valid) {
      return res.status(400).json({ error: 'Invalid 2FA code' });
    }

    await prisma.user.update({
      where: { id: user.id },
      data: { twoFactorEnabled: false, twoFactorSecret: null },
    });

    res.json({ message: '2FA disabled successfully', twoFactorEnabled: false });
  } catch (error) {
    console.error('[2FA Disable] Error:', error);
    res.status(500).json({ error: error.message || 'Failed to disable 2FA' });
  }
}

/**
 * 4. Verify 2FA During Login
 * POST /api/auth/2fa/verify-login
 */
async function verify2FALogin(req, res) {
  try {
    const { tempToken, code } = req.body;

    if (!tempToken || !code) {
      return res.status(400).json({ error: 'Temporary login token and 2FA code are required' });
    }

    let decoded;
    try {
      decoded = jwt.verify(tempToken, config.jwtSecret);
    } catch (err) {
      return res.status(401).json({ error: '2FA login session expired. Please sign in again.' });
    }

    if (!decoded.is2FAPending || !decoded.userId) {
      return res.status(400).json({ error: 'Invalid 2FA session token' });
    }

    const user = await prisma.user.findUnique({
      where: { id: decoded.userId },
      include: { mentor: true },
    });

    if (!user || !user.twoFactorEnabled || !user.twoFactorSecret) {
      return res.status(400).json({ error: '2FA is not enabled for this account' });
    }

    const verifyResult = verifySync({ token: code.trim(), secret: user.twoFactorSecret });
    if (!verifyResult || !verifyResult.valid) {
      return res.status(400).json({ error: 'Invalid 6-digit Google Authenticator code. Please try again.' });
    }

    // Complete login — generate full access token & refresh token
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

    // Update lastSeen
    prisma.user.update({ where: { id: user.id }, data: { lastSeen: new Date() } }).catch(() => {});

    console.log(`[2FA AUTH] 2FA Login verified successfully for ${user.email} (${user.role})`);

    res.json({
      message: '2FA Verification Successful',
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
    console.error('[2FA Verify Login] Error:', error);
    res.status(500).json({ error: '2FA verification failed' });
  }
}

module.exports = {
  setup2FA,
  enable2FA,
  disable2FA,
  verify2FALogin,
};
