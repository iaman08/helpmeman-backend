const prisma = require('../config/prisma');
const supabase = require('../config/supabase');
const { hashPassword, comparePassword } = require('../utils/hash');
const { generateAccessToken, generateRefreshToken, verifyRefreshToken, generateEmailToken, verifyEmailToken } = require('../utils/jwt');
const { generateOTP, storeOTP, verifyOTP, canRequestOTP, getOTPCooldown } = require('../utils/otp');
const { isValidCollegeEmail, isValidCompanyEmail, isValidStartupEmail } = require('../utils/emailDomains');
const { sendEmail, sendOtpEmail, sendWelcomeEmail, sendVerifyEmail, sendPasswordResetEmail } = require('../services/email.service');
const { sendNotification } = require('../services/notification.service');
const { saveUserProfile, getUserProfile } = require('../services/userProfile.service');
const config = require('../config/env');
const crypto = require('crypto');
const https = require('https');

// Password complexity: min 8 chars, at least 1 uppercase, 1 lowercase, 1 digit
function isPasswordStrong(password) {
  if (!password || password.length < 8) return false;
  if (!/[A-Z]/.test(password)) return false;
  if (!/[a-z]/.test(password)) return false;
  if (!/[0-9]/.test(password)) return false;
  return true;
}

// POST /api/auth/register
async function register(req, res) {
  try {
    const { name, email, password } = req.body;

    if (!name || !email || !password) {
      return res.status(400).json({ error: 'Name, email, and password are required' });
    }
    if (!isPasswordStrong(password)) {
      return res.status(400).json({ error: 'Password must be at least 8 characters with uppercase, lowercase, and a number' });
    }

    const existing = await prisma.user.findUnique({ where: { email: email.toLowerCase() } });
    if (existing) return res.status(409).json({ error: 'Email already registered' });

    const otp = generateOTP();
    await storeOTP(email.toLowerCase(), otp, 'signup');
    if (process.env.NODE_ENV !== 'production') {
      console.log(`\n🔑 [DEV] OTP for ${email.toLowerCase()}: ${otp}\n`);
    }
    await sendOtpEmail({ email: email.toLowerCase(), name, otp, purpose: 'signup' });

    res.json({ message: 'Verification OTP sent to your email', email: email.toLowerCase(), requiresOTP: true });
  } catch (error) {
    console.error('Register error:', error);
    res.status(500).json({ error: 'Registration failed' });
  }
}

