const admin = require('firebase-admin');
const path = require('path');

// Initialize Firebase Admin with service account for full Firestore access
// Priority: FIREBASE_SERVICE_ACCOUNT_PATH env var > inline credentials > project ID only
if (!admin.apps.length) {
  const serviceAccountPath = process.env.FIREBASE_SERVICE_ACCOUNT_PATH;
  const projectId = process.env.FIREBASE_PROJECT_ID || 'helpmeman-b1b7e';

  if (serviceAccountPath) {
    // Use service account key file (recommended for local development)
    const serviceAccount = require(path.resolve(serviceAccountPath));
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
      projectId,
    });
    console.log('✅ Firebase Admin initialized with service account key');
  } else if (process.env.FIREBASE_CLIENT_EMAIL && process.env.FIREBASE_PRIVATE_KEY) {
    // Use inline credentials from env vars (useful for deployment)
    admin.initializeApp({
      credential: admin.credential.cert({
        projectId,
        clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
        privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
      }),
      projectId,
    });
    console.log('✅ Firebase Admin initialized with inline credentials');
  } else {
    // Fallback: project ID only (auth token verification works, but Firestore will NOT work)
    admin.initializeApp({ projectId });
    console.warn('⚠️ Firebase Admin initialized with project ID only. Firestore writes will fail. Set FIREBASE_SERVICE_ACCOUNT_PATH or FIREBASE_CLIENT_EMAIL + FIREBASE_PRIVATE_KEY.');
  }
}

module.exports = admin;
