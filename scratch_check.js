const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  try {
    const reactions = await prisma.messageReaction.findMany();
    console.log('Total reactions:', reactions.length);
    console.log(JSON.stringify(reactions, null, 2));
  } catch (e) {
    console.error('Error:', e);
  } finally {
    await prisma.$disconnect();
  }
}

main();
