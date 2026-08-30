const prisma = require('../config/prisma');
const { uploadImage, deleteFile } = require('../services/upload.service');

function sanitizeTeamMember(member) {
  if (!member) return null;
  const { phone, email, showEmail, ...rest } = member;
  return {
    ...rest,
    showEmail,
    email: showEmail ? email : null,
  };
}

// Get all team members (with filters and search)
async function getTeam(req, res) {
  try {
    const { department, roleType, search, active, page = 1, limit = 100 } = req.query;

    const where = {};

    // By default, public only sees active members
    if (active === 'false') {
      where.isActive = false;
    } else if (active === 'all') {
      // Don't filter by isActive
    } else {
      where.isActive = true;
    }

    if (department) {
      where.department = department;
    }

    if (roleType === 'founder') {
      where.isFounder = true;
    } else if (roleType === 'leadership') {
      where.isLeadership = true;
    }

    if (search) {
      where.OR = [
        { fullName: { contains: search, mode: 'insensitive' } },
        { role: { contains: search, mode: 'insensitive' } },
        { location: { contains: search, mode: 'insensitive' } },
        { skills: { hasSome: [search] } },
      ];
    }

    const parsedPage = parseInt(page);
    const parsedLimit = parseInt(limit);
    const skip = (parsedPage - 1) * parsedLimit;

    const [membersList, total] = await Promise.all([
      prisma.teamMember.findMany({
        where,
        orderBy: { displayOrder: 'asc' },
        skip,
        take: parsedLimit,
      }),
      prisma.teamMember.count({ where }),
    ]);

    const members = membersList.map(sanitizeTeamMember);

    res.json({
      members,
      total,
      page: parsedPage,
      totalPages: Math.ceil(total / parsedLimit),
    });
  } catch (error) {
    console.error('[TEAM CONTROLLER] getTeam error:', error);
    res.status(500).json({ error: 'Failed to retrieve team members' });
  }
}

// Get single member details by username
async function getTeamMemberByUsername(req, res) {
  try {
    const { username } = req.params;
    const rawMember = await prisma.teamMember.findUnique({
      where: { username: username.toLowerCase().trim() },
    });

    if (!rawMember) {
      return res.status(404).json({ error: 'Team member not found' });
    }

    const member = sanitizeTeamMember(rawMember);

    res.json({ member });
  } catch (error) {
    console.error('[TEAM CONTROLLER] getTeamMemberByUsername error:', error);
    res.status(500).json({ error: 'Failed to retrieve team member profile' });
  }
}

// Helper to clean array inputs from client-side JSON/form-data
function parseArrayField(field) {
  if (!field) return [];
  if (Array.isArray(field)) return field;
  try {
    const parsed = JSON.parse(field);
    return Array.isArray(parsed) ? parsed : [field];
  } catch {
    return field.split(',').map(s => s.trim()).filter(Boolean);
  }
}

// Create new team member
async function createTeamMember(req, res) {
  try {
    const {
      fullName,
      username,
      role,
      department,
      bio,
      story,
      education,
      experience,
      achievements,
      projects,
      skills,
      interests,
      languages,
      location,
      country,
      email,
      phone,
      linkedin,
      github,
      twitter,
      website,
      instagram,
      facebook,
      status,
      isFounder,
      isLeadership,
      isVerified,
      isActive,
      isFeatured,
      availableForMentorship,
      allowContact,
      showEmail,
      showSocialLinks,
      displayOrder,
      joinedAt,
      leftAt,
    } = req.body;

    if (!fullName || !username || !role || !department || !bio) {
      return res.status(400).json({ error: 'Required fields missing' });
    }

    // Check if username is taken
    const existing = await prisma.teamMember.findUnique({
      where: { username: username.toLowerCase().trim() },
    });
    if (existing) {
      return res.status(400).json({ error: 'Username is already taken' });
    }

    // Upload files if present
    let imageUrl = null;
    let coverUrl = null;

    if (req.files) {
      if (req.files.image && req.files.image[0]) {
        imageUrl = await uploadImage(req.files.image[0], 'team');
      }
      if (req.files.cover && req.files.cover[0]) {
        coverUrl = await uploadImage(req.files.cover[0], 'team_covers');
      }
    }

    const member = await prisma.teamMember.create({
      data: {
        fullName,
        username: username.toLowerCase().trim(),
        role,
        department,
        bio,
        story: story || null,
        education: education || null,
        experience: experience || null,
        achievements: achievements || null,
        projects: projects || null,
        skills: parseArrayField(skills),
        interests: parseArrayField(interests),
        languages: parseArrayField(languages),
        location: location || null,
        country: country || null,
        email: email || null,
        phone: phone || null,
        linkedin: linkedin || null,
        github: github || null,
        twitter: twitter || null,
        website: website || null,
        instagram: instagram || null,
        facebook: facebook || null,
        imageUrl,
        coverUrl,
        status: status || 'ONLINE',
        isFounder: isFounder === 'true' || isFounder === true,
        isLeadership: isLeadership === 'true' || isLeadership === true,
        isVerified: isVerified === 'true' || isVerified === true,
        isActive: isActive === undefined ? true : (isActive === 'true' || isActive === true),
        isFeatured: isFeatured === 'true' || isFeatured === true,
        availableForMentorship: availableForMentorship === 'true' || availableForMentorship === true,
        allowContact: allowContact === undefined ? true : (allowContact === 'true' || allowContact === true),
        showEmail: showEmail === 'true' || showEmail === true,
        showSocialLinks: showSocialLinks === undefined ? true : (showSocialLinks === 'true' || showSocialLinks === true),
        displayOrder: displayOrder ? parseInt(displayOrder) : 0,
        joinedAt: joinedAt ? new Date(joinedAt) : new Date(),
        leftAt: leftAt ? new Date(leftAt) : null,
      },
    });

    res.status(201).json({ member });
  } catch (error) {
    console.error('[TEAM CONTROLLER] createTeamMember error:', error);
    res.status(500).json({ error: error.message || 'Failed to create team member' });
  }
}

