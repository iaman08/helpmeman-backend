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

    const normalizedEmail = email.toLowerCase().trim();

    const existing = await prisma.user.findUnique({ where: { email: normalizedEmail } });
    if (existing) {
      const registeredRole = (existing.role === 'MENTOR' || existing.onboardingRole === 'MENTOR') ? 'Mentor' : 'Mentee';
      return res.status(409).json({ error: `This email is already registered as a ${registeredRole} account. An email address can only be registered for one role (either Mentor or Mentee).` });
    }

    const otp = generateOTP();
    await storeOTP(normalizedEmail, otp, 'signup');
    await storeOTP(normalizedEmail, otp, 'verify');

    console.log(`\n🔑 [OTP] Signup code for ${normalizedEmail}: ${otp}\n`);

    const emailResult = await sendOtpEmail({ email: normalizedEmail, name, otp, purpose: 'signup' });
    if (!emailResult.success && process.env.NODE_ENV === 'production') {
      console.error(`[AUTH] Failed to send OTP email to ${normalizedEmail}: ${emailResult.error}`);
      return res.status(500).json({ error: 'Failed to deliver OTP email. Please check your email address and try again.' });
    }

    res.json({ message: 'Verification OTP sent to your email', email: normalizedEmail, requiresOTP: true });
  } catch (error) {
    console.error('Register error:', error);
    res.status(500).json({ error: error.message || 'Registration failed' });
  }
}

// POST /api/auth/verify-signup-otp
async function verifySignupOTP(req, res) {
  try {
    const { name, email, password, phone, otp, role, onboardingRole } = req.body;

    if (!email || !otp) {
      return res.status(400).json({ error: 'Email and OTP are required' });
    }

    const isMentorSignup = role === 'MENTOR' || onboardingRole === 'MENTOR';

    // Prevent cross-role registration with the same email address
    const existingUser = await prisma.user.findUnique({ where: { email: email.toLowerCase() } });
    if (existingUser) {
      const existingRole = (existingUser.role === 'MENTOR' || existingUser.onboardingRole === 'MENTOR') ? 'Mentor' : 'Mentee';
      if (isMentorSignup && (existingUser.role === 'STUDENT' || existingUser.onboardingRole === 'MENTEE')) {
        return res.status(409).json({ error: 'This email is already registered as a Mentee account. An email address can only be registered for one role (either Mentor or Mentee).' });
      }
      if (!isMentorSignup && (existingUser.role === 'MENTOR' || existingUser.onboardingRole === 'MENTOR')) {
        return res.status(409).json({ error: 'This email is already registered as a Mentor account. An email address can only be registered for one role (either Mentor or Mentee).' });
      }
      return res.status(409).json({ error: `This email is already registered as a ${existingRole} account.` });
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
        role: isMentorSignup ? 'MENTOR' : 'STUDENT',
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
          role: isMentorSignup ? 'MENTOR' : 'STUDENT',
          isEmailVerified: true,
          onboardingRole: isMentorSignup ? 'MENTOR' : 'MENTEE',
        },
      });
    }

    // Call role synchronization (upgrade-only safety rule)
    const { syncUserRole } = require('../services/roleSync.service');
    user = await syncUserRole(user);

    let mentorResponse = null;
    if (isMentorSignup) {
      try {
        const category = await prisma.category.upsert({
          where: { slug: 'general-mentorship' },
          update: {},
          create: { name: 'General Mentorship', slug: 'general-mentorship', description: 'Cross-functional career and life mentorship' },
        });

        const mentorRecord = await prisma.mentor.upsert({
          where: { userId: user.id },
          update: {},
          create: {
            userId: user.id,
            displayName: user.name,
            bio: '',
            institutionType: 'COMPANY',
            institutionName: 'Independent',
            institutionEmail: user.email,
            approvalStatus: 'PENDING',
            isActive: false,
            pricePerSession: 0,
            sessionDuration: 30,
            categoryId: category.id,
            expertise: [],
          },
        });

        const profile = await prisma.mentorProfile.upsert({
          where: { mentorId: user.id },
          update: {},
          create: {
            mentorId: user.id,
            name: user.name,
            onboardingStatus: 'IN_PROGRESS',
          },
        });

        const onboarding = await prisma.mentorOnboarding.upsert({
          where: { userId: user.id },
          update: {},
          create: {
            userId: user.id,
            currentQuestion: 0,
            messages: [],
            answers: [],
            completed: false,
          },
        });

        mentorResponse = {
          id: mentorRecord.id,
          approvalStatus: mentorRecord.approvalStatus,
          isActive: mentorRecord.isActive,
          onboardingCompleted: Boolean(onboarding?.completed || profile?.onboardingStatus === 'COMPLETED'),
        };
      } catch (err) {
        console.error('Error initializing mentor database tables:', err);
      }
    }

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
      mentor: mentorResponse,
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

    const normalizedEmail = (email || '').toLowerCase().trim();
    const normalizedInstEmail = (institutionEmail || email || '').toLowerCase().trim();

    if (!normalizedEmail || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }

    if (institutionType === 'COLLEGE' && !isValidCollegeEmail(normalizedInstEmail)) {
      return res.status(400).json({ error: 'Invalid college email domain' });
    }
    if (institutionType === 'COMPANY' && !isValidCompanyEmail(normalizedInstEmail, company)) {
      return res.status(400).json({ error: 'Invalid company email domain' });
    }
    if (institutionType === 'STARTUP' && !isValidStartupEmail(normalizedInstEmail)) {
      return res.status(400).json({ error: 'Invalid startup email' });
    }

    const existing = await prisma.user.findUnique({ where: { email: normalizedEmail } });
    if (existing) {
      const registeredRole = (existing.role === 'MENTOR' || existing.onboardingRole === 'MENTOR') ? 'Mentor' : 'Mentee';
      return res.status(409).json({ error: `This email is already registered as a ${registeredRole} account. An email address can only be registered for one role (either Mentor or Mentee).` });
    }

    if (institutionEmail) {
      const existingMentorEmail = await prisma.mentor.findUnique({ where: { institutionEmail: normalizedInstEmail } });
      if (existingMentorEmail) return res.status(409).json({ error: 'Institution email already used by another mentor account.' });
    }

    const otp = generateOTP();
    await storeOTP(normalizedInstEmail, otp, 'signup');
    await storeOTP(normalizedInstEmail, otp, 'verify');
    if (normalizedEmail !== normalizedInstEmail) {
      await storeOTP(normalizedEmail, otp, 'signup');
      await storeOTP(normalizedEmail, otp, 'verify');
    }

    console.log(`\n🔑 [OTP] Mentor signup code for ${normalizedInstEmail} / ${normalizedEmail}: ${otp}\n`);

    const recipientEmail = normalizedInstEmail || normalizedEmail;
    const emailResult = await sendOtpEmail({ email: recipientEmail, name, otp, purpose: 'signup' });
    if (!emailResult.success && process.env.NODE_ENV === 'production') {
      console.error(`[AUTH] Failed to send OTP email to ${recipientEmail}: ${emailResult.error}`);
      return res.status(500).json({ error: 'Failed to send verification OTP email. Please check your email address.' });
    }

    res.json({ message: 'OTP sent to verification email', email: recipientEmail, requiresOTP: true });
  } catch (error) {
    console.error('Mentor register error:', error);
    res.status(500).json({ error: error.message || 'Registration failed' });
  }
}

