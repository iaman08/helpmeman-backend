const Groq = require('groq-sdk');
const prisma = require('../config/prisma');
const config = require('../config/env');

const MODEL = 'llama-3.1-8b-instant';

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
    key: 'experience',
    phase: 'Expertise',
    type: 'single_choice',
    text: 'How many years of experience do you have?',
    options: ['1-3 years', '4-6 years', '7-10 years', '10+ years', '15+ years'],
  },
  {
    key: 'preferred_mentees',
    phase: 'Mentoring style',
    type: 'single_choice',
    text: 'What type of mentees do you enjoy working with most?',
    options: ['Early-career professionals', 'Founders', 'Students', 'Career switchers', 'Senior leaders', 'Builders with an idea'],
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
  const [user, profile, onboarding, mentor] = await Promise.all([
    prisma.user.findUnique({ where: { id: userId }, select: { id: true, name: true, email: true, role: true, onboardingRole: true } }),
    prisma.mentorProfile.findUnique({ where: { mentorId: userId } }),
    prisma.mentorOnboarding.findUnique({ where: { userId } }),
    prisma.mentor.findUnique({ where: { userId }, select: { id: true, approvalStatus: true, isActive: true } }),
  ]);

  const answers = onboarding?.answers || [];
  const index = onboarding?.currentQuestion || 0;
  const status = onboarding?.completed ? 'COMPLETED' : (user?.onboardingRole ? 'IN_PROGRESS' : 'NOT_STARTED');

  return {
    role: user?.onboardingRole,
    status,
    currentQuestion: index,
    totalQuestions: QUESTIONS.length,
    question: getQuestion(index, answers),
    answers,
    messages: onboarding?.messages || [],
    profile,
    mentor,
  };
}

async function selectRole(userId, role) {
  if (!['MENTOR', 'MENTEE'].includes(role)) throw new Error('Choose MENTOR or MENTEE');
  const user = await prisma.user.update({ where: { id: userId }, data: { onboardingRole: role, ...(role === 'MENTOR' ? { role: 'MENTOR' } : {}) } });
  if (role === 'MENTOR') {
    const firstName = user?.name ? user.name.split(' ')[0] : 'there';
    const firstMsg = {
      id: `msg_init`,
      sender: 'RUTH',
      text: `Hi ${firstName}, I’m Ruth. I’ll ask one thing at a time, remember every answer, and shape your mentor profile as we go.`,
      createdAt: new Date().toISOString(),
    };
    const firstQuestionMsg = {
      id: `msg_q0`,
      sender: 'RUTH',
      text: QUESTIONS[0].text,
      createdAt: new Date().toISOString(),
    };

    await Promise.all([
      prisma.mentorProfile.upsert({
        where: { mentorId: userId },
        update: { onboardingStatus: 'IN_PROGRESS' },
        create: { mentorId: userId, skills: [], expertiseTags: [], onboardingStatus: 'IN_PROGRESS' },
      }),
      prisma.mentorOnboarding.upsert({
        where: { userId },
        update: { currentQuestion: 0, completed: false, messages: [firstMsg, firstQuestionMsg], answers: [] },
        create: { userId, currentQuestion: 0, completed: false, messages: [firstMsg, firstQuestionMsg], answers: [] },
      }),
    ]);
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
    const groqCall = client.chat.completions.create({ model: MODEL, messages: [{ role: 'user', content: prompt }], temperature: 0.65, max_tokens: 90 });
    const timeout = new Promise((_, reject) => setTimeout(() => reject(new Error('Groq API request timed out')), 3500));
    const result = await Promise.race([groqCall, timeout]);
    return result.choices[0]?.message?.content?.trim() || `Got it. ${nextQuestion.text}`;
  } catch (error) {
    console.warn('[Onboarding] Ruth transition fallback:', error.message);
    return `Thanks for sharing that. ${nextQuestion.text}`;
  }
}

async function summarize(userId) {
  const onboarding = await prisma.mentorOnboarding.findUnique({ where: { userId } });
  const answers = (onboarding?.answers || []).filter(a => !a.skipped);
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
      const groqCall = client.chat.completions.create({ model: MODEL, messages: [{ role: 'user', content: prompt }], temperature: 0.25, max_tokens: 800, response_format: { type: 'json_object' } });
      const timeout = new Promise((_, reject) => setTimeout(() => reject(new Error('Groq API summarize timed out')), 4000));
      const completion = await Promise.race([groqCall, timeout]);
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

    // Parse location
    let country = 'India';
    let state = '';
    let city = '';
    const locStr = result.location || '';
    if (locStr) {
      const parts = locStr.split(',').map(s => s.trim());
      if (parts.length >= 2) {
        city = parts[0];
        country = parts[parts.length - 1];
        state = parts.length === 3 ? parts[1] : '';
      } else {
        city = locStr;
      }
    }

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
        update: {
          displayName: result.preferredName || result.name || user.name,
          bio: result.bio || '',
          currentRole: result.role || null,
          company: result.company || null,
          expertise: result.expertiseTags || result.skills || [],
          location: result.location || null,
          country,
          state: state || null,
          city,
          experienceYears: result.experienceYears || null,
        },
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
          location: result.location || null,
          country,
          state: state || null,
          city,
          activeStatus: 'Active this week',
          averageResponseTime: '1 day',
          languages: ['English'],
          experienceYears: result.experienceYears || null,
        },
      }),
      prisma.mentorOnboarding.update({
        where: { userId },
        data: { completed: true, currentQuestion: QUESTIONS.length },
      }),
    ]);

  // Trigger email notifications
  try {
    const { sendMentorUnderReviewEmail, sendMentorApplicationToAdminEmail } = require('./email.service');
    sendMentorUnderReviewEmail(user).catch(err => console.error('[ONBOARDING] Failed to send mentor review email:', err.message));
    sendMentorApplicationToAdminEmail(user, answers).catch(err => console.error('[ONBOARDING] Failed to send admin notification email:', err.message));
  } catch (err) {
    console.error('[ONBOARDING] Email dispatch setup failed:', err.message);
  }

  return getState(userId);
}

