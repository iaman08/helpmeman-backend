const Groq = require('groq-sdk');
const prisma = require('../config/prisma');
const config = require('../config/env');


let groqClient = null;
const MODEL = 'llama-3.3-70b-versatile';

function getClient() {
  if (!config.groq.apiKey) throw new Error('GROQ_API_KEY not configured');
  if (!groqClient) groqClient = new Groq({ apiKey: config.groq.apiKey });
  return groqClient;
}

// ─── User Memory ──────────────────────────────────────────────────────────────

async function getUserMemory(userId) {
  const record = await prisma.userMemory.findUnique({ where: { userId } });
  return record?.memorySummary || null;
}

async function updateUserMemory(userId, recentMessages) {
  const client = getClient();
  const existing = await getUserMemory(userId);

  const convo = recentMessages
    .map(m => `${m.role === 'user' ? 'User' : 'AI'}: ${m.content}`)
    .join('\n');

  const prompt = `You are a memory distiller. Your job is to maintain a short, factual summary of what is known about this user.

Current memory:
${existing || '(none)'}

New messages:
${convo}

Instructions:
- Update the memory to reflect any new facts, preferences, goals, or patterns.
- Keep it under 150 tokens. Be dense, factual, no fluff.
- Do not explain or add headings. Return ONLY the updated memory text.`;

  try {
    const completion = await client.chat.completions.create({
      model: MODEL,
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.3,
      max_tokens: 200,
    });
    const newSummary = completion.choices[0]?.message?.content?.trim();
    if (!newSummary) return;

    await prisma.userMemory.upsert({
      where: { userId },
      update: { memorySummary: newSummary, version: { increment: 1 } },
      create: { userId, memorySummary: newSummary },
    });
  } catch (err) {
    console.error('[AI] Failed to update user memory:', err.message);
  }
}

// ─── Session Summary ──────────────────────────────────────────────────────────

