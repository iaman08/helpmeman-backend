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

    console.log('[DB] Verifying User table columns in PostgreSQL...');
    await prisma.$executeRawUnsafe(`
      ALTER TABLE "User" 
        ADD COLUMN IF NOT EXISTS "onboardingRole" TEXT,
        ADD COLUMN IF NOT EXISTS "username" TEXT,
        ADD COLUMN IF NOT EXISTS "currentRole" TEXT,
        ADD COLUMN IF NOT EXISTS "lastSeen" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP,
        ADD COLUMN IF NOT EXISTS "presenceStatus" TEXT DEFAULT 'OFFLINE',
        ADD COLUMN IF NOT EXISTS "currency" TEXT;
    `);

    // Create unique index and index on username
    await prisma.$executeRawUnsafe(`
      CREATE UNIQUE INDEX IF NOT EXISTS "User_username_key" ON "User"("username");
    `);
    await prisma.$executeRawUnsafe(`
      CREATE INDEX IF NOT EXISTS "User_username_idx" ON "User"("username");
    `);
    console.log('[DB] User table schema verification complete ✓');

    console.log('[DB] Verifying TeamMember table in PostgreSQL...');
    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS "TeamMember" (
        "id" TEXT NOT NULL,
        "fullName" TEXT NOT NULL,
        "username" TEXT NOT NULL,
        "role" TEXT NOT NULL,
        "department" TEXT NOT NULL,
        "bio" TEXT NOT NULL,
        "story" TEXT,
        "education" TEXT,
        "experience" TEXT,
        "achievements" TEXT,
        "projects" TEXT,
        "skills" TEXT[],
        "interests" TEXT[],
        "languages" TEXT[],
        "location" TEXT,
        "country" TEXT,
        "email" TEXT,
        "phone" TEXT,
        "linkedin" TEXT,
        "github" TEXT,
        "twitter" TEXT,
        "website" TEXT,
        "instagram" TEXT,
        "facebook" TEXT,
        "imageUrl" TEXT,
        "coverUrl" TEXT,
        "status" TEXT NOT NULL DEFAULT 'ONLINE',
        "isFounder" BOOLEAN NOT NULL DEFAULT false,
        "isLeadership" BOOLEAN NOT NULL DEFAULT false,
        "isVerified" BOOLEAN NOT NULL DEFAULT false,
        "isActive" BOOLEAN NOT NULL DEFAULT true,
        "isFeatured" BOOLEAN NOT NULL DEFAULT false,
        "availableForMentorship" BOOLEAN NOT NULL DEFAULT false,
        "allowContact" BOOLEAN NOT NULL DEFAULT true,
        "showEmail" BOOLEAN NOT NULL DEFAULT false,
        "showSocialLinks" BOOLEAN NOT NULL DEFAULT true,
        "displayOrder" INTEGER NOT NULL DEFAULT 0,
        "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "leftAt" TIMESTAMP(3),
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

        CONSTRAINT "TeamMember_pkey" PRIMARY KEY ("id")
      );
    `);
    await prisma.$executeRawUnsafe(`
      CREATE UNIQUE INDEX IF NOT EXISTS "TeamMember_username_key" ON "TeamMember"("username");
    `);
    await prisma.$executeRawUnsafe(`
      CREATE INDEX IF NOT EXISTS "TeamMember_username_idx" ON "TeamMember"("username");
    `);
    await prisma.$executeRawUnsafe(`
      CREATE INDEX IF NOT EXISTS "TeamMember_department_idx" ON "TeamMember"("department");
    `);
    await prisma.$executeRawUnsafe(`
      CREATE INDEX IF NOT EXISTS "TeamMember_displayOrder_idx" ON "TeamMember"("displayOrder");
    `);
    console.log('[DB] TeamMember table schema verification complete ✓');

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

    console.log('[DB] Verifying MentorReview table in PostgreSQL...');
    // Add aggregate columns to Mentor if not exists
    await prisma.$executeRawUnsafe(`
      ALTER TABLE "Mentor"
        ADD COLUMN IF NOT EXISTS "avgRating" FLOAT NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS "totalReviews" INTEGER NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS "ratingDistribution" JSONB NOT NULL DEFAULT '{"1":0,"2":0,"3":0,"4":0,"5":0}'::jsonb;
    `);
    // Create MentorReview table
    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS "MentorReview" (
        "id" TEXT NOT NULL,
        "bookingId" TEXT NOT NULL,
        "mentorId" TEXT NOT NULL,
        "userId" TEXT NOT NULL,
        "rating" INTEGER NOT NULL,
        "feedback" TEXT,
        "tags" TEXT[] NOT NULL DEFAULT '{}',
        "anonymous" BOOLEAN NOT NULL DEFAULT false,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT "MentorReview_pkey" PRIMARY KEY ("id"),
        CONSTRAINT "MentorReview_rating_check" CHECK ("rating" >= 1 AND "rating" <= 5),
        CONSTRAINT "MentorReview_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "Booking"("id") ON DELETE CASCADE ON UPDATE CASCADE,
        CONSTRAINT "MentorReview_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
      );
    `);
    // Unique one review per booking
    await prisma.$executeRawUnsafe(`
      CREATE UNIQUE INDEX IF NOT EXISTS "MentorReview_bookingId_key" ON "MentorReview"("bookingId");
    `);
    await prisma.$executeRawUnsafe(`
      CREATE INDEX IF NOT EXISTS "MentorReview_mentorId_idx" ON "MentorReview"("mentorId");
    `);
    await prisma.$executeRawUnsafe(`
      CREATE INDEX IF NOT EXISTS "MentorReview_userId_idx" ON "MentorReview"("userId");
    `);
    await prisma.$executeRawUnsafe(`
      CREATE INDEX IF NOT EXISTS "MentorReview_rating_idx" ON "MentorReview"("rating");
    `);
    await prisma.$executeRawUnsafe(`
      CREATE INDEX IF NOT EXISTS "MentorReview_createdAt_idx" ON "MentorReview"("createdAt" DESC);
    `);
    console.log('[DB] MentorReview table schema verification complete ✓');

    console.log('[DB] Verification finished.');
  } catch (err) {
    console.error('[DB] MessageReaction dynamic migration failed:', err.message);
  }
})();

// Singleton with global auto-retry middleware for Supabase cold-start wakeup.
// NOTE: P2024 (connection pool timeout) is explicitly NOT retried — retrying
// exhausted-pool errors only makes the situation worse by holding slots longer.
prisma.$use(async (params, next) => {
  const maxRetries = 3;
  const delay = (ms) => new Promise((r) => setTimeout(r, ms));
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await next(params);
    } catch (err) {
      // P2024 = connection pool timeout — do NOT retry, throw immediately.
      if (err.code === 'P2024') throw err;

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
