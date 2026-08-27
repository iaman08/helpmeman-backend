const Groq = require('groq-sdk');
const prisma = require('../config/prisma');
const config = require('../config/env');

const MODEL = 'openai/gpt-oss-120b';

const BASE_QUESTIONS = [
  {
    key: 'full_name',
    phase: 'Identity',
    type: 'text',
    text: "Let's begin with your full name.",
    prompt: "What's your full name?",
    placeholder: 'Enter your full name',
  },
  {
    key: 'email_address',
    phase: 'Identity',
    type: 'text',
    text: "What is your email address?",
    placeholder: 'name@domain.com',
  },
  {
    key: 'mentor_track',
    phase: 'Identity',
    type: 'single_choice',
    text: "Which primary mentorship track are you joining to guide students in?",
    options: [
      'NEET & Medical Mentorship',
      'JEE & Engineering Mentorship',
      'Law & CLAT Mentorship',
      'Career Guidance & Professional Mentorship',
    ],
  },
];

const MEDICAL_QUESTIONS = [
  { key: 'institution', phase: 'Background', type: 'text', text: "Which College or University did you attend or are currently studying at?", placeholder: 'Example: AIIMS New Delhi, MAMC, KGMU, JIPMER, KMC Manipal' },
  { key: 'branch_year', phase: 'Background', type: 'text', text: "What is your Branch / Specialization and your current year or graduation year?", placeholder: 'Example: MBBS 4th Year / MD General Medicine (Batch of 2024)' },
  { key: 'current_status', phase: 'Background', type: 'single_choice', text: "What is your current status?", options: ['Medical Student (MBBS/BDS)', 'Junior Resident / Intern', 'Working Professional', 'Other'] },
  { key: 'exam_background', phase: 'Background', type: 'text', text: "What is your medical entrance examination background? Mention your NEET-UG year & percentile or NEET-PG rank if applicable.", placeholder: 'Example: NEET-UG 2021 AIR 450 (99.9 percentile), NEET-PG 2025 AIR 120' },
  { key: 'mentor_areas', phase: 'Expertise', type: 'multi_choice', text: "Which areas can you confidently mentor NEET aspirants in?", options: ['Physics', 'Chemistry', 'Biology (Botany)', 'Biology (Zoology)', 'Study Planning and Strategy', 'Mental Health and Stress Management', 'Revision Techniques'] },
  { key: 'prior_experience', phase: 'Expertise', type: 'single_choice', text: "Have you previously taught, mentored, guided or coached students?", options: ['Yes', 'No'] },
  { key: 'experience_details', phase: 'Expertise', type: 'text', text: "Briefly describe your mentoring or teaching experience. Mention who you mentored, approximate number of students, what you helped with and duration.", placeholder: 'Example: Mentored 15 NEET droppers over 1 year focusing on Physics numericals & 3-stage revision.' },
  { key: 'scenario_mock_scores', phase: 'Mentoring Scenario', type: 'text', text: "SCENARIO: A NEET aspirant says: 'I have studied for months, but my mock-test scores are not improving. I feel I am working hard but do not know what I am doing wrong.' How would you approach the student's first mentoring session?", placeholder: 'Describe your diagnostic approach, error-analysis method, and action plan...' },
  { key: 'scenario_biology_retention', phase: 'Mentoring Scenario', type: 'text', text: "SCENARIO: A student is struggling with the high volume of syllabus in Biology and feels overwhelmed. They are forgetting topics as soon as they study them. How would you help them improve their retention?", placeholder: 'Explain your active recall, spaced repetition, or NCERT mapping techniques...' },
  { key: 'comfortable_mentees', phase: 'Preferences', type: 'multi_choice', text: "Which NEET aspirants would you be most comfortable mentoring?", options: ['Dropper students', 'First-time test takers (Class 11/12)', 'Students aiming for top 100 ranks', 'Students struggling to pass', 'All types of students'] },
  { key: 'daily_time_commitment', phase: 'Availability', type: 'single_choice', text: "How much time can you realistically dedicate each day at HelpMeMan?", options: ['Less than 1 hour', '1-2 hours', '3-4 hours', 'More than 4 hours'] },
  { key: 'target_student_level', phase: 'Preferences', type: 'single_choice', text: "Which level of student are you most interested in mentoring based on your current qualifications?", options: ['NEET-UG aspirants (11th/12th/Droppers)', 'MBBS students preparing for PG entrance exams', 'Both levels'] },
  { key: 'mbbs_specialization', phase: 'Expertise', type: 'multi_choice', text: "If mentoring MBBS students, which specific subjects or exam modules (e.g., NExT/NEET-PG strategy) are you best equipped to guide?", options: ['Clinical Subjects', 'Pre-clinical / Para-clinical Subjects', 'Exam Strategy & Time Management', 'Subject-wise Resource Guidance', 'Not applicable (I am only mentoring NEET-UG)'] },
  { key: 'scenario_mbbs_guidance', phase: 'Mentoring Scenario', type: 'text', text: "How would you structure a guidance plan for an MBBS student struggling to balance clinical postings with PG preparation?", placeholder: 'Detail your time-blocking, ward-time utilization, and high-yield QBank schedule...' },
];

