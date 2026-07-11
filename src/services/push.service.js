/**
 * push.service.js
 *
 * Web Push notifications using the VAPID standard (RFC 8030).
 * Replaces Firebase Cloud Messaging (FCM) entirely.
 * No Firebase dependency. Works with all modern browsers.
 *
 * Setup:
 *   1. Generate VAPID keys once:
 *      npx web-push generate-vapid-keys
 *   2. Add to backend .env:
 *      VAPID_PUBLIC_KEY=<public key>
 *      VAPID_PRIVATE_KEY=<private key>
 *      VAPID_SUBJECT=mailto:noreply@helpmeman.com
 *   3. Add to frontend .env:
 *      NEXT_PUBLIC_VAPID_PUBLIC_KEY=<same public key>
 */
const prisma = require('../config/prisma');

let webpush;
try {
  webpush = require('web-push');
} catch {
  console.warn('[WebPush] web-push package not installed. Push notifications will be skipped.');
  webpush = null;
}

// Configure VAPID details
function configureVapid() {
  if (!webpush) return false;
  const publicKey = process.env.VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  const subject = process.env.VAPID_SUBJECT || 'mailto:noreply@helpmeman.com';

  if (!publicKey || !privateKey) {
    console.warn('[WebPush] VAPID keys not configured. Push notifications disabled.');
    console.warn('[WebPush] Run: npx web-push generate-vapid-keys');
    return false;
  }

  webpush.setVapidDetails(subject, publicKey, privateKey);
  return true;
}

const vapidConfigured = configureVapid();

/**
 * Parse a stored subscription token.
 * Supports both:
 *   - JSON Web Push subscription objects (new)
 *   - Legacy FCM tokens (strings) — silently skipped
 */
function parseSubscription(tokenValue) {
  if (!tokenValue) return null;
  try {
    const parsed = JSON.parse(tokenValue);
    if (parsed && parsed.endpoint && parsed.keys) {
      return parsed; // Valid Web Push subscription
    }
  } catch {
    // Legacy FCM token string — not a JSON Web Push subscription
    // These are gracefully skipped; the device registration endpoint
    // now stores Web Push JSON instead.
  }
  return null;
}

/**
 * Send a push notification to an array of stored subscription tokens.
 * Returns { sent, failed, invalidTokens }
 */
async function sendPushToTokens(tokens, { title, body, data = {} }) {
  if (!tokens.length) return { sent: 0, failed: 0, invalidTokens: [] };
  if (!webpush || !vapidConfigured) {
    console.warn('[WebPush] Push skipped — web-push not configured');
    return { sent: 0, failed: tokens.length, invalidTokens: [] };
  }

  const payload = JSON.stringify({ title, body, data });
  const invalidTokens = [];
  let sent = 0;
  let failed = 0;

  for (const token of tokens) {
    const subscription = parseSubscription(token);
    if (!subscription) {
      // Legacy FCM token — skip gracefully
      failed++;
      continue;
    }

    try {
      await webpush.sendNotification(subscription, payload);
      sent++;
    } catch (err) {
      failed++;
      // 410 Gone = subscription expired/unsubscribed → clean up
      // 404 Not Found = endpoint gone
      if (err.statusCode === 410 || err.statusCode === 404) {
        invalidTokens.push(token);
      } else {
        console.error('[WebPush] Push error:', err.message);
      }
    }
  }

  // Clean up invalid subscriptions
  if (invalidTokens.length) {
    await prisma.userDevice.deleteMany({
      where: { fcmToken: { in: invalidTokens } },
    }).catch(() => {});
  }

  return { sent, failed, invalidTokens };
}

/**
 * Send a push notification to all devices of a user.
 */
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
