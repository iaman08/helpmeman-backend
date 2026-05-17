const admin = require('firebase-admin');

// Initialize Firebase Admin with project ID from environment
// No service account key needed — we only use verifyIdToken which works with just the project ID
if (!admin.apps.length) {
  admin.initializeApp({
    projectId: process.env.FIREBASE_PROJECT_ID || 'helpmeman-1',
  });
}

module.exports = admin;
