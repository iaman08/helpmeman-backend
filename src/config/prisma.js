const { PrismaClient } = require('@prisma/client');

let prisma;

if (process.env.NODE_ENV === 'production') {
  prisma = new PrismaClient({
    log: ['error'],
  });
} else {
  if (!global.prisma) {
    global.prisma = new PrismaClient({
      log: ['warn', 'error'],
    });
  }
  prisma = global.prisma;
}

// Dynamic table creation for message reactions and ChatMessage columns
(async () => {
  try {
    const path = require('path');
    const { execSync } = require('child_process');
    // Wait slightly to ensure DB connection is ready
    await new Promise(r => setTimeout(r, 1000));

    console.log('[DB] Verifying MessageStatus enum and ChatMessage columns in PostgreSQL...');
    
    // 1. Create enum if not exists
    await prisma.$executeRawUnsafe(`
      DO $$
      BEGIN
          IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'MessageStatus') THEN
              CREATE TYPE "MessageStatus" AS ENUM ('SENDING', 'SENT', 'DELIVERED', 'READ');
          END IF;
      END
      $$;
    `);

    // 2. Add columns if not exists
    await prisma.$executeRawUnsafe(`
      ALTER TABLE "ChatMessage" 
        ADD COLUMN IF NOT EXISTS "status" "MessageStatus" NOT NULL DEFAULT 'SENT',
        ADD COLUMN IF NOT EXISTS "replyToId" TEXT,
        ADD COLUMN IF NOT EXISTS "editedAt" TIMESTAMP(3),
        ADD COLUMN IF NOT EXISTS "deletedAt" TIMESTAMP(3),
        ADD COLUMN IF NOT EXISTS "attachments" JSONB;
    `);

    // 3. Add foreign key if not exists
    await prisma.$executeRawUnsafe(`
      DO $$
      BEGIN
          IF NOT EXISTS (
              SELECT 1 
              FROM information_schema.table_constraints 
              WHERE constraint_name = 'ChatMessage_replyToId_fkey'
          ) THEN
              ALTER TABLE "ChatMessage" 
                ADD CONSTRAINT "ChatMessage_replyToId_fkey" 
                FOREIGN KEY ("replyToId") REFERENCES "ChatMessage"("id") ON DELETE SET NULL ON UPDATE CASCADE;
          END IF;
      END
      $$;
    `);

    // 4. Add index
    await prisma.$executeRawUnsafe(`
      CREATE INDEX IF NOT EXISTS "ChatMessage_replyToId_idx" ON "ChatMessage"("replyToId");
    `);

    console.log('[DB] Verifying MessageReaction table in PostgreSQL...');
    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS "MessageReaction" (
        "id" TEXT NOT NULL,
        "messageId" TEXT NOT NULL,
        "userId" TEXT NOT NULL,
        "emoji" TEXT NOT NULL,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

        CONSTRAINT "MessageReaction_pkey" PRIMARY KEY ("id"),
        CONSTRAINT "MessageReaction_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "ChatMessage"("id") ON DELETE CASCADE ON UPDATE CASCADE
      );
    `);
    // Drop old multi-emoji index if it exists
    await prisma.$executeRawUnsafe(`
      DROP INDEX IF EXISTS "MessageReaction_messageId_userId_emoji_key";
    `);
    // Create new unique constraint/index on (messageId, userId)
    await prisma.$executeRawUnsafe(`
      CREATE UNIQUE INDEX IF NOT EXISTS "MessageReaction_messageId_userId_key" 
      ON "MessageReaction"("messageId", "userId");
    `);
    await prisma.$executeRawUnsafe(`
      CREATE INDEX IF NOT EXISTS "MessageReaction_messageId_idx" 
      ON "MessageReaction"("messageId");
    `);
    console.log('[DB] MessageReaction and ChatMessage schema migration complete ✓');

    // Run column diagnostic check
    try {
      console.log('[DB] Running inline column diagnostics...');
      const cols = await prisma.$queryRawUnsafe(`
        SELECT column_name, data_type 
        FROM information_schema.columns 
        WHERE table_name = 'ChatMessage';
      `);
      const fs = require('fs');
      const p = require('path');
      fs.writeFileSync(p.join(__dirname, '..', '..', 'db_columns.txt'), JSON.stringify(cols, null, 2), 'utf8');
      console.log('[DB] Diagnostics written to db_columns.txt');
    } catch (e) {
      console.error('[DB] Inline diagnostics failed:', e.message);
    }

    console.log('[DB] Checking Prisma Client generation status...');
    const fs = require('fs');
    const flagPath = path.join(__dirname, '..', '..', 'prisma_generated.flag');
    if (!fs.existsSync(flagPath)) {
      console.log('[DB] Regenerating Prisma Client for new MessageReaction constraint...');
      execSync('npx prisma generate', { cwd: path.join(__dirname, '..', '..') });
      fs.writeFileSync(flagPath, 'done', 'utf8');
      console.log('[DB] Prisma Client regenerated successfully! Restarting server to reload types...');
      process.exit(0);
    } else {
      console.log('[DB] Prisma Client is up-to-date. ✓');
    }
  } catch (err) {
    console.error('[DB] MessageReaction dynamic migration failed:', err.message);
  }
})();

// Singleton with global auto-retry middleware for Supabase cold-start wakeup.
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
        err.message?.includes('ConnectionReset') ||
        err.message?.includes('10054') ||
        err.message?.includes('forcibly closed') ||
        err.code === 'P1001' || // Connection error
        err.code === 'P1002';   // Timed out connecting
      if (isConnErr && attempt < maxRetries) {
        console.warn(
          `[DB] Supabase wakeup retry ${attempt}/${maxRetries} for ${params.model}.${params.action} — waiting ${attempt * 3}s...`
        );
        await delay(attempt * 3000);
      } else {
        throw err;
      }
    }
  }
});

module.exports = prisma;
