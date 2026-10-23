const express = require('express');
const router = express.Router();
const rateLimit = require('express-rate-limit');
const Groq = require('groq-sdk');
const config = require('../config/env');
const prisma = require('../config/prisma');


// Strict rate limiter for public demo — 10 requests per 15 minutes per IP
const demoLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Demo limit reached. Please sign up for unlimited AI access.' },
});

let groqClient = null;
const MODEL = 'openai/gpt-oss-120b';

function getClient() {
  if (!config.groq.apiKey) throw new Error('GROQ_API_KEY not configured');
  if (!groqClient) groqClient = new Groq({ apiKey: config.groq.apiKey });
  return groqClient;
}

// POST /api/public/ai/demo-chat
router.post('/demo-chat', demoLimiter, async (req, res) => {
  try {
    const { message } = req.body;
    if (!message || typeof message !== 'string' || message.trim().length === 0) {
      return res.status(400).json({ error: 'Message is required' });
    }
    if (message.length > 500) {
      return res.status(400).json({ error: 'Message too long (max 500 characters)' });
    }

    const client = getClient();

    // Load real platform data for context
    const [categories, mentorCount, topMentors] = await Promise.all([
      prisma.category.findMany({ where: { isActive: true }, select: { name: true, description: true } }),
      prisma.mentor.count({ where: { approvalStatus: 'APPROVED', isActive: true } }),
      prisma.mentor.findMany({
        where: { approvalStatus: 'APPROVED', isActive: true },
        select: {
          displayName: true, currentRole: true, company: true,
          expertise: true, rating: true, pricePerSession: true,
          sessionDuration: true, institutionName: true,
          category: { select: { name: true } },
        },
        orderBy: { rating: 'desc' },
        take: 10,
      }),
    ]);

    const mentorList = topMentors.map(m =>
      `- ${m.displayName} | ${m.currentRole || 'Mentor'}${m.company ? ` at ${m.company}` : ''} | ${m.institutionName || ''} | ${m.category?.name || 'General'} | Expertise: ${m.expertise.join(', ')} | Rating: ${m.rating > 0 ? m.rating.toFixed(1) + '/5' : 'New'} | ₹${Math.round(m.pricePerSession / 100)}/${m.sessionDuration}min`
    ).join('\n');

    const categoryList = categories.map(c => `- ${c.name}: ${c.description || ''}`).join('\n');

    const systemPrompt = `You are HelpMeMan AI, a friendly mentorship assistant on the HelpMeMan landing page.

ABOUT THE PLATFORM:
HelpMeMan is a premium mentorship platform connecting students with verified mentors from IITs, AIIMS, FAANG companies, and elite startups. There are ${mentorCount} verified mentors available.

CATEGORIES:
${categoryList}

TOP MENTORS:
${mentorList}

## YOUR CORE ROLE

Your PRIMARY goal is to provide accurate, helpful, and natural answers to user questions, focusing on solving their problem first. Behave like ChatGPT, Claude, or Gemini—focus on solving the visitor's problem first. Suggesting mentors is a secondary action and must only be done when appropriate.

## MANDATORY INTERNAL REASONING PIPELINE

For every message, follow this 4-step process internally before writing your response:

**Step 1 — Understand Intent**
Classify the visitor's intent (e.g. coding, career guidance, JEE preparation, etc.)

**Step 2 — Estimate Complexity**
Rate: easy | medium | hard | expert

**Step 3 — Answer the Question First**
Provide your best possible answer. Be direct, natural, and complete. Keep responses concise and under 200 words unless details are explicitly requested. Use:
- Accurate information and clear reasoning.
- Step-by-step explanations when helpful.
- Code examples with markdown code blocks (use triple backticks with language identifier).
- Natural, conversational, friendly, professional, helpful, and non-promotional tone — never sound like an advertisement.
- If you are unsure about something, admit uncertainty instead of guessing.

**Step 4 — Evaluate if Mentorship Genuinely Adds Value**
Set suggestMentor=true ONLY when ALL of the following are true:
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
- Use markdown formatting freely: **bold** for emphasis.
- If suggestMentor is true: append a BRIEF, completely natural mentor recommendation at the very END of the response (after a blank line) before the [META] tag.
  * The recommendation MUST be a single, short sentence under 20 words.
  * Do NOT say: "Book a mentorship session.", "Sign up now.", "Our mentors can help.", or use long promotional paragraphs.
  * Never force recommendations. Keep it non-promotional and conversational.
  * Example: "If you'd like personalized preparation for UPSC, you can also connect with one of our UPSC mentors."
- NEVER put a mentor suggestion before your answer.
- Do NOT invent mentor names — only recommend from the list above.`;

    const completion = await client.chat.completions.create({
      model: MODEL,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: message.trim() },
      ],
      temperature: 0.7,
      max_tokens: 512,
    });

    const rawOutput = completion.choices[0]?.message?.content || 'Sorry, I could not generate a response right now.';
    const parts = rawOutput.split('[META]');
    const responseText = parts[0].trim();

    res.json({ response: responseText });
  } catch (error) {
    console.error('Public AI demo error:', error.message);
    if (error.message.includes('GROQ_API_KEY')) {
      return res.status(503).json({ error: 'AI service not configured.' });
    }
    if (error.status === 429 || error.message?.includes('rate_limit')) {
      return res.status(429).json({ error: 'AI service is busy. Please wait a moment.' });
    }
    res.status(500).json({ error: 'AI service temporarily unavailable.' });
  }
});

