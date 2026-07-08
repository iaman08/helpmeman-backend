const { PrismaClient } = require('@prisma/client');

// Singleton with global auto-retry middleware for Neon cold-start wakeup.
// Neon free tier sleeps after ~5 min inactivity; first query after sleep
// needs up to 10s to reconnect. This middleware retries 3x automatically.
const prisma = new PrismaClient({
  log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
});

prisma.$use(async (params, next) => {
  const maxRetries = 3;
  const delay = (ms) => new Promise((r) => setTimeout(r, ms));
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await next(params);
    } catch (err) {
      const isConnErr =
        err.message?.includes("Can't reach database") ||
        err.message?.includes('Unable to start a transaction') ||
        err.code === 'P1001' || // Connection error
        err.code === 'P1002';   // Timed out connecting
      if (isConnErr && attempt < maxRetries) {
        console.warn(
          `[DB] Neon wakeup retry ${attempt}/${maxRetries} for ${params.model}.${params.action} — waiting ${attempt * 3}s...`
        );
        await delay(attempt * 3000);
      } else {
        throw err;
      }
    }
  }
});

module.exports = prisma;