// Update team member
async function updateTeamMember(req, res) {
  try {
    const { id } = req.params;
    const {
      fullName,
      username,
      role,
      department,
      bio,
      story,
      education,
      experience,
      achievements,
      projects,
      skills,
      interests,
      languages,
      location,
      country,
      email,
      phone,
      linkedin,
      github,
      twitter,
      website,
      instagram,
      facebook,
      status,
      isFounder,
      isLeadership,
      isVerified,
      isActive,
      isFeatured,
      availableForMentorship,
      allowContact,
      showEmail,
      showSocialLinks,
      displayOrder,
      joinedAt,
      leftAt,
    } = req.body;

    const existing = await prisma.teamMember.findUnique({ where: { id } });
    if (!existing) {
      return res.status(404).json({ error: 'Team member not found' });
    }

    // Check if new username is taken
    if (username && username.toLowerCase().trim() !== existing.username) {
      const uTaken = await prisma.teamMember.findUnique({
        where: { username: username.toLowerCase().trim() },
      });
      if (uTaken) {
        return res.status(400).json({ error: 'Username is already taken' });
      }
    }

    const data = {
      fullName: fullName || existing.fullName,
      role: role || existing.role,
      department: department || existing.department,
      bio: bio || existing.bio,
      story: story !== undefined ? story : existing.story,
      education: education !== undefined ? education : existing.education,
      experience: experience !== undefined ? experience : existing.experience,
      achievements: achievements !== undefined ? achievements : existing.achievements,
      projects: projects !== undefined ? projects : existing.projects,
      location: location !== undefined ? location : existing.location,
      country: country !== undefined ? country : existing.country,
      email: email !== undefined ? email : existing.email,
      phone: phone !== undefined ? phone : existing.phone,
      linkedin: linkedin !== undefined ? linkedin : existing.linkedin,
      github: github !== undefined ? github : existing.github,
      twitter: twitter !== undefined ? twitter : existing.twitter,
      website: website !== undefined ? website : existing.website,
      instagram: instagram !== undefined ? instagram : existing.instagram,
      facebook: facebook !== undefined ? facebook : existing.facebook,
      status: status || existing.status,
    };

    if (username) {
      data.username = username.toLowerCase().trim();
    }

    if (skills !== undefined) data.skills = parseArrayField(skills);
    if (interests !== undefined) data.interests = parseArrayField(interests);
    if (languages !== undefined) data.languages = parseArrayField(languages);

    if (isFounder !== undefined) data.isFounder = isFounder === 'true' || isFounder === true;
    if (isLeadership !== undefined) data.isLeadership = isLeadership === 'true' || isLeadership === true;
    if (isVerified !== undefined) data.isVerified = isVerified === 'true' || isVerified === true;
    if (isActive !== undefined) data.isActive = isActive === 'true' || isActive === true;
    if (isFeatured !== undefined) data.isFeatured = isFeatured === 'true' || isFeatured === true;
    if (availableForMentorship !== undefined) data.availableForMentorship = availableForMentorship === 'true' || availableForMentorship === true;
    if (allowContact !== undefined) data.allowContact = allowContact === 'true' || allowContact === true;
    if (showEmail !== undefined) data.showEmail = showEmail === 'true' || showEmail === true;
    if (showSocialLinks !== undefined) data.showSocialLinks = showSocialLinks === 'true' || showSocialLinks === true;
    if (displayOrder !== undefined) data.displayOrder = parseInt(displayOrder);
    if (joinedAt !== undefined) data.joinedAt = joinedAt ? new Date(joinedAt) : existing.joinedAt;
    if (leftAt !== undefined) data.leftAt = leftAt ? new Date(leftAt) : null;

    // Handle file uploads
    if (req.files) {
      if (req.files.image && req.files.image[0]) {
        // Delete old image if present
        if (existing.imageUrl) {
          await deleteFile(existing.imageUrl);
        }
        data.imageUrl = await uploadImage(req.files.image[0], 'team');
      }
      if (req.files.cover && req.files.cover[0]) {
        // Delete old cover if present
        if (existing.coverUrl) {
          await deleteFile(existing.coverUrl);
        }
        data.coverUrl = await uploadImage(req.files.cover[0], 'team_covers');
      }
    }

    const updated = await prisma.teamMember.update({
      where: { id },
      data,
    });

    res.json({ member: updated });
  } catch (error) {
    console.error('[TEAM CONTROLLER] updateTeamMember error:', error);
    res.status(500).json({ error: error.message || 'Failed to update team member' });
  }
}