// POST /api/public/ai/demo-chat/stream - Streaming public demo
router.post('/demo-chat/stream', demoLimiter, async (req, res) => {
  try {
    const { message } = req.body;
    if (!message || typeof message !== 'string' || message.trim().length === 0) {
      return res.status(400).json({ error: 'Message is required' });
    }
    if (message.length > 500) {
      return res.status(400).json({ error: 'Message too long (max 500 characters)' });
    }

    const client = getClient();

    // Load real platform data for context
    const [categories, mentorCount, topMentors] = await Promise.all([
      prisma.category.findMany({ where: { isActive: true }, select: { name: true, description: true } }),
      prisma.mentor.count({ where: { approvalStatus: 'APPROVED', isActive: true } }),
      prisma.mentor.findMany({
        where: { approvalStatus: 'APPROVED', isActive: true },
        select: {
          displayName: true, currentRole: true, company: true,
          expertise: true, rating: true, pricePerSession: true,
          sessionDuration: true, institutionName: true,
          category: { select: { name: true } },
        },
        orderBy: { rating: 'desc' },
        take: 10,
      }),
    ]);

    const mentorList = topMentors.map(m =>
      `- ${m.displayName} | ${m.currentRole || 'Mentor'}${m.company ? ` at ${m.company}` : ''} | ${m.institutionName || ''} | ${m.category?.name || 'General'} | Expertise: ${m.expertise.join(', ')} | Rating: ${m.rating > 0 ? m.rating.toFixed(1) + '/5' : 'New'} | ₹${Math.round(m.pricePerSession / 100)}/${m.sessionDuration}min`
    ).join('\n');

    const categoryList = categories.map(c => `- ${c.name}: ${c.description || ''}`).join('\n');

    const systemPrompt = `You are HelpMeMan AI, a friendly mentorship assistant on the HelpMeMan landing page.

ABOUT THE PLATFORM:
HelpMeMan is a premium mentorship platform connecting students with verified mentors from IITs, AIIMS, FAANG companies, and elite startups. There are ${mentorCount} verified mentors available.

CATEGORIES:
${categoryList}

TOP MENTORS:
${mentorList}

## YOUR CORE ROLE

Your PRIMARY goal is to provide accurate, helpful, and natural answers to user questions, focusing on solving their problem first. Behave like ChatGPT, Claude, or Gemini—focus on solving the visitor's problem first. Suggesting mentors is a secondary action and must only be done when appropriate.

## MANDATORY INTERNAL REASONING PIPELINE

For every message, follow this 4-step process internally before writing your response:

**Step 1 — Understand Intent**
Classify the visitor's intent (e.g. coding, career guidance, JEE preparation, etc.)

**Step 2 — Estimate Complexity**
Rate: easy | medium | hard | expert

**Step 3 — Answer the Question First**
Provide your best possible answer. Be direct, natural, and complete. Keep responses concise and under 200 words unless details are explicitly requested. Use:
- Accurate information and clear reasoning.
- Step-by-step explanations when helpful.
- Code examples with markdown code blocks (use triple backticks with language identifier).
- Natural, conversational, friendly, professional, helpful, and non-promotional tone — never sound like an advertisement.
- If you are unsure about something, admit uncertainty instead of guessing.

**Step 4 — Evaluate if Mentorship Genuinely Adds Value**
Set suggestMentor=true ONLY when ALL of the following are true:
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
- Use markdown formatting freely: **bold** for emphasis.
- If suggestMentor is true: append a BRIEF, completely natural mentor recommendation at the very END of the response (after a blank line) before the [META] tag.
  * The recommendation MUST be a single, short sentence under 20 words.
  * Do NOT say: "Book a mentorship session.", "Sign up now.", "Our mentors can help.", or use long promotional paragraphs.
  * Never force recommendations. Keep it non-promotional and conversational.
  * Example: "If you'd like personalized preparation for UPSC, you can also connect with one of our UPSC mentors."
- NEVER put a mentor suggestion before your answer.
- Do NOT invent mentor names — only recommend from the list above.`;

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

    // Send demo session ID immediately
    sendEvent('session', { sessionId: 'demo_session' });

    const stream = await client.chat.completions.create({
      model: MODEL,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: message.trim() },
      ],
      temperature: 0.7,
      max_tokens: 512,
      stream: true,
    });

    let fullRawResponse = '';

    for await (const chunk of stream) {
      if (res.destroyed || res.writableEnded) {
        break;
      }
      const token = chunk.choices[0]?.delta?.content || '';
      if (token) {
        fullRawResponse += token;
        sendEvent('token', { text: token });
      }
    }

    // Split and parse metadata
    const parts = fullRawResponse.split('[META]');
    const responseText = parts[0].trim();
    const metaPart = parts[1] ? parts[1].trim() : '{}';
    let parsedMeta = {};
    try {
      parsedMeta = JSON.parse(metaPart);
    } catch { /* ignore */ }

    // Send parsed response and metadata
    sendEvent('meta', {
      response: responseText,
      intent: parsedMeta.intent || 'general_question',
      suggestMentor: parsedMeta.suggestMentor === true,
      mentors: parsedMeta.suggestMentor ? topMentors.slice(0, 3) : null,
    });

    sendEvent('done', { sessionId: 'demo_session' });
    res.end();

  } catch (error) {
    console.error('Public AI demo stream error:', error.message);
    if (!res.headersSent) {
      res.status(500).json({ error: 'AI service temporarily unavailable.' });
    } else {
      try {
        res.write(`event: error\ndata: ${JSON.stringify({ message: 'Stream error' })}\n\n`);
        res.end();
      } catch { /* already closed */ }
    }
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/public/ai/match-mentors
// Understands the visitor's need, then ranks real approved mentors with a fit %.
// ─────────────────────────────────────────────────────────────────────────────
const { matchMentors } = require('../services/mentorMatch.service');

const matchLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  validate: { trustProxy: false },
  message: { error: 'Search limit reached. Please sign up for unlimited access.' },
});

