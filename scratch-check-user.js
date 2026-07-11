const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const fs = require('fs');
const path = require('path');

const outputFile = path.join(__dirname, 'check-user-output.txt');
const logs = [];

function log(msg) {
  console.log(msg);
  logs.push(msg);
}

async function checkUser(email) {
  log(`=== Database Check for ${email} ===`);
  try {
    const user = await prisma.user.findUnique({
      where: { email: email.toLowerCase() },
    });
    if (!user) {
      log("❌ User not found.");
      return;
    }
    log(`User record: ${JSON.stringify({
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      onboardingRole: user.onboardingRole,
    }, null, 2)}`);

    const onboarding = await prisma.mentorOnboarding.findUnique({
      where: { userId: user.id },
    });
    log(`MentorOnboarding record: ${onboarding ? JSON.stringify({
      completed: onboarding.completed,
      currentQuestion: onboarding.currentQuestion,
      answersLength: onboarding.answers ? JSON.parse(JSON.stringify(onboarding.answers)).length : 0,
    }, null, 2) : "NOT FOUND"}`);

    const mentor = await prisma.mentor.findUnique({
      where: { userId: user.id },
    });
    log(`Mentor record: ${mentor ? JSON.stringify({
      id: mentor.id,
      displayName: mentor.displayName,
      approvalStatus: mentor.approvalStatus,
      isActive: mentor.isActive,
    }, null, 2) : "NOT FOUND"}`);

    const profile = await prisma.mentorProfile.findUnique({
      where: { mentorId: user.id },
    });
    log(`MentorProfile record: ${profile ? JSON.stringify({
      id: profile.id,
      onboardingStatus: profile.onboardingStatus,
    }, null, 2) : "NOT FOUND"}`);

  } catch (error) {
    log(`Check failed: ${error.message}`);
  } finally {
    fs.writeFileSync(outputFile, logs.join('\n'), 'utf8');
    await prisma.$disconnect();
  }
}

checkUser('official.diljha@gmail.com');
