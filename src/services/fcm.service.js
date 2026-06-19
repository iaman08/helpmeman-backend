const admin = require('../config/firebase');
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

async function sendPushToTokens(tokens, { title, body, data = {} }) {
  if (!tokens.length) return { sent: 0, failed: 0, invalidTokens: [] };

  const invalidTokens = [];
  let sent = 0;
  let failed = 0;

  const stringData = Object.fromEntries(
    Object.entries(data).map(([key, value]) => [key, String(value ?? '')])
  );

  try {
    const response = await admin.messaging().sendEachForMulticast({
      tokens,
      notification: { title, body },
      data: stringData,
      webpush: {
        fcmOptions: { link: data.link || 'https://helpmeman.com/dashboard/notifications' },
      },
    });

    response.responses.forEach((result, index) => {
      if (result.success) {
        sent += 1;
      } else {
        failed += 1;
        const code = result.error?.code;
        if (
          code === 'messaging/invalid-registration-token' ||
          code === 'messaging/registration-token-not-registered'
        ) {
          invalidTokens.push(tokens[index]);
        }
      }
    });
  } catch (error) {
    console.error('FCM multicast error:', error.message);
    failed = tokens.length;
  }

  if (invalidTokens.length) {
    await prisma.userDevice.deleteMany({ where: { fcmToken: { in: invalidTokens } } }).catch(() => {});
  }

  return { sent, failed, invalidTokens };
}

async function sendPushToUser(userId, payload) {
  const devices = await prisma.userDevice.findMany({
    where: { userId },
    select: { fcmToken: true },
  });
  return sendPushToTokens(
    devices.map((device) => device.fcmToken),
    payload
  );
}

module.exports = { sendPushToTokens, sendPushToUser };
