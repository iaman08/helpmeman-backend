const { test } = require('node:test');
const assert = require('node:assert/strict');
const { setup, loadController, response } = require('../services/onboardingTestFixture');

test('OTP mentor signup starts an interview and never publishes an approved mentor', async () => {
  const ctx = setup();
  ctx.rows().user.length = 0;
  const res = response();
  await loadController('auth', ctx).verifySignupOTP({ body: {
    name: 'Test Mentor', email: 'mentor@example.test', password: 'TestPassword123', otp: '123456', role: 'MENTOR',
  } }, res);
  assert.equal(res.statusCode, 201);
  assert.equal(res.body.user.role, 'MENTOR');
  assert.equal(res.body.mentor, null);
  assert.equal(ctx.rows().mentor.length, 0);
  assert.equal(ctx.rows().mentorOnboarding[0].completed, false);
  assert.equal(ctx.rows().mentorProfile[0].onboardingStatus, 'IN_PROGRESS');
});

test('Google mentor signup creates a resumable draft', async () => {
  const ctx = setup();
  const res = response();
  await loadController('auth', ctx).googleLogin({ body: { accessToken: 'test-google-token', onboardingRole: 'MENTOR' } }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.user.role, 'MENTOR');
  assert.equal(res.body.mentor, null);
  assert.equal(ctx.rows().mentor.length, 0);
  assert.equal(ctx.rows().mentorOnboarding[0].completed, false);
});

for (const status of ['PENDING', 'REJECTED', 'APPROVED']) {
  test(`Google login preserves ${status} admin decisions`, async () => {
    const ctx = setup();
    await ctx.service.selectRole('candidate', 'MENTOR');
    await ctx.prisma.mentor.create({ data: { userId: 'candidate', approvalStatus: status, isActive: status === 'APPROVED' } });
    await ctx.prisma.mentorOnboarding.update({ where: { userId: 'candidate' }, data: { completed: true } });
    await ctx.prisma.mentorProfile.update({ where: { mentorId: 'candidate' }, data: { onboardingStatus: 'COMPLETED_EMAIL_SENT' } });
    const res = response();
    await loadController('auth', ctx).googleLogin({ body: { accessToken: 'test-google-token' } }, res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.mentor.approvalStatus, status);
    assert.equal(res.body.mentor.onboardingCompleted, true);
    assert.equal(ctx.rows().mentorProfile[0].onboardingStatus, 'COMPLETED_EMAIL_SENT');
  });
}

const application = () => ({
  displayName: 'Test Mentor', headline: 'Senior Engineer', bio: 'I help students prepare for technical interviews.',
  currentRole: 'Engineer', company: 'Example', location: 'Bengaluru, India', categorySlug: 'general-mentorship',
  expertise: ['Engineering'], mentoringTopics: ['Interview practice'], languages: ['English'],
  pricePerSession: 499.99, sessionDuration: 30, experienceYears: 0,
  availabilities: [{ dayOfWeek: 1, startTime: '18:00', endTime: '21:00' }],
});

test('LinkedIn submission saves review details, headline, price in paise and schedule', async () => {
  const ctx = setup();
  const res = response();
  await loadController('linkedin', ctx).publishMentorProfile({ user: ctx.rows().user[0], body: application() }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.mentor.approvalStatus, 'PENDING');
  assert.equal(res.body.mentor.isActive, false);
  assert.equal(ctx.rows().mentor[0].headline, 'Senior Engineer');
  assert.equal(ctx.rows().mentor[0].pricePerSession, 49999);
  assert.equal(ctx.rows().mentor[0].experienceYears, 0);
  assert.equal(ctx.rows().availability.length, 1);
  assert.ok(ctx.rows().mentorOnboarding[0].answers.some(a => a.question === 'Expertise'));
  assert.equal(ctx.rows().mentorProfile[0].onboardingStatus, 'COMPLETED_EMAIL_SENT');
  assert.equal(ctx.rows().user[0].role, 'MENTOR');
});

test('LinkedIn retry preserves rejection and does not resend successful emails', async () => {
  const ctx = setup();
  const controller = loadController('linkedin', ctx);
  await controller.publishMentorProfile({ user: ctx.rows().user[0], body: application() }, response());
  await ctx.prisma.mentor.update({ where: { userId: 'candidate' }, data: { approvalStatus: 'REJECTED' } });
  const res = response();
  await controller.publishMentorProfile({ user: ctx.rows().user[0], body: application() }, res);
  assert.equal(res.body.mentor.approvalStatus, 'REJECTED');
  assert.equal(ctx.controls.emails, 2);
  assert.equal(ctx.rows().availability.length, 1);
});

test('LinkedIn profile failure rolls back the mentor, schedule and completion', async () => {
  const ctx = setup();
  ctx.controls.failProfile = true;
  const res = response();
  await loadController('linkedin', ctx).publishMentorProfile({ user: ctx.rows().user[0], body: application() }, res);
  assert.equal(res.statusCode, 500);
  assert.equal(ctx.rows().mentor.length, 0);
  assert.equal(ctx.rows().mentorOnboarding.length, 0);
  assert.equal(ctx.rows().availability.length, 0);
});

