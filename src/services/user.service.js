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
  console.log(`[USER_SERVICE] Searching database for user by Supabase ID: ${supabaseUser.id} or email: ${email}`);
  let user;
  try {
    user = await prisma.user.findFirst({
      where: {
        OR: [
          { id: supabaseUser.id },
          { email: email }
        ]
      },
      include: mentorInclude
    });
  } catch (dbErr) {
    console.error('[USER_SERVICE] Database lookup failed:', dbErr.message);
    throw new Error(`DATABASE_ERROR during lookup: ${dbErr.message}`);
  }

  if (!user) {
    console.log(`[USER_SERVICE] User profile not found in DB. Creating new profile for email: ${email}`);
    try {
      user = await prisma.user.create({
        data: {
          id: supabaseUser.id,
          email: email,
          name: name,
          passwordHash: '', // Password hashing and validation is handled by Supabase Auth GoTrue
          avatar: avatar,
          role: 'STUDENT',
          isEmailVerified: isEmailVerified,
        },
        include: mentorInclude
      });
      console.log(`[USER_SERVICE] User profile created successfully. Local ID: ${user.id}`);
    } catch (createErr) {
      console.error('[USER_SERVICE] Database creation failed:', createErr.message);
      throw new Error(`DATABASE_ERROR during creation: ${createErr.message}`);
    }
  } else {
    console.log(`[USER_SERVICE] User profile found. Local ID: ${user.id}, Role: ${user.role}`);
    // Check if we actually need to write an update query
    const needsUpdate = 
      user.id !== supabaseUser.id ||
      user.name !== name ||
      (avatar && user.avatar !== avatar) ||
      user.isEmailVerified !== isEmailVerified;

    if (needsUpdate) {
      console.log('[USER_SERVICE] Metadata or ID mismatch detected. Updating user profile...');
      console.log(`[USER_SERVICE] Update Diff - ID: ${user.id} -> ${supabaseUser.id}, Name: ${user.name} -> ${name}, EmailVerified: ${user.isEmailVerified} -> ${isEmailVerified}`);
      
      try {
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
        console.log(`[USER_SERVICE] User profile updated successfully. New ID: ${user.id}`);
      } catch (updateErr) {
        console.error('[USER_SERVICE] Database update failed:', updateErr.message);
        throw new Error(`DATABASE_ERROR during update: ${updateErr.message}`);
      }
    } else {
      console.log('[USER_SERVICE] Database profile is up to date.');
    }
  }

  return user;
}

module.exports = { findOrCreateUser };
