const { PrismaClient } = require('@prisma/client');
const { hashPassword, comparePassword } = require('../utils/hash');
const { generateAccessToken, generateRefreshToken, verifyRefreshToken, generateEmailToken, verifyEmailToken } = require('../utils/jwt');
const { generateOTP, storeOTP, verifyOTP, canRequestOTP, getOTPCooldown } = require('../utils/otp');
const { isValidCollegeEmail, isValidCompanyEmail, isValidStartupEmail } = require('../utils/emailDomains');
const { sendEmail, sendOtpEmail, sendWelcomeEmail, sendVerifyEmail, sendPasswordResetEmail } = require('../services/email.service');
const { sendNotification } = require('../services/notification.service');
const { saveUserToFirestore, saveMentorToFirestore, getUserFromFirestore } = require('../services/firestore.service');
const config = require('../config/env');
const crypto = require('crypto');
const firebaseAdmin = require('../config/firebase');

const prisma = new PrismaClient();

// POST /api/auth/register
// Does NOT create user — sends OTP to email for verification
async function register(req, res) {
  try {
    const { name, email, password, phone } = req.body;

    if (!name || !email || !password) {
      return res.status(400).json({ error: 'Name, email, and password are required' });
    }
    if (password.length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters' });
    }

    const existing = await prisma.user.findUnique({ where: { email: email.toLowerCase() } });
    if (existing) return res.status(409).json({ error: 'Email already registered' });

    // Check rate limit
    const rateCheck = await canRequestOTP(email);
    if (!rateCheck.allowed) {
      return res.status(429).json({ error: rateCheck.reason, cooldown: rateCheck.cooldown });
    }

    // Generate and send OTP
    const otp = generateOTP();
    await storeOTP(email, otp);

    if (process.env.NODE_ENV !== 'production') {
      console.log(`\n📧 [DEV] Signup OTP for ${email}: ${otp}\n`);
    }
    await sendOtpEmail({ email: email.toLowerCase(), name, otp, purpose: 'verify' });

    res.json({ message: 'OTP sent to your email', email: email.toLowerCase(), requiresOTP: true });
  } catch (error) {
    console.error('Register error:', error);
    res.status(500).json({ error: 'Registration failed' });
  }
}

