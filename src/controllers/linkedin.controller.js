/**
 * LinkedIn & Ruth AI Mentor Onboarding Controller
 */

const prisma = require('../config/prisma');
const config = require('../config/env');
const linkedinService = require('../services/linkedin.service');
const ruthMentorService = require('../services/ruthMentor.service');
const { generateAccessToken, generateRefreshToken } = require('../utils/jwt');
const { logAuditEvent } = require('../services/auditLog.service');

/**
 * GET /api/auth/linkedin/url or /api/linkedin/auth-url
 * Returns authorization URL for starting OAuth flow.
 */
async function getAuthUrl(req, res) {
  try {
    const userId = req.user?.id || null;
    const returnPath = req.query.returnPath || '/onboarding';
    const redirectUri = req.query.redirectUri || null;

    const url = linkedinService.generateAuthUrl({ userId, returnPath, redirectUri });
    res.json({ url });
  } catch (error) {
    console.error('[LinkedIn Controller] getAuthUrl error:', error.message);
    res.status(500).json({ error: error.message || 'Failed to generate LinkedIn authorization URL' });
  }
}

/**
 * GET /api/auth/linkedin/callback or /api/linkedin/callback
 * Handles OAuth callback from LinkedIn.
 */
async function handleOAuthCallback(req, res) {
  const { code, state, error, error_description } = req.query;

  // Derive frontend base dynamically (handles localhost dev environment smoothly)
  let frontendBase = config.frontendUrl || 'http://localhost:3000';
  if (state) {
    try {
      const verified = linkedinService.verifyState(state);
      if (verified && verified.redirectUri) {
        frontendBase = new URL(verified.redirectUri).origin;
      }
    } catch {}
  }
  if (req.headers.host?.includes('localhost') || req.headers.referer?.includes('localhost')) {
    frontendBase = 'http://localhost:3000';
  }

  // 1. Handle user cancellation or provider error
  if (error) {
    console.warn(`[LinkedIn OAuth] OAuth cancelled or failed: ${error} - ${error_description}`);
    const isCancelled = error === 'user_cancelled_authorize' || error === 'access_denied';
    const errorParam = isCancelled ? 'cancelled' : 'oauth_error';
    return res.redirect(`${frontendBase}/onboarding?linkedinError=${errorParam}&message=${encodeURIComponent(error_description || 'LinkedIn authorization cancelled')}`);
  }

  // 2. Validate state parameter (CSRF protection)
  if (!state || !code) {
    console.error('[LinkedIn OAuth] Missing code or state parameter in callback');
    return res.redirect(`${frontendBase}/onboarding?linkedinError=invalid_state`);
  }

  const verifiedState = linkedinService.verifyState(state);
  if (!verifiedState) {
    console.error('[LinkedIn OAuth] Invalid or expired state parameter');
    return res.redirect(`${frontendBase}/onboarding?linkedinError=invalid_state`);
  }

  try {
    // 3. Exchange code for access token
    const tokenData = await linkedinService.exchangeCodeForTokens(code, verifiedState.redirectUri);

    // 4. Fetch userinfo from LinkedIn OpenID Connect API
    const rawUserInfo = await linkedinService.fetchLinkedInProfile(tokenData.access_token);
    const normalized = linkedinService.normalizeLinkedInProfile(rawUserInfo);

    if (!normalized || !normalized.linkedinId) {
      throw new Error('Unable to extract valid profile identifier from LinkedIn response');
    }

    // 5. Identify or provision the HelpMeMan User
    let userId = verifiedState.userId;
    let targetUser = null;

    if (userId) {
      targetUser = await prisma.user.findUnique({ where: { id: userId } });
    }

    // If unauthenticated or user wasn't found by state ID, look up by LinkedIn email
    if (!targetUser && normalized.email) {
      targetUser = await prisma.user.findUnique({ where: { email: normalized.email.toLowerCase() } });
    }

    // If still no user, create a new User account for this mentor
    if (!targetUser) {
      if (!normalized.email) {
        throw new Error('LinkedIn account did not provide an email address.');
      }
      targetUser = await prisma.user.create({
        data: {
          name: normalized.name || 'Mentor Candidate',
          email: normalized.email.toLowerCase(),
          passwordHash: '',
          role: 'MENTOR',
          onboardingRole: 'MENTOR',
          avatar: normalized.profileImage || null,
          isEmailVerified: true,
        },
      });
      console.log(`[LinkedIn OAuth] Created new user ${targetUser.id} (${targetUser.email}) from LinkedIn`);
    } else {
      // Ensure mentor role is assigned if not admin
      if (targetUser.role !== 'ADMIN' && targetUser.role !== 'SUPER_ADMIN') {
        targetUser = await prisma.user.update({
          where: { id: targetUser.id },
          data: {
            onboardingRole: 'MENTOR',
            role: 'MENTOR',
            avatar: targetUser.avatar || normalized.profileImage || null,
          },
        });
      }
    }

    userId = targetUser.id;

    // 6. Save encrypted LinkedIn credentials & normalized profile
    try {
      await linkedinService.saveLinkedInData({
        userId,
        tokens: tokenData,
        normalizedProfile: normalized,
      });
    } catch (saveErr) {
      if (saveErr.code === 'LINKEDIN_ACCOUNT_CONFLICT') {
        return res.redirect(`${frontendBase}/onboarding?linkedinError=account_conflict`);
      }
      throw saveErr;
    }

    // 7. Generate HelpMeMan session tokens for frontend authentication
    const accessToken = generateAccessToken({
      userId: targetUser.id,
      email: targetUser.email,
      role: targetUser.role,
    });
    const refreshToken = generateRefreshToken({
      userId: targetUser.id,
    });

    logAuditEvent({
      action: 'LINKEDIN_AUTH_SUCCESS',
      actorId: targetUser.id,
      req,
      metadata: { linkedinId: normalized.linkedinId, email: targetUser.email },
    }).catch(() => {});

    // 8. Set auth cookies and redirect user to frontend onboarding review
    res.cookie('helpmeman.accessToken', accessToken, {
      maxAge: 30 * 24 * 60 * 60 * 1000,
      httpOnly: false,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
    });
    res.cookie('helpmeman.role', targetUser.role, {
      maxAge: 30 * 24 * 60 * 60 * 1000,
      httpOnly: false,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
    });

    const returnPath = verifiedState.returnPath || '/onboarding';
    const redirectUrl = new URL(returnPath, frontendBase);
    redirectUrl.searchParams.set('linkedin', 'success');
    redirectUrl.searchParams.set('token', accessToken);
    redirectUrl.searchParams.set('refreshToken', refreshToken);

    return res.redirect(redirectUrl.toString());
  } catch (err) {
    console.error('[LinkedIn OAuth] Callback processing error:', err.message);
    const safeMsg = err.code === 'LINKEDIN_ACCOUNT_CONFLICT'
      ? 'account_conflict'
      : 'import_failed';
    return res.redirect(`${frontendBase}/onboarding?linkedinError=${safeMsg}`);
  }
}