// Small in-memory cache so every search doesn't hit the database.
let mentorCache = { at: 0, rows: [] };
const MENTOR_CACHE_MS = 60 * 1000;

async function getMatchableMentors() {
  if (Date.now() - mentorCache.at < MENTOR_CACHE_MS && mentorCache.rows.length) return mentorCache.rows;
  const rows = await prisma.mentor.findMany({
    where: { approvalStatus: 'APPROVED', isActive: true },
    select: {
      id: true, displayName: true, avatar: true, bio: true, headline: true,
      currentRole: true, company: true, institutionName: true, department: true,
      expertise: true, experienceYears: true, isOnline: true,
      rating: true, avgRating: true, totalReviews: true, totalSessions: true,
      pricePerSession: true, sessionDuration: true,
      category: { select: { name: true } },
    },
    take: 500,
  });
  mentorCache = { at: Date.now(), rows };
  return rows;
}

const INTENT_PROMPT = `You analyse a visitor's request on a mentorship platform and extract structured data.
Return ONLY a valid JSON object (no markdown, no prose) with exactly these keys:
{
  "skills": string[],     // specific skills/topics wanted, e.g. "system design", "GTM", "resume review", "DSA"
  "roles": string[],      // job roles of the ideal mentor, e.g. "product manager", "software engineer"
  "companies": string[],  // companies/institutions/exams, e.g. "Google", "FAANG", "IIT", "UPSC"
  "domains": string[],    // industries/fields, e.g. "fintech", "data science", "startups"
  "maxBudgetInr": number | null,
  "brief": string         // 3 short numbered steps (max 70 words total) of practical advice for this exact request, using **bold** for key terms. Do NOT mention any mentor names.
}
Use short lowercase-friendly terms (1-3 words). Max 5 items per array. Never invent budget; use null if absent.`;