// POST /api/auth/verify-signup-otp
// Verifies OTP, creates user, returns tokens
async function verifySignupOTP(req, res) {
  try {
    const { name, email, password, phone, otp } = req.body;

    if (!email || !password || !otp) {
      return res.status(400).json({ error: 'Email, password, and OTP are required' });
    }
    if (password.length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters' });
    }

    // Check if user was created in the meantime (race condition) or is already verified
    const existing = await prisma.user.findUnique({ where: { email: email.toLowerCase() } });
    if (existing && existing.isEmailVerified) {
      return res.status(409).json({ error: 'Email already registered' });
    }

    const userName = name || (existing ? existing.name : null);
    if (!userName) {
      return res.status(400).json({ error: 'Name is required' });
    }

    // Verify OTP
    const result = await verifyOTP(email, otp);
    if (!result.valid) {
      return res.status(400).json({ error: result.error });
    }

    // OTP verified — create user or update existing unverified user
    const passwordHash = await hashPassword(password);
    let user;
    if (existing) {
      user = await prisma.user.update({
        where: { id: existing.id },
        data: {
          name: userName,
          passwordHash,
          phone: phone || null,
          isEmailVerified: true,
        },
      });
    } else {
      user = await prisma.user.create({
        data: {
          name: userName,
          email: email.toLowerCase(),
          passwordHash,
          phone: phone || null,
          role: 'USER',
          isEmailVerified: true,
        },
      });
    }

    const accessToken = generateAccessToken({ userId: user.id, role: user.role });
    const refreshToken = generateRefreshToken({ userId: user.id });
    await prisma.refreshToken.create({
      data: { token: refreshToken, userId: user.id, expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) },
    });

    // Sync user to Firestore
    try { await saveUserToFirestore(user); } catch (e) { console.warn('Firestore sync failed (register):', e.message); }

    try {
      const { getOrCreatePreferences } = require('../services/notification.service');
      await getOrCreatePreferences(user.id);
    } catch (e) { console.warn('Notification prefs init failed:', e.message); }

    // Send welcome email
    try {
      await sendWelcomeEmail(user);
      await sendNotification({
        userId: user.id,
        type: 'ACCOUNT_UPDATE',
        title: 'Welcome to HelpMeMan',
        body: 'Your account is ready. Complete onboarding to personalize your experience.',
        sendEmail: false,
      });
    } catch (e) { console.warn('Welcome email failed:', e.message); }

    res.status(201).json({
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        username: null,
        currentRole: null,
      },
      accessToken,
      refreshToken,
    });
  } catch (error) {
    console.error('Verify signup OTP error:', error);
    res.status(500).json({ error: 'Verification failed' });
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
    await storeOTP(institutionEmail, otp);
    if (process.env.NODE_ENV !== 'production') {
      console.log(`\n🔑 [DEV] OTP for ${institutionEmail}: ${otp}\n`);
    }
    await sendOtpEmail({ email: institutionEmail, otp, purpose: 'verify' });

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

    const result = await verifyOTP(institutionEmail, otp);
    if (!result.valid) {
      return res.status(400).json({ error: result.error || 'Invalid or expired OTP' });
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

    // Google-only users (no password) should use Google login
    if (!user.passwordHash) {
      return res.status(401).json({ error: 'This account uses Google sign-in. Please use "Continue with Google".' });
    }

    const valid = await comparePassword(password, user.passwordHash);
    if (!valid) return res.status(401).json({ error: 'Invalid credentials' });

    // Block unverified users
    if (!user.isEmailVerified) {
      return res.status(403).json({
        error: 'Please verify your email first. Check your inbox for the verification OTP.',
        requiresVerification: true,
        email: user.email,
      });
    }

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
// Sends OTP instead of a reset link
async function forgotPassword(req, res) {
  try {
    const { email } = req.body;
    const user = await prisma.user.findUnique({ where: { email: email.toLowerCase() } });

    // Always return success (don't reveal if account exists)
    if (!user) return res.json({ message: 'If account exists, OTP sent to email' });

    // Google-only users can't reset password
    if (!user.passwordHash) {
      return res.json({ message: 'If account exists, OTP sent to email' });
    }

    // Check rate limit
    const rateCheck = await canRequestOTP(email);
    if (!rateCheck.allowed) {
      return res.status(429).json({ error: rateCheck.reason, cooldown: rateCheck.cooldown });
    }

    const otp = generateOTP();
    await storeOTP(email, otp);

    if (process.env.NODE_ENV !== 'production') {
      console.log(`\n🔑 [DEV] Password reset OTP for ${email}: ${otp}\n`);
    }
    await sendOtpEmail({ email: user.email, name: user.name, otp, purpose: 'reset' });

    res.json({ message: 'If account exists, OTP sent to email' });
  } catch (error) {
    console.error('Forgot password error:', error);
    res.status(500).json({ error: 'Failed to process request' });
  }
}

// POST /api/auth/verify-reset-otp
// Verifies OTP, returns a temporary reset token
async function verifyResetOTP(req, res) {
  try {
    const { email, otp } = req.body;
    if (!email || !otp) {
      return res.status(400).json({ error: 'Email and OTP are required' });
    }

    const user = await prisma.user.findUnique({ where: { email: email.toLowerCase() } });
    if (!user) {
      return res.status(400).json({ error: 'Invalid OTP' });
    }

    const result = await verifyOTP(email, otp);
    if (!result.valid) {
      return res.status(400).json({ error: result.error });
    }

    // Mark email as verified (helps legacy unverified users)
    if (!user.isEmailVerified) {
      await prisma.user.update({ where: { id: user.id }, data: { isEmailVerified: true } });
    }

    // Generate short-lived reset token (15 minutes)
    const resetToken = generateEmailToken({ userId: user.id, type: 'password_reset' });

    res.json({ resetToken, message: 'OTP verified successfully' });
  } catch (error) {
    console.error('Verify reset OTP error:', error);
    res.status(500).json({ error: 'Verification failed' });
  }
}

// POST /api/auth/reset-password
async function resetPassword(req, res) {
  try {
    const { token, password } = req.body;
    if (!token || !password) {
      return res.status(400).json({ error: 'Token and password are required' });
    }
    if (password.length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters' });
    }

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

// POST /api/auth/resend-otp
// Resends OTP for signup or password reset
async function resendOTP(req, res) {
  try {
    const { email, purpose } = req.body;
    if (!email || !purpose) {
      return res.status(400).json({ error: 'Email and purpose are required' });
    }
    if (!['signup', 'reset'].includes(purpose)) {
      return res.status(400).json({ error: 'Purpose must be "signup" or "reset"' });
    }

    // Check rate limit
    const rateCheck = await canRequestOTP(email);
    if (!rateCheck.allowed) {
      return res.status(429).json({ error: rateCheck.reason, cooldown: rateCheck.cooldown });
    }

    // For signup resend, make sure user doesn't already exist or is unverified
    if (purpose === 'signup') {
      const existing = await prisma.user.findUnique({ where: { email: email.toLowerCase() } });
      if (existing && existing.isEmailVerified) {
        return res.status(409).json({ error: 'Email already registered' });
      }
    }

    // For reset resend, make sure user exists (but don't reveal)
    if (purpose === 'reset') {
      const existing = await prisma.user.findUnique({ where: { email: email.toLowerCase() } });
      if (!existing) {
        // Don't reveal — pretend it was sent
        return res.json({ message: 'OTP resent', cooldown: 60 });
      }
    }

    const otp = generateOTP();
    await storeOTP(email, otp);

    if (process.env.NODE_ENV !== 'production') {
      console.log(`\n🔄 [DEV] Resend OTP for ${email} (${purpose}): ${otp}\n`);
    }

    const emailPurpose = purpose === 'reset' ? 'reset' : 'verify';
    await sendOtpEmail({ email: email.toLowerCase(), otp, purpose: emailPurpose });

    const cooldown = await getOTPCooldown(email);
    res.json({ message: 'OTP resent', cooldown: cooldown || 60 });
  } catch (error) {
    console.error('Resend OTP error:', error);
    res.status(500).json({ error: 'Failed to resend OTP' });
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

module.exports = { register, verifySignupOTP, registerMentor, verifyMentorOTP, verifyEmail, login, googleLogin, refresh, logout, forgotPassword, verifyResetOTP, resetPassword, resendOTP };