/**
 * GET /api/linkedin/profile
 * Returns the authenticated user's imported LinkedIn profile.
 */
async function getImportedProfile(req, res) {
  try {
    const data = await linkedinService.getImportedProfile(req.user.id);
    if (!data) {
      return res.json({ connected: false, profile: null });
    }
    res.json(data);
  } catch (error) {
    console.error('[LinkedIn Controller] getImportedProfile error:', error.message);
    res.status(500).json({ error: 'Failed to retrieve imported profile' });
  }
}

/**
 * POST /api/ruth/analyze-mentor
 * Analyzes imported profile data using Ruth AI.
 */
async function analyzeWithRuth(req, res) {
  try {
    const userId = req.user.id;
    let profileData = req.body.profileData;

    // If profileData is not provided in body, load from DB
    if (!profileData) {
      const stored = await prisma.linkedInProfile.findUnique({ where: { userId } });
      if (!stored) {
        return res.status(400).json({ error: 'No profile data found to analyze.' });
      }
      profileData = stored;
    }

    const analysis = await ruthMentorService.analyzeMentorProfile(profileData);
    res.json(analysis);
  } catch (error) {
    console.error('[LinkedIn Controller] analyzeWithRuth error:', error.message);
    res.status(500).json({ error: 'Ruth AI analysis failed' });
  }
}

/**
 * POST /api/mentor/profile/publish
 * Publishes user-confirmed mentor profile with Ruth suggestions.
 */
