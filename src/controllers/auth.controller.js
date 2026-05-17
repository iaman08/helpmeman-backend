const { PrismaClient } = require('@prisma/client');
const { hashPassword, comparePassword } = require('../utils/hash');
const { generateAccessToken, generateRefreshToken, verifyRefreshToken, generateEmailToken, verifyEmailToken } = require('../utils/jwt');
const { generateOTP, storeOTP, verifyOTP } = require('../utils/otp');
const { isValidCollegeEmail, isValidCompanyEmail, isValidStartupEmail } = require('../utils/emailDomains');
const { sendEmail, welcomeEmailTemplate, emailVerificationTemplate, otpEmailTemplate, passwordResetTemplate } = require('../services/email.service');
const { createNotification } = require('../services/notification.service');
const { saveUserToFirestore, saveMentorToFirestore, getUserFromFirestore } = require('../services/firestore.service');
const config = require('../config/env');
const crypto = require('crypto');
const firebaseAdmin = require('../config/firebase');

const prisma = new PrismaClient();

// POST /api/auth/register
async function register(req, res) {
  try {
    const { name, email, password, phone } = req.body;
    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) return res.status(409).json({ error: 'Email already registered' });

    const passwordHash = await hashPassword(password);
    const user = await prisma.user.create({
      data: { name, email: email.toLowerCase(), passwordHash, phone, role: 'USER' },
    });

    const token = generateEmailToken({ userId: user.id, type: 'email_verify' });
    const verificationUrl = `${config.frontendUrl}/verify-email?token=${token}`;
    if (process.env.NODE_ENV !== 'production') {
      console.log(`\n📧 [DEV] Email verification URL for ${user.email}:\n${verificationUrl}\n`);
    }
    await sendEmail({ to: user.email, subject: 'Verify your email — HelpMeMan', html: emailVerificationTemplate(user, verificationUrl) });

    const accessToken = generateAccessToken({ userId: user.id, role: user.role });
    const refreshToken = generateRefreshToken({ userId: user.id });
    await prisma.refreshToken.create({ data: { token: refreshToken, userId: user.id, expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) } });

    // Sync user to Firestore
    try { await saveUserToFirestore(user); } catch (e) { console.warn('Firestore sync failed (register):', e.message); }

    res.status(201).json({
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        username: null,
        currentRole: null
      },
      accessToken,
      refreshToken
    });
  } catch (error) {
    console.error('Register error:', error);
    res.status(500).json({ error: 'Registration failed' });
  }
}

// POST /api/auth/register/mentor
async function registerMentor(req, res) {
  try {
    const { name, email, password, phone, displayName, bio, institutionType, institutionName, institutionEmail, department, graduationYear, currentRole, company, linkedinUrl, expertise, categoryId, pricePerSession, sessionDuration } = req.body;

    // Validate institution email
    if (institutionType === 'COLLEGE' && !isValidCollegeEmail(institutionEmail)) {
      return res.status(400).json({ error: 'Invalid college email domain' });
    }
    if (institutionType === 'COMPANY' && !isValidCompanyEmail(institutionEmail, company)) {
      return res.status(400).json({ error: 'Invalid company email domain' });
    }
    if (institutionType === 'STARTUP' && !isValidStartupEmail(institutionEmail)) {
      return res.status(400).json({ error: 'Invalid startup email' });
    }

    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) return res.status(409).json({ error: 'Email already registered' });

    const existingMentorEmail = await prisma.mentor.findUnique({ where: { institutionEmail } });
    if (existingMentorEmail) return res.status(409).json({ error: 'Institution email already used' });

    // Send OTP to institution email
    const otp = generateOTP();
    storeOTP(institutionEmail, otp);
    if (process.env.NODE_ENV !== 'production') {
      console.log(`\n🔑 [DEV] OTP for ${institutionEmail}: ${otp}\n`);
    }
    await sendEmail({ to: institutionEmail, subject: 'HelpMeMan — Verify your institution email', html: otpEmailTemplate(institutionEmail, otp) });

    // Store pending registration data in session/temp (simplified: store in response for client to send back)
    res.json({ message: 'OTP sent to institution email', institutionEmail, requiresOTP: true });
  } catch (error) {
    console.error('Mentor register error:', error);
    res.status(500).json({ error: 'Registration failed' });
  }
}

