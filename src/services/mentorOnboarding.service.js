const Groq = require('groq-sdk');
const { PrismaClient } = require('@prisma/client');
const config = require('../config/env');

const prisma = new PrismaClient();
const MODEL = 'llama-3.3-70b-versatile';

const QUESTIONS = [
  {
    key: 'full_name',
    phase: 'Identity',
    type: 'text',
    text: "Let's begin with your name.",
    prompt: "What's your full name?",
    placeholder: 'Enter your name',
  },
  {
    key: 'preferred_name',
    phase: 'Identity',
    type: 'text',
    text: 'What should mentees call you?',
    placeholder: 'Example: Rahul, Dr. Mehta, Priya',
  },
  {
    key: 'role_type',
    phase: 'Identity',
    type: 'single_choice',
    text: 'Which best describes your current work?',
    options: ['Founder', 'Product leader', 'Engineer', 'Designer', 'Marketer', 'Operator', 'Investor', 'Other'],
  },
  {
    key: 'role_company',
    phase: 'Identity',
    type: 'text',
    text: "What's your current role, and where do you work?",
    placeholder: 'Example: Senior Product Manager at Razorpay',
  },
  {
    key: 'location',
    phase: 'Identity',
    type: 'text',
    text: 'Where are you based?',
    placeholder: 'City, country, or remote',
  },
  {
    key: 'skills',
    phase: 'Expertise',
    type: 'multi_choice',
    text: 'Pick the skills you feel strongest in.',
    options: ['Product strategy', 'Software engineering', 'AI/ML', 'Growth', 'Fundraising', 'Leadership', 'Design', 'Career growth', 'Sales', 'Operations'],
  },
  {
    key: 'topics',
    phase: 'Expertise',
    type: 'text',
    text: 'What topics can you mentor people in?',
    placeholder: 'Add a few topics, separated by commas',
  },
  {
    key: 'experience',
    phase: 'Expertise',
    type: 'single_choice',
    text: 'How many years of experience do you have?',
    options: ['1-3 years', '4-6 years', '7-10 years', '10+ years', '15+ years'],
  },
  {
    key: 'industries',
    phase: 'Expertise',
    type: 'multi_choice',
    text: 'Which industries have shaped your experience?',
    options: ['SaaS', 'Fintech', 'AI', 'Consumer', 'Healthcare', 'Education', 'E-commerce', 'Enterprise', 'Climate', 'Other'],
  },
  {
    key: 'focus',
    phase: 'Expertise',
    type: 'text',
    text: 'What are you currently focused on?',
    placeholder: 'A product, company goal, learning curve, or mission',
  },
  {
    key: 'journey',
    phase: 'Background',
    type: 'text',
    text: 'Tell me the short version of your career journey.',
    placeholder: 'A few lines is perfect',
  },
  {
    key: 'achievement',
    phase: 'Background',
    type: 'text',
    text: "What's an achievement you're proud of?",
    placeholder: 'Something that still feels meaningful',
  },
  {
    key: 'leadership_projects',
    phase: 'Background',
    type: 'single_choice',
    text: 'Have you founded a startup, led a team, or owned a major project?',
    options: ['Founded a startup', 'Led a team', 'Owned a major project', 'Not yet', 'A mix of these'],
  },
  {
    key: 'why_mentor',
    phase: 'Mentoring style',
    type: 'text',
    text: 'Why do you mentor?',
    placeholder: 'What makes it worth your time?',
  },
  {
    key: 'mentoring_style',
    phase: 'Mentoring style',
    type: 'multi_choice',
    text: 'How do you usually help people?',
    options: ['Direct feedback', 'Hands-on problem solving', 'Strategy sessions', 'Accountability', 'Career clarity', 'Network introductions', 'Portfolio/project reviews'],
  },
  {
    key: 'preferred_mentees',
    phase: 'Mentoring style',
    type: 'single_choice',
    text: 'What type of mentees do you enjoy working with most?',
    options: ['Early-career professionals', 'Founders', 'Students', 'Career switchers', 'Senior leaders', 'Builders with an idea'],
  },
  {
    key: 'personal',
    phase: 'Personal',
    type: 'text',
    text: 'Last one: what motivates you, inspires you, or keeps you curious outside work?',
    placeholder: 'Books, creators, leaders, hobbies, long-term goals',
  },
];

function tinyEmbedding(text, dimensions = 64) {
  const vector = Array(dimensions).fill(0);
  const words = text.toLowerCase().match(/[a-z0-9]+/g) || [];
  for (const word of words) {
    let hash = 2166136261;
    for (const ch of word) hash = Math.imul(hash ^ ch.charCodeAt(0), 16777619);
    vector[Math.abs(hash) % dimensions] += hash % 2 ? 1 : -1;
  }
  const norm = Math.sqrt(vector.reduce((sum, n) => sum + n * n, 0)) || 1;
  return vector.map(n => Number((n / norm).toFixed(6)));
}

