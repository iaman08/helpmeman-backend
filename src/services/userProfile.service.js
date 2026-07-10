/**
 * userProfile.service.js
 *
 * Replaces firestore.service.js — all data now lives in PostgreSQL via Prisma.
 * Drop-in compatible: same function signatures as the old Firestore service.
 */
const prisma = require('../config/prisma');

/**
 * Save/update user profile fields (username, currentRole, etc.) in Postgres.
 * Equivalent of old saveUserToFirestore().
 */
async function saveUserProfile(userId, data = {}) {
  const allowedFields = ['name', 'email', 'phone', 'avatar', 'username', 'currentRole'];
  const updateData = {};

  for (const field of allowedFields) {
    if (data[field] !== undefined) {
      updateData[field] = data[field];
    }
  }

  if (Object.keys(updateData).length === 0) return null;

  return prisma.user.update({
    where: { id: userId },
    data: updateData,
    select: { id: true, name: true, email: true, phone: true, avatar: true, role: true, username: true, currentRole: true, onboardingRole: true },
  });
}

/**
 * Get enriched user profile from Postgres.
 * Equivalent of old getUserFromFirestore().
 */
async function getUserProfile(userId) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      name: true,
      email: true,
      phone: true,
      avatar: true,
      role: true,
      username: true,
      currentRole: true,
      onboardingRole: true,
      isEmailVerified: true,
      createdAt: true,
    },
  });
  return user;
}

/**
 * Check if a username is available in Postgres.
 * Returns true if available, false if taken.
 */
async function isUsernameAvailable(username) {
  if (!username) return false;
  const normalized = username.toLowerCase().trim();
  const existing = await prisma.user.findUnique({
    where: { username: normalized },
    select: { id: true },
  });
  return !existing;
}

/**
 * Set a username for a user. Validates and checks uniqueness.
 * Returns { success: true } or { success: false, error: string }
 */
async function setUsername(userId, username) {
  if (!username || username.trim().length < 3) {
    return { success: false, error: 'Username must be at least 3 characters' };
  }
  if (!/^[a-zA-Z0-9_]+$/.test(username)) {
    return { success: false, error: 'Username can only contain letters, numbers, and underscores' };
  }

  const normalized = username.toLowerCase().trim();

  // Check if taken by another user
  const existing = await prisma.user.findUnique({
    where: { username: normalized },
    select: { id: true },
  });

  if (existing && existing.id !== userId) {
    return { success: false, error: 'Username is already taken' };
  }

  await prisma.user.update({
    where: { id: userId },
    data: { username: normalized },
  });

  return { success: true };
}

module.exports = {
  saveUserProfile,
  getUserProfile,
  isUsernameAvailable,
  setUsername,
};
