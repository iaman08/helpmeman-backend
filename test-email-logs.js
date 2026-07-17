const prisma = require('./src/config/prisma');

async function main() {
  const logs = await prisma.emailDeliveryLog.findMany({
    orderBy: { createdAt: 'desc' },
    take: 30,
  });
  console.log('\n--- 📊 EMAIL LOGS ---');
  logs.forEach(log => {
    console.log(`[${log.createdAt.toISOString()}] ID: ${log.id} | To: ${log.toEmail} | Subject: "${log.subject}" | Status: ${log.status} | Template: ${log.templateType} | Retries: ${log.retryCount} | Error: ${log.errorMessage ? log.errorMessage.substring(0, 120) : 'None'}`);
  });
  console.log('---------------------\n');
}

main().catch(err => console.error(err)).finally(() => prisma.$disconnect());
