const authService = require('../services/auth.service');

async function authenticate(req, res, next) {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Access token required' });
    }

    const token = authHeader.split(' ')[1];
    const user = await authService.verifySession(token);

    req.user = user;

    // Track user presence dynamically from API traffic
    const { updateUserPresence } = require('../services/presence.service');
    updateUserPresence(user.id).catch(() => {});

    next();
  } catch (error) {
    console.error('Auth middleware error:', error.message);
    if (error.message.includes('expired')) {
      return res.status(401).json({ error: 'Token expired', code: 'TOKEN_EXPIRED' });
    }
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

async function optionalAuth(req, res, next) {
  try {
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.split(' ')[1];
      const user = await authService.verifySession(token);
      req.user = user;
    } else {
      req.user = null;
    }
  } catch {
    req.user = null;
  }
  next();
}

module.exports = { authenticate, optionalAuth };

