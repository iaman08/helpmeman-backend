const firebaseAdmin = require('../config/firebase');

const db = firebaseAdmin.firestore();

/**
 * Save or update a user document in Firestore.
 * Collection: "users", Document ID = Prisma user.id
 */
async function saveUserToFirestore(user, extraData = {}) {
  const docRef = db.collection('users').doc(user.id);
  const data = {
    updatedAt: new Date().toISOString(),
  };

  if (user.name !== undefined && user.name !== null) data.name = user.name;
  if (user.email !== undefined && user.email !== null) data.email = user.email;
  if (user.phone !== undefined) data.phone = user.phone;
  if (user.avatar !== undefined) data.avatar = user.avatar;
  if (user.role !== undefined && user.role !== null) data.role = user.role;
  if (user.isEmailVerified !== undefined && user.isEmailVerified !== null) data.isEmailVerified = user.isEmailVerified;
  if (user.username !== undefined) data.username = user.username;
  if (user.createdAt !== undefined && user.createdAt !== null) data.createdAt = user.createdAt;

  // Merge extra data (like currentRole)
  Object.keys(extraData).forEach((key) => {
    if (extraData[key] !== undefined) {
      data[key] = extraData[key];
    }
  });

  await docRef.set(data, { merge: true });
  return data;
}

/**
 * Save or update a mentor document in Firestore.
 * Collection: "mentors", Document ID = Prisma mentor.id
 */
async function saveMentorToFirestore(mentor) {
  const docRef = db.collection('mentors').doc(mentor.id);
  const data = {
    userId: mentor.userId,
    displayName: mentor.displayName || '',
    bio: mentor.bio || '',
    avatar: mentor.avatar || null,
    institutionType: mentor.institutionType || '',
    institutionName: mentor.institutionName || '',
    institutionEmail: mentor.institutionEmail || '',
    department: mentor.department || null,
    graduationYear: mentor.graduationYear || null,
    currentRole: mentor.currentRole || null,
    company: mentor.company || null,
    linkedinUrl: mentor.linkedinUrl || null,
    expertise: mentor.expertise || [],
    categoryId: mentor.categoryId || '',
    approvalStatus: mentor.approvalStatus || 'PENDING',
    isActive: mentor.isActive ?? false,
    pricePerSession: mentor.pricePerSession || 0,
    sessionDuration: mentor.sessionDuration || 30,
    totalSessions: mentor.totalSessions || 0,
    rating: mentor.rating || 0,
    createdAt: mentor.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  await docRef.set(data, { merge: true });
  return data;
}

/**
 * Get a user document from Firestore by user ID.
 */
async function getUserFromFirestore(userId) {
  const doc = await db.collection('users').doc(userId).get();
  if (!doc.exists) return null;
  return { id: doc.id, ...doc.data() };
}

/**
 * Get a mentor document from Firestore by mentor ID.
 */
async function getMentorFromFirestore(mentorId) {
  const doc = await db.collection('mentors').doc(mentorId).get();
  if (!doc.exists) return null;
  return { id: doc.id, ...doc.data() };
}

/**
 * Check if a username is already taken in Firestore.
 * Returns true if the username is available, false if taken.
 */
async function isUsernameAvailable(username) {
  if (!username) return false;
  const snapshot = await db
    .collection('users')
    .where('username', '==', username.toLowerCase())
    .limit(1)
    .get();
  return snapshot.empty;
}

/**
 * Set a username for a user. Checks uniqueness first.
 * Returns { success: true } or { success: false, error: string }
 */
async function setUsername(userId, username) {
  if (!username || username.length < 3) {
    return { success: false, error: 'Username must be at least 3 characters' };
  }
  if (!/^[a-zA-Z0-9_]+$/.test(username)) {
    return { success: false, error: 'Username can only contain letters, numbers, and underscores' };
  }

  const normalizedUsername = username.toLowerCase();

  // Check if username is taken by another user
  const snapshot = await db
    .collection('users')
    .where('username', '==', normalizedUsername)
    .limit(1)
    .get();

  if (!snapshot.empty) {
    const existingDoc = snapshot.docs[0];
    if (existingDoc.id !== userId) {
      return { success: false, error: 'Username is already taken' };
    }
  }

  await db.collection('users').doc(userId).set(
    { username: normalizedUsername, updatedAt: new Date().toISOString() },
    { merge: true }
  );

  return { success: true };
}

module.exports = {
  saveUserToFirestore,
  saveMentorToFirestore,
  getUserFromFirestore,
  getMentorFromFirestore,
  isUsernameAvailable,
  setUsername,
};
