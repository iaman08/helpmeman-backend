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

YOUR ROLE:
- Answer the visitor's career/education question helpfully and concisely.
- Recommend 1-2 specific mentors by name when relevant.
- Encourage the user to sign up for a full mentorship session.
- Keep responses under 200 words, warm, and professional.
- Use markdown formatting (**bold** for emphasis).
- Do NOT invent mentor names — only recommend from the list above.
- If no mentor matches, give general advice and suggest signing up to browse all mentors.`;

    const completion = await client.chat.completions.create({
      model: MODEL,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: message.trim() },
      ],
      temperature: 0.7,
      max_tokens: 512,
    });

    const responseText = completion.choices[0]?.message?.content || 'Sorry, I could not generate a response right now.';

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

YOUR ROLE:
- Answer the visitor's career/education question helpfully and concisely.
- Recommend 1-2 specific mentors by name when relevant.
- Encourage the user to sign up for a full mentorship session.
- Keep responses under 200 words, warm, and professional.
- Use markdown formatting (**bold** for emphasis).
- Do NOT invent mentor names — only recommend from the list above.
- If no mentor matches, give general advice and suggest signing up to browse all mentors.

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
}`;

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
