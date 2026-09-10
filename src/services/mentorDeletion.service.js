const prisma = require('../config/prisma');
const { logAuditEvent } = require('./auditLog.service');

/**
 * Safely delete a single mentor and cascade all related records.
 * Resets the associated user's role back to STUDENT.
 */
async function deleteSingleMentor(mentorId, actorContext = {}) {
  const mentor = await prisma.mentor.findUnique({
    where: { id: mentorId },
    include: { user: true },
  });

  if (!mentor) {
    throw new Error('Mentor not found');
  }

  const userId = mentor.userId;

  await prisma.$transaction(async (tx) => {
    // 1. Delete reviews referencing this mentor
    await tx.review.deleteMany({
      where: { mentorId },
    });

    // 2. Delete earnings for this mentor
    await tx.earning.deleteMany({
      where: { mentorId },
    });

    // 3. Delete bookings for this mentor
    await tx.booking.deleteMany({
      where: { mentorId },
    });

    // 4. Delete availabilities and blocked dates
    await tx.availability.deleteMany({
      where: { mentorId },
    });
    await tx.blockedDate.deleteMany({
      where: { mentorId },
    });

    // 5. Delete verification docs and complaints
    await tx.verificationDoc.deleteMany({
      where: { mentorId },
    });
    await tx.complaint.deleteMany({
      where: { mentorId },
    });

    // 6. Delete or nullify notifications
    await tx.notification.deleteMany({
      where: { mentorId },
    });

    // 7. Clean up chat threads & messages
    const threads = await tx.chatThread.findMany({
      where: { mentorId },
      select: { id: true },
    });
    const threadIds = threads.map((t) => t.id);

    if (threadIds.length > 0) {
      const messages = await tx.chatMessage.findMany({
        where: { threadId: { in: threadIds } },
        select: { id: true },
      });
      const messageIds = messages.map((m) => m.id);

      if (messageIds.length > 0) {
        // Delete message reactions
        await tx.messageReaction.deleteMany({
          where: { messageId: { in: messageIds } },
        });
        // Nullify replies
        await tx.chatMessage.updateMany({
          where: { threadId: { in: threadIds } },
          data: { replyToId: null },
        });
        // Delete chat messages
        await tx.chatMessage.deleteMany({
          where: { threadId: { in: threadIds } },
        });
      }

      // Delete threads
      await tx.chatThread.deleteMany({
        where: { id: { in: threadIds } },
      });
    }

    // 8. Delete the Mentor profile
    await tx.mentor.delete({
      where: { id: mentorId },
    });

    // 9. Reset user role and mentor onboarding data
    if (userId) {
      await tx.mentorProfile.deleteMany({
        where: { mentorId: userId },
      });
      await tx.mentorOnboarding.deleteMany({
        where: { userId },
      });
      await tx.mentorOnboardingAnswer.deleteMany({
        where: { mentorId: userId },
      });
      await tx.mentorMemory.deleteMany({
        where: { mentorId: userId },
      });

      const user = await tx.user.findUnique({
        where: { id: userId },
        select: { role: true },
      });

      if (user && user.role === 'MENTOR') {
        await tx.user.update({
          where: { id: userId },
          data: {
            role: 'STUDENT',
            onboardingRole: 'student',
          },
        });
      }
    }
  });

  // 10. Audit log
  if (actorContext.actorId) {
    try {
      await logAuditEvent({
        action: 'MENTOR_DELETED',
        actorId: actorContext.actorId,
        targetId: mentorId,
        endpoint: actorContext.endpoint || null,
        ip: actorContext.ip || null,
        userAgent: actorContext.userAgent || null,
        metadata: {
          mentorName: mentor.displayName,
          mentorEmail: mentor.user?.email || mentor.institutionEmail,
          userId,
        },
      });
    } catch (err) {
      console.warn('[AUDIT] Failed to log mentor deletion:', err);
    }
  }

  return { success: true, deletedMentorId: mentorId, mentorName: mentor.displayName };
}

