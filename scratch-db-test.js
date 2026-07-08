const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');
const prisma = new PrismaClient();

async function testUser(email) {
  console.log(`\nChecking user: ${email}...`);
  try {
    const user = await prisma.user.findUnique({
      where: { email: email.toLowerCase() },
    });

    if (!user) {
      console.log(`❌ User ${email} not found in database.`);
      return;
    }

    console.log(`✅ User found:`);
    console.log(`  - ID: ${user.id}`);
    console.log(`  - Name: ${user.name}`);
    console.log(`  - Role: ${user.role}`);
    console.log(`  - Email Verified: ${user.isEmailVerified}`);
    console.log(`  - Has Password Hash: ${!!user.passwordHash}`);

    if (user.passwordHash) {
      console.log(`  - Hash value: ${user.passwordHash}`);
      // Verify bcrypt hash validity
      const isValid = await bcrypt.compare('password123', user.passwordHash);
      console.log(`  - Bcrypt compare with 'password123': ${isValid ? 'VALID ✅' : 'INVALID ❌'}`);
    } else {
      console.log(`  - ⚠️ Password hash is missing!`);
    }
  } catch (error) {
    console.error(`❌ Error checking user ${email}:`, error);
  }
}

async function main() {
  const dbUrl = process.env.DATABASE_URL || 'Not specified';
  // Mask connection string password/user for logs
  const maskedDbUrl = dbUrl.replace(/:([^:@]+)@/, ':****@');
  console.log(`Testing connection to DATABASE_URL: ${maskedDbUrl}`);

  try {
    const userCount = await prisma.user.count();
    console.log("✅ Success! Connected to database. Total users:", userCount);

    const categoryCount = await prisma.category.count();
    console.log("✅ Total categories:", categoryCount);

    // Verify database contains the target users
    await testUser('admin@helpmeman.com');
    await testUser('mentor@helpmeman.com');
    await testUser('student@helpmeman.com');

  } catch (error) {
    console.error("❌ Connection failed:", error);
  } finally {
    await prisma.$disconnect();
  }
}

main();