const JEE_QUESTIONS = [
  { key: 'institution', phase: 'Background', type: 'text', text: "Which College or University did you attend or are currently studying at?", placeholder: 'Example: IIT Bombay, NIT Trichy, BITS Pilani, DTU' },
  { key: 'branch_year', phase: 'Background', type: 'text', text: "What is your Branch / Specialization and your current year or graduation year?", placeholder: 'Example: Computer Science & Engineering, 3rd Year (Batch of 2026)' },
  { key: 'current_status', phase: 'Background', type: 'single_choice', text: "What is your current status?", options: ['Engineering Student', 'Engineering Graduate', 'Working Professional', 'Teacher / Faculty', 'Other'] },
  { key: 'exam_background', phase: 'Background', type: 'single_choice', text: "What is your JEE / engineering entrance examination background?", options: ['JEE Main', 'JEE Advanced', 'Both JEE Main & JEE Advanced', 'Other engineering entrance exam', 'Did not appear for JEE'] },
  { key: 'exam_details', phase: 'Background', type: 'text', text: "If applicable, mention your JEE year and JEE Main percentile / JEE Advanced rank.", placeholder: 'Example: JEE Main 2022: 99.8 percentile, JEE Advanced 2022: AIR 412' },
  { key: 'mentor_areas', phase: 'Expertise', type: 'multi_choice', text: "Which areas can you confidently mentor JEE aspirants in?", options: ['Physics', 'Chemistry', 'Mathematics', 'JEE Main strategy', 'JEE Advanced strategy', 'Study planning', 'Time management', 'Mock-test analysis', 'Exam strategy', 'Other'] },
  { key: 'prior_experience', phase: 'Expertise', type: 'single_choice', text: "Have you previously taught, mentored, guided or coached students?", options: ['Yes, formally', 'Yes, informally', 'No, but I have guided peers', 'No previous experience'] },
  { key: 'experience_details', phase: 'Expertise', type: 'text', text: "Briefly describe your mentoring or teaching experience. Mention who you mentored, approximate number of students, what you helped with and duration.", placeholder: 'Example: Mentored 20 JEE aspirants on Advanced Math problem-solving & exam strategy over 8 months.' },
  { key: 'scenario_mock_scores', phase: 'Mentoring Scenario', type: 'text', text: "SCENARIO: A JEE aspirant says: 'I have studied for months, but my mock-test scores are not improving. I feel I am working hard but dont know what Im doing wrong.' How would you approach the student's first mentoring session?", placeholder: 'Describe your diagnostic approach, error log review, and strategy adjustment...' },
  { key: 'scenario_main_vs_advanced', phase: 'Mentoring Scenario', type: 'text', text: "SCENARIO: A student is confused about whether to focus mainly on JEE Main or also prepare seriously for JEE Advanced. They are unsure about their current level. How would you help them decide?", placeholder: 'Explain your assessment method, syllabus coverage test, and dual-track preparation plan...' },
  { key: 'comfortable_mentees', phase: 'Preferences', type: 'multi_choice', text: "Which JEE aspirants would you be most comfortable mentoring?", options: ['Class 9-10', 'Class 11', 'Class 12', 'Droppers', 'JEE Main-focused', 'JEE Advanced-focused', 'Students unsure about their preparation strategy'] },
  { key: 'daily_time_commitment', phase: 'Availability', type: 'single_choice', text: "How much time can you realistically dedicate each day at HelpMeMan?", options: ['Less than 1 hour', '1-2 hours', '2-4 hours', 'More than 4 hours'] },
];

