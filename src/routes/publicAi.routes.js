const express = require('express');
const router = express.Router();
const rateLimit = require('express-rate-limit');
const Groq = require('groq-sdk');
const config = require('../config/env');
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

// Strict rate limiter for public demo — 10 requests per 15 minutes per IP
const demoLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Demo limit reached. Please sign up for unlimited AI access.' },
});

let groqClient = null;
const MODEL = 'llama-3.3-70b-versatile';

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

module.exports = router;