async function publishMentorProfile(req, res) {
  try {
    const userId = req.user.id;
    const {
      displayName,
      bio,
      currentRole,
      company,
      location,
      pricePerSession,
      sessionDuration,
      languages,
      expertise,
      mentoringTopics,
      categorySlug,
      availabilities,
      avatar,
      experienceYears,
    } = req.body;

    if (!displayName || !bio) {
      return res.status(400).json({ error: 'Display name and bio are required.' });
    }

    // Resolve category
    const slug = categorySlug || 'general-mentorship';
    let category = await prisma.category.findUnique({ where: { slug } });
    if (!category) {
      category = await prisma.category.findFirst({ where: { isActive: true } });
      if (!category) {
        category = await prisma.category.create({
          data: {
            name: 'General Mentorship',
            slug: 'general-mentorship',
            description: 'Cross-functional career mentorship',
          },
        });
      }
    }

    const price = typeof pricePerSession === 'number' ? pricePerSession : (parseInt(pricePerSession, 10) || 0);
    const duration = typeof sessionDuration === 'number' ? sessionDuration : (parseInt(sessionDuration, 10) || 30);
    const langs = Array.isArray(languages) && languages.length > 0 ? languages : ['English'];
    const skillsList = Array.isArray(expertise) ? expertise : [];

    // Parse structured location
    let country = 'India';
    let city = location || 'Online';
    if (location && location.includes(',')) {
      const parts = location.split(',').map(s => s.trim());
      city = parts[0];
      country = parts[parts.length - 1];
    }

    // Upsert Mentor record
    const mentor = await prisma.mentor.upsert({
      where: { userId },
      update: {
        displayName,
        bio,
        avatar: avatar || req.user.avatar || null,
        currentRole: currentRole || null,
        company: company || null,
        expertise: skillsList,
        categoryId: category.id,
        pricePerSession: price * 100, // store in paise
        sessionDuration: duration,
        location: location || null,
        city,
        country,
        languages: langs,
        experienceYears: typeof experienceYears === 'number' ? experienceYears : null,
        approvalStatus: 'APPROVED',
        isActive: true,
      },
      create: {
        userId,
        displayName,
        bio,
        avatar: avatar || req.user.avatar || null,
        institutionType: 'COMPANY',
        institutionName: company || 'Independent',
        institutionEmail: req.user.email,
        currentRole: currentRole || null,
        company: company || null,
        expertise: skillsList,
        categoryId: category.id,
        pricePerSession: price * 100,
        sessionDuration: duration,
        location: location || null,
        city,
        country,
        languages: langs,
        experienceYears: typeof experienceYears === 'number' ? experienceYears : null,
        approvalStatus: 'APPROVED',
        isActive: true,
      },
    });

    // Update MentorProfile
    await prisma.mentorProfile.upsert({
      where: { mentorId: userId },
      update: {
        name: displayName,
        preferredName: displayName.split(' ')[0] || displayName,
        role: currentRole || null,
        company: company || null,
        location: location || null,
        skills: skillsList,
        expertiseTags: skillsList.slice(0, 8),
        bio,
        summary: bio,
        onboardingStatus: 'COMPLETED',
        completedAt: new Date(),
      },
      create: {
        mentorId: userId,
        name: displayName,
        preferredName: displayName.split(' ')[0] || displayName,
        role: currentRole || null,
        company: company || null,
        location: location || null,
        skills: skillsList,
        expertiseTags: skillsList.slice(0, 8),
        bio,
        summary: bio,
        onboardingStatus: 'COMPLETED',
        completedAt: new Date(),
      },
    });

    // Update MentorOnboarding record
    await prisma.mentorOnboarding.upsert({
      where: { userId },
      update: { completed: true },
      create: { userId, completed: true, currentQuestion: 10, answers: [] },
    });

    // Save default availability if provided
    if (Array.isArray(availabilities) && availabilities.length > 0) {
      await prisma.availability.deleteMany({ where: { mentorId: mentor.id } });
      await prisma.availability.createMany({
        data: availabilities.map(a => ({
          mentorId: mentor.id,
          dayOfWeek: Number(a.dayOfWeek),
          startTime: String(a.startTime || '09:00'),
          endTime: String(a.endTime || '18:00'),
          isActive: true,
        })),
      });
    }

    // Save mentor memory from confirmed profile
    try {
      const memoryContent = `Mentor: ${displayName}\nRole: ${currentRole} at ${company}\nExpertise: ${skillsList.join(', ')}\nTopics: ${Array.isArray(mentoringTopics) ? mentoringTopics.join(', ') : ''}`;
      await prisma.mentorMemory.create({
        data: {
          mentorId: userId,
          content: memoryContent,
          metadata: { type: 'linkedin_onboarding_published' },
        },
      });
    } catch (e) {}

    // Send confirmation email
    try {
      const { sendMentorUnderReviewEmail, sendMentorApplicationToAdminEmail } = require('../services/email.service');
      await sendMentorUnderReviewEmail(req.user).catch(() => {});
      await sendMentorApplicationToAdminEmail(req.user, [
        { question: 'Role & Company', answer: `${currentRole} at ${company}` },
        { question: 'Expertise', answer: skillsList.join(', ') },
      ]).catch(() => {});
    } catch (e) {}

    logAuditEvent({
      action: 'MENTOR_PROFILE_PUBLISHED',
      actorId: userId,
      req,
      metadata: { mentorId: mentor.id, role: currentRole, company },
    }).catch(() => {});

    console.log(`[Mentor Onboarding] Mentor profile successfully published for user ${userId}`);
    res.json({
      success: true,
      mentor: {
        id: mentor.id,
        approvalStatus: mentor.approvalStatus,
        isActive: mentor.isActive,
      },
    });
  } catch (error) {
    console.error('[LinkedIn Controller] publishMentorProfile error:', error.message);
    res.status(500).json({ error: error.message || 'Failed to publish mentor profile' });
  }
}

/**
 * POST /api/linkedin/disconnect
 * Disconnects LinkedIn and removes sensitive tokens.
 */
async function disconnect(req, res) {
  try {
    const result = await linkedinService.disconnectLinkedIn(req.user.id);
    res.json(result);
  } catch (error) {
    console.error('[LinkedIn Controller] disconnect error:', error.message);
    res.status(500).json({ error: 'Failed to disconnect LinkedIn account' });
  }
}

module.exports = {
  getAuthUrl,
  handleOAuthCallback,
  getImportedProfile,
  analyzeWithRuth,
  publishMentorProfile,
  disconnect,
};