/**
 * Safely delete all mentors from the database and cascade all related records.
 * Resets all affected users' roles from MENTOR to STUDENT.
 */
async function deleteAllMentors(actorContext = {}) {
  const allMentors = await prisma.mentor.findMany({
    select: { id: true, userId: true, displayName: true },
  });

  if (allMentors.length === 0) {
    return { success: true, count: 0, message: 'No mentors found to delete' };
  }

  const mentorIds = allMentors.map((m) => m.id);
  const userIds = allMentors.map((m) => m.userId).filter(Boolean);

  await prisma.$transaction(async (tx) => {
    // 1. Delete all reviews linked to these mentors
    await tx.review.deleteMany({
      where: { mentorId: { in: mentorIds } },
    });

    // 2. Delete all earnings for these mentors
    await tx.earning.deleteMany({
      where: { mentorId: { in: mentorIds } },
    });

    // 3. Delete all bookings for these mentors
    await tx.booking.deleteMany({
      where: { mentorId: { in: mentorIds } },
    });

    // 4. Delete availabilities and blocked dates
    await tx.availability.deleteMany({
      where: { mentorId: { in: mentorIds } },
    });
    await tx.blockedDate.deleteMany({
      where: { mentorId: { in: mentorIds } },
    });

    // 5. Delete verification docs and complaints
    await tx.verificationDoc.deleteMany({
      where: { mentorId: { in: mentorIds } },
    });
    await tx.complaint.deleteMany({
      where: { mentorId: { in: mentorIds } },
    });

    // 6. Delete notifications
    await tx.notification.deleteMany({
      where: { mentorId: { in: mentorIds } },
    });

    // 7. Delete chat threads & messages
    const threads = await tx.chatThread.findMany({
      where: { mentorId: { in: mentorIds } },
      select: { id: true },
    });
    const threadIds = threads.map((t) => t.id);

    if (threadIds.length > 0) {
      const messages = await tx.chatMessage.findMany({
        where: { threadId: { in: threadIds } },
        select: { id: true },
      });
      const messageIds = messages.map((m) => m.id);

      if (messageIds.length > 0) {
        await tx.messageReaction.deleteMany({
          where: { messageId: { in: messageIds } },
        });
        await tx.chatMessage.updateMany({
          where: { threadId: { in: threadIds } },
          data: { replyToId: null },
        });
        await tx.chatMessage.deleteMany({
          where: { threadId: { in: threadIds } },
        });
      }

      await tx.chatThread.deleteMany({
        where: { id: { in: threadIds } },
      });
    }

    // 8. Delete all mentors
    await tx.mentor.deleteMany({
      where: { id: { in: mentorIds } },
    });

    // 9. Reset user roles and mentor profile data
    if (userIds.length > 0) {
      await tx.mentorProfile.deleteMany({
        where: { mentorId: { in: userIds } },
      });
      await tx.mentorOnboarding.deleteMany({
        where: { userId: { in: userIds } },
      });
      await tx.mentorOnboardingAnswer.deleteMany({
        where: { mentorId: { in: userIds } },
      });
      await tx.mentorMemory.deleteMany({
        where: { mentorId: { in: userIds } },
      });

      await tx.user.updateMany({
        where: {
          id: { in: userIds },
          role: 'MENTOR',
        },
        data: {
          role: 'STUDENT',
          onboardingRole: 'student',
        },
      });
    }
  });

  // 10. Audit log
  if (actorContext.actorId) {
    try {
      await logAuditEvent({
        action: 'ALL_MENTORS_DELETED',
        actorId: actorContext.actorId,
        targetId: 'ALL_MENTORS',
        endpoint: actorContext.endpoint || null,
        ip: actorContext.ip || null,
        userAgent: actorContext.userAgent || null,
        metadata: {
          deletedCount: mentorIds.length,
          mentorIds,
        },
      });
    } catch (err) {
      console.warn('[AUDIT] Failed to log all mentors deletion:', err);
    }
  }

  return { success: true, count: mentorIds.length };
}

module.exports = {
  deleteSingleMentor,
  deleteAllMentors,
};
