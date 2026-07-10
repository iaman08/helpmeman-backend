const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  console.log('Connecting to database...');
  try {
    const count = await prisma.mentor.count();
    console.log('Successfully connected! Mentor count:', count);
  } catch (err) {
    console.error('Database connection failed:', err);
  } finally {
    await prisma.$disconnect();
  }
}

main();