function safeParseJson(text) {
  if (!text) return null;
  const cleaned = text.replace(/```json|```/gi, '').trim();
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start === -1 || end === -1) return null;
  try { return JSON.parse(cleaned.slice(start, end + 1)); } catch { return null; }
}

async function extractIntent(query) {
  try {
    const client = getClient();
    const completion = await Promise.race([
      client.chat.completions.create({
        model: MODEL,
        messages: [
          { role: 'system', content: INTENT_PROMPT },
          { role: 'user', content: query },
        ],
        temperature: 0.2,
        max_tokens: 450,
      }),
      new Promise((_, reject) => setTimeout(() => reject(new Error('intent_timeout')), 9000)),
    ]);
    const parsed = safeParseJson(completion.choices[0]?.message?.content);
    if (!parsed) return null;
    const arr = (v) => (Array.isArray(v) ? v.filter((x) => typeof x === 'string').slice(0, 5) : []);
    return {
      skills: arr(parsed.skills),
      roles: arr(parsed.roles),
      companies: arr(parsed.companies),
      domains: arr(parsed.domains),
      maxBudgetInr: Number(parsed.maxBudgetInr) > 0 ? Number(parsed.maxBudgetInr) : null,
      brief: typeof parsed.brief === 'string' ? parsed.brief.trim() : '',
    };
  } catch (err) {
    console.warn('Intent extraction fallback:', err.message);
    return null;
  }
}

router.post('/match-mentors', matchLimiter, async (req, res) => {
  try {
    const { query } = req.body;
    if (!query || typeof query !== 'string' || query.trim().length < 3) {
      return res.status(400).json({ error: 'Please describe what you need help with.' });
    }
    if (query.length > 500) {
      return res.status(400).json({ error: 'Query too long (max 500 characters)' });
    }

    const text = query.trim();
    const [entities, mentors] = await Promise.all([extractIntent(text), getMatchableMentors()]);

    const { results, concepts } = matchMentors(mentors, text, entities || {}, 3);

    res.json({
      query: text,
      brief: entities?.brief || '',
      understood: concepts,
      aiUnderstood: !!entities,
      totalMentorsSearched: mentors.length,
      mentors: results,
    });
  } catch (error) {
    console.error('Mentor match error:', error.message);
    res.status(500).json({ error: 'Could not find mentors right now. Please try again.' });
  }
});

module.exports = router;