// POST /api/auth/verify-signup-otp
async function verifySignupOTP(req, res) {
  try {
    const { name, email, password, phone, otp } = req.body;

    if (!email || !otp) {
      return res.status(400).json({ error: 'Email and OTP are required' });
    }

    const result = await verifyOTP(email.toLowerCase(), otp, 'signup');
    if (!result.valid) {
      return res.status(400).json({ error: result.error || 'Invalid or expired OTP' });
    }

    // Create user in Supabase Auth via admin interface (email is verified via OTP)
    const { data, error: createError } = await supabase.auth.admin.createUser({
      email: email.toLowerCase(),
      password,
      email_confirm: true,
      user_metadata: {
        name,
        role: 'STUDENT',
      },
    });

    if (createError || !data.user) {
      return res.status(400).json({ error: 'Failed to create user account. Please try again.' });
    }

    // Now log in to retrieve a session/tokens
    const { data: sessionData, error: loginError } = await supabase.auth.signInWithPassword({
      email: email.toLowerCase(),
      password,
    });

    if (loginError || !sessionData.session) {
      return res.status(400).json({ error: 'Account creation failed. Please try again.' });
    }

    let user = await prisma.user.findUnique({ where: { id: data.user.id } });
    if (!user) {
      user = await prisma.user.create({
        data: {
          id: data.user.id,
          name: name || data.user.user_metadata?.name || email.split('@')[0],
          email: email.toLowerCase(),
          passwordHash: '',
          phone: phone || null,
          role: 'STUDENT',
          isEmailVerified: true,
        },
      });
    }

    // Call role synchronization (upgrade-only safety rule)
    const { syncUserRole } = require('../services/roleSync.service');
    user = await syncUserRole(user);

    try {
      const { getOrCreatePreferences } = require('../services/notification.service');
      await getOrCreatePreferences(user.id);
    } catch (e) {}

    try {
      await sendWelcomeEmail(user);
      await sendNotification({
        userId: user.id,
        type: 'ACCOUNT_UPDATE',
        title: 'Welcome to HelpMeMan',
        body: 'Your account is ready. Complete onboarding to personalize your experience.',
        sendEmail: false,
      });
    } catch (e) {}

    res.status(201).json({
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        onboardingRole: user.onboardingRole || null,
        username: user.username || null,
        currentRole: user.currentRole || null,
        currency: user.currency || null,
      },
      accessToken: sessionData.session.access_token,
      refreshToken: sessionData.session.refresh_token,
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

    const otp = generateOTP();
    await storeOTP(institutionEmail, otp);
    if (process.env.NODE_ENV !== 'production') {
      console.log(`\n🔑 [DEV] OTP for ${institutionEmail}: ${otp}\n`);
    }
    await sendOtpEmail({ email: institutionEmail, otp, purpose: 'verify' });

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

    // Create user in Supabase Auth via admin interface (email is verified via institutional OTP already)
    const { data: { user: supabaseUser }, error: createError } = await supabase.auth.admin.createUser({
      email: email.toLowerCase(),
      password,
      email_confirm: true,
      user_metadata: {
        name,
        role: 'MENTOR',
      },
    });

    if (createError || !supabaseUser) {
      return res.status(400).json({ error: createError?.message || 'Failed to create mentor auth account' });
    }

    // Now log in to retrieve a session/tokens
    const { data: sessionData, error: loginError } = await supabase.auth.signInWithPassword({
      email: email.toLowerCase(),
      password,
    });

    if (loginError || !sessionData.session) {
      return res.status(400).json({ error: loginError?.message || 'Failed to authenticate mentor' });
    }

    let user = await prisma.user.create({
      data: { id: supabaseUser.id, name, email: email.toLowerCase(), passwordHash: '', phone, role: 'MENTOR', isEmailVerified: true },
    });

    // Call role synchronization (upgrade-only safety rule)
    const { syncUserRole } = require('../services/roleSync.service');
    user = await syncUserRole(user);

    const mentor = await prisma.mentor.create({
      data: {
        userId: user.id, displayName, bio, institutionType, institutionName,
        institutionEmail, department, graduationYear, currentRole, company,
        linkedinUrl, expertise: expertise || [], categoryId,
        pricePerSession: pricePerSession || 50000, sessionDuration: sessionDuration || 30,
        approvalStatus: 'PENDING', isActive: false,
      },
    });

    try {
      await sendEmail({ to: config.admin.notificationEmail, subject: 'New mentor application — HelpMeMan', html: `<p>New mentor: ${displayName} from ${institutionName}. Review at admin panel.</p>` });
    } catch (e) {}

    res.status(201).json({
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        onboardingRole: user.onboardingRole || null,
        username: user.username || null,
        currentRole: mentor.currentRole || null,
        currency: user.currency || null,
      },
      mentor: { id: mentor.id, approvalStatus: mentor.approvalStatus },
      accessToken: sessionData.session.access_token,
      refreshToken: sessionData.session.refresh_token,
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
    const { data, error } = await supabase.auth.verifyOtp({
      token,
      type: 'signup',
    });
    if (error) return res.status(400).json({ error: 'Invalid or expired verification token' });
    res.json({ message: 'Email verified successfully' });
  } catch (error) {
    res.status(400).json({ error: 'Invalid or expired token' });
  }
}

// POST /api/auth/login
async function login(req, res) {
  const { email, password } = req.body;
  console.log(`[AUTH] Login attempt initiated for: ${email}`);
  try {
    // Local development bypass for seeded demo accounts
    if (process.env.NODE_ENV === 'development' && 
        ['admin@helpmeman.com', 'student@helpmeman.com', 'mentor@helpmeman.com', 'official.diljha@gmail.com', 'aman@helpmeman.com'].includes(email.toLowerCase()) &&
        (password === 'password123' || password === 'mock123')) {
        
      const role = (email.toLowerCase() === 'official.diljha@gmail.com' || email.toLowerCase() === 'aman@helpmeman.com') ? 'SUPER_ADMIN' :
                   email.toLowerCase() === 'admin@helpmeman.com' ? 'ADMIN' :
                   email.toLowerCase() === 'mentor@helpmeman.com' ? 'MENTOR' : 'STUDENT';
                   
      const localUser = await prisma.user.findFirst({
        where: { email: email.toLowerCase() }
      });
      
      if (localUser) {
        let mentorData = null;
        if (role === 'MENTOR') {
          mentorData = await prisma.mentor.findUnique({
            where: { userId: localUser.id },
            select: { id: true, approvalStatus: true, isActive: true }
          });
        }
        
        const tokenRole = role === 'STUDENT' ? 'student' : role.toLowerCase();
        
        console.log(`[AUTH] Demo login completed successfully for user: ${email}`);
        return res.json({
          user: {
            id: localUser.id,
            name: localUser.name,
            email: localUser.email,
            role: localUser.role,
            avatar: localUser.avatar,
            onboardingRole: localUser.onboardingRole || null,
            username: localUser.username || null,
            currentRole: localUser.currentRole || null,
            currency: localUser.currency || null,
          },
          mentor: mentorData,
          accessToken: `demo_${tokenRole}_token`,
          refreshToken: 'demo_refresh_token',
        });
      }
    }

    const { data, error } = await supabase.auth.signInWithPassword({
      email: email.toLowerCase(),
      password,
    });

    if (error || !data.user || !data.session) {
      console.warn(`[AUTH] Login failed for email: ${email}. Error: ${error?.message}`);
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const mentorInclude = {
      mentor: {
        select: { id: true, approvalStatus: true, isActive: true }
      }
    };

    let user = await prisma.user.findUnique({ 
      where: { id: data.user.id },
      include: mentorInclude
    });

    if (!user) {
      user = await prisma.user.create({
        data: {
          id: data.user.id,
          name: data.user.user_metadata?.name || email.split('@')[0],
          email: email.toLowerCase(),
          passwordHash: '',
          role: data.user.user_metadata?.role || 'STUDENT',
          isEmailVerified: true,
        },
        include: mentorInclude
      });
    }

    // Call role synchronization (upgrade-only safety rule)
    const { syncUserRole } = require('../services/roleSync.service');
    user = await syncUserRole(user);

    const mentorData = user.mentor || null;

    // Track last login
    prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } }).catch(() => {});

    console.log(`[AUTH] Login completed successfully for user: ${email}`);
    res.json({
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        avatar: user.avatar,
        onboardingRole: user.onboardingRole || null,
        username: user.username || null,
        currentRole: user.currentRole || null,
        currency: user.currency || null,
      },
      mentor: mentorData,
      accessToken: data.session.access_token,
      refreshToken: data.session.refresh_token,
    });
  } catch (error) {
    console.error(`[AUTH] Login execution crashed for email: ${email}`, error);
    res.status(500).json({ error: 'Login failed' });
  }
}