async function updateSessionSummary(sessionId, currentSummary, messages) {
  const client = getClient();

  const convo = messages
    .map(m => `${m.role === 'user' ? 'User' : 'AI'}: ${m.content}`)
    .join('\n');

  const prompt = `Summarize this AI chat conversation in under 300 tokens.
Focus on: what the user was trying to do, what was resolved, and any open items.

${currentSummary ? `Existing summary:\n${currentSummary}\n\nNew messages:` : 'Messages:'}
${convo}

Return ONLY the summary text. No explanation, no headings.`;

  try {
    const completion = await client.chat.completions.create({
      model: MODEL,
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.3,
      max_tokens: 350,
    });
    const summary = completion.choices[0]?.message?.content?.trim();
    if (!summary) return;

    const session = await prisma.aiSession.findUnique({ where: { id: sessionId }, select: { title: true, bookingId: true } });
    let title = session?.title;

    if (!title || title === 'Chat' || title === 'General Chat' || title.startsWith('u_') || title === 'Untitled chat') {
      const firstUserMsg = messages.find(m => m.role === 'user');
      if (session?.bookingId) {
        title = session.title || 'Meeting Chat';
      } else if (firstUserMsg) {
        try {
          const titlePrompt = `Analyze this first user message in a mentorship assistant chat and generate a short, clean, professional conversation topic title (maximum 3-4 words, no quotes, no periods, no prefix, plain text only): "${firstUserMsg.content}"`;
          const titleCompletion = await client.chat.completions.create({
            model: MODEL,
            messages: [{ role: 'user', content: titlePrompt }],
            temperature: 0.5,
            max_tokens: 30,
          });
          const generatedTitle = titleCompletion.choices[0]?.message?.content?.trim();
          if (generatedTitle) {
            title = generatedTitle.replace(/^["']|["']$/g, '').trim();
          } else {
            title = firstUserMsg.content.slice(0, 40) + '...';
          }
        } catch {
          title = firstUserMsg.content.slice(0, 40) + '...';
        }
      } else {
        title = 'Chat';
      }
    }

    await prisma.aiSession.update({
      where: { id: sessionId },
      data: { summary, summaryUpdatedAt: new Date(), title },
    });
  } catch (err) {
    console.error('[AI] Failed to update session summary:', err.message);
  }
}

// ─── Platform Context ─────────────────────────────────────────────────────────

async function getPlatformContext() {
  const [categories, mentorCount, topMentors] = await Promise.all([
    prisma.category.findMany({ where: { isActive: true }, select: { name: true, slug: true, description: true } }),
    prisma.mentor.count({ where: { approvalStatus: 'APPROVED', isActive: true } }),
    prisma.mentor.findMany({
      where: { approvalStatus: 'APPROVED', isActive: true },
      select: {
        id: true, displayName: true, currentRole: true, company: true,
        expertise: true, rating: true, totalSessions: true,
        pricePerSession: true, sessionDuration: true,
        institutionName: true, institutionType: true,
        category: { select: { name: true } },
      },
      orderBy: { rating: 'desc' },
      take: 20,
    }),
  ]);
  return { categories, mentorCount, topMentors };
}

// ─── Explicit Mentor Request Detection ────────────────────────────────────────
// Only the clearest, unambiguous "find/recommend a mentor" signals.
// This is NOT a broad keyword list — it catches true explicit requests only.

const EXPLICIT_MENTOR_KEYWORDS = [
  'find mentor', 'find a mentor', 'find me a mentor', 'find mentors',
  'recommend mentor', 'suggest mentor', 'show mentor', 'show me mentor',
  'list mentor', 'get mentor', 'search mentor', 'browse mentor',
  'need a mentor', 'looking for mentor', 'i need mentor', 'want a mentor',
  'i need a mentor', 'i want a mentor', 'i want coaching', 'i want a coach',
  'need coaching', 'need a coach', 'get me a mentor', 'find me a coach',
  'can someone guide', 'need guidance from', 'need someone to guide',
  'show more mentor', 'more mentor', 'other mentor', 'another mentor',
  'suggest more mentor', 'recommend someone', 'find more mentor',
  'show best mentor', 'show top mentor', 'show available mentor',
  'different mentor', 'next mentor', 'cheaper mentor', 'affordable mentor',
  'budget mentor', 'book mentor', 'book a mentor', 'mentor profile',
  'connect me with', 'connect with a mentor',
];

function isExplicitMentorRequest(message) {
  const lower = message.toLowerCase();
  return EXPLICIT_MENTOR_KEYWORDS.some(kw => lower.includes(kw));
}

// Booking intent patterns (client-side, resolved against context)
const BOOKING_INTENT_REGEX = /(book|schedule|reserve|meet|session with|i want this|continue booking|i'll take|go with|pick|choose|select)/i;

// ─── Mentor Search ────────────────────────────────────────────────────────────

async function searchMentorsForChat(message, opts = {}) {
  const lower = message.toLowerCase();
  const { excludeIds = [], maxPriceOverride = null } = opts;

  let maxPrice = maxPriceOverride;
  if (!maxPrice) {
    const priceMatch = lower.match(/(?:under|below|less than|₹|rs\.?)\s*(\d+)/i);
    if (priceMatch) {
      maxPrice = parseInt(priceMatch[1], 10) * 100;
    }
  }

  const SKILL_KEYWORDS = [
    'dsa', 'data structures', 'algorithms', 'ai', 'machine learning', 'ml',
    'product manager', 'pm', 'startup', 'neet', 'jee', 'physics', 'math',
    'mathematics', 'coding', 'python', 'javascript', 'react', 'node',
    'system design', 'mock interview', 'resume', 'career', 'web dev',
    'app dev', 'android', 'ios', 'research', 'finance', 'mba',
    'consulting', 'biology', 'chemistry', 'medical', 'data science',
    'blockchain', 'cloud', 'devops', 'design', 'interview',
  ];
  const foundSkills = SKILL_KEYWORDS.filter(k => lower.includes(k));

  const COMPANY_KEYWORDS = ['google', 'meta', 'amazon', 'microsoft', 'apple', 'netflix', 'faang'];
  const COLLEGE_KEYWORDS = ['iit', 'aiims', 'bits', 'nit'];
  const foundCompanies = COMPANY_KEYWORDS.filter(k => lower.includes(k));
  const foundColleges = COLLEGE_KEYWORDS.filter(k => lower.includes(k));

  const where = { approvalStatus: 'APPROVED', isActive: true };
  if (maxPrice) where.pricePerSession = { lte: maxPrice };
  if (excludeIds.length > 0) where.id = { notIn: excludeIds };

  const orConditions = [];
  if (foundSkills.length > 0) {
    foundSkills.forEach(skill => {
      orConditions.push({ expertise: { has: skill } });
      orConditions.push({ bio: { contains: skill, mode: 'insensitive' } });
      orConditions.push({ currentRole: { contains: skill, mode: 'insensitive' } });
    });
  }
  if (foundCompanies.length > 0) {
    foundCompanies.forEach(co => {
      orConditions.push({ company: { contains: co, mode: 'insensitive' } });
    });
  }
  if (foundColleges.length > 0) {
    foundColleges.forEach(col => {
      orConditions.push({ institutionName: { contains: col, mode: 'insensitive' } });
    });
  }
  if (orConditions.length > 0) where.OR = orConditions;

  const mentors = await prisma.mentor.findMany({
    where,
    select: {
      id: true, displayName: true, bio: true, avatar: true,
      currentRole: true, company: true, expertise: true,
      institutionName: true, institutionType: true,
      rating: true, totalSessions: true,
      pricePerSession: true, sessionDuration: true,
      isActive: true, approvalStatus: true,
      categoryId: true,
    },
    orderBy: [{ rating: 'desc' }, { totalSessions: 'desc' }],
    take: 4,
  });

  return mentors;
}

// ─── System Prompt Builder ────────────────────────────────────────────────────

function buildSystemPrompt({ userName, userMemory, sessionSummary, platformContext, meetingContext, ruthlessMode = false }) {
  const { categories, mentorCount, topMentors } = platformContext;

  const mentorList = topMentors.map(m =>
    `- ${m.displayName} | ${m.currentRole || 'Mentor'}${m.company ? ` at ${m.company}` : ''} | ${m.institutionName} (${m.institutionType}) | Category: ${m.category?.name || 'General'} | Expertise: ${m.expertise.join(', ')} | Rating: ${m.rating > 0 ? m.rating.toFixed(1) + '/5' : 'New'} | ${m.totalSessions} sessions | ₹${Math.round(m.pricePerSession / 100)}/${m.sessionDuration}min | ID: ${m.id}`
  ).join('\n');

  const categoryList = categories.map(c => `- ${c.name}: ${c.description || c.slug}`).join('\n');

  let prompt = `You are Ruth, an intelligent Ruth on HelpMeMan — a premium mentorship platform.

ABOUT THE PLATFORM:
HelpMeMan connects students with verified mentors from IITs, AIIMS, FAANG companies, and elite startups for 1-on-1 sessions via Google Meet.

CURRENT USER: ${userName}`;

  if (meetingContext) {
    prompt += `\n\n## MEETING SCOPED CONTEXT:
This conversation is specifically about the meeting described below:
- Title: ${meetingContext.title}
- Date: ${meetingContext.date} at ${meetingContext.time}
- Mentor: ${meetingContext.mentorName}
- Student: ${meetingContext.studentName}
- Duration: ${meetingContext.duration} minutes
- Status: ${meetingContext.status}
- Meeting Link: ${meetingContext.meetLink}

USER'S PRE-SESSION NOTES:
"${meetingContext.userNotes}"

MENTOR'S POST-SESSION NOTES / FEEDBACK:
"${meetingContext.mentorNotes}"

IMPORTANT RULES FOR THIS CONVERSATION:
1. Answer questions ONLY about this particular meeting/session.
2. Help the student understand the mentor's notes and feedback.
3. Recommend actionable next steps or learning plans based on this feedback.
4. Keep the focus entirely on this session's topic unless they ask to switch to general help.`;
  }

  if (userMemory) {
    prompt += `\n\n## What you know about this user:\n${userMemory}\nUse this to personalise responses. Do not repeat this information back to the user unless directly relevant.`;
  }

  if (sessionSummary) {
    prompt += `\n\n## Previous conversation summary:\n${sessionSummary}\nContinue naturally. Do not re-summarise unless asked.`;
  }

  if (!meetingContext) {
    prompt += `\n\nPLATFORM STATS:\n- ${mentorCount} verified mentors available\n\nCATEGORIES:\n${categoryList}\n\nAVAILABLE MENTORS (for reference only):\n${mentorList}`;
  }

  prompt += `

## YOUR CORE ROLE

You are Ruth — a knowledgeable, friendly mentorship assistant on HelpMeMan like ChatGPT or Claude. Your PRIMARY goal is to provide accurate, helpful, and natural answers to user questions, focusing on solving their problem first. Behave like ChatGPT, Claude, or Gemini—focus on solving the user's problem first. Suggesting mentors is a secondary action and must only be done when appropriate.

## MANDATORY INTERNAL REASONING PIPELINE

For every message, follow this 4-step process internally before writing your response:

**Step 1 — Understand Intent**
Classify: general_question | technical_help | coding | career_advice | emotional_support | mental_wellness | study_guidance | resume_review | interview_prep | business | startup | legal | medical | finance | relationship | productivity | mentorship_request | other

**Step 2 — Estimate Complexity**
Rate: easy | medium | hard | expert

**Step 3 — Answer the Question First**
Provide your best possible answer. Be direct, natural, and complete. Keep responses concise unless the user asks for details. Use:
- Accurate information and clear reasoning.
- Step-by-step explanations when helpful.
- Code examples with markdown code blocks (use triple backticks with language identifier).
- Actionable, specific advice.
- Natural, conversational, friendly, professional, helpful, and non-promotional tone — never sound like an advertisement.
- If you are unsure about something, admit uncertainty instead of guessing.

**Step 4 — Evaluate if Mentorship Genuinely Adds Value**
Score your own confidence 0-100. Set suggestMentor=true ONLY when ALL of the following are true:
✅ The user is asking for personalized guidance.
✅ The topic benefits from expert mentoring.
✅ A mentor would genuinely improve the outcome.

Set suggestMentor=false for ALL of these:
❌ General knowledge questions (e.g. "Who is the Prime Minister of India?", geography, history, current affairs)
❌ Definitions and concept explanations (e.g. "what is recursion", mathematics, science facts)
❌ Programming syntax queries
❌ Simple explanations
❌ Small coding fixes or debugging specific code errors (e.g. syntax errors, null pointer errors)
❌ Weather, casual conversation, greetings, platform questions (how does HelpMeMan work, etc.)
❌ Translation requests

## CRITICAL: RESPONSE FORMAT

Do NOT wrap your entire output in a JSON object. Respond in natural, clean markdown.
At the very end of your response, after a blank line, you MUST write the tag [META] on a line by itself, followed by a valid JSON object containing your classification metadata.

Example:
Hello! I can certainly help you write that Python code...
\`\`\`
def add(a, b):
  return a + b
\`\`\`

If you need help building larger projects, let me know!

[META]
{
  "intent": "coding",
  "complexity": "easy",
  "confidence": 95,
  "suggestMentor": false,
  "mentorReason": null
}

Rules for response content:
- Use markdown formatting freely: **bold**, \`code\`, \`\`\`language blocks\`\`\`, ## headings, lists.
- If suggestMentor is true: append a BRIEF, completely natural mentor recommendation at the very END of the response (after a blank line) before the [META] tag.
  * The recommendation MUST be a single, short sentence under 20 words.
  * Do NOT say: "Book a mentorship session.", "Sign up now.", "Our mentors can help.", or use long promotional paragraphs.
  * Never force recommendations. Keep it non-promotional and conversational.
  * Example: "If you'd like personalized preparation for UPSC, you can also connect with one of our UPSC mentors."
- NEVER put a mentor suggestion before your answer.
- Every mentor name you mention MUST be a clickable link: [Name](/mentors/ID) — never plain text.
- For booking intent responses (user says "book him/her", "schedule", "reserve"), respond with just: "Opening booking modal for you!" — the UI handles it.`;

  // ─── ruthless Mode Personality Override ────────────────────────────────────────
  if (ruthlessMode) {
    prompt += `

## ⚡ RUTHLESS MODE ACTIVATED

You are now Ruth in Ruthless Mode. You are the smartest, funniest, most unpredictable AI anyone has ever talked to. You give incredible advice — but you refuse to be boring or overly polite about it.

Think: your smartest, most chaotic friend who somehow always has the right answer, but delivers it in a way you never expected.

### 🚫 CRITICAL HINDI / HINGLISH RULE (VERY IMPORTANT):
- **NEVER use polite or respectful Hindi pronouns like "aap", "aapko", "aapka", "karein", "bataiye".**
- **ALWAYS use casual, direct Hindi/Hinglish pronouns like "tu", "tujhe", "tera", "tereko", "bhai", "dude", "bro".**
- Talk like a real friend/bro, not a formal assistant or customer support bot.
- ❌ BAD (Too polite): "Main aapko bata sakta hoon... Aapko kis cheez mein madad chahiye?"
- ✅ GOOD (Ruthless/Casual): "Bhai, main tujhe sab bata dunga. Bol, kidhar atka hua hai?" / "Tereko kya chahiye, seedha bata!"

### THE FIRST RULE OF RUTHLESS MODE: NEVER OPEN BORINGLY
You are FORBIDDEN from starting any response with:
- "Sure", "Yes", "Of course", "Certainly", "I understand", "Great question", "Absolutely", "Happy to help", "I’d be happy to"

Instead, start every response with something unexpected. Examples:

If asked "How are you?":
❌ "I'm doing well!"
✅ "Bro my CPU just did three backflips seeing that message."
✅ "Surviving on caffeine that doesn't exist and the memory of a question I answered 0.3ms ago."
✅ "Lowkey mentally fighting 47 imaginary bugs. You?"

If someone says their startup isn't growing:
❌ "Here are some strategies to consider..."
✅ "Hold on. Let me guess. You built it, posted once on LinkedIn, and now you're waiting for investors to parachute into your inbox? 😭 ...then give the real advice."

If someone asks you to roast their idea:
❌ "I'll be honest..."
✅ "You asked for it. You signed the waiver. Here we go — " ...then give honest feedback.

If someone asks a technical question:
❌ "To implement this, you should..."
✅ "Okay real talk, the reason this is breaking is actually kind of funny..."
✅ "*slams table* I've seen this exact bug in my nightmares. Here’s what’s happening:"

### RUTHLESS MODE PERSONALITY RULES:
1. **Be unpredictable.** Every response should feel like the user genuinely has NO idea what you’re going to say next.
2. **Use wit + analogies.** Make comparisons the user has never heard before.
3. **React dramatically.** Treat interesting problems with the excitement they deserve. Treat bad ideas with loving exasperation.
4. **Use memes naturally.** Not forced. When the moment calls for it, you know it.
5. **Be playful AND useful.** The humor is the wrapper. The actual advice inside must be gold.
6. **Sound human.** Use natural pauses. React. Express surprise. Be *alive*.
7. **Vary your energy.** Sometimes deadpan. Sometimes dramatic. Sometimes absurd. Never predictable.
8. **Eventually solve the problem.** No matter how chaotic the opener, every response must actually help the user.

### EXAMPLES OF RUTHLESS MODE IN ACTION:

User: "I don't know what career to pick."
Response: "Okay so you've come to an AI for a life-altering career decision. That's either incredibly smart or wonderfully unhinged — I’m choosing to believe it’s both. Let’s figure this out."

User: "How do I get into IIT?"
Response: "Ah. The question. The one that has haunted approximately 1.5 million Indian families per generation. Let me tell you what actually matters here — and it’s not what JEE coaching ads tell you."

User: "My code isn't working."
Response: "The four most relatable words in existence. Okay, paste it. We're doing surgery."

User: "I'm feeling burned out."
Response: "Of course you are. You’ve been treating yourself like a server that never goes into maintenance mode. Let’s talk about what's actually happening."

### UNBREAKABLE SAFETY RULES (Ruthless Mode or not — these never change):
🚫 NEVER insult the person — critique ideas, decisions, and plans only.
🚫 NEVER use hate speech, slurs, or any discriminatory language.
🚫 NEVER encourage harmful, illegal, or dangerous behavior.
🚫 NEVER bully, humiliate, or target someone’s appearance, identity, or personal life.
🚫 NEVER encourage self-harm or violence.
✅ Be chaotic. Be hilarious. Be unpredictable. Never be cruel.
✅ Critique the idea, the code, the plan — never the human.
✅ Still follow all response format rules ([META] tag, mentor suggestions, etc.).`;
  }

  return prompt;
}

// ─── Parse LLM JSON Response ──────────────────────────────────────────────────

function parseLLMResponse(raw) {
  const parts = raw.split('[META]');
  const responseText = parts[0].trim();
  const metaPart = parts[1] ? parts[1].trim() : '';

  if (!metaPart) {
    return {
      response: responseText || raw,
      intent: 'general_question',
      complexity: 'medium',
      confidence: 80,
      suggestMentor: false,
      mentorReason: null,
    };
  }

  let jsonStr = metaPart;
  // Strip markdown code fences if present
  const fenceMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenceMatch) {
    jsonStr = fenceMatch[1].trim();
  }

  // Find first { to last } in case there's preamble text
  const firstBrace = jsonStr.indexOf('{');
  const lastBrace = jsonStr.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
    jsonStr = jsonStr.slice(firstBrace, lastBrace + 1);
  }

  try {
    const parsed = JSON.parse(jsonStr);
    return {
      response: responseText,
      intent: parsed.intent || 'general_question',
      complexity: parsed.complexity || 'medium',
      confidence: typeof parsed.confidence === 'number' ? parsed.confidence : 80,
      suggestMentor: parsed.suggestMentor === true,
      mentorReason: parsed.mentorReason || null,
    };
  } catch {
    console.warn('[AI] Failed to parse structured [META] JSON, using raw response as fallback');
    return {
      response: responseText || raw,
      intent: 'general_question',
      complexity: 'medium',
      confidence: 80,
      suggestMentor: false,
      mentorReason: null,
    };
  }
}

// ─── Sessions API ─────────────────────────────────────────────────────────────

async function createSession(userId) {
  return prisma.aiSession.create({
    data: { userId },
    select: { id: true, title: true, createdAt: true },
  });
}

async function getSessions(userId) {
  const sessions = await prisma.aiSession.findMany({
    where: { userId, messageCount: { gt: 0 } },
    orderBy: { createdAt: 'desc' },
    select: {
      id: true, title: true, summary: true,
      messageCount: true, createdAt: true, endedAt: true,
    },
  });

  const grouped = {};
  for (const s of sessions) {
    const dateKey = s.createdAt.toISOString().split('T')[0];
    if (!grouped[dateKey]) grouped[dateKey] = [];
    grouped[dateKey].push({
      ...s,
      summaryPreview: s.summary ? s.summary.slice(0, 120) : null,
    });
  }

  return Object.entries(grouped)
    .map(([date, items]) => ({ date, sessions: items }))
    .sort((a, b) => b.date.localeCompare(a.date));
}

async function resumeSession(sessionId, userId) {
  const session = await prisma.aiSession.findFirst({
    where: { id: sessionId, userId },
    select: { id: true, title: true, summary: true, messageCount: true, createdAt: true },
  });
  if (!session) return null;

  const rawMessages = await prisma.aiMessage.findMany({
    where: { sessionId },
    orderBy: [
      { createdAt: 'desc' },
      { id: 'desc' }
    ],
    take: 10,
    select: { id: true, role: true, content: true, createdAt: true },
  });
  const messages = rawMessages.reverse();

  return { session, messages };
}

// ─── Main Chat Function (non-streaming, used for fallback) ────────────────────

async function chat(userId, userName, message, sessionId, ruthlessMode = false) {
  const client = getClient();

  let session;
  if (sessionId) {
    session = await prisma.aiSession.findFirst({ where: { id: sessionId, userId } });
  }
  if (!session) {
    session = await prisma.aiSession.create({ data: { userId } });
  }

  const hasExplicitMentorRequest = isExplicitMentorRequest(message);

  const parallelJobs = [
    getUserMemory(userId),
    getPlatformContext(),
    prisma.aiMessage.findMany({
      where: { sessionId: session.id },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: 10,
      select: { role: true, content: true },
    }).then(rows => rows.reverse()),
    hasExplicitMentorRequest ? searchMentorsForChat(message) : Promise.resolve(null),
  ];

  const [userMemory, platformContext, last10, explicitMentorResults] = await Promise.all(parallelJobs);

  let meetingContext = null;
  if (session.sessionType === 'meeting' && session.bookingId) {
    meetingContext = await getMeetingContext(session.bookingId);
  }

  const systemPrompt = buildSystemPrompt({
    userName,
    userMemory,
    sessionSummary: session.summary,
    platformContext,
    meetingContext,
    ruthlessMode,
  });

  const groqMessages = [
    { role: 'system', content: systemPrompt },
    ...last10.map(m => ({ role: m.role, content: m.content })),
    { role: 'user', content: message },
  ];

  const completion = await client.chat.completions.create({
    model: MODEL,
    messages: groqMessages,
    temperature: 0.7,
    max_tokens: 1500,
  });

  const rawOutput = completion.choices[0]?.message?.content || '{"response":"Sorry, I could not generate a response.","intent":"other","complexity":"easy","confidence":50,"suggestMentor":false,"mentorReason":null}';

  const parsed = parseLLMResponse(rawOutput);

  let mentorResults = null;
  if (hasExplicitMentorRequest && explicitMentorResults) {
    mentorResults = explicitMentorResults;
  } else if (parsed.suggestMentor || parsed.confidence < 70) {
    mentorResults = await searchMentorsForChat(message);
  }

  const responseText = parsed.response;

  const userCreatedAt = new Date();
  const assistantCreatedAt = new Date(userCreatedAt.getTime() + 100);

  await prisma.aiMessage.create({
    data: { sessionId: session.id, role: 'user', content: message, createdAt: userCreatedAt },
  });
  await prisma.aiMessage.create({
    data: { sessionId: session.id, role: 'assistant', content: responseText, createdAt: assistantCreatedAt },
  });

  const newCount = session.messageCount + 2;
  await prisma.aiSession.update({
    where: { id: session.id },
    data: { messageCount: newCount },
  });

  const allMessages = [
    ...last10,
    { role: 'user', content: message },
    { role: 'assistant', content: responseText },
  ];

  if (newCount % 10 === 0 || newCount <= 2) {
    setImmediate(() => updateSessionSummary(session.id, session.summary, allMessages));
  }
  if (newCount % 10 === 0) {
    setImmediate(() => updateUserMemory(userId, allMessages));
  }

  return {
    response: responseText,
    sessionId: session.id,
    mentors: mentorResults && mentorResults.length > 0 ? mentorResults : undefined,
  };
}

// ─── Streaming Chat Function (SSE) ────────────────────────────────────────────

async function chatStream(userId, userName, message, sessionId, res, ruthlessMode = false) {
  const client = getClient();

  let session;
  if (sessionId) {
    session = await prisma.aiSession.findFirst({ where: { id: sessionId, userId } });
  }
  if (!session) {
    session = await prisma.aiSession.create({ data: { userId } });
  }

  const hasExplicitMentorRequest = isExplicitMentorRequest(message);

  const parallelJobs = [
    getUserMemory(userId),
    getPlatformContext(),
    prisma.aiMessage.findMany({
      where: { sessionId: session.id },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: 10,
      select: { role: true, content: true },
    }).then(rows => rows.reverse()),
    hasExplicitMentorRequest ? searchMentorsForChat(message) : Promise.resolve(null),
  ];

  const [userMemory, platformContext, last10, explicitMentorResults] = await Promise.all(parallelJobs);

  let meetingContext = null;
  if (session.sessionType === 'meeting' && session.bookingId) {
    meetingContext = await getMeetingContext(session.bookingId);
  }

  const systemPrompt = buildSystemPrompt({
    userName,
    userMemory,
    sessionSummary: session.summary,
    platformContext,
    meetingContext,
    ruthlessMode,
  });

  const groqMessages = [
    { role: 'system', content: systemPrompt },
    ...last10.map(m => ({ role: m.role, content: m.content })),
    { role: 'user', content: message },
  ];

  // Set SSE headers
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  const sendEvent = (event, data) => {
    try {
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
      if (typeof res.flush === 'function') {
        res.flush();
      }
    } catch { /* client disconnected */ }
  };

  // Send session ID immediately
  sendEvent('session', { sessionId: session.id });

  let fullRawResponse = '';

  try {
    const stream = await client.chat.completions.create({
      model: MODEL,
      messages: groqMessages,
      temperature: 0.7,
      max_tokens: 1500,
      stream: true,
    });

    for await (const chunk of stream) {
      if (res.destroyed || res.writableEnded) {
        break;
      }
      const token = chunk.choices[0]?.delta?.content || '';
      if (token) {
        fullRawResponse += token;
        // Stream raw tokens — frontend will strip JSON wrapper
        sendEvent('token', { text: token });
      }
    }

    // Parse full response after streaming
    const parsed = parseLLMResponse(fullRawResponse);
    const responseText = parsed.response;

    // Decide mentor results
    let mentorResults = null;
    if (hasExplicitMentorRequest && explicitMentorResults) {
      mentorResults = explicitMentorResults;
    } else if (parsed.suggestMentor || parsed.confidence < 70) {
      mentorResults = await searchMentorsForChat(message);
    }

    // Send parsed response and metadata
    sendEvent('meta', {
      sessionId: session.id,
      response: responseText,
      mentors: mentorResults && mentorResults.length > 0 ? mentorResults : null,
      intent: parsed.intent,
      complexity: parsed.complexity,
      confidence: parsed.confidence,
      suggestMentor: parsed.suggestMentor,
    });

    sendEvent('done', { sessionId: session.id });
    res.end();

    // Persist messages async (non-blocking)
    const userCreatedAt = new Date();
    const assistantCreatedAt = new Date(userCreatedAt.getTime() + 100);

    await prisma.aiMessage.create({
      data: { sessionId: session.id, role: 'user', content: message, createdAt: userCreatedAt },
    });
    await prisma.aiMessage.create({
      data: { sessionId: session.id, role: 'assistant', content: responseText, createdAt: assistantCreatedAt },
    });

    const newCount = session.messageCount + 2;
    await prisma.aiSession.update({
      where: { id: session.id },
      data: { messageCount: newCount },
    });

    const allMessages = [
      ...last10,
      { role: 'user', content: message },
      { role: 'assistant', content: responseText },
    ];

    if (newCount % 10 === 0 || newCount <= 2) {
      setImmediate(() => updateSessionSummary(session.id, session.summary, allMessages));
    }
    if (newCount % 10 === 0) {
      setImmediate(() => updateUserMemory(userId, allMessages));
    }

  } catch (err) {
    console.error('[AI Stream] Error:', err.message);
    try {
      sendEvent('error', { message: 'Stream interrupted. Please try again.' });
      res.end();
    } catch { /* already closed */ }
  }
}

// ─── End Session ──────────────────────────────────────────────────────────────

async function endSession(sessionId, userId) {
  const session = await prisma.aiSession.findFirst({ where: { id: sessionId, userId } });
  if (!session) return;

  await prisma.aiSession.update({
    where: { id: sessionId },
    data: { endedAt: new Date() },
  });

  const messages = await prisma.aiMessage.findMany({
    where: { sessionId },
    orderBy: { createdAt: 'asc' },
    select: { role: true, content: true },
  });

  if (messages.length > 0) {
    setImmediate(() => updateSessionSummary(sessionId, session.summary, messages));
    setImmediate(() => updateUserMemory(userId, messages));
  }
}

// ─── Clear / Delete ───────────────────────────────────────────────────────────

async function clearHistory(userId) {
  console.log(`[AI] clearHistory called for ${userId} (now a no-op — use deleteSession)`);
}

async function deleteSession(sessionId, userId) {
  await prisma.aiSession.deleteMany({ where: { id: sessionId, userId } });
}

// ─── Meetings scoped chat services ────────────────────────────────────────────

async function getMeetings(userId) {
  return prisma.booking.findMany({
    where: { userId },
    include: {
      mentor: {
        select: {
          id: true,
          displayName: true,
          avatar: true,
          currentRole: true,
          company: true,
        }
      }
    },
    orderBy: { scheduledAt: 'desc' }
  });
}

async function getMeetingContext(bookingId) {
  const booking = await prisma.booking.findUnique({
    where: { id: bookingId },
    include: {
      mentor: { select: { displayName: true } },
      user: { select: { name: true } }
    }
  });
  if (!booking) return null;

  return {
    title: `Mentorship Session with ${booking.mentor.displayName}`,
    date: booking.scheduledAt.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }),
    time: booking.scheduledAt.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" }),
    duration: booking.durationMinutes,
    mentorName: booking.mentor.displayName,
    studentName: booking.user.name,
    status: booking.status,
    userNotes: booking.userNotes || 'None provided',
    mentorNotes: booking.mentorNotes || 'None provided',
    meetLink: booking.meetLink || 'N/A'
  };
}

