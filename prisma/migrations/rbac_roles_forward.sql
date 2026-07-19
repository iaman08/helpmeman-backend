-- RBAC Migration: Role Enum Expansion
-- Forward Migration (USER → STUDENT, add SUPER_ADMIN)
-- PostgreSQL supports transactional DDL — entire migration is atomic.

BEGIN;

-- 1. Drop the default on the role column (required before type change)
ALTER TABLE "User" ALTER COLUMN "role" DROP DEFAULT;

-- 2. Create the new enum type with target values
CREATE TYPE "Role_new" AS ENUM ('SUPER_ADMIN', 'ADMIN', 'MENTOR', 'STUDENT');

-- 3. Alter the column to use the new type, mapping old values to new
ALTER TABLE "User"
  ALTER COLUMN "role" TYPE "Role_new"
  USING (
    CASE "role"::text
      WHEN 'USER'   THEN 'STUDENT'::"Role_new"
      WHEN 'ADMIN'  THEN 'ADMIN'::"Role_new"
      WHEN 'MENTOR' THEN 'MENTOR'::"Role_new"
    END
  );

-- 4. Set the new default
ALTER TABLE "User" ALTER COLUMN "role" SET DEFAULT 'STUDENT'::"Role_new";

-- 5. Drop the old enum type (no longer referenced by any column)
DROP TYPE "Role";

-- 6. Rename the new enum to the canonical name
ALTER TYPE "Role_new" RENAME TO "Role";

-- 7. Create AuditLog table
CREATE TABLE IF NOT EXISTS "AuditLog" (
  "id"        TEXT NOT NULL DEFAULT gen_random_uuid()::text,
  "action"    TEXT NOT NULL,
  "actorId"   TEXT NOT NULL,
  "targetId"  TEXT,
  "oldValue"  TEXT,
  "newValue"  TEXT,
  "endpoint"  TEXT,
  "ip"        TEXT,
  "requestId" TEXT,
  "metadata"  JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "AuditLog_actorId_createdAt_idx" ON "AuditLog" ("actorId", "createdAt");
CREATE INDEX "AuditLog_targetId_createdAt_idx" ON "AuditLog" ("targetId", "createdAt");
CREATE INDEX "AuditLog_action_createdAt_idx" ON "AuditLog" ("action", "createdAt");

COMMIT;
