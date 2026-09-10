const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  console.log('🚀 Starting Database Mentor Cleanup...');

  try {
    const allMentors = await prisma.mentor.findMany({
      select: {
        id: true,
        displayName: true,
        userId: true,
        user: { select: { email: true } },
      },
    });

    console.log(`📊 Found ${allMentors.length} mentors in the database.`);

    if (allMentors.length === 0) {
      console.log('✅ No mentors found to delete. Database is already clean.');
      return;
    }

    const mentorIds = allMentors.map((m) => m.id);
    const userIds = allMentors.map((m) => m.userId).filter(Boolean);

    console.log(`\nMentors to be deleted:`);
    allMentors.forEach((m, idx) => {
      console.log(`  ${idx + 1}. ${m.displayName} (${m.user?.email || 'no email'}) [ID: ${m.id}]`);
    });

    console.log('\n⏳ Beginning transactional cascade deletion...');

    const result = await prisma.$transaction(async (tx) => {
      // 1. Reviews
      const rev = await tx.review.deleteMany({
        where: { mentorId: { in: mentorIds } },
      });
      console.log(`  - Deleted ${rev.count} reviews`);

      // 2. Earnings
      const earn = await tx.earning.deleteMany({
        where: { mentorId: { in: mentorIds } },
      });
      console.log(`  - Deleted ${earn.count} earnings`);

      // 3. Bookings
      const book = await tx.booking.deleteMany({
        where: { mentorId: { in: mentorIds } },
      });
      console.log(`  - Deleted ${book.count} bookings`);

      // 4. Availabilities & Blocked Dates
      const avail = await tx.availability.deleteMany({
        where: { mentorId: { in: mentorIds } },
      });
      console.log(`  - Deleted ${avail.count} availability slots`);

      const blk = await tx.blockedDate.deleteMany({
        where: { mentorId: { in: mentorIds } },
      });
      console.log(`  - Deleted ${blk.count} blocked dates`);

      // 5. Verification docs & Complaints
      const docs = await tx.verificationDoc.deleteMany({
        where: { mentorId: { in: mentorIds } },
      });
      console.log(`  - Deleted ${docs.count} verification documents`);

      const comp = await tx.complaint.deleteMany({
        where: { mentorId: { in: mentorIds } },
      });
      console.log(`  - Deleted ${comp.count} complaints`);

      // 6. Notifications
      const notif = await tx.notification.deleteMany({
        where: { mentorId: { in: mentorIds } },
      });
      console.log(`  - Deleted ${notif.count} notifications`);

      // 7. Chat Threads & Messages
      const threads = await tx.chatThread.findMany({
        where: { mentorId: { in: mentorIds } },
        select: { id: true },
      });
      const threadIds = threads.map((t) => t.id);

      if (threadIds.length > 0) {
        const msgs = await tx.chatMessage.findMany({
          where: { threadId: { in: threadIds } },
          select: { id: true },
        });
        const msgIds = msgs.map((m) => m.id);

        if (msgIds.length > 0) {
          const rxn = await tx.messageReaction.deleteMany({
            where: { messageId: { in: msgIds } },
          });
          console.log(`  - Deleted ${rxn.count} chat message reactions`);

          await tx.chatMessage.updateMany({
            where: { threadId: { in: threadIds } },
            data: { replyToId: null },
          });

          const delMsgs = await tx.chatMessage.deleteMany({
            where: { threadId: { in: threadIds } },
          });
          console.log(`  - Deleted ${delMsgs.count} chat messages`);
        }

        const delThreads = await tx.chatThread.deleteMany({
          where: { id: { in: threadIds } },
        });
        console.log(`  - Deleted ${delThreads.count} chat threads`);
      }

      // 8. Delete Mentor records
      const delMentors = await tx.mentor.deleteMany({
        where: { id: { in: mentorIds } },
      });
      console.log(`  - Deleted ${delMentors.count} mentor records`);

      // 9. Reset User roles & onboarding data
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

        const updatedUsers = await tx.user.updateMany({
          where: {
            id: { in: userIds },
            role: 'MENTOR',
          },
          data: {
            role: 'STUDENT',
            onboardingRole: 'student',
          },
        });
        console.log(`  - Reset role to STUDENT for ${updatedUsers.count} users`);
      }

      return delMentors.count;
    });

    console.log(`\n🎉 Successfully deleted all ${result} mentors from the database!`);
  } catch (error) {
    console.error('❌ Error during mentor deletion:', error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

main();