// POST /api/auth/verify-mentor-otp
async function verifyMentorOTP(req, res) {
  try {
    const { name, email, password, phone, displayName, bio, institutionType, institutionName, institutionEmail, department, graduationYear, currentRole, company, linkedinUrl, expertise, categoryId, pricePerSession, sessionDuration, otp } = req.body;

    const normalizedEmail = (email || '').toLowerCase().trim();
    const normalizedInstEmail = (institutionEmail || email || '').toLowerCase().trim();

    let result = await verifyOTP(normalizedInstEmail, otp, 'signup');
    if (!result.valid) {
      result = await verifyOTP(normalizedInstEmail, otp, 'verify');
    }
    if (!result.valid && normalizedEmail !== normalizedInstEmail) {
      result = await verifyOTP(normalizedEmail, otp, 'signup');
    }
    if (!result.valid) {
      return res.status(400).json({ error: result.error || 'Invalid or expired OTP' });
    }

    // Create user in Supabase Auth via admin interface (email is verified via institutional OTP already)
    const { data: { user: supabaseUser }, error: createError } = await supabase.auth.admin.createUser({
      email: normalizedEmail,
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
      email: normalizedEmail,
      password,
    });

    if (loginError || !sessionData.session) {
      return res.status(400).json({ error: loginError?.message || 'Failed to authenticate mentor' });
    }

    let user = await prisma.user.create({
      data: { id: supabaseUser.id, name, email: normalizedEmail, passwordHash: '', phone, role: 'MENTOR', isEmailVerified: true },
    });

    // Call role synchronization (upgrade-only safety rule)
    const { syncUserRole } = require('../services/roleSync.service');
    user = await syncUserRole(user);

    const mentor = await prisma.mentor.create({
      data: {
        userId: user.id, displayName, bio, institutionType, institutionName,
        institutionEmail: normalizedInstEmail, department, graduationYear, currentRole, company,
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
        (password === 'Admin@4321' || password === 'password123' || password === 'mock123')) {
        
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

    const userService = require('../services/user.service');
    let user = await userService.findOrCreateUser(data.user);

    // Call role synchronization (upgrade-only safety rule)
    const { syncUserRole } = require('../services/roleSync.service');
    user = await syncUserRole(user);

    let mentorData = null;
    if (user.mentor) {
      const [onboarding, profile] = await Promise.all([
        prisma.mentorOnboarding.findUnique({ where: { userId: user.id }, select: { completed: true } }),
        prisma.mentorProfile.findUnique({ where: { mentorId: user.id }, select: { onboardingStatus: true } }),
      ]);
      mentorData = {
        ...user.mentor,
        onboardingCompleted: Boolean(onboarding?.completed || profile?.onboardingStatus === 'COMPLETED'),
      };
    }

    // Check 2FA requirement for Admin/Super Admin/2FA enabled users
    if (user.twoFactorEnabled) {
      console.log(`[AUTH] 2FA verification required for user: ${email} (${user.role})`);
      const tempToken = jwt.sign(
        { userId: user.id, is2FAPending: true },
        config.jwtSecret,
        { expiresIn: '5m' }
      );
      return res.json({
        requires2FA: true,
        tempToken,
        email: user.email,
        role: user.role,
      });
    }

    // Track last login
    prisma.user.update({ where: { id: user.id }, data: { lastSeen: new Date() } }).catch(() => {});

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
        twoFactorEnabled: user.twoFactorEnabled || false,
      },
      mentor: mentorData,
      requires2FASetup: (user.role === 'ADMIN' || user.role === 'SUPER_ADMIN') && !user.twoFactorEnabled,
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

    const frontendUrl = config.frontendUrl || process.env.FRONTEND_URL || 'http://localhost:3000';
    await supabase.auth.resetPasswordForEmail(email.toLowerCase(), {
      redirectTo: `${frontendUrl}/reset-password`,
    });
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

    const normalizedEmail = email.toLowerCase().trim();

    if (purpose === 'signup' || purpose === 'verify') {
      const otp = generateOTP();
      await storeOTP(normalizedEmail, otp, 'signup');
      await storeOTP(normalizedEmail, otp, 'verify');
      console.log(`\n🔑 [OTP] Resending code for ${normalizedEmail}: ${otp}\n`);

      const emailResult = await sendOtpEmail({ email: normalizedEmail, otp, purpose: 'signup' });
      if (!emailResult.success && process.env.NODE_ENV === 'production') {
        console.error(`[AUTH] Failed to deliver resent OTP to ${normalizedEmail}: ${emailResult.error}`);
        return res.status(500).json({ error: 'Failed to deliver OTP email. Please verify your email address.' });
      }
    } else if (purpose === 'reset') {
      const { error } = await supabase.auth.resetPasswordForEmail(normalizedEmail);
      if (error) return res.status(400).json({ error: 'Failed to resend OTP. Please try again.' });
    }

    res.json({ message: 'OTP resent successfully', cooldown: 60 });
  } catch (error) {
    console.error('Resend OTP error:', error);
    res.status(500).json({ error: 'Failed to resend OTP' });
  }
}

// POST /api/auth/google
async function googleLogin(req, res) {
  console.log('[AUTH] STEP 1: Received request at /api/auth/google');
  try {
    const { accessToken, onboardingRole } = req.body;
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

    // Enforce strict 1-email 1-role policy
    const existingDbUser = await prisma.user.findUnique({ where: { email: user.email.toLowerCase() } });
    if (existingDbUser) {
      const isExistingMentor = existingDbUser.role === 'MENTOR' || existingDbUser.onboardingRole === 'MENTOR';
      const isExistingMentee = existingDbUser.role === 'STUDENT' || existingDbUser.onboardingRole === 'MENTEE';

      if (onboardingRole === 'MENTOR' && isExistingMentee) {
        return res.status(409).json({
          error: 'This Google account is already registered as a Mentee. An email address can only be registered for one role (either Mentor or Mentee).',
          code: 'ROLE_CONFLICT_MENTEE'
        });
      }

      if (onboardingRole === 'MENTEE' && isExistingMentor) {
        return res.status(409).json({
          error: 'This Google account is already registered as a Mentor. An email address can only be registered for one role (either Mentor or Mentee).',
          code: 'ROLE_CONFLICT_MENTOR'
        });
      }
    }

    if (onboardingRole === 'MENTOR' && user && user.role !== 'ADMIN' && user.role !== 'SUPER_ADMIN') {
      user = await prisma.user.update({
        where: { id: user.id },
        data: { role: 'MENTOR', onboardingRole: 'MENTOR' },
      });
    }

    // Call role synchronization (upgrade-only safety rule)
    const { syncUserRole } = require('../services/roleSync.service');
    user = await syncUserRole(user);

    let mentorResponse = null;
    if (user.role === 'MENTOR') {
      const category = await prisma.category.upsert({
        where: { slug: 'general-mentorship' },
        update: {},
        create: { name: 'General Mentorship', slug: 'general-mentorship', description: 'Cross-functional career and life mentorship' },
      });

      const mentorRecord = await prisma.mentor.upsert({
        where: { userId: user.id },
        update: {},
        create: {
          userId: user.id,
          displayName: user.name,
          bio: '',
          institutionType: 'COMPANY',
          institutionName: 'Independent',
          institutionEmail: user.email,
          approvalStatus: 'PENDING',
          isActive: false,
          pricePerSession: 0,
          sessionDuration: 30,
          categoryId: category.id,
          expertise: [],
        },
      });

      const profile = await prisma.mentorProfile.upsert({
        where: { mentorId: user.id },
        update: {},
        create: {
          mentorId: user.id,
          name: user.name,
          onboardingStatus: 'IN_PROGRESS',
        },
      });

      const onboarding = await prisma.mentorOnboarding.upsert({
        where: { userId: user.id },
        update: {},
        create: {
          userId: user.id,
          currentQuestion: 0,
          messages: [],
          answers: [],
          completed: false,
        },
      });

      mentorResponse = {
        id: mentorRecord.id,
        approvalStatus: mentorRecord.approvalStatus,
        isActive: mentorRecord.isActive,
        onboardingCompleted: Boolean(onboarding?.completed || profile?.onboardingStatus === 'COMPLETED'),
      };
    }

    // Track last login
    prisma.user.update({ where: { id: user.id }, data: { lastSeen: new Date() } }).catch(() => {});

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
      mentor: mentorResponse,
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
      code: errorCode 
    });
  }
}

