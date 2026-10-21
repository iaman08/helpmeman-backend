const prisma = require('../config/prisma');

async function createTable() {
  try {
    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS "PlatformSetting" (
        "id" TEXT NOT NULL,
        "key" TEXT UNIQUE NOT NULL,
        "value" TEXT NOT NULL,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT "PlatformSetting_pkey" PRIMARY KEY ("id")
      );
    `);
    await prisma.$executeRawUnsafe(`
      CREATE INDEX IF NOT EXISTS "PlatformSetting_key_idx" ON "PlatformSetting"("key");
    `);
    console.log('[DB] PlatformSetting table created/verified successfully!');
  } catch (err) {
    console.error('[DB] Failed to create PlatformSetting table:', err.message);
  } finally {
    process.exit(0);
  }
}

createTable();