// POST /api/auth/refresh
async function refresh(req, res) {
  try {
    const { refreshToken } = req.body;
    if (!refreshToken) {
      return res.status(400).json({ error: 'Refresh token is required' });
    }

    if (process.env.NODE_ENV === 'development' && refreshToken === 'demo_refresh_token') {
      let roleToken = 'demo_student_token';
      const authHeader = req.headers.authorization;
      if (authHeader && authHeader.startsWith('Bearer ')) {
        const currentToken = authHeader.split(' ')[1];
        if (currentToken === 'demo_mentor_token') roleToken = 'demo_mentor_token';
        else if (currentToken === 'demo_admin_token') roleToken = 'demo_admin_token';
      }
      return res.json({
        accessToken: roleToken,
        refreshToken: 'demo_refresh_token',
      });
    }

    const { data, error } = await supabase.auth.refreshSession({ refresh_token: refreshToken });
    if (error || !data.session) {
      return res.status(401).json({ error: 'Invalid or expired refresh token' });
    }

    res.json({
      accessToken: data.session.access_token,
      refreshToken: data.session.refresh_token,
    });
  } catch (error) {
    res.status(401).json({ error: 'Invalid refresh token' });
  }
}

// POST /api/auth/logout
async function logout(req, res) {
  try {
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.split(' ')[1];
      const { createClient } = require('@supabase/supabase-js');
      const tempSupabase = createClient(config.supabase.url, config.supabase.serviceRoleKey, {
        auth: {
          persistSession: false,
          autoRefreshToken: false,
        },
      });
      await tempSupabase.auth.admin.signOut(token).catch(() => {});
    }
    res.json({ message: 'Logged out' });
  } catch (error) {
    res.status(500).json({ error: 'Logout failed' });
  }
}