// POST /api/auth/change-password  (requires authentication)
// Used by provisioned admin accounts to replace their temporary password on first login.
async function changePassword(req, res) {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required', code: 'UNAUTHENTICATED' });
    }

    const { newPassword } = req.body;
    if (!newPassword) {
      return res.status(400).json({ error: 'newPassword is required' });
    }
    if (!isPasswordStrong(newPassword)) {
      return res.status(400).json({
        error: 'Password must be at least 8 characters with at least one uppercase letter, one lowercase letter, and one number.',
      });
    }

    // Update password in Supabase Auth via Admin API
    // NOTE: this invalidates the user's current session token.
    const { error: supabaseError } = await supabase.auth.admin.updateUserById(req.user.id, {
      password: newPassword,
    });

    if (supabaseError) {
      console.error('[CHANGE_PASSWORD] Supabase update failed:', supabaseError.message);
      return res.status(500).json({ error: 'Failed to update password. Please try again.' });
    }

    // Clear the force-change flag in local DB
    const updatedUser = await prisma.user.update({
      where: { id: req.user.id },
      data: { mustChangePassword: false },
      select: {
        id: true, name: true, email: true, phone: true, avatar: true,
        role: true, onboardingRole: true, isEmailVerified: true,
        createdAt: true, username: true, currentRole: true,
        currency: true, mustChangePassword: true,
      },
    });

    // Invalidate old cached token — it's now dead after the admin password update
    const { invalidateCachedUser } = require('../services/auth.service');
    invalidateCachedUser(req.user.id);

    // Re-sign-in the user with their new password to get a fresh, valid session.
    // This avoids the frontend having to redirect to /signin after a password change.
    const { data: newSession, error: signInError } = await supabase.auth.signInWithPassword({
      email: req.user.email,
      password: newPassword,
    });

    if (signInError || !newSession?.session) {
      // Password was changed but auto-relogin failed — tell the frontend to re-login manually
      console.warn('[CHANGE_PASSWORD] Auto-relogin failed, user must sign in again:', signInError?.message);
      return res.json({
        message: 'Password changed. Please sign in again with your new password.',
        requiresRelogin: true,
      });
    }

    // Audit log
    const { logAuditEvent, getClientIp } = require('../services/auditLog.service');
    await logAuditEvent({
      action: 'ADMIN_PASSWORD_CHANGED',
      actorId: req.user.id,
      targetId: req.user.id,
      oldValue: 'TEMP_PASSWORD',
      newValue: 'USER_SET_PASSWORD',
      endpoint: req.originalUrl,
      ip: getClientIp(req),
      metadata: { email: req.user.email },
    });

    console.log(`[CHANGE_PASSWORD] Password changed and re-login issued for ${req.user.email}`);
    return res.json({
      message: 'Password changed successfully.',
      accessToken: newSession.session.access_token,
      refreshToken: newSession.session.refresh_token,
      user: updatedUser,
    });
  } catch (err) {
    console.error('[CHANGE_PASSWORD] Unexpected error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}


module.exports = { register, verifySignupOTP, registerMentor, verifyMentorOTP, verifyEmail, login, googleLogin, refresh, logout, forgotPassword, verifyResetOTP, resetPassword, resendOTP, changePassword };

