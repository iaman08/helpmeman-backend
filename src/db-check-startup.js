const prisma = require('./config/prisma');
const bcrypt = require('bcryptjs');
const fs = require('fs');
const path = require('path');

async function testUser(email, results) {
  results.push(`\nChecking user: ${email}...`);
  try {
    let user = await prisma.user.findUnique({
      where: { email: email.toLowerCase() },
    });

    if (!user) {
      results.push(`❌ User ${email} not found in database.`);
      return;
    }

    // Auto-fix if passwordHash is the mock placeholder 'hashed_demo_password'
    if (email.toLowerCase() === 'mentor@helpmeman.com' && user.passwordHash === 'hashed_demo_password') {
      results.push(`⚠️ Detected invalid password hash 'hashed_demo_password' for mentor. Running auto-fix...`);
      const correctHash = await bcrypt.hash('password123', 12);
      user = await prisma.user.update({
        where: { email: 'mentor@helpmeman.com' },
        data: { passwordHash: correctHash },
      });
      results.push(`✅ Auto-fix complete! Password hash updated.`);
    }

    results.push(`✅ User found:`);
    results.push(`  - ID: ${user.id}`);
    results.push(`  - Name: ${user.name}`);
    results.push(`  - Role: ${user.role}`);
    results.push(`  - Email Verified: ${user.isEmailVerified}`);
    results.push(`  - Has Password Hash: ${!!user.passwordHash}`);

    if (user.passwordHash) {
      results.push(`  - Hash value: ${user.passwordHash}`);
      const isValid = await bcrypt.compare('password123', user.passwordHash);
      results.push(`  - Bcrypt compare with 'password123': ${isValid ? 'VALID ✅' : 'INVALID ❌'}`);
    } else {
      results.push(`  - ⚠️ Password hash is missing!`);
    }
  } catch (error) {
    results.push(`❌ Error checking/fixing user ${email}: ${error.message}`);
  }
}

async function runCheck() {
  const results = [];
  const dbUrl = process.env.DATABASE_URL || 'Not specified';
  const maskedDbUrl = dbUrl.replace(/:([^:@]+)@/, ':****@');
  results.push(`Testing connection to DATABASE_URL: ${maskedDbUrl}`);

  try {
    const userCount = await prisma.user.count();
    results.push(`✅ Success! Connected to database. Total users: ${userCount}`);

    const categoryCount = await prisma.category.count();
    results.push(`✅ Total categories: ${categoryCount}`);

    await testUser('admin@helpmeman.com', results);
    await testUser('mentor@helpmeman.com', results);
    await testUser('student@helpmeman.com', results);

  } catch (error) {
    results.push(`❌ Connection failed: ${error.message}`);
  }

  // Write to a local file in backend directory
  const outputPath = path.join(__dirname, '..', 'db-test-output.txt');
  fs.writeFileSync(outputPath, results.join('\n'), 'utf8');
  console.log(`[DB Check] Results written to ${outputPath}`);
}

// Run check asynchronously
runCheck().catch(err => console.error('DB check failed:', err));
