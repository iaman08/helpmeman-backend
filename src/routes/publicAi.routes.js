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

module.exports = router;