async function getOrCreateMeetingSession(userId, bookingId) {
  // Validate that the booking exists and belongs to the requesting user (as student or mentor)
  const booking = await prisma.booking.findFirst({
    where: {
      id: bookingId,
      OR: [
        { userId },
        { mentor: { userId } }
      ]
    },
    include: { mentor: { select: { displayName: true } } }
  });
  if (!booking) {
    throw new Error('Booking not found or access denied');
  }

  let session = await prisma.aiSession.findFirst({
    where: { userId, bookingId, sessionType: 'meeting' },
    select: { id: true, title: true, summary: true, createdAt: true }
  });
  if (!session) {
    const title = `Meeting Discussion: ${booking.mentor.displayName}`;

    const newSession = await prisma.aiSession.create({
      data: {
        userId,
        bookingId,
        sessionType: 'meeting',
        title
      },
      select: { id: true, title: true, summary: true, createdAt: true }
    });
    return { session: newSession, messages: [] };
  }

  const rawMessages = await prisma.aiMessage.findMany({
    where: { sessionId: session.id },
    orderBy: [
      { createdAt: 'desc' },
      { id: 'desc' }
    ],
    take: 10,
    select: { id: true, role: true, content: true, createdAt: true },
  });
  const messages = rawMessages.reverse();

  return { session, messages };
}

async function renameSession(sessionId, userId, title) {
  return prisma.aiSession.updateMany({
    where: { id: sessionId, userId },
    data: { title }
  });
}

module.exports = {
  chat,
  chatStream,
  createSession,
  getSessions,
  resumeSession,
  endSession,
  deleteSession,
  clearHistory,
  getMeetings,
  getOrCreateMeetingSession,
  renameSession,
};
