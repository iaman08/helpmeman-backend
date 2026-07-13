const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  console.log('Querying database for active mentors...\n');
  try {
    const mentors = await prisma.mentor.findMany({
      include: {
        user: true,
      },
    });

    console.log(`Found ${mentors.length} mentors in the database:`);
    mentors.forEach((m, idx) => {
      console.log(`[${idx + 1}] ${m.displayName}`);
      console.log(`    - Email: ${m.user.email}`);
      console.log(`    - Current Role: ${m.currentRole} at ${m.company}`);
      console.log(`    - Rating: ${m.rating} (${m.totalSessions} sessions)`);
      console.log(`    - Expertise: ${m.expertise.join(', ')}`);
      console.log(`    - Location: ${m.location}`);
      console.log(`    - Avatar: ${m.avatar || 'None'}`);
      console.log(`-----------------------------------------------`);
    });

  } catch (error) {
    console.error('❌ Error querying mentors:', error);
  } finally {
    await prisma.$disconnect();
  }
}

main();
