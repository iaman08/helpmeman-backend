/**
 * ⛔ FIREBASE HAS BEEN REMOVED FROM HELPMEMAN
 *
 * This file is intentionally empty. Firebase Admin is no longer used.
 *
 * Replacements:
 *   - Google OAuth token verification: Google's tokeninfo API (in auth.controller.js)
 *   - Firestore: PostgreSQL via Prisma (userProfile.service.js)
 *   - FCM Push Notifications: Web Push API (push.service.js)
 *
 * If you see an import of this file, it is a bug. Remove the import.
 */

throw new Error(
  '[firebase.js] Firebase has been removed from HelpMeMan. ' +
  'See src/services/userProfile.service.js and src/services/push.service.js for replacements.'
);