// POST /api/auth/verify-mentor-otp
async function verifyMentorOTP(req, res) {
  try {
    const { name, email, password, phone, displayName, bio, institutionType, institutionName, institutionEmail, department, graduationYear, currentRole, company, linkedinUrl, expertise, categoryId, pricePerSession, sessionDuration, otp } = req.body;

    if (!verifyOTP(institutionEmail, otp)) {
      return res.status(400).json({ error: 'Invalid or expired OTP' });
    }

    const passwordHash = await hashPassword(password);
    const user = await prisma.user.create({
      data: { name, email: email.toLowerCase(), passwordHash, phone, role: 'MENTOR', isEmailVerified: true },
    });

    const mentor = await prisma.mentor.create({
      data: {
        userId: user.id, displayName, bio, institutionType, institutionName,
        institutionEmail, department, graduationYear, currentRole, company,
        linkedinUrl, expertise: expertise || [], categoryId,
        pricePerSession: pricePerSession || 50000, sessionDuration: sessionDuration || 30,
        approvalStatus: 'PENDING', isActive: false,
      },
    });

    // Notify admin
    await sendEmail({ to: config.admin.notificationEmail, subject: 'New mentor application — HelpMeMan', html: `<p>New mentor: ${displayName} from ${institutionName}. Review at admin panel.</p>` });

    const accessToken = generateAccessToken({ userId: user.id, role: user.role });
    const refreshToken = generateRefreshToken({ userId: user.id });
    await prisma.refreshToken.create({ data: { token: refreshToken, userId: user.id, expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) } });

    // Sync user and mentor to Firestore
    try {
      await saveUserToFirestore(user, { currentRole: mentor.currentRole || null });
      await saveMentorToFirestore(mentor);
    } catch (e) { console.warn('Firestore sync failed (mentor register):', e.message); }

    res.status(201).json({
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        username: null,
        currentRole: mentor.currentRole || null
      },
      mentor: { id: mentor.id, approvalStatus: mentor.approvalStatus },
      accessToken,
      refreshToken
    });
  } catch (error) {
    console.error('Mentor OTP verify error:', error);
    res.status(500).json({ error: 'Verification failed' });
  }
}

// POST /api/auth/verify-email
async function verifyEmail(req, res) {
  try {
    const { token } = req.body;
    const decoded = verifyEmailToken(token);
    if (decoded.type !== 'email_verify') return res.status(400).json({ error: 'Invalid token' });
    await prisma.user.update({ where: { id: decoded.userId }, data: { isEmailVerified: true } });
    res.json({ message: 'Email verified successfully' });
  } catch (error) {
    res.status(400).json({ error: 'Invalid or expired token' });
  }
}

// POST /api/auth/login
async function login(req, res) {
  try {
    const { email, password } = req.body;
    const user = await prisma.user.findUnique({ where: { email: email.toLowerCase() } });
    if (!user) return res.status(401).json({ error: 'Invalid credentials' });

    const valid = await comparePassword(password, user.passwordHash);
    if (!valid) return res.status(401).json({ error: 'Invalid credentials' });

    const accessToken = generateAccessToken({ userId: user.id, role: user.role });
    const refreshToken = generateRefreshToken({ userId: user.id });
    await prisma.refreshToken.create({ data: { token: refreshToken, userId: user.id, expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) } });

    let mentorData = null;
    if (user.role === 'MENTOR') {
      mentorData = await prisma.mentor.findUnique({ where: { userId: user.id }, select: { id: true, approvalStatus: true, isActive: true } });
    }

    // Sync user to Firestore on login
    try { await saveUserToFirestore(user); } catch (e) { console.warn('Firestore sync failed (login):', e.message); }

    // Fetch enriched Firestore data
    let firestoreData = null;
    try { firestoreData = await getUserFromFirestore(user.id); } catch (e) { /* silent */ }

    res.json({
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        avatar: user.avatar,
        username: firestoreData?.username || null,
        currentRole: firestoreData?.currentRole || null,
      },
      mentor: mentorData,
      accessToken,
      refreshToken
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Login failed' });
  }
}

// POST /api/auth/refresh
async function refresh(req, res) {
  try {
    const { refreshToken: token } = req.body;
    const stored = await prisma.refreshToken.findUnique({ where: { token } });
    if (!stored || stored.expiresAt < new Date()) {
      return res.status(401).json({ error: 'Invalid refresh token' });
    }
    const decoded = verifyRefreshToken(token);
    const user = await prisma.user.findUnique({ where: { id: decoded.userId } });
    if (!user) return res.status(401).json({ error: 'User not found' });

    const newAccessToken = generateAccessToken({ userId: user.id, role: user.role });
    res.json({ accessToken: newAccessToken });
  } catch (error) {
    res.status(401).json({ error: 'Invalid refresh token' });
  }
}