const LAW_QUESTIONS = [
  { key: 'institution', phase: 'Background', type: 'text', text: "Which College / University and Course / Degree + Current Year or Graduation Year?", placeholder: 'Example: NLSIU Bengaluru, BA LLB (Hons), 4th Year (Batch of 2025)' },
  { key: 'current_status', phase: 'Background', type: 'single_choice', text: "What is your current status?", options: ['Law Student', 'Law Graduate', 'Working Professional', 'Teacher / Faculty', 'Other'] },
  { key: 'exam_background', phase: 'Background', type: 'single_choice', text: "What is your CLAT / law entrance examination background?", options: ['CLAT', 'AILET', 'Did not appear for a law entrance examination', 'Other'] },
  { key: 'clat_score_rank', phase: 'Background', type: 'text', text: "What was your CLAT rank/score? If you appeared for multiple attempts, mention each performance.", placeholder: 'Example: CLAT 2022: AIR 85 (Score: 104.5), AILET 2022: AIR 32' },
  { key: 'clat_prep_strategy', phase: 'Background', type: 'text', text: "Briefly describe your CLAT preparation strategy, including resources, study schedule, mock tests, and major strategies that helped you.", placeholder: 'Detail your newspaper reading routine, sectional mocks, and legal reasoning approach...' },
  { key: 'prior_experience', phase: 'Expertise', type: 'single_choice', text: "Have you previously mentored or taught CLAT aspirants?", options: ['Yes, formally', 'Yes, informally / helped friends or juniors', 'No, but I have strong CLAT preparation experience', 'No previous experience'] },
  { key: 'clat_sections', phase: 'Expertise', type: 'multi_choice', text: "Which CLAT sections are you most confident in mentoring students on?", options: ['English Language', 'Current Affairs & General Knowledge', 'Legal Reasoning', 'Logical Reasoning', 'Quantitative Techniques', 'Overall CLAT Strategy & Mock Analysis', 'Study Planning', 'Time Management', 'Mock-Test Analysis', 'Exam-Day Strategy', 'Other'] },
  { key: 'experience_details', phase: 'Expertise', type: 'text', text: "Briefly describe your mentoring or teaching experience. Mention who you mentored, approximate number of students, what you helped with and duration.", placeholder: 'Example: Mentored 12 CLAT aspirants focusing on GK compendiums and Legal Reasoning speed...' },
  { key: 'scenario_mock_scores', phase: 'Mentoring Scenario', type: 'text', text: "SCENARIO: A CLAT aspirant says: 'I have studied for months, but my mock-test scores are not improving. I feel I am working hard but don't know what I'm doing wrong.' How would you approach the student's first mentoring session?", placeholder: 'Explain your reading speed analysis, accuracy vs attempts breakdown, and mock analysis...' },
  { key: 'scenario_gk_weakness', phase: 'Mentoring Scenario', type: 'text', text: "SCENARIO: A student is performing well in Legal Reasoning and Logical Reasoning but consistently struggles with Current Affairs and General Knowledge. How would you help them improve without affecting their preparation for other sections?", placeholder: 'Outline your daily GK routine, monthly compendium strategy, and time-allocation plan...' },
  { key: 'comfortable_mentees', phase: 'Preferences', type: 'multi_choice', text: "Which Law aspirants would you be most comfortable mentoring?", options: ['Class 11', 'Class 12', 'Droppers', 'CLAT-focused aspirants', 'AILET / Other Law Entrance-focused aspirants', 'Students struggling with specific CLAT sections', 'Students unsure about their preparation strategy'] },
  { key: 'daily_time_commitment', phase: 'Availability', type: 'single_choice', text: "How much time can you realistically dedicate each day to mentoring?", options: ['Less than 1 hour', '1-2 hours', '2-4 hours', 'More than 4 hours'] },
];