// POST /api/auth/forgot-password
async function forgotPassword(req, res) {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: 'Email is required' });

    await supabase.auth.resetPasswordForEmail(email.toLowerCase());
    res.json({ message: 'If account exists, reset instructions sent to email' });
  } catch (error) {
    console.error('Forgot password error:', error);
    res.status(500).json({ error: 'Failed to process request' });
  }
}

// POST /api/auth/verify-reset-otp
async function verifyResetOTP(req, res) {
  try {
    const { email, otp } = req.body;
    if (!email || !otp) {
      return res.status(400).json({ error: 'Email and OTP are required' });
    }

    const { data, error } = await supabase.auth.verifyOtp({
      email: email.toLowerCase(),
      token: otp,
      type: 'recovery',
    });

    if (error || !data.user || !data.session) {
      return res.status(400).json({ error: 'Verification failed. Please try again.' });
    }

    res.json({ resetToken: data.session.access_token, message: 'OTP verified successfully' });
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
    if (!isPasswordStrong(password)) {
      return res.status(400).json({ error: 'Password must be at least 8 characters with uppercase, lowercase, and a number' });
    }

    const { createClient } = require('@supabase/supabase-js');
    const tempSupabase = createClient(config.supabase.url, config.supabase.serviceRoleKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    });

    const { data: { user }, error: userError } = await tempSupabase.auth.getUser(token);
    if (userError || !user) {
      return res.status(400).json({ error: 'Invalid or expired reset token' });
    }

    const { error } = await tempSupabase.auth.admin.updateUserById(user.id, {
      password: password,
    });

    if (error) {
      return res.status(400).json({ error: 'Password reset failed. Please try again.' });
    }

    res.json({ message: 'Password reset successful' });
  } catch (error) {
    res.status(400).json({ error: 'Invalid or expired token' });
  }
}

// POST /api/auth/resend-otp
async function resendOTP(req, res) {
  try {
    const { email, purpose } = req.body;
    if (!email || !purpose) {
      return res.status(400).json({ error: 'Email and purpose are required' });
    }

    if (purpose === 'signup') {
      const otp = generateOTP();
      await storeOTP(email.toLowerCase(), otp, 'signup');
      if (process.env.NODE_ENV !== 'production') {
        console.log(`\n🔑 [DEV] OTP for ${email.toLowerCase()}: ${otp}\n`);
      }
      await sendOtpEmail({ email: email.toLowerCase(), otp, purpose: 'signup' });
    } else if (purpose === 'reset') {
      const { error } = await supabase.auth.resetPasswordForEmail(email.toLowerCase());
      if (error) return res.status(400).json({ error: 'Failed to resend OTP. Please try again.' });
    }

    res.json({ message: 'OTP resent', cooldown: 60 });
  } catch (error) {
    console.error('Resend OTP error:', error);
    res.status(500).json({ error: 'Failed to resend OTP' });
  }
}

