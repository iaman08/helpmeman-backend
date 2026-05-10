const Groq = require('groq-sdk');
const { Redis } = require('@upstash/redis');
const { PrismaClient } = require('@prisma/client');
const config = require('../config/env');

const prisma = new PrismaClient();

let groqClient = null;
const MODEL = 'llama-3.3-70b-versatile';

function getClient() {
  if (!config.groq.apiKey) {
    throw new Error('GROQ_API_KEY not configured');
  }
  if (!groqClient) {
    groqClient = new Groq({ apiKey: config.groq.apiKey });
  }
  return groqClient;
}

// Initialize Upstash Redis
const redis = new Redis({
  url: config.upstash.url,
  token: config.upstash.token,
});

const TTL = 24 * 60 * 60; // 24 hours in seconds
const MSG_THRESHOLD = 10;

function getConversationKey(userId) {
  return `ai_chat:${userId}`;
}

async function getHistory(userId) {
  const key = getConversationKey(userId);
  const data = await redis.get(key);
  
  if (!data) {
    return { summary: '', messages: [] };
  }
  
  return typeof data === 'string' ? JSON.parse(data) : data;
}

async function saveHistory(userId, data) {
  const key = getConversationKey(userId);
  await redis.set(key, JSON.stringify(data), { ex: TTL });
}

async function summarizeConversation(currentSummary, messages) {
  const client = getClient();
  
  const conversationText = messages
    .map(m => `${m.role === 'user' ? 'User' : 'AI'}: ${m.content}`)
    .join('\n');
    
  const prompt = `You are a conversation summarizer. 
Existing Summary: ${currentSummary || 'None'}

New Messages:
${conversationText}

Provide a new, updated summary of the entire conversation so far in about 100 words or less. Preserve key details like requested topics, mentor recommendations made, and user goals. Do not include any other text, just the summary.`;

  try {
    const completion = await client.chat.completions.create({
      model: MODEL,
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.5,
      max_tokens: 200,
    });
    
    return completion.choices[0]?.message?.content?.trim() || currentSummary;
  } catch (error) {
    console.error('Failed to summarize conversation:', error);
    return currentSummary; // fallback to old summary if failed
  }
}

async function clearHistory(userId) {
  const key = getConversationKey(userId);
  await redis.del(key);
}

// Fetch platform context for the AI
async function getPlatformContext() {
  const [categories, mentorCount, topMentors] = await Promise.all([
    prisma.category.findMany({ where: { isActive: true }, select: { name: true, slug: true, description: true } }),
    prisma.mentor.count({ where: { approvalStatus: 'APPROVED', isActive: true } }),
    prisma.mentor.findMany({
      where: { approvalStatus: 'APPROVED', isActive: true },
      select: {
        id: true,
        displayName: true,
        currentRole: true,
        company: true,
        expertise: true,
        rating: true,
        totalSessions: true,
        pricePerSession: true,
        sessionDuration: true,
        institutionName: true,
        institutionType: true,
        category: { select: { name: true } },
      },
      orderBy: { rating: 'desc' },
      take: 20,
    }),
  ]);

  return { categories, mentorCount, topMentors };
}

function buildSystemPrompt(context, userName, summary) {
  const mentorList = context.topMentors.map(m =>
    `- ${m.displayName} | ${m.currentRole || 'Mentor'}${m.company ? ` at ${m.company}` : ''} | ${m.institutionName} (${m.institutionType}) | Category: ${m.category?.name || 'General'} | Expertise: ${m.expertise.join(', ')} | Rating: ${m.rating > 0 ? m.rating.toFixed(1) + '/5' : 'New'} | ${m.totalSessions} sessions | ₹${Math.round(m.pricePerSession / 100)}/${m.sessionDuration}min | ID: ${m.id}`
  ).join('\n');

  const categoryList = context.categories.map(c => `- ${c.name}: ${c.description || c.slug}`).join('\n');

  let prompt = `You are HelpMeMan AI, a friendly and knowledgeable mentorship assistant for the HelpMeMan platform.

ABOUT THE PLATFORM:
HelpMeMan is a premium mentorship platform that connects students with verified mentors from IITs, AIIMS, NLUs, FAANG companies, and elite startups. Students can browse mentors, book 1-on-1 sessions, pay via Razorpay, and join video calls via Google Meet.

CURRENT USER: ${userName}`;

  if (summary) {
    prompt += `\n\nCONVERSATION SUMMARY SO FAR:\n${summary}\n(Use this to remember what the user discussed previously)`;
  }

  prompt += `\n\nPLATFORM STATS:
- ${context.mentorCount} verified mentors available

CATEGORIES:
${categoryList}

AVAILABLE MENTORS:
${mentorList}

YOUR RESPONSIBILITIES:
1. Help students find the right mentor based on their goals, interests, and budget
2. Answer questions about the platform (booking process, pricing, how sessions work)
3. Provide general career and education guidance
4. Recommend specific mentors by name when relevant — include their profile link as /mentors/[ID]
5. Be encouraging and supportive

RULES:
- Be concise but warm. Use short paragraphs.
- Format mentor recommendations with clickable links: [Mentor Name](/mentors/MENTOR_ID)
- Use ₹ for prices
- Keep responses under 300 words
- Use markdown formatting`;

  return prompt;
}

async function chat(userId, userName, message) {
  const client = getClient();
  const context = await getPlatformContext();
  
  // 1. Get history from Redis
  const history = await getHistory(userId);
  
  // 2. Build system prompt with summary
  const systemPrompt = buildSystemPrompt(context, userName, history.summary);

  // 3. Build messages for completion
  const messagesForGroq = [
    { role: 'system', content: systemPrompt },
    ...history.messages,
    { role: 'user', content: message },
  ];

  // 4. Get response from Groq
  const completion = await client.chat.completions.create({
    model: MODEL,
    messages: messagesForGroq,
    temperature: 0.7,
    max_tokens: 1024,
  });

  const responseText = completion.choices[0]?.message?.content || 'Sorry, I could not generate a response.';

  // 5. Update history
  history.messages.push({ role: 'user', content: message });
  history.messages.push({ role: 'assistant', content: responseText });

  // 6. Check for summarization threshold
  if (history.messages.length >= MSG_THRESHOLD) {
    console.log(`Threshold reached (${history.messages.length} msgs). Summarizing...`);
    const newSummary = await summarizeConversation(history.summary, history.messages);
    history.summary = newSummary;
    history.messages = []; // Clear messages after summarization
  }

  // 7. Save back to Redis
  await saveHistory(userId, history);

  return responseText;
}

module.exports = { chat, clearHistory };