const CAREER_QUESTIONS = [
  { key: 'current_role', phase: 'Background', type: 'text', text: "What is your Current Role / Profession?", placeholder: 'Example: Senior Product Manager at Tech Firm / Corporate Lawyer / Data Scientist' },
  { key: 'educational_background', phase: 'Background', type: 'text', text: "What is your Educational Background? (Degree/Course, College/University, Specialization)", placeholder: 'Example: MBA in Marketing from IIM Ahmedabad / B.Tech from NIT Warangal' },
  { key: 'mentor_areas', phase: 'Expertise', type: 'multi_choice', text: "Which career areas can you guide students in?", options: ['Engineering & Technology', 'Medicine & Healthcare', 'Law', 'Management & Business', 'Finance & Economics', 'Government Jobs / Civil Services', 'Research & Academia', 'Design & Creative Careers', 'Data Science / AI', 'Entrepreneurship', 'Defence & Armed Forces', 'Other'] },
  { key: 'comfortable_mentees', phase: 'Preferences', type: 'multi_choice', text: "Which students are you most comfortable mentoring?", options: ['Classes 8–10', 'Classes 11–12', 'Entrance/competitive exam aspirants', 'College students', 'Final-year students', 'Fresh graduates', 'Students considering a career switch', 'Other'] },
  { key: 'experience_years', phase: 'Background', type: 'single_choice', text: "How much professional/career experience do you have?", options: ['Less than 1 year', '1–3 years', '3–5 years', '5–10 years', '10+ years'] },
  { key: 'guidance_types', phase: 'Expertise', type: 'multi_choice', text: "What kind of guidance can you provide?", options: ['Career exploration & career selection', 'Course/degree selection', 'College & higher-education guidance', 'Skill development & learning roadmap', 'Industry insights', 'Internship & early-career guidance', 'Resume/CV guidance', 'Interview preparation', 'Career transition guidance', 'Long-term career planning', 'Other'] },
  { key: 'career_journey', phase: 'Background', type: 'text', text: "Briefly describe your career journey and what makes you qualified to guide students.", placeholder: 'Share key achievements, industry roles, and insights gained along your career path...' },
  { key: 'motivation', phase: 'Mentoring style', type: 'text', text: "What motivates you to mentor students through HelpMeMan?", placeholder: 'What drives your passion for helping students succeed?' },
  { key: 'scenario_confused_student', phase: 'Mentoring Scenario', type: 'text', text: "How would you approach a student who is confused about which career path to choose?", placeholder: 'Describe your diagnostic framework, interest-mapping, and career exploration strategy...' },
  { key: 'biggest_mistakes', phase: 'Mentoring Scenario', type: 'text', text: "What do you think is one of the biggest mistakes students make while choosing a career?", placeholder: 'Share common pitfalls like peer pressure, superficial research, or lack of self-awareness...' },
  { key: 'daily_time_commitment', phase: 'Availability', type: 'single_choice', text: "How much time can you realistically dedicate to mentoring?", options: ['Less than 1 hour/day', '1-2 hours/day', '2–4 hours/day', '4+ hours/day', 'Flexible depending on availability'] },
  { key: 'mentoring_goals', phase: 'Personal', type: 'text', text: "What are you hoping to achieve through mentoring on HelpMeMan?", placeholder: 'Sharing knowledge, networking, giving back to community...' },
];

function getTrackQuestions(track = '') {
  if (track.includes('NEET') || track.includes('Medical')) return MEDICAL_QUESTIONS;
  if (track.includes('JEE') || track.includes('Engineering')) return JEE_QUESTIONS;
  if (track.includes('Law') || track.includes('CLAT')) return LAW_QUESTIONS;
  if (track.includes('Career')) return CAREER_QUESTIONS;
  return MEDICAL_QUESTIONS;
}

