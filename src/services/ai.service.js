const Groq = require('groq-sdk');
const { PrismaClient } = require('@prisma/client');
const config = require('../config/env');

const prisma = new PrismaClient();

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

    // Auto-title from first user message using AI if not already set or default
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

// ─── System Prompt Builder ────────────────────────────────────────────────────

function buildSystemPrompt({ userName, userMemory, sessionSummary, platformContext, meetingContext }) {
  const { categories, mentorCount, topMentors } = platformContext;

  const mentorList = topMentors.map(m =>
    `- ${m.displayName} | ${m.currentRole || 'Mentor'}${m.company ? ` at ${m.company}` : ''} | ${m.institutionName} (${m.institutionType}) | Category: ${m.category?.name || 'General'} | Expertise: ${m.expertise.join(', ')} | Rating: ${m.rating > 0 ? m.rating.toFixed(1) + '/5' : 'New'} | ${m.totalSessions} sessions | ₹${Math.round(m.pricePerSession / 100)}/${m.sessionDuration}min | ID: ${m.id}`
  ).join('\n');

  const categoryList = categories.map(c => `- ${c.name}: ${c.description || c.slug}`).join('\n');

  let prompt = `You are HelpMeMan AI, a friendly and knowledgeable mentorship assistant for the HelpMeMan platform.

ABOUT THE PLATFORM:
HelpMeMan is a premium mentorship platform connecting students with verified mentors from IITs, AIIMS, FAANG companies, and elite startups. Students can browse mentors, book 1-on-1 sessions, and join video calls via Google Meet.

CURRENT USER: ${userName}`;

  // Inject meeting context if available (Meeting-Scoped AI)
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

  // Inject user memory (~150 tokens)
  if (userMemory) {
    prompt += `\n\n## What you know about this user:\n${userMemory}\nUse this to personalise responses. Do not repeat this information back to the user unless directly relevant.`;
  }

  // Inject session summary for continuity (~300 tokens)
  if (sessionSummary) {
    prompt += `\n\n## Previous conversation summary:\n${sessionSummary}\nContinue naturally. Do not re-summarise unless asked.`;
  }

  if (!meetingContext) {
    prompt += `\n\nPLATFORM STATS:\n- ${mentorCount} verified mentors available\n\nCATEGORIES:\n${categoryList}\n\nAVAILABLE MENTORS:\n${mentorList}`;
  }

  prompt += `\n\nYOUR RESPONSIBILITIES:
1. Help students find the right mentor based on their goals, interests, and budget
2. Answer questions about the platform (booking process, pricing, how sessions work)
3. Provide career and education guidance
4. Recommend specific mentors by name with profile links: [Mentor Name](/mentors/MENTOR_ID)

RULES:
- Be concise but warm. Short paragraphs.
- Use ₹ for prices
- Keep responses under 300 words
- Use markdown formatting`;

  return prompt;
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

  // Group by calendar date
  const grouped = {};
  for (const s of sessions) {
    const dateKey = s.createdAt.toISOString().split('T')[0]; // YYYY-MM-DD
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

  // Only last 10 messages — never full history (order desc, take 10, reverse)
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

// ─── Main Chat Function ───────────────────────────────────────────────────────

async function chat(userId, userName, message, sessionId) {
  const client = getClient();

  // 1. Ensure session exists
  let session;
  if (sessionId) {
    session = await prisma.aiSession.findFirst({ where: { id: sessionId, userId } });
  }
  if (!session) {
    session = await prisma.aiSession.create({ data: { userId } });
  }

  // 2. Load context (parallel)
  const [userMemory, platformContext, last10] = await Promise.all([
    getUserMemory(userId),
    getPlatformContext(),
    // Last 10 messages for context window (order desc, take 10, then reverse)
    prisma.aiMessage.findMany({
      where: { sessionId: session.id },
      orderBy: [
        { createdAt: 'desc' },
        { id: 'desc' }
      ],
      take: 10,
      select: { role: true, content: true },
    }).then(rows => rows.reverse()),
  ]);

  // Load meeting context if applicable
  let meetingContext = null;
  if (session.sessionType === 'meeting' && session.bookingId) {
    meetingContext = await getMeetingContext(session.bookingId);
  }

  // 3. Build system prompt
  const systemPrompt = buildSystemPrompt({
    userName,
    userMemory,
    sessionSummary: session.summary,
    platformContext,
    meetingContext,
  });

  // 4. Build messages array for Groq (last 10 + new user msg)
  const groqMessages = [
    { role: 'system', content: systemPrompt },
    ...last10.map(m => ({ role: m.role, content: m.content })),
    { role: 'user', content: message },
  ];

  // 5. Call Groq
  const completion = await client.chat.completions.create({
    model: MODEL,
    messages: groqMessages,
    temperature: 0.7,
    max_tokens: 1024,
  });

  const responseText = completion.choices[0]?.message?.content || 'Sorry, I could not generate a response.';

  // 6. Persist both messages sequentially with explicit distinct timestamps to guarantee chronological tie-breaking
  const userCreatedAt = new Date();
  const assistantCreatedAt = new Date(userCreatedAt.getTime() + 100); // 100ms offset

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

  // 7. Async background jobs — never block the user
  const allMessages = [
    ...last10,
    { role: 'user', content: message },
    { role: 'assistant', content: responseText },
  ];

  // Update session summary every 5 messages or on first message
  if (newCount % 10 === 0 || newCount <= 2) {
    setImmediate(() => updateSessionSummary(session.id, session.summary, allMessages));
  }

  // Update user memory every 10 messages
  if (newCount % 10 === 0) {
    setImmediate(() => updateUserMemory(userId, allMessages));
  }

  return { response: responseText, sessionId: session.id };
}

// ─── End Session ──────────────────────────────────────────────────────────────

async function endSession(sessionId, userId) {
  const session = await prisma.aiSession.findFirst({ where: { id: sessionId, userId } });
  if (!session) return;

  await prisma.aiSession.update({
    where: { id: sessionId },
    data: { endedAt: new Date() },
  });

  // Run final summary and memory update async
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
  // Legacy: clear all Redis-style data for backward compat — now a no-op stub
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
  let session = await prisma.aiSession.findFirst({
    where: { userId, bookingId, sessionType: 'meeting' },
    select: { id: true, title: true, summary: true, createdAt: true }
  });
  if (!session) {
    const booking = await prisma.booking.findUnique({
      where: { id: bookingId },
      include: { mentor: { select: { displayName: true } } }
    });
    const title = booking
      ? `Meeting Discussion: ${booking.mentor.displayName}`
      : 'Meeting Discussion';

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

  // Load last 10 messages
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