for (const [label, change] of [
  ['negative price', { pricePerSession: -1 }],
  ['fractional duration', { sessionDuration: 1.5 }],
  ['invalid weekday', { availabilities: [{ dayOfWeek: 7, startTime: '09:00', endTime: '10:00' }] }],
  ['reversed time range', { availabilities: [{ dayOfWeek: 1, startTime: '18:00', endTime: '10:00' }] }],
  ['overlapping slots', { availabilities: [{ dayOfWeek: 1, startTime: '09:00', endTime: '11:00' }, { dayOfWeek: 1, startTime: '10:00', endTime: '12:00' }] }],
  ['invalid expertise', { expertise: [42] }],
]) {
  test(`LinkedIn rejects ${label} before persisting anything`, async () => {
    const ctx = setup();
    const res = response();
    await loadController('linkedin', ctx).publishMentorProfile({ user: ctx.rows().user[0], body: { ...application(), ...change } }, res);
    assert.equal(res.statusCode, 400);
    assert.equal(ctx.rows().mentor.length, 0);
    assert.equal(ctx.rows().mentorOnboarding.length, 0);
  });
}

for (const body of [undefined, null, [], 'invalid']) {
  test(`LinkedIn rejects malformed application ${JSON.stringify(body)} as a client error`, async () => {
    const ctx = setup();
    const res = response();
    await loadController('linkedin', ctx).publishMentorProfile({ user: ctx.rows().user[0], body }, res);
    assert.equal(res.statusCode, 400);
    assert.equal(ctx.rows().mentor.length, 0);
  });
}

test('the answer endpoint rejects a string skip flag instead of skipping an answer', async () => {
  const ctx = setup();
  await ctx.service.selectRole('candidate', 'MENTOR');
  const res = response();
  await loadController('onboarding', ctx).answer({ user: ctx.rows().user[0], body: { answer: 'Test Mentor', skip: 'false' } }, res);
  assert.equal(res.statusCode, 400);
  assert.equal((await ctx.service.getState('candidate')).currentQuestion, 0);
});

test('signup synchronizes a provider-triggered student row before responding as a mentor', async () => {
  const ctx = setup(); ctx.rows().user.length = 0;
  const controller = loadController('auth', ctx, {
    '../config/supabase': { auth: {
      admin: { createUser: async () => { await ctx.prisma.user.create({ data: { id: 'candidate', name: 'Trigger User', email: 'mentor@example.test', role: 'STUDENT', onboardingRole: 'MENTEE' } }); return { data: { user: { id: 'candidate' } } }; } },
      signInWithPassword: async () => ({ data: { user: { id: 'candidate' }, session: { access_token: 'access', refresh_token: 'refresh' } } }),
    } },
  });
  const res = response(); await controller.verifySignupOTP({ body: { name: 'Test Mentor', email: 'mentor@example.test', password: 'Example123', otp: '123456', role: 'MENTOR' } }, res);
  assert.equal(res.statusCode, 201); assert.equal(res.body.user.role, 'MENTOR'); assert.equal(res.body.user.onboardingRole, 'MENTOR');
});

test('signup can recover a provider account created before a failed DB write without resetting its password', async () => {
  const ctx = setup(); ctx.rows().user.length = 0;
  const res = response();
  await loadController('auth', ctx, { '../config/supabase': { auth: {
    admin: { createUser: async () => ({ error: { message: 'Already exists' } }) },
    signInWithPassword: async () => ({ data: { user: { id: 'candidate' }, session: { access_token: 'access', refresh_token: 'refresh' } } }),
  } } }).verifySignupOTP({ body: { name: 'Test Mentor', email: 'mentor@example.test', password: 'Example123', otp: '123456', role: 'MENTOR' } }, res);
  assert.equal(res.statusCode, 201); assert.equal(res.body.user.id, 'candidate'); assert.equal(res.body.user.role, 'MENTOR');
});

test('an unsuccessful provider-account recovery never creates a database user', async () => {
  const ctx = setup(); ctx.rows().user.length = 0; const res = response();
  await loadController('auth', ctx, { '../config/supabase': { auth: {
    admin: { createUser: async () => ({ error: { message: 'Exists' } }) },
    signInWithPassword: async () => ({ error: { message: 'Wrong credentials' } }),
  } } }).verifySignupOTP({ body: { email: 'mentor@example.test', password: 'Example123', otp: '123456', role: 'MENTOR' } }, res);
  assert.equal(res.statusCode, 400); assert.equal(ctx.rows().user.length, 0);
});

test('an identical LinkedIn submission retry does not append duplicate transcript memory', async () => {
  const ctx = setup(); const controller = loadController('linkedin', ctx);
  const req = { user: ctx.rows().user[0], body: application() };
  await controller.publishMentorProfile(req, response()); await controller.publishMentorProfile(req, response());
  assert.equal(ctx.rows().mentorMemory.length, 1); assert.equal(ctx.rows().mentor.length, 1); assert.equal(ctx.controls.emails, 2);
});

