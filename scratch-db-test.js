const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  console.log("Testing connection to database...");
  try {
    const userCount = await prisma.user.count();
    console.log("Success! Connected to database. Total users:", userCount);
  } catch (error) {
    console.error("Connection failed:", error);
  } finally {
    await prisma.$disconnect();
  }
}

main();
