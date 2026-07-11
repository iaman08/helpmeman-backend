const prisma = require('./src/config/prisma');
const { startOrGetThread } = require('./src/services/chat.service');

async function test() {
  try {
    console.log("Searching user...");
    const user = await prisma.user.findFirst({
      where: { role: 'USER' }
    });
    console.log("Found User:", user ? user.email : "none");

    console.log("Searching mentor...");
    const mentor = await prisma.mentor.findFirst({
      where: { isActive: true }
    });
    console.log("Found Mentor:", mentor ? mentor.displayName : "none");

    if (user && mentor) {
      console.log(`Starting/getting thread between User: ${user.id} and Mentor: ${mentor.id}`);
      const thread = await startOrGetThread(user.id, mentor.id);
      console.log("SUCCESS! Thread:", thread);
    } else {
      console.log("Cannot run test, user or mentor missing");
    }
  } catch (error) {
    console.error("ERROR DETECTED:", error);
  } finally {
    await prisma.$disconnect();
  }
}

test();