for (const valid of [true, false]) test(`existing email verification ${valid ? 'confirms email without issuing a session' : 'rejects an invalid code without mutating the account'}`, async () => {
  const ctx = setup(); let confirmed = 0; const res = response();
  const controller = loadController('auth', ctx, {
    '../utils/otp': { verifyOTP: async () => ({ valid, error: 'Invalid code' }) },
    '../config/supabase': { auth: { admin: { updateUserById: async () => { confirmed++; return {}; } } } },
  });
  await controller.verifyExistingEmailOTP({ body: { email: 'mentor@example.test', otp: '123456' } }, res);
  assert.equal(res.statusCode, valid ? 200 : 400); assert.equal(confirmed, valid ? 1 : 0);
  assert.equal(res.body.accessToken, undefined); assert.equal(ctx.rows().user[0].role, 'STUDENT');
  assert.equal(!!ctx.rows().user[0].isEmailVerified, valid);
});

test('resend applies cooldown before replacing a code', async () => {
  const ctx = setup(); let stored = false; const res = response();
  await loadController('auth', ctx, { '../utils/otp': { canRequestOTP: async () => ({ allowed: false, cooldown: 42, reason: 'Wait 42 seconds' }), storeOTP: async () => { stored = true; } } })
    .resendOTP({ body: { email: 'mentor@example.test', purpose: 'signup' } }, res);
  assert.equal(res.statusCode, 429); assert.equal(res.body.cooldown, 42); assert.equal(stored, false);
});

test('LinkedIn authorization ignores client-supplied callback and external return paths', async () => {
  const ctx = setup(); let args; const res = response();
  await loadController('linkedin', ctx, { '../services/linkedin.service': { generateAuthUrl: value => { args = value; return 'https://www.linkedin.com/auth'; } } })
    .getAuthUrl({ user: { id: 'candidate' }, query: { returnPath: 'https://external.example', redirectUri: 'https://external.example/callback' } }, res);
  assert.equal(args.redirectUri, null); assert.equal(args.returnPath, '/onboarding');
});

test('LinkedIn callback returns to the configured frontend even when OAuth callback is on the API host', async () => {
  const ctx = setup(); const res = response(); let redirect;
  res.cookie = () => res; res.redirect = value => { redirect = value; return res; };
  const controller = loadController('linkedin', ctx, {
    '../config/env': { frontendUrl: 'https://www.helpmeman.com' },
    '../services/linkedin.service': {
      verifyState: () => ({ userId: 'candidate', redirectUri: 'https://api.helpmeman.com/api/linkedin/callback', returnPath: 'https://external.example' }),
      exchangeCodeForTokens: async () => ({ access_token: 'mock-provider-token' }),
      fetchLinkedInProfile: async () => ({}), normalizeLinkedInProfile: () => ({ linkedinId: 'mock-linkedin', name: 'Test Mentor', email: 'mentor@example.test' }),
      saveLinkedInData: async () => {},
    },
    '../utils/jwt': { generateAccessToken: () => 'mock-access', generateRefreshToken: () => 'mock-refresh' },
  });
  await controller.handleOAuthCallback({ query: { code: 'mock-code', state: 'mock-state' }, headers: {} }, res);
  const url = new URL(redirect); assert.equal(url.origin, 'https://www.helpmeman.com'); assert.equal(url.pathname, '/onboarding'); assert.equal(url.searchParams.get('linkedin'), 'success');
});

for (const codeError of ['Invalid OTP', 'OTP has expired']) test(`signup preserves account state on ${codeError}`, async () => {
  const ctx = setup(); ctx.rows().user.length = 0; let created = false; const res = response();
  await loadController('auth', ctx, {
    '../utils/otp': { verifyOTP: async () => ({ valid: false, error: codeError }) },
    '../config/supabase': { auth: { admin: { createUser: async () => { created = true; } } } },
  }).verifySignupOTP({ body: { name: 'Test Mentor', email: 'mentor@example.test', password: 'Example123', otp: '123456', role: 'MENTOR' } }, res);
  assert.equal(res.statusCode, 400); assert.equal(created, false); assert.equal(ctx.rows().user.length, 0);
});

test('LinkedIn publication retries a serializable transaction conflict safely', async () => {
  const ctx = setup(); const transaction = ctx.prisma.$transaction; let attempts = 0;
  ctx.prisma.$transaction = (work, options) => {
    assert.equal(options.isolationLevel, 'Serializable');
    if (++attempts === 1) return Promise.reject(Object.assign(Error('Conflict'), { code: 'P2034' }));
    return transaction(work);
  };
  const res = response(); await loadController('linkedin', ctx).publishMentorProfile({ user: ctx.rows().user[0], body: application() }, res);
  assert.equal(res.statusCode, 200); assert.equal(attempts, 2); assert.equal(ctx.rows().mentor.length, 1);
});