// Delete team member
async function deleteTeamMember(req, res) {
  try {
    const { id } = req.params;
    const existing = await prisma.teamMember.findUnique({ where: { id } });

    if (!existing) {
      return res.status(404).json({ error: 'Team member not found' });
    }

    // Clean up images
    if (existing.imageUrl) {
      await deleteFile(existing.imageUrl);
    }
    if (existing.coverUrl) {
      await deleteFile(existing.coverUrl);
    }

    await prisma.teamMember.delete({ where: { id } });

    res.json({ message: 'Team member deleted successfully' });
  } catch (error) {
    console.error('[TEAM CONTROLLER] deleteTeamMember error:', error);
    res.status(500).json({ error: 'Failed to delete team member' });
  }
}

// Update team ordering (for drag and drop reordering)
async function updateTeamOrder(req, res) {
  try {
    const { orders } = req.body; // Array of { id, displayOrder }
    if (!orders || !Array.isArray(orders)) {
      return res.status(400).json({ error: 'Invalid order list provided' });
    }

    // Bulk update using transactions
    const updates = orders.map((o) =>
      prisma.teamMember.update({
        where: { id: o.id },
        data: { displayOrder: o.displayOrder },
      })
    );

    await prisma.$transaction(updates);

    res.json({ message: 'Team order updated successfully' });
  } catch (error) {
    console.error('[TEAM CONTROLLER] updateTeamOrder error:', error);
    res.status(500).json({ error: 'Failed to update display order' });
  }
}

// Update team status (online/offline/away)
async function updateTeamStatus(req, res) {
  try {
    const { id, status } = req.body;
    if (!id || !status) {
      return res.status(400).json({ error: 'ID and status required' });
    }

    const updated = await prisma.teamMember.update({
      where: { id },
      data: { status },
    });

    res.json({ member: updated });
  } catch (error) {
    console.error('[TEAM CONTROLLER] updateTeamStatus error:', error);
    res.status(500).json({ error: 'Failed to update status' });
  }
}

// Archive/Restore member (toggle isActive)
async function archiveTeamMember(req, res) {
  try {
    const { id, isActive } = req.body;
    if (!id || isActive === undefined) {
      return res.status(400).json({ error: 'ID and isActive state required' });
    }

    const updated = await prisma.teamMember.update({
      where: { id },
      data: { isActive: isActive === 'true' || isActive === true },
    });

    res.json({ member: updated });
  } catch (error) {
    console.error('[TEAM CONTROLLER] archiveTeamMember error:', error);
    res.status(500).json({ error: 'Failed to toggle archive state' });
  }
}

// Verify/Unverify member (toggle isVerified)
async function verifyTeamMember(req, res) {
  try {
    const { id, isVerified } = req.body;
    if (!id || isVerified === undefined) {
      return res.status(400).json({ error: 'ID and isVerified state required' });
    }

    const updated = await prisma.teamMember.update({
      where: { id },
      data: { isVerified: isVerified === 'true' || isVerified === true },
    });

    res.json({ member: updated });
  } catch (error) {
    console.error('[TEAM CONTROLLER] verifyTeamMember error:', error);
    res.status(500).json({ error: 'Failed to toggle verification state' });
  }
}

module.exports = {
  getTeam,
  getTeamMemberByUsername,
  createTeamMember,
  updateTeamMember,
  deleteTeamMember,
  updateTeamOrder,
  updateTeamStatus,
  archiveTeamMember,
  verifyTeamMember,
};
