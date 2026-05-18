const aiService = require('../services/ai.service');

// POST /api/ai/chat
async function chatWithAI(req, res) {
  try {
    const { message, sessionId } = req.body;
    if (!message || typeof message !== 'string' || message.trim().length === 0) {
      return res.status(400).json({ error: 'Message is required' });
    }
    if (message.length > 2000) {
      return res.status(400).json({ error: 'Message too long (max 2000 characters)' });
    }

    const userId = req.user.id;
    const userName = req.user.name || 'Student';

    const result = await aiService.chat(userId, userName, message.trim(), sessionId || null);
    res.json(result);
  } catch (error) {
    console.error('AI chat error:', error.message);
    if (error.message.includes('GROQ_API_KEY')) {
      return res.status(503).json({ error: 'AI service not configured.' });
    }
    if (error.status === 429 || error.message?.includes('rate_limit')) {
      return res.status(429).json({ error: 'AI service is busy. Please wait a moment.' });
    }
    res.status(500).json({ error: 'AI service temporarily unavailable.' });
  }
}

// POST /api/ai/sessions  — create a new session
async function createSession(req, res) {
  try {
    const session = await aiService.createSession(req.user.id);
    res.status(201).json(session);
  } catch (error) {
    console.error('Create session error:', error.message);
    res.status(500).json({ error: 'Failed to create session' });
  }
}

// GET /api/ai/sessions  — list sessions grouped by date
async function getSessions(req, res) {
  try {
    const grouped = await aiService.getSessions(req.user.id);
    res.json(grouped);
  } catch (error) {
    console.error('Get sessions error:', error.message);
    res.status(500).json({ error: 'Failed to fetch sessions' });
  }
}

// GET /api/ai/sessions/:id/resume  — load session + last 10 messages
async function resumeSession(req, res) {
  try {
    const data = await aiService.resumeSession(req.params.id, req.user.id);
    if (!data) return res.status(404).json({ error: 'Session not found' });
    res.json(data);
  } catch (error) {
    console.error('Resume session error:', error.message);
    res.status(500).json({ error: 'Failed to resume session' });
  }
}

// POST /api/ai/sessions/:id/end
async function endSession(req, res) {
  try {
    await aiService.endSession(req.params.id, req.user.id);
    res.json({ message: 'Session ended' });
  } catch (error) {
    console.error('End session error:', error.message);
    res.status(500).json({ error: 'Failed to end session' });
  }
}

// DELETE /api/ai/sessions/:id
async function deleteSession(req, res) {
  try {
    await aiService.deleteSession(req.params.id, req.user.id);
    res.json({ message: 'Session deleted' });
  } catch (error) {
    console.error('Delete session error:', error.message);
    res.status(500).json({ error: 'Failed to delete session' });
  }
}

// POST /api/ai/clear  — legacy stub
async function clearChat(req, res) {
  try {
    await aiService.clearHistory(req.user.id);
    res.json({ message: 'Chat history cleared' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to clear chat' });
  }
}

// GET /api/ai/meetings
async function getMeetings(req, res) {
  try {
    const meetings = await aiService.getMeetings(req.user.id);
    res.json(meetings);
  } catch (error) {
    console.error('Get meetings error:', error.message);
    res.status(500).json({ error: 'Failed to fetch meetings' });
  }
}

// POST /api/ai/meetings/:bookingId/session
async function getMeetingSession(req, res) {
  try {
    const data = await aiService.getOrCreateMeetingSession(req.user.id, req.params.bookingId);
    res.json(data);
  } catch (error) {
    console.error('Get meeting session error:', error.message);
    res.status(500).json({ error: 'Failed to open meeting session' });
  }
}

// PUT /api/ai/sessions/:id/rename
async function renameSession(req, res) {
  try {
    const { title } = req.body;
    if (!title || typeof title !== 'string' || title.trim().length === 0) {
      return res.status(400).json({ error: 'Title is required' });
    }
    await aiService.renameSession(req.params.id, req.user.id, title.trim());
    res.json({ message: 'Session renamed' });
  } catch (error) {
    console.error('Rename session error:', error.message);
    res.status(500).json({ error: 'Failed to rename session' });
  }
}

module.exports = {
  chatWithAI,
  createSession,
  getSessions,
  resumeSession,
  endSession,
  deleteSession,
  clearChat,
  getMeetings,
  getMeetingSession,
  renameSession,
};
