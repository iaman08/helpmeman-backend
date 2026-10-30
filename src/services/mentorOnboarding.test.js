const { test } = require('node:test');
const assert = require('node:assert/strict');

const { setup } = require('./onboardingTestFixture');

async function advanceToTrack(ctx, track) {
  await ctx.service.selectRole('candidate', 'MENTOR');
  await ctx.service.answer('candidate', 'Test Mentor');
  await ctx.service.answer('candidate', 'mentor@example.test');
  return ctx.service.answer('candidate', track);
}

async function finish(ctx, track) {
  let state = await advanceToTrack(ctx, track);
  while (state.question && state.status !== 'COMPLETED') {
    const q = state.question;
    state = await ctx.service.answer('candidate', q.options?.[0] || 'Relevant mentoring experience and a concrete plan.');
  }
  return state;
}

for (const [track, count, category] of [
  ['NEET & Medical Mentorship', 17, 'medical-neet'],
  ['JEE & Engineering Mentorship', 15, 'jee-neet-prep'],
  ['Law & CLAT Mentorship', 15, 'law'],
  ['Career Guidance & Professional Mentorship', 15, 'general-mentorship'],
]) {
  test(`${track}: saves every answer, resumes, and completes pending review`, async () => {
    const ctx = setup();
    const state = await finish(ctx, track);
    assert.equal(state.status, 'COMPLETED');
    assert.equal(state.question, null);
    assert.equal(state.answers.length, count);
    assert.equal(state.currentQuestion, count);
    assert.equal(state.mentor.approvalStatus, 'PENDING');
    assert.equal(state.mentor.isActive, false);
    assert.equal(ctx.rows().mentor[0].categoryId, category);
    assert.equal((await ctx.service.getState('candidate')).answers.length, count);
    assert.equal(ctx.controls.emails, 2);
  });
}

test('track cannot be skipped or replaced with an unsupported choice', async () => {
  const ctx = setup();
  await ctx.service.selectRole('candidate', 'MENTOR');
  await ctx.service.answer('candidate', 'Test Mentor');
  await ctx.service.answer('candidate', 'mentor@example.test');
  await assert.rejects(ctx.service.answer('candidate', '', true), /track|choose|select/i);
  await assert.rejects(ctx.service.answer('candidate', 'Unsupported track'), /option|choose|select/i);
  assert.equal((await ctx.service.getState('candidate')).currentQuestion, 2);
});

test('email and multi-select answers are validated without advancing the interview', async () => {
  const ctx = setup();
  await ctx.service.selectRole('candidate', 'MENTOR');
  await ctx.service.answer('candidate', 'Test Mentor');
  await assert.rejects(ctx.service.answer('candidate', 'not-an-email'), /email/i);
  let state = await ctx.service.answer('candidate', 'mentor@example.test');
  state = await ctx.service.answer('candidate', 'NEET & Medical Mentorship');
  while (state.question.type !== 'multi_choice') {
    state = await ctx.service.answer('candidate', state.question.options?.[0] || 'Relevant background');
  }
  await assert.rejects(ctx.service.answer('candidate', 'Physics, Invented subject'), /option|select/i);
  assert.equal((await ctx.service.getState('candidate')).question.key, 'mentor_areas');
});

test('reselecting mentor preserves completion and email status', async () => {
  const ctx = setup();
  await finish(ctx, 'JEE & Engineering Mentorship');
  const before = ctx.rows().mentorProfile[0].onboardingStatus;
  const state = await ctx.service.selectRole('candidate', 'MENTOR');
  assert.equal(state.status, 'COMPLETED');
  assert.equal(state.profile.onboardingStatus, before);
  await ctx.service.answer('candidate', 'Duplicate retry');
  assert.equal(ctx.controls.emails, 2);
});

test('failed email delivery is not marked as sent and can be retried', async () => {
  const ctx = setup({ emailSuccess: false });
  await finish(ctx, 'Law & CLAT Mentorship');
  assert.equal(ctx.rows().mentorProfile[0].onboardingStatus, 'COMPLETED');
  ctx.controls.emailSuccess = true;
  assert.equal((await ctx.service.checkAndSendConfirmationEmail('candidate')).sent, true);
  assert.equal(ctx.rows().mentorProfile[0].onboardingStatus, 'COMPLETED_EMAIL_SENT');
});

test('AI output is restricted to valid profile fields and wrong types use the fallback', async () => {
  const ctx = setup({ aiResult: { skills: 'not-an-array', location: 42, experienceYears: 'many', unexpectedField: true } });
  const state = await finish(ctx, 'Career Guidance & Professional Mentorship');
  assert.equal(state.status, 'COMPLETED');
  assert.ok(Array.isArray(state.profile.skills));
  assert.equal(state.profile.name, 'Test Mentor');
  assert.equal('unexpectedField' in state.profile, false);
});

