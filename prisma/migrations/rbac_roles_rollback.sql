-- RBAC Migration: Rollback Script
-- Reverts the Role enum back to {USER, MENTOR, ADMIN}
-- SUPER_ADMIN → ADMIN, STUDENT → USER

BEGIN;

-- 1. Drop the default
ALTER TABLE "User" ALTER COLUMN "role" DROP DEFAULT;

-- 2. Create the old enum type
CREATE TYPE "Role_old" AS ENUM ('USER', 'MENTOR', 'ADMIN');

-- 3. Alter the column back, mapping new values to old
ALTER TABLE "User"
  ALTER COLUMN "role" TYPE "Role_old"
  USING (
    CASE "role"::text
      WHEN 'SUPER_ADMIN' THEN 'ADMIN'::"Role_old"
      WHEN 'ADMIN'       THEN 'ADMIN'::"Role_old"
      WHEN 'MENTOR'      THEN 'MENTOR'::"Role_old"
      WHEN 'STUDENT'     THEN 'USER'::"Role_old"
    END
  );

-- 4. Restore original default
ALTER TABLE "User" ALTER COLUMN "role" SET DEFAULT 'USER'::"Role_old";

-- 5. Drop the new enum
DROP TYPE "Role";

-- 6. Rename old enum back to canonical name
ALTER TYPE "Role_old" RENAME TO "Role";

-- 7. Drop AuditLog table (preserving data is optional; uncomment to keep)
-- DROP TABLE IF EXISTS "AuditLog";

COMMIT;
