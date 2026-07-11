const prisma = require('../config/prisma');

const lastUpdates = new Map();

/**
 * Throttled user activity registration.
 * Ensures we only write to the database once a minute per user to maximize performance.
 */
async function updateUserPresence(userId, forceStatus = null) {
  if (!userId) return;

  const now = Date.now();
  const lastUpdate = lastUpdates.get(userId);
  const statusToSet = forceStatus || 'ONLINE';

  if (!forceStatus && lastUpdate && (now - lastUpdate < 60000)) {
    return; // Throttled
  }

  if (!forceStatus) {
    lastUpdates.set(userId, now);
  }

  try {
    await prisma.user.update({
      where: { id: userId },
      data: {
        lastSeen: new Date(),
        presenceStatus: statusToSet
      }
    });
  } catch (err) {
    console.error(`[PRESENCE] Failed to update presence for ${userId}:`, err.message);
  }
}

/**
 * Periodically sweep users to AWAY or OFFLINE based on inactivity thresholds:
 * - ONLINE -> AWAY: Last seen 5 to 30 minutes ago.
 * - AWAY -> OFFLINE: Last seen > 30 minutes ago.
 */
function initPresenceSweep() {
  console.log('⏰ Presence background sweeper initialized');
  setInterval(async () => {
    try {
      const fiveMinsAgo = new Date(Date.now() - 5 * 60 * 1000);
      const thirtyMinsAgo = new Date(Date.now() - 30 * 60 * 1000);

      // Sweep ONLINE -> AWAY
      await prisma.user.updateMany({
        where: {
          presenceStatus: 'ONLINE',
          lastSeen: { lt: fiveMinsAgo }
        },
        data: { presenceStatus: 'AWAY' }
      });

      // Sweep AWAY -> OFFLINE
      await prisma.user.updateMany({
        where: {
          presenceStatus: { in: ['ONLINE', 'AWAY'] },
          lastSeen: { lt: thirtyMinsAgo }
        },
        data: { presenceStatus: 'OFFLINE' }
      });
    } catch (error) {
      console.error('[PRESENCE] Sweep job crashed:', error.message);
    }
  }, 60000); // Sweep every minute
}

module.exports = {
  updateUserPresence,
  initPresenceSweep
};