function getQuestionList(answers = []) {
  const byKey = answersByKey(answers);
  const track = byKey.mentor_track;
  if (!track) return BASE_QUESTIONS;
  return [...BASE_QUESTIONS, ...getTrackQuestions(track)];
}

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
  const list = getQuestionList(answers);
  const base = list[index];
  if (!base) return null;

  const byKey = answersByKey(answers);
  const preferredName = (byKey.full_name || '').split(' ')[0] || '';
  const question = { ...base };

  if (question.key === 'institution' && preferredName) {
    question.text = `Great to meet you, ${preferredName}. ${base.text}`;
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
  const list = getQuestionList(answers);
  const status = onboarding?.completed ? 'COMPLETED' : (user?.onboardingRole ? 'IN_PROGRESS' : 'NOT_STARTED');

  return {
    role: user?.onboardingRole,
    status,
    currentQuestion: index,
    totalQuestions: list.length,
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
      text: BASE_QUESTIONS[0].text,
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
    const prompt = `You are Ruth, a warm, perceptive AI onboarding assistant for mentors on HelpMeMan. A mentor candidate just answered:
Question: ${question.text}
Answer: ${answer}

Recent context:
${context || '(none)'}

Write a natural response of at most 35 words. Briefly acknowledge one specific detail from their answer (e.g. their rank, institution, career path, or scenario approach), then smoothly ask this exact next question: "${nextQuestion.text}". No headings, no generic boilerplate.`;
    const groqCall = client.chat.completions.create({ model: MODEL, messages: [{ role: 'user', content: prompt }], temperature: 0.65, max_tokens: 100 });
    const timeout = new Promise((_, reject) => setTimeout(() => reject(new Error('Groq API request timed out')), 3500));
    const result = await Promise.race([groqCall, timeout]);
    return result.choices[0]?.message?.content?.trim() || `Got it. ${nextQuestion.text}`;
  } catch (error) {
    console.warn('[Onboarding] Ruth transition fallback:', error.message);
    return `Thanks for sharing that. ${nextQuestion.text}`;
  }
}

function detectCategorySlug(text = '', track = '') {
  if (track.includes('NEET') || track.includes('Medical')) return 'medical-neet';
  if (track.includes('JEE') || track.includes('Engineering')) return 'jee-neet-prep';
  if (track.includes('Law') || track.includes('CLAT')) return 'law';
  if (track.includes('Career')) return 'general-mentorship';

  const lower = text.toLowerCase();
  if (lower.includes('law') || lower.includes('clat') || lower.includes('legal') || lower.includes('advocate') || lower.includes('nlu') || lower.includes('court')) {
    return 'law';
  }
  if (lower.includes('neet') || lower.includes('mbbs') || lower.includes('aiims') || lower.includes('medical') || lower.includes('bds')) {
    return 'medical-neet';
  }
  if (lower.includes('jee') || lower.includes('iit') || lower.includes('nit') || lower.includes('engineering')) {
    return 'jee-neet-prep';
  }
  if (lower.includes('faang') || lower.includes('software') || lower.includes('coding') || lower.includes('dsa') || lower.includes('developer')) {
    return 'faang';
  }
  return 'general-mentorship';
}