test('a profile-save failure can be retried after all answers have been saved', async () => {
  const ctx = setup();
  ctx.controls.failProfile = true;
  await assert.rejects(finish(ctx, 'JEE & Engineering Mentorship'), /temporarily unavailable/);
  let state = await ctx.service.getState('candidate');
  assert.equal(state.answers.length, 15);
  assert.equal(state.status, 'PROCESSING');
  ctx.controls.failProfile = false;
  state = await ctx.service.answer('candidate', '');
  assert.equal(state.status, 'COMPLETED');
  assert.equal(state.answers.length, 15);
});

test('stale submissions do not become answers to a different question', async () => {
  const ctx = setup();
  await ctx.service.selectRole('candidate', 'MENTOR');
  await ctx.service.answer('candidate', 'Test Mentor', false, 'full_name');
  await assert.rejects(ctx.service.answer('candidate', 'Test Mentor', false, 'full_name'), /changed|refresh|saved/i);
  assert.equal((await ctx.service.getState('candidate')).currentQuestion, 1);
});

test('simultaneous answers cannot overwrite each other or duplicate the interview step', async () => {
  const ctx = setup();
  await ctx.service.selectRole('candidate', 'MENTOR');
  const results = await Promise.allSettled([
    ctx.service.answer('candidate', 'First Candidate', false, 'full_name'),
    ctx.service.answer('candidate', 'Second Candidate', false, 'full_name'),
  ]);
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal((await ctx.service.getState('candidate')).answers.length, 1);
});

test('a LinkedIn-created mentor can switch to manual before an interview draft exists', async () => {
  const ctx = setup();
  await ctx.prisma.user.update({ where: { id: 'candidate' }, data: { role: 'MENTOR', onboardingRole: 'MENTOR' } });
  const state = await ctx.service.answer('candidate', 'Test Mentor', false, 'full_name');
  assert.equal(state.currentQuestion, 1);
  assert.equal(state.answers[0].answer, 'Test Mentor');
  assert.equal(ctx.rows().mentorOnboarding.length, 1);
});

test('a slow role-selection request cannot erase an answer saved in another tab', async () => {
  const ctx = setup();
  await ctx.service.selectRole('candidate', 'MENTOR');
  const upsert = ctx.prisma.mentorOnboarding.upsert.bind(ctx.prisma.mentorOnboarding);
  let release;
  ctx.prisma.mentorOnboarding.upsert = async args => {
    if (args.update.answers?.length === 0) await new Promise(resolve => { release = resolve; });
    return upsert(args);
  };
  const selecting = ctx.service.selectRole('candidate', 'MENTOR');
  await new Promise(setImmediate);
  await ctx.service.answer('candidate', 'Test Mentor', false, 'full_name');
  release?.();
  await selecting;
  const state = await ctx.service.getState('candidate');
  assert.equal(state.currentQuestion, 1);
  assert.equal(state.answers[0].answer, 'Test Mentor');
});

test('legacy completed mentor profiles do not restart the interview when the draft flag is missing', async () => {
  const ctx = setup(); await ctx.service.selectRole('candidate', 'MENTOR');
  await ctx.prisma.mentor.create({ data: { userId: 'candidate', approvalStatus: 'APPROVED' } });
  await ctx.prisma.mentorProfile.update({ where: { mentorId: 'candidate' }, data: { onboardingStatus: 'COMPLETED' } });
  const state = await ctx.service.getState('candidate');
  assert.equal(state.status, 'COMPLETED'); assert.equal(state.question, null);
});

for (const name of ['A', 'x'.repeat(101)]) test(`invalid full-name length ${name.length} does not advance onboarding`, async () => {
  const ctx = setup(); await ctx.service.selectRole('candidate', 'MENTOR');
  await assert.rejects(ctx.service.answer('candidate', name), /name/i);
  assert.equal((await ctx.service.getState('candidate')).currentQuestion, 0);
});

test('concurrent LinkedIn publish retries preserve a single submission memory', async () => {
  const { loadController, response } = require('./onboardingTestFixture');
  const ctx = setup(); const controller = loadController('linkedin', ctx);
  const req = { user: ctx.rows().user[0], body: { displayName: 'Test Mentor', bio: 'Professional background', pricePerSession: 0, sessionDuration: 30 } };
  await Promise.all([controller.publishMentorProfile(req, response()), controller.publishMentorProfile(req, response())]);
  assert.equal(ctx.rows().mentorMemory.length, 1);
});