function answersByKey(answers = []) {
  return Object.fromEntries(answers.map(answer => [answer.questionKey, answer.answer]));
}

function getQuestion(index, answers = []) {
  const base = QUESTIONS[index];
  if (!base) return null;

  const byKey = answersByKey(answers);
  const preferredName = byKey.preferred_name || byKey.full_name?.split(' ')[0] || '';
  const roleType = byKey.role_type;
  const question = { ...base };

  if (question.key === 'role_company' && roleType && roleType !== 'Other') {
    question.text = `${preferredName ? `${preferredName}, ` : ''}where are you doing your ${roleType.toLowerCase()} work right now?`;
  }
  if (question.key === 'topics' && byKey.skills) {
    question.text = `Nice — ${byKey.skills} gives me a signal. What specific topics can you mentor people in?`;
  }
  if (question.key === 'journey' && roleType) {
    question.text = `How did you become the kind of ${roleType.toLowerCase()} mentor someone would learn from?`;
  }
  if (question.key === 'why_mentor' && byKey.achievement) {
    question.text = 'That achievement has a story behind it. Why do you want to mentor others now?';
  }
  if (question.key === 'personal' && byKey.preferred_mentees) {
    question.text = `Beautiful. To help me match you with ${byKey.preferred_mentees.toLowerCase()}, what motivates you outside work?`;
  }

  return question;
}

async function getState(userId) {
  const [user, profile, answers, mentor] = await Promise.all([
    prisma.user.findUnique({ where: { id: userId }, select: { id: true, name: true, email: true, role: true, onboardingRole: true } }),
    prisma.mentorProfile.findUnique({ where: { mentorId: userId } }),
    prisma.mentorOnboardingAnswer.findMany({ where: { mentorId: userId }, orderBy: { createdAt: 'asc' } }),
    prisma.mentor.findUnique({ where: { userId }, select: { id: true, approvalStatus: true, isActive: true } }),
  ]);
  const index = Math.min(profile?.currentQuestion || 0, QUESTIONS.length);
  return {
    role: user?.onboardingRole,
    status: profile?.onboardingStatus || 'NOT_STARTED',
    currentQuestion: index,
    totalQuestions: QUESTIONS.length,
    question: getQuestion(index, answers),
    answers,
    profile,
    mentor,
  };
}

async function selectRole(userId, role) {
  if (!['MENTOR', 'MENTEE'].includes(role)) throw new Error('Choose MENTOR or MENTEE');
  await prisma.user.update({ where: { id: userId }, data: { onboardingRole: role, ...(role === 'MENTOR' ? { role: 'MENTOR' } : {}) } });
  if (role === 'MENTOR') {
    await prisma.mentorProfile.upsert({
      where: { mentorId: userId },
      update: { onboardingStatus: 'IN_PROGRESS' },
      create: { mentorId: userId, skills: [], expertiseTags: [], onboardingStatus: 'IN_PROGRESS' },
    });
  }
  return getState(userId);
}

async function humanTransition(question, answer, nextQuestion, priorAnswers) {
  if (!config.groq.apiKey) return `Got it. ${nextQuestion.text}`;
  try {
    const client = new Groq({ apiKey: config.groq.apiKey });
    const context = priorAnswers.slice(-4).map(a => `${a.question}: ${a.answer}`).join('\n');
    const prompt = `You are Ruth, a warm, perceptive onboarding assistant for mentors. A mentor just answered:
Question: ${question.text}
Answer: ${answer}

Recent context:
${context || '(none)'}

Write a natural response of at most 35 words. Briefly acknowledge one specific detail, then ask this exact next question naturally: "${nextQuestion.text}". No headings, no generic praise.`;
    const result = await client.chat.completions.create({ model: MODEL, messages: [{ role: 'user', content: prompt }], temperature: 0.65, max_tokens: 90 });
    return result.choices[0]?.message?.content?.trim() || `Got it. ${nextQuestion.text}`;
  } catch (error) {
    console.warn('[Onboarding] Ruth transition fallback:', error.message);
    return `Thanks for sharing that. ${nextQuestion.text}`;
  }
}

