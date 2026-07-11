const prisma = require('../config/prisma');

/**
 * Recalculate a mentor's average response time and cache the human-friendly string.
 * Triggered on mentor chat replies.
 */
async function calculateAndCacheResponseTime(mentorId) {
  if (!mentorId) return;

  try {
    // Fetch all chat threads with their messages
    const threads = await prisma.chatThread.findMany({
      where: { mentorId },
      include: {
        messages: {
          orderBy: { createdAt: 'asc' }
        }
      }
    });

    const responseTimesMs = [];

    for (const thread of threads) {
      // Find the first message sent by the user (student)
      const firstUserMsg = thread.messages.find(m => m.senderRole === 'USER');
      if (!firstUserMsg) continue;

      // Find the first message sent by the mentor after the student's message
      const firstMentorMsg = thread.messages.find(
        m => m.senderRole === 'MENTOR' && m.createdAt > firstUserMsg.createdAt
      );
      if (!firstMentorMsg) continue;

      const diff = new Date(firstMentorMsg.createdAt) - new Date(firstUserMsg.createdAt);
      if (diff >= 0) {
        responseTimesMs.push(diff);
      }
    }

    let formattedString = 'Usually replies within a day';

    if (responseTimesMs.length > 0) {
      const avgMs = responseTimesMs.reduce((sum, val) => sum + val, 0) / responseTimesMs.length;
      const avgMins = Math.round(avgMs / 60000);

      if (avgMins < 5) {
        formattedString = 'Usually replies in 5 min';
      } else if (avgMins < 60) {
        formattedString = `Usually replies in ${avgMins} min`;
      } else {
        const avgHours = Math.round(avgMins / 60);
        if (avgHours === 1) {
          formattedString = 'Usually replies in 1 hour';
        } else if (avgHours < 24) {
          formattedString = `Usually replies in ${avgHours} hours`;
        } else {
          formattedString = 'Usually replies within a day';
        }
      }
    }

    // Cache the computed response time in the mentor table
    await prisma.mentor.update({
      where: { id: mentorId },
      data: { averageResponseTime: formattedString }
    });
  } catch (error) {
    console.error(`[RESPONSE_TIME] Failed to compute response time for mentor ${mentorId}:`, error.message);
  }
}

module.exports = {
  calculateAndCacheResponseTime
};
