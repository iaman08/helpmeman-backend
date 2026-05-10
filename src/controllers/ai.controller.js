const aiService = require('../services/ai.service');

// POST /api/ai/chat
async function chatWithAI(req, res) {
  try {
    const { message } = req.body;
    if (!message || typeof message !== 'string' || message.trim().length === 0) {
      return res.status(400).json({ error: 'Message is required' });
    }

    if (message.length > 2000) {
      return res.status(400).json({ error: 'Message too long (max 2000 characters)' });
    }

    const userId = req.user.id;
    const userName = req.user.name || 'Student';

    const response = await aiService.chat(userId, userName, message.trim());

    res.json({ response });
  } catch (error) {
    console.error('AI chat error:', error.message);

    if (error.message.includes('GROQ_API_KEY')) {
      return res.status(503).json({ error: 'AI service not configured. Please add GROQ_API_KEY to environment.' });
    }

    if (error.status === 429 || error.message?.includes('rate_limit')) {
      return res.status(429).json({ error: 'AI service is busy right now. Please wait a moment and try again.' });
    }

    res.status(500).json({ error: 'AI service temporarily unavailable. Please try again.' });
  }
}

// POST /api/ai/clear
async function clearChat(req, res) {
  try {
    const userId = req.user.id;
    aiService.clearHistory(userId);
    res.json({ message: 'Chat history cleared' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to clear chat' });
  }
}

module.exports = { chatWithAI, clearChat };
