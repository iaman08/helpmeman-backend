const { PrismaClient } = require('./node_modules/@prisma/client');
const prisma = new PrismaClient();
async function main() {
  const logs = await prisma.emailDeliveryLog.findMany({
    orderBy: { createdAt: 'desc' },
    take: 20
  });
  console.log(JSON.stringify(logs, null, 2));
  
  const failedCount = await prisma.emailDeliveryLog.count({
    where: { status: 'failed' }
  });
  console.log("Total failed count:", failedCount);
}
main().catch(console.error).finally(() => prisma.$disconnect());