async function answer(userId, answerText, skip = false) {
  const [state, onboarding] = await Promise.all([
    getState(userId),
    prisma.mentorOnboarding.findUnique({ where: { userId } }),
  ]);
  if (state.role !== 'MENTOR') throw new Error('Mentor role required');
  if (!state.question) return state;

  const answerVal = skip ? 'Skipped' : String(answerText || '').trim();
  if (!skip && answerVal.length < 2) throw new Error('Please share a little more');

  const newAnswer = {
    id: `ans_${Date.now()}`,
    question: state.question.text,
    questionKey: state.question.key,
    answer: answerVal,
    skipped: skip,
  };
  const updatedAnswers = [...state.answers, newAnswer];

  const userMsg = {
    id: `msg_u_${Date.now()}`,
    sender: 'USER',
    text: skip ? 'Skipped' : answerVal,
    createdAt: new Date().toISOString(),
  };

  const nextIndex = state.currentQuestion + 1;

  if (nextIndex >= QUESTIONS.length) {
    const finalMsg = {
      id: `msg_r_${Date.now()}`,
      sender: 'RUTH',
      text: "That's everything I need. I've shaped your mentor profile — it already feels distinctly yours.",
      createdAt: new Date().toISOString(),
    };

    await prisma.mentorOnboarding.upsert({
      where: { userId },
      create: {
        userId,
        answers: updatedAnswers,
        messages: [userMsg, finalMsg],
        currentQuestion: nextIndex,
        completed: false,
      },
      update: {
        answers: updatedAnswers,
        messages: [...(onboarding?.messages || []), userMsg, finalMsg],
        currentQuestion: nextIndex,
      },
    });

    if (!skip) {
      try {
        await prisma.mentorMemory.create({
          data: {
            mentorId: userId,
            content: `${state.question.text}\n${answerVal}`,
            metadata: { type: 'onboarding_answer', questionKey: state.question.key, phase: state.question.phase, inputType: state.question.type },
            embedding: tinyEmbedding(answerVal),
          },
        });
      } catch (err) {
        console.warn('[Onboarding] Failed to save memory:', err.message);
      }
    }

    return { ...(await summarize(userId)), message: "That's everything I need. I've shaped your mentor profile — it already feels distinctly yours." };
  }

  const nextQuestion = getQuestion(nextIndex, updatedAnswers);
  const ruthResponse = skip ? nextQuestion.text : await humanTransition(state.question, answerVal, nextQuestion, updatedAnswers);

  const ruthMsg = {
    id: `msg_r_${Date.now()}`,
    sender: 'RUTH',
    text: ruthResponse,
    createdAt: new Date().toISOString(),
  };

  await Promise.all([
    prisma.mentorOnboarding.upsert({
      where: { userId },
      create: {
        userId,
        currentQuestion: nextIndex,
        answers: updatedAnswers,
        messages: [userMsg, ruthMsg],
        completed: false,
      },
      update: {
        currentQuestion: nextIndex,
        answers: updatedAnswers,
        messages: [...(onboarding?.messages || []), userMsg, ruthMsg],
      },
    }),
    prisma.mentorProfile.upsert({
      where: { mentorId: userId },
      create: {
        mentorId: userId,
        skills: [],
        expertiseTags: [],
        onboardingStatus: 'IN_PROGRESS',
        currentQuestion: nextIndex,
      },
      update: {
        currentQuestion: nextIndex,
        onboardingStatus: 'IN_PROGRESS',
      },
    }),
    ...(!skip ? [
      prisma.mentorMemory.create({
        data: {
          mentorId: userId,
          content: `${state.question.text}\n${answerVal}`,
          metadata: { type: 'onboarding_answer', questionKey: state.question.key, phase: state.question.phase, inputType: state.question.type },
          embedding: tinyEmbedding(answerVal),
        },
      }).catch(err => console.warn('[Onboarding] Failed to save memory:', err.message))
    ] : []),
  ]);

  return {
    role: state.role,
    status: nextIndex >= QUESTIONS.length ? 'COMPLETED' : 'IN_PROGRESS',
    currentQuestion: nextIndex,
    totalQuestions: QUESTIONS.length,
    question: nextQuestion,
    answers: updatedAnswers,
    messages: [...(onboarding?.messages || []), userMsg, ruthMsg],
    profile: state.profile,
    mentor: state.mentor,
    message: ruthResponse,
  };
}

module.exports = { QUESTIONS, getState, selectRole, answer };