async function summarize(userId) {
  const onboarding = await prisma.mentorOnboarding.findUnique({ where: { userId } });
  const answers = (onboarding?.answers || []).filter(a => !a.skipped);
  const transcript = answers.map(a => `${a.questionKey}: ${a.answer}`).join('\n');
  const byKey = answersByKey(answers);
  const track = byKey.mentor_track || '';
  let result;

  const fallbackProfile = () => {
    const firstName = (byKey.full_name || '').split(' ')[0] || byKey.full_name;
    const areas = (byKey.mentor_areas || byKey.clat_sections || byKey.guidance_types || '').split(',').map(s => s.trim()).filter(Boolean);
    const mbbsMods = (byKey.mbbs_specialization || '').split(',').map(s => s.trim()).filter(Boolean);
    const allSkills = [...new Set([...areas, ...mbbsMods])];

    return {
      name: byKey.full_name,
      preferredName: firstName,
      role: byKey.current_role || `${byKey.current_status || 'Mentor'} (${byKey.branch_year || track})`,
      company: byKey.institution || byKey.educational_background || 'HelpMeMan Network',
      location: 'India',
      skills: allSkills.length > 0 ? allSkills : [track || 'Mentorship & Strategy'],
      bio: `${track || 'Mentor'} from ${byKey.institution || byKey.educational_background || 'HelpMeMan'}. Background: ${byKey.exam_background || byKey.exam_details || byKey.career_journey || 'Experienced Guide'}.`,
      mentoringStyle: {
        scenarioApproach: byKey.scenario_mock_scores || byKey.scenario_confused_student || '',
        retentionOrStrategy: byKey.scenario_biology_retention || byKey.scenario_main_vs_advanced || byKey.scenario_gk_weakness || '',
        guidancePlan: byKey.scenario_mbbs_guidance || byKey.career_journey || '',
      },
      goals: byKey.target_student_level || byKey.mentoring_goals || 'Student Mentorship & Guidance',
      summary: `${track || 'Mentor'} (${byKey.current_status || 'Specialist'}). Areas: ${allSkills.slice(0, 4).join(', ')}. Availability: ${byKey.daily_time_commitment || '1-2 hours/day'}.`,
      expertiseTags: allSkills.slice(0, 8),
      personality: {
        communication_style: 'Empathetic & Structured',
        mentoring_style: 'Domain-tailored & Strategic',
        experience_level: byKey.experience_years || byKey.prior_experience || 'Experienced Mentor',
        preferred_mentees: byKey.comfortable_mentees || 'Aspirants & Students',
      },
    };
  };

  if (config.groq.apiKey) {
    try {
      const client = new Groq({ apiKey: config.groq.apiKey });
      const prompt = `Create a professional mentor profile from these domain-specific onboarding answers (${track}).
Extract:
- Full Name, Institution/College, Role/Background, Current Status
- Entrance exam scores/ranks (NEET, JEE, CLAT, etc.) or Professional experience
- Subject expertise & mentoring areas
- Scenario responses & diagnostic methodology
- Target mentee profiles, daily commitment, and motivation.

Return valid JSON only with keys:
name, preferredName, role, company, location, skills (array), experienceYears (integer or null), bio (80-120 words), mentoringStyle (object), goals (string), summary (string), expertiseTags (max 8 array), personality (object with communication_style, mentoring_style, experience_level, preferred_mentees, domain_credentials).\n\n${transcript}`;
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
  const detectedSlug = detectCategorySlug(transcript, track);
  let category = await prisma.category.findUnique({ where: { slug: detectedSlug } });
  if (!category) {
    category = await prisma.category.upsert({
      where: { slug: 'general-mentorship' },
      update: {},
      create: { name: 'General Mentorship', slug: 'general-mentorship', description: 'Cross-functional career and life mentorship' },
    });
  }

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

  const list = typeof getQuestionList === 'function' ? getQuestionList(answers) : (typeof QUESTIONS !== 'undefined' ? QUESTIONS : []);
  const existingProfile = await prisma.mentorProfile.findUnique({ where: { mentorId: userId } });
  const isEmailAlreadySent = existingProfile?.onboardingStatus === 'COMPLETED_EMAIL_SENT';

  await prisma.$transaction([
    prisma.mentorProfile.update({
      where: { mentorId: userId },
      data: {
        ...result,
        skills: result.skills || [],
        expertiseTags: result.expertiseTags || [],
        onboardingStatus: isEmailAlreadySent ? 'COMPLETED_EMAIL_SENT' : 'COMPLETED',
        completedAt: existingProfile?.completedAt || new Date(),
        currentQuestion: list.length,
      },
    }),
    prisma.mentorMemory.create({ data: { mentorId: userId, content: transcript, metadata: { type: 'onboarding_transcript', answerCount: answers.length, track }, embedding: tinyEmbedding(transcript) } }),
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
      data: { completed: true, currentQuestion: list.length },
    }),
  ]);

  // Check Mentorship Onboarding Status to determine if checkmark/confirmation mail has been sent
  if (!isEmailAlreadySent) {
    try {
      const { sendMentorUnderReviewEmail, sendMentorApplicationToAdminEmail } = require('./email.service');
      await sendMentorUnderReviewEmail(user).catch(err => console.error('[ONBOARDING] Failed to send mentor review email:', err.message));
      await sendMentorApplicationToAdminEmail(user, answers).catch(err => console.error('[ONBOARDING] Failed to send admin notification email:', err.message));
      
      // Update Mentorship Onboarding Status to confirm email has been sent
      await prisma.mentorProfile.update({
        where: { mentorId: userId },
        data: { onboardingStatus: 'COMPLETED_EMAIL_SENT' },
      });
      console.log(`[ONBOARDING] ✅ Checkmark/confirmation mail sent and status updated to COMPLETED_EMAIL_SENT for ${user.email}`);
    } catch (err) {
      console.error('[ONBOARDING] Email dispatch setup failed:', err.message);
    }
  } else {
    console.log(`[ONBOARDING] ℹ️ Mentorship Onboarding Status confirms checkmark email already sent for ${user.email}. Skipping duplicate.`);
  }

  return getState(userId);
}