// POST /api/auth/google
async function googleLogin(req, res) {
  console.log('[AUTH] STEP 1: Received request at /api/auth/google');
  try {
    const { accessToken } = req.body;
    console.log('[AUTH] STEP 2: Received Google/Supabase token:', accessToken ? `${accessToken.substring(0, 15)}...[len=${accessToken.length}]` : 'undefined');
    
    if (!accessToken) {
      console.error('[AUTH] STEP 2 Failed: Access token is missing');
      return res.status(400).json({ 
        error: 'Access token is required', 
        code: 'INVALID_GOOGLE_TOKEN' 
      });
    }

    const authService = require('../services/auth.service');
    console.log('[AUTH] STEP 3: Verifying token with Supabase...');
    let user = await authService.verifySession(accessToken);
    console.log('[AUTH] STEP 4: Google/Supabase user successfully verified and extracted:', user.email);

    // Call role synchronization (upgrade-only safety rule)
    const { syncUserRole } = require('../services/roleSync.service');
    user = await syncUserRole(user);

    console.log('[AUTH] STEP 5: Searching/syncing database for user:', user.email);
    const mentorData = user.mentor || null;
    console.log('[AUTH] STEP 6: User created/found in DB. ID:', user.id);

    // Track last login
    prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } }).catch(() => {});

    console.log('[AUTH] STEP 7: Google session tokens sync completed. Generating response data...');
    console.log('[AUTH] STEP 8: Response sent successfully');
    
    res.json({
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        avatar: user.avatar,
        onboardingRole: user.onboardingRole || null,
        username: user.username || null,
        currentRole: user.currentRole || null,
        currency: user.currency || null,
      },
      mentor: mentorData,
      accessToken,
    });
  } catch (error) {
    console.error('[AUTH] Google login execution crashed / failed:', error);
    
    let errorCode = 'GOOGLE_VERIFICATION_FAILED';
    const msg = error.message || '';
    
    if (msg.includes('expired')) {
      errorCode = 'TOKEN_EXPIRED';
    } else if (msg.includes('database') || msg.includes('prisma') || msg.includes('ForeignKeyConstraint') || msg.includes('constraint')) {
      errorCode = 'DATABASE_ERROR';
    } else if (msg.includes('invalid') || msg.includes('signature') || msg.includes('session')) {
      errorCode = 'INVALID_GOOGLE_TOKEN';
    } else if (msg.includes('client_id') || msg.includes('audience')) {
      errorCode = 'GOOGLE_CLIENT_ID_MISMATCH';
    }

    try {
      const { PrismaClient } = require('@prisma/client');
      const debugPrisma = new PrismaClient();
      await debugPrisma.emailDeliveryLog.create({
        data: {
          toEmail: 'debug@helpmeman.com',
          subject: 'Auth Debug Log',
          templateType: 'DEBUG_AUTH_' + errorCode,
          status: 'FAILED',
          errorMessage: String(error.message || error).substring(0, 500)
        }
      });
      await debugPrisma.$disconnect();
    } catch(e) {}

    res.status(401).json({ 
      error: 'Google authentication failed. Please try again.', 
      code: errorCode,
      details: String(error.message || error).substring(0, 500)
    });
  }
}

module.exports = { register, verifySignupOTP, registerMentor, verifyMentorOTP, verifyEmail, login, googleLogin, refresh, logout, forgotPassword, verifyResetOTP, resetPassword, resendOTP };