// POST /api/auth/logout
async function logout(req, res) {
  try {
    const { refreshToken: token } = req.body;
    await prisma.refreshToken.deleteMany({ where: { token } });
    res.json({ message: 'Logged out' });
  } catch (error) {
    res.status(500).json({ error: 'Logout failed' });
  }
}

// POST /api/auth/forgot-password
async function forgotPassword(req, res) {
  try {
    const { email } = req.body;
    const user = await prisma.user.findUnique({ where: { email: email.toLowerCase() } });
    if (!user) return res.json({ message: 'If account exists, reset email sent' });

    const token = generateEmailToken({ userId: user.id, type: 'password_reset' });
    const resetUrl = `${config.frontendUrl}/reset-password?token=${token}`;
    await sendEmail({ to: user.email, subject: 'Reset your password — HelpMeMan', html: passwordResetTemplate(user, resetUrl) });
    res.json({ message: 'If account exists, reset email sent' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to send reset email' });
  }
}

// POST /api/auth/reset-password
async function resetPassword(req, res) {
  try {
    const { token, password } = req.body;
    const decoded = verifyEmailToken(token);
    if (decoded.type !== 'password_reset') return res.status(400).json({ error: 'Invalid token' });
    const passwordHash = await hashPassword(password);
    await prisma.user.update({ where: { id: decoded.userId }, data: { passwordHash } });
    await prisma.refreshToken.deleteMany({ where: { userId: decoded.userId } });
    res.json({ message: 'Password reset successful' });
  } catch (error) {
    res.status(400).json({ error: 'Invalid or expired token' });
  }
}

// POST /api/auth/google
async function googleLogin(req, res) {
  try {
    const { idToken } = req.body;
    if (!idToken) return res.status(400).json({ error: 'ID token is required' });

    // Verify the Firebase ID token
    const decodedToken = await firebaseAdmin.auth().verifyIdToken(idToken);
    const { email, name, picture, uid } = decodedToken;

    if (!email) return res.status(400).json({ error: 'Email not available from Google account' });

    // Find existing user or create a new one
    let user = await prisma.user.findUnique({ where: { email: email.toLowerCase() } });

    if (!user) {
      // Create new user from Google sign-in (no password needed)
      user = await prisma.user.create({
        data: {
          name: name || email.split('@')[0],
          email: email.toLowerCase(),
          passwordHash: '', // No password for Google users
          avatar: picture || null,
          role: 'USER',
          isEmailVerified: true, // Google emails are already verified
        },
      });
    } else if (!user.isEmailVerified) {
      // If user exists but email not verified, mark it verified (Google verified it)
      user = await prisma.user.update({
        where: { id: user.id },
        data: { isEmailVerified: true },
      });
    }

    const accessToken = generateAccessToken({ userId: user.id, role: user.role });
    const refreshToken = generateRefreshToken({ userId: user.id });
    await prisma.refreshToken.create({
      data: { token: refreshToken, userId: user.id, expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) },
    });

    let mentorData = null;
    if (user.role === 'MENTOR') {
      mentorData = await prisma.mentor.findUnique({
        where: { userId: user.id },
        select: { id: true, approvalStatus: true, isActive: true },
      });
    }

    // Sync user to Firestore on Google login
    try { await saveUserToFirestore(user); } catch (e) { console.warn('Firestore sync failed (google):', e.message); }

    // Fetch enriched Firestore data
    let firestoreData = null;
    try { firestoreData = await getUserFromFirestore(user.id); } catch (e) { /* silent */ }

    res.json({
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        avatar: user.avatar,
        username: firestoreData?.username || null,
        currentRole: firestoreData?.currentRole || null,
      },
      mentor: mentorData,
      accessToken,
      refreshToken,
    });
  } catch (error) {
    console.error('Google login error:', error);
    if (error.code === 'auth/id-token-expired') {
      return res.status(401).json({ error: 'Token expired, please try again' });
    }
    res.status(500).json({ error: 'Google login failed' });
  }
}

module.exports = { register, registerMentor, verifyMentorOTP, verifyEmail, login, googleLogin, refresh, logout, forgotPassword, resetPassword };
