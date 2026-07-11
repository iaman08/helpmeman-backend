/**
 * One-time migration script: Firestore username/currentRole → Postgres
 *
 * Run ONCE before removing Firebase code:
 *   node src/scripts/migrate-firestore-to-postgres.js
 *
 * Safe to run multiple times (idempotent).
 */
require('dotenv').config();

const admin = require('firebase-admin');
const path = require('path');
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

// Initialize Firebase Admin
if (!admin.apps.length) {
  const serviceAccountPath = process.env.FIREBASE_SERVICE_ACCOUNT_PATH;
  const projectId = process.env.FIREBASE_PROJECT_ID || 'helpmeman-b1b7e';

  if (serviceAccountPath) {
    const serviceAccount = require(path.resolve(serviceAccountPath));
    admin.initializeApp({ credential: admin.credential.cert(serviceAccount), projectId });
  } else if (process.env.FIREBASE_CLIENT_EMAIL && process.env.FIREBASE_PRIVATE_KEY) {
    admin.initializeApp({
      credential: admin.credential.cert({
        projectId,
        clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
        privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
      }),
      projectId,
    });
  } else {
    console.error('❌ No Firebase credentials found. Cannot migrate from Firestore.');
    process.exit(1);
  }
}

const db = admin.firestore();

async function migrate() {
  console.log('🚀 Starting Firestore → Postgres data migration...\n');

  let migrated = 0;
  let skipped = 0;
  let errors = 0;

  try {
    const snapshot = await db.collection('users').get();
    console.log(`📊 Found ${snapshot.size} user documents in Firestore\n`);

    for (const doc of snapshot.docs) {
      const data = doc.data();
      const firestoreId = doc.id;

      // Only migrate username and currentRole — these are the only fields
      // that Firestore has which Postgres doesn't have yet
      const hasUsername = data.username && data.username.trim().length >= 3;
      const hasCurrentRole = data.currentRole && data.currentRole.trim().length > 0;

      if (!hasUsername && !hasCurrentRole) {
        skipped++;
        continue;
      }

      try {
        // Find the user in Postgres by the Firestore document ID (which equals prisma user.id)
        const existingUser = await prisma.user.findUnique({
          where: { id: firestoreId },
          select: { id: true, username: true, currentRole: true },
        });

        if (!existingUser) {
          console.warn(`  ⚠️  User ${firestoreId} not found in Postgres — skipping`);
          skipped++;
          continue;
        }

        const updateData = {};

        if (hasUsername && !existingUser.username) {
          // Check uniqueness before setting
          const taken = await prisma.user.findUnique({
            where: { username: data.username.toLowerCase() },
            select: { id: true },
          });
          if (!taken || taken.id === firestoreId) {
            updateData.username = data.username.toLowerCase();
          } else {
            console.warn(`  ⚠️  Username "${data.username}" already taken in Postgres — skipping for user ${firestoreId}`);
          }
        }

        if (hasCurrentRole && !existingUser.currentRole) {
          updateData.currentRole = data.currentRole;
        }

        if (Object.keys(updateData).length > 0) {
          await prisma.user.update({ where: { id: firestoreId }, data: updateData });
          console.log(`  ✅ Migrated user ${firestoreId}: ${JSON.stringify(updateData)}`);
          migrated++;
        } else {
          skipped++;
        }
      } catch (err) {
        console.error(`  ❌ Error migrating user ${firestoreId}:`, err.message);
        errors++;
      }
    }
  } catch (err) {
    console.error('❌ Failed to read Firestore:', err.message);
    process.exit(1);
  }

  console.log('\n─────────────────────────────────────────');
  console.log('📋 Migration Report:');
  console.log(`   ✅ Migrated: ${migrated}`);
  console.log(`   ⏭  Skipped:  ${skipped}`);
  console.log(`   ❌ Errors:   ${errors}`);
  console.log('─────────────────────────────────────────\n');

  if (errors > 0) {
    console.warn('⚠️  Migration completed with errors. Review logs above.');
  } else {
    console.log('✅ Migration completed successfully!');
    console.log('   You can now safely remove Firebase/Firestore code.\n');
  }

  await prisma.$disconnect();
  process.exit(errors > 0 ? 1 : 0);
}

migrate();