async function summarize(userId) {
  const answers = await prisma.mentorOnboardingAnswer.findMany({ where: { mentorId: userId, skipped: false }, orderBy: { createdAt: 'asc' } });
  const transcript = answers.map(a => `${a.questionKey}: ${a.answer}`).join('\n');
  let result;
  const fallbackProfile = () => {
    const byKey = answersByKey(answers);
    return {
      name: byKey.full_name,
      preferredName: byKey.preferred_name,
      role: byKey.role_company,
      location: byKey.location,
      skills: (byKey.skills || byKey.topics || '').split(',').map(s => s.trim()).filter(Boolean),
      bio: byKey.journey || transcript.slice(0, 500),
      mentoringStyle: { approach: byKey.mentoring_style || '', motivation: byKey.why_mentor || '' },
      goals: byKey.personal || '',
      summary: byKey.focus || byKey.journey || '',
      expertiseTags: (byKey.topics || byKey.skills || '').split(',').map(s => s.trim()).filter(Boolean).slice(0, 8),
      personality: {
        communication_style: 'Thoughtful',
        mentoring_style: byKey.mentoring_style || 'Personalized',
        experience_level: byKey.experience || 'Experienced',
        preferred_mentees: byKey.preferred_mentees || 'Curious learners',
      },
    };
  };

  if (config.groq.apiKey) {
    try {
      const client = new Groq({ apiKey: config.groq.apiKey });
      const prompt = `Create a mentor profile from these onboarding answers. Return valid JSON only with keys: name, preferredName, role, company, location, skills (array), experienceYears (integer or null), bio (80-120 words), mentoringStyle (object), goals (string), summary (string), expertiseTags (max 8 array), personality (object with communication_style, mentoring_style, experience_level, preferred_mentees).\n\n${transcript}`;
      const completion = await client.chat.completions.create({ model: MODEL, messages: [{ role: 'user', content: prompt }], temperature: 0.25, max_tokens: 800, response_format: { type: 'json_object' } });
      result = JSON.parse(completion.choices[0]?.message?.content || '{}');
    } catch (error) {
      console.warn('[Onboarding] Profile synthesis fallback:', error.message);
      result = fallbackProfile();
    }
  } else {
    result = fallbackProfile();
  }

  const user = await prisma.user.findUnique({ where: { id: userId } });
  const category = await prisma.category.upsert({
    where: { slug: 'general-mentorship' },
    update: {},
    create: { name: 'General Mentorship', slug: 'general-mentorship', description: 'Cross-functional career and life mentorship' },
  });

  await prisma.$transaction([
    prisma.mentorProfile.update({
      where: { mentorId: userId },
      data: {
        ...result,
        skills: result.skills || [],
        expertiseTags: result.expertiseTags || [],
        onboardingStatus: 'COMPLETED',
        completedAt: new Date(),
        currentQuestion: QUESTIONS.length,
      },
    }),
    prisma.mentorMemory.create({ data: { mentorId: userId, content: transcript, metadata: { type: 'onboarding_transcript', answerCount: answers.length }, embedding: tinyEmbedding(transcript) } }),
    prisma.mentor.upsert({
      where: { userId },
      update: { displayName: result.preferredName || result.name || user.name, bio: result.bio || '', currentRole: result.role || null, company: result.company || null, expertise: result.expertiseTags || result.skills || [] },
      create: {
        userId,
        displayName: result.preferredName || result.name || user.name,
        bio: result.bio || '',
        institutionType: 'COMPANY',
        institutionName: result.company || 'Independent',
        institutionEmail: user.email,
        currentRole: result.role || null,
        company: result.company || null,
        expertise: result.expertiseTags || result.skills || [],
        categoryId: category.id,
        pricePerSession: 0,
        sessionDuration: 30,
      },
    }),
  ]);

  return getState(userId);
}

async function answer(userId, answerText, skip = false) {
  const state = await getState(userId);
  if (state.role !== 'MENTOR') throw new Error('Mentor role required');
  if (!state.question) return state;

  const answer = skip ? 'Skipped' : String(answerText || '').trim();
  if (!skip && answer.length < 2) throw new Error('Please share a little more');

  await prisma.$transaction([
    prisma.mentorOnboardingAnswer.create({ data: { mentorId: userId, question: state.question.text, questionKey: state.question.key, answer, skipped: skip } }),
    ...(!skip ? [prisma.mentorMemory.create({
      data: {
        mentorId: userId,
        content: `${state.question.text}\n${answer}`,
        metadata: { type: 'onboarding_answer', questionKey: state.question.key, phase: state.question.phase, inputType: state.question.type },
        embedding: tinyEmbedding(answer),
      },
    })] : []),
  ]);

  const nextIndex = state.currentQuestion + 1;
  await prisma.mentorProfile.update({ where: { mentorId: userId }, data: { currentQuestion: nextIndex, onboardingStatus: nextIndex >= QUESTIONS.length ? 'PROCESSING' : 'IN_PROGRESS' } });

  if (nextIndex >= QUESTIONS.length) {
    return { ...(await summarize(userId)), message: "That's everything I need. I've shaped your mentor profile — it already feels distinctly yours." };
  }

  const allAnswers = [...state.answers, { questionKey: state.question.key, question: state.question.text, answer }];
  const nextQuestion = getQuestion(nextIndex, allAnswers);
  const message = skip ? nextQuestion.text : await humanTransition(state.question, answer, nextQuestion, allAnswers);
  return { ...(await getState(userId)), message };
}

module.exports = { QUESTIONS, getState, selectRole, answer };
