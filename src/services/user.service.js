const prisma = require('../config/prisma');

/**
 * Finds a user by their Supabase ID or email, and updates or creates their database profile.
 * Maintains database consistency between Supabase Auth and the application schema.
 *
 * @param {object} supabaseUser - The user object returned from Supabase Auth
 * @returns {Promise<object>} The synced application user record
 */
async function findOrCreateUser(supabaseUser) {
  if (!supabaseUser) {
    throw new Error('Supabase user object is required');
  }

  const email = supabaseUser.email?.toLowerCase();
  if (!email) {
    throw new Error('Email is required from Supabase Auth profile');
  }

  const name = supabaseUser.user_metadata?.full_name || supabaseUser.user_metadata?.name || email.split('@')[0] || 'User';
  const avatar = supabaseUser.user_metadata?.avatar_url || supabaseUser.user_metadata?.picture || null;
  const isEmailVerified = !!supabaseUser.email_confirmed_at;

  const mentorInclude = {
    mentor: {
      select: { id: true, approvalStatus: true, isActive: true }
    }
  };

  // Search by either Supabase UUID or Email to link potential pre-existing accounts
  let user = await prisma.user.findFirst({
    where: {
      OR: [
        { id: supabaseUser.id },
        { email: email }
      ]
    },
    include: mentorInclude
  });

  if (!user) {
    // Create new application profile
    user = await prisma.user.create({
      data: {
        id: supabaseUser.id,
        email: email,
        name: name,
        passwordHash: '', // Password hashing and validation is handled by Supabase Auth GoTrue
        avatar: avatar,
        role: 'USER',
        isEmailVerified: isEmailVerified,
      },
      include: mentorInclude
    });
  } else {
    // Check if we actually need to write an update query
    const needsUpdate = 
      user.id !== supabaseUser.id ||
      user.name !== name ||
      (avatar && user.avatar !== avatar) ||
      user.isEmailVerified !== isEmailVerified;

    if (needsUpdate) {
      // Update existing profile with latest metadata
      user = await prisma.user.update({
        where: { id: user.id },
        data: {
          id: supabaseUser.id, // Migrate existing cuid users to Supabase UUID
          name: name,
          avatar: avatar || user.avatar,
          isEmailVerified: isEmailVerified,
        },
        include: mentorInclude
      });
    }
  }

  return user;
}

module.exports = { findOrCreateUser };