async function checkAndSendConfirmationEmail(userId) {
  const [user, profile, onboarding] = await Promise.all([
    prisma.user.findUnique({ where: { id: userId } }),
    prisma.mentorProfile.findUnique({ where: { mentorId: userId } }),
    prisma.mentorOnboarding.findUnique({ where: { userId } }),
  ]);

  if (!user) return { sent: false, reason: 'User not found' };

  // Check Mentorship Onboarding Status
  const isCompleted = Boolean(onboarding?.completed || profile?.onboardingStatus === 'COMPLETED' || profile?.onboardingStatus === 'COMPLETED_EMAIL_SENT');
  const alreadySent = profile?.onboardingStatus === 'COMPLETED_EMAIL_SENT';

  if (!isCompleted) {
    return { sent: false, reason: 'Onboarding not completed yet' };
  }

  if (alreadySent) {
    return { sent: false, reason: 'Checkmark email already sent according to Mentorship Onboarding Status' };
  }

  try {
    const { sendMentorUnderReviewEmail, sendMentorApplicationToAdminEmail } = require('./email.service');
    const answers = (onboarding?.answers || []).filter(a => !a.skipped);

    await sendMentorUnderReviewEmail(user);
    await sendMentorApplicationToAdminEmail(user, answers);

    await prisma.mentorProfile.update({
      where: { mentorId: userId },
      data: { onboardingStatus: 'COMPLETED_EMAIL_SENT' },
    });

    return { sent: true };
  } catch (err) {
    console.error('[ONBOARDING] Error sending confirmation email in checkAndSendConfirmationEmail:', err.message);
    return { sent: false, error: err.message };
  }
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
  const list = getQuestionList(updatedAnswers);
  const nextIndex = state.currentQuestion + 1;

  const userMsg = {
    id: `msg_u_${Date.now()}`,
    sender: 'USER',
    text: skip ? 'Skipped' : answerVal,
    createdAt: new Date().toISOString(),
  };

  if (nextIndex >= list.length) {
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
    status: nextIndex >= list.length ? 'COMPLETED' : 'IN_PROGRESS',
    currentQuestion: nextIndex,
    totalQuestions: list.length,
    question: nextQuestion,
    answers: updatedAnswers,
    messages: [...(onboarding?.messages || []), userMsg, ruthMsg],
    profile: state.profile,
    mentor: state.mentor,
    message: ruthResponse,
  };
}

module.exports = {
  BASE_QUESTIONS: typeof BASE_QUESTIONS !== 'undefined' ? BASE_QUESTIONS : [],
  MEDICAL_QUESTIONS: typeof MEDICAL_QUESTIONS !== 'undefined' ? MEDICAL_QUESTIONS : [],
  JEE_QUESTIONS: typeof JEE_QUESTIONS !== 'undefined' ? JEE_QUESTIONS : [],
  LAW_QUESTIONS: typeof LAW_QUESTIONS !== 'undefined' ? LAW_QUESTIONS : [],
  CAREER_QUESTIONS: typeof CAREER_QUESTIONS !== 'undefined' ? CAREER_QUESTIONS : [],
  QUESTIONS: typeof QUESTIONS !== 'undefined' ? QUESTIONS : (typeof BASE_QUESTIONS !== 'undefined' ? BASE_QUESTIONS : []),
  getState,
  selectRole,
  answer,
  checkAndSendConfirmationEmail,
};
