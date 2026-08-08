/**
 * provision-team-admins.js
 *
 * ONE-TIME script — run locally to create individual admin accounts for HelpMeMan team.
 * NEVER deploy or run this in CI/CD.
 *
 * What it does:
 *  1. Generates a cryptographically random temporary password for each member.
 *  2. Creates the user in Supabase Auth (email pre-confirmed).
 *  3. Upserts the local Prisma User record with role=ADMIN, mustChangePassword=true.
 *  4. Skips any email that already exists in Supabase or local DB (safe to re-run).
 *  5. Writes credentials to credentials_PRIVATE_DO_NOT_COMMIT.txt (gitignored).
 *  6. Logs ADMIN_ACCOUNT_CREATED audit event for each account.
 *
 * Usage:
 *   node src/scripts/provision-team-admins.js
 *
 * After running:
 *   - Distribute credentials individually and SECURELY to each team member.
 *   - Delete credentials_PRIVATE_DO_NOT_COMMIT.txt immediately after distribution.
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '../../.env') });

const { createClient } = require('@supabase/supabase-js');
const { PrismaClient } = require('@prisma/client');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

// ── Supabase client with service role (can create users) ──────────────────────
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false, autoRefreshToken: false } }
);

const prisma = new PrismaClient();

// ── Team members to provision ─────────────────────────────────────────────────
const TEAM_MEMBERS = [
  { name: 'Dilkhush',   email: 'dilkhush@helpmeman.com'   },
  { name: 'Aman',       email: 'aman@helpmeman.com'        },
  { name: 'Akash',      email: 'akash@helpmeman.com'       },
  { name: 'Sriman',     email: 'sriman@helpmeman.com'      },
  { name: 'Omi',        email: 'omi@helpmeman.com'         },
  { name: 'Roshan',     email: 'roshan@helpmeman.com'      },
  { name: 'Rishav',     email: 'rishav@helpmeman.com'      },
  { name: 'Egamberdi',  email: 'egamberdi@helpmeman.com'  },
];

// ── Password generator: 18 chars, mixed case + digits + symbols ───────────────
function generateTempPassword() {
  const upper  = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  const lower  = 'abcdefghjkmnpqrstuvwxyz';
  const digits = '23456789';
  const sym    = '!@#$%^&*';

  const all = upper + lower + digits + sym;
  const bytes = crypto.randomBytes(18);

  // Guarantee at least one of each category
  let password =
    upper[bytes[0] % upper.length] +
    lower[bytes[1] % lower.length] +
    digits[bytes[2] % digits.length] +
    sym[bytes[3] % sym.length];

  for (let i = 4; i < 18; i++) {
    password += all[bytes[i] % all.length];
  }

  // Shuffle to avoid predictable category positions
  return password
    .split('')
    .sort(() => crypto.randomInt(3) - 1)
    .join('');
}

// ── Audit log helper (writes to DB) ──────────────────────────────────────────
async function auditLog(actorId, targetId, email) {
  try {
    await prisma.auditLog.create({
      data: {
        action: 'ADMIN_ACCOUNT_CREATED',
        actorId,
        targetId,
        newValue: 'ADMIN',
        endpoint: 'provision-team-admins.js (script)',
        metadata: { email, provisionedBy: 'system-script', mustChangePassword: true },
      },
    });
  } catch (e) {
    console.warn(`  ⚠️  Audit log failed for ${email}: ${e.message}`);
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  console.log('\n🔐  HelpMeMan — Team Admin Account Provisioner\n');
  console.log('='.repeat(55));

  // We need a "system actor" ID for audit logs — use the first existing SUPER_ADMIN
  const systemActor = await prisma.user.findFirst({
    where: { role: 'SUPER_ADMIN' },
    select: { id: true, email: true },
  });
  const actorId = systemActor?.id || 'system-script';
  console.log(`\n📋 System actor for audit: ${systemActor?.email ?? 'none found'}`);

  const results = [];
  const outputLines = [
    '╔══════════════════════════════════════════════════════════════╗',
    '║     HelpMeMan Admin Credentials — DISTRIBUTE SECURELY       ║',
    '║     DELETE THIS FILE IMMEDIATELY AFTER DISTRIBUTION         ║',
    '╚══════════════════════════════════════════════════════════════╝',
    `Generated at: ${new Date().toISOString()}`,
    '',
  ];

  for (const member of TEAM_MEMBERS) {
    console.log(`\n▶  Processing ${member.name} (${member.email})`);

    // ── 1. Check if email already exists in local DB ─────────────────────────
    const existingLocal = await prisma.user.findFirst({
      where: { email: member.email },
      select: { id: true, role: true, email: true },
    });

    if (existingLocal) {
      console.log(`  ⏭️  SKIPPED — local DB record already exists (role: ${existingLocal.role})`);
      outputLines.push(`${member.name} (${member.email}): SKIPPED — account already exists`);
      results.push({ ...member, status: 'SKIPPED', reason: 'already_exists_local' });
      continue;
    }

    const tempPassword = generateTempPassword();

    // ── 2. Create in Supabase Auth ────────────────────────────────────────────
    const { data: sbData, error: sbError } = await supabase.auth.admin.createUser({
      email: member.email,
      password: tempPassword,
      email_confirm: true,           // skip email confirmation flow
      user_metadata: { full_name: member.name },
    });

    if (sbError) {
      // If the user already exists in Supabase but not locally, try fetching the existing one
      if (sbError.message?.toLowerCase().includes('already') || sbError.status === 422) {
        console.log(`  ⚠️  Supabase user already exists — checking if we can link to local DB...`);

        // List users and find by email
        const { data: listData } = await supabase.auth.admin.listUsers({ page: 1, perPage: 1000 });
        const existingSbUser = listData?.users?.find((u) => u.email === member.email);

        if (!existingSbUser) {
          console.error(`  ✗  Cannot find existing Supabase user for ${member.email}. Skipping.`);
          outputLines.push(`${member.name} (${member.email}): ERROR — Supabase lookup failed`);
          results.push({ ...member, status: 'ERROR', reason: sbError.message });
          continue;
        }

        console.log(`  ℹ️  Found Supabase user ${existingSbUser.id}. Linking to local DB...`);

        // Create local DB record linking to existing Supabase UUID
        const newUser = await prisma.user.create({
          data: {
            id: existingSbUser.id,
            email: member.email,
            name: member.name,
            passwordHash: '',           // Supabase manages passwords
            role: 'ADMIN',
            isEmailVerified: true,
            mustChangePassword: true,
          },
        });

        await auditLog(actorId, newUser.id, member.email);
        console.log(`  ✅  Linked existing Supabase user to new local ADMIN record.`);
        console.log(`  ⚠️  Note: Cannot retrieve existing Supabase password. Please use Supabase dashboard to reset.`);
        outputLines.push(`${member.name} (${member.email}): LINKED (existing Supabase account — reset password via Supabase dashboard)`);
        results.push({ ...member, status: 'LINKED', userId: newUser.id });
        continue;
      }

      console.error(`  ✗  Supabase error: ${sbError.message}`);
      outputLines.push(`${member.name} (${member.email}): ERROR — ${sbError.message}`);
      results.push({ ...member, status: 'ERROR', reason: sbError.message });
      continue;
    }

    const supabaseUser = sbData.user;
    console.log(`  ✓  Supabase Auth user created: ${supabaseUser.id}`);

    // ── 3. Create local DB record ─────────────────────────────────────────────
    let localUser;
    try {
      localUser = await prisma.user.create({
        data: {
          id: supabaseUser.id,
          email: member.email,
          name: member.name,
          passwordHash: '',             // Supabase manages all passwords
          role: 'ADMIN',
          isEmailVerified: true,
          mustChangePassword: true,
        },
      });
      console.log(`  ✓  Local DB record created with role=ADMIN, mustChangePassword=true`);
    } catch (dbErr) {
      console.error(`  ✗  Local DB create failed: ${dbErr.message}`);
      // Attempt rollback in Supabase to keep systems in sync
      await supabase.auth.admin.deleteUser(supabaseUser.id);
      console.log(`  ↩️  Rolled back Supabase user.`);
      outputLines.push(`${member.name} (${member.email}): ERROR — DB create failed, Supabase user deleted`);
      results.push({ ...member, status: 'ERROR', reason: dbErr.message });
      continue;
    }

    // ── 4. Write audit log ────────────────────────────────────────────────────
    await auditLog(actorId, localUser.id, member.email);

    // ── 5. Record credentials ─────────────────────────────────────────────────
    outputLines.push(`┌─ ${member.name}`);
    outputLines.push(`│  Email:    ${member.email}`);
    outputLines.push(`│  Password: ${tempPassword}`);
    outputLines.push(`│  Role:     ADMIN`);
    outputLines.push(`│  Note:     Must change password on first login`);
    outputLines.push(`└${'─'.repeat(55)}`);
    outputLines.push('');

    results.push({ ...member, status: 'CREATED', userId: localUser.id, tempPassword });
    console.log(`  ✓  DONE — credentials recorded`);
  }

  // ── Summary ───────────────────────────────────────────────────────────────
  outputLines.push('');
  outputLines.push('IMPORTANT SECURITY REMINDERS:');
  outputLines.push('• Distribute each password individually and privately (NOT in a group message).');
  outputLines.push('• Each admin must change their password on first login.');
  outputLines.push('• Delete this file immediately after distributing all credentials.');
  outputLines.push(`• Generated: ${new Date().toISOString()}`);

  const credFile = path.resolve(__dirname, '../../credentials_PRIVATE_DO_NOT_COMMIT.txt');
  fs.writeFileSync(credFile, outputLines.join('\n'), 'utf8');

  console.log('\n' + '='.repeat(55));
  console.log('📊  SUMMARY');
  console.log('='.repeat(55));
  const created  = results.filter((r) => r.status === 'CREATED');
  const skipped  = results.filter((r) => r.status === 'SKIPPED');
  const linked   = results.filter((r) => r.status === 'LINKED');
  const errored  = results.filter((r) => r.status === 'ERROR');

  console.log(`  ✅ Created : ${created.length}`);
  console.log(`  ⏭️  Skipped : ${skipped.length}`);
  console.log(`  🔗 Linked  : ${linked.length}`);
  console.log(`  ✗  Errors  : ${errored.length}`);

  if (errored.length > 0) {
    console.log('\n  Failed accounts:');
    errored.forEach((r) => console.log(`    - ${r.email}: ${r.reason}`));
  }

  console.log(`\n📄 Credentials saved to: ${credFile}`);
  console.log('⚠️  DELETE THIS FILE AFTER DISTRIBUTION!\n');

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error('\n💥 Fatal error:', err);
  prisma.$disconnect();
  process.exit(1);
});
