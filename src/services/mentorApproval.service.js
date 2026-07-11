const prisma = require('../config/prisma');
const { sendMentorApprovalEmail } = require('./email.service');
const { sendNotification } = require('./notification.service');


async function approveMentor(mentorId) {
  const mentor = await prisma.mentor.update({
    where: { id: mentorId },
    data: { approvalStatus: 'APPROVED', isActive: true },
    include: { user: true },
  });

  // Run email side-effects safely
  try {
    await sendMentorApprovalEmail({ ...mentor.user, displayName: mentor.displayName }, true);
    if (mentor.institutionEmail && mentor.institutionEmail !== mentor.user.email) {
      await sendMentorApprovalEmail(
        { email: mentor.institutionEmail, name: mentor.displayName, userId: mentor.userId },
        true
      );
    }
  } catch (emailError) {
    console.error('[EMAIL] Failed to send mentor approval emails:', emailError.message);
  }

  // Run notification side-effects safely
  try {
    await sendNotification({
      mentorId: mentor.id,
      type: 'MENTOR_APPROVED',
      title: 'Your profile is live!',
      body: 'Congratulations! Students can now book sessions with you.',
      sendEmail: false,
      sendPush: true,
    });
  } catch (notifError) {
    console.error('[NOTIFICATION] Failed to create approval notification:', notifError.message);
  }

  return mentor;
}

async function rejectMentor(mentorId, reason) {
  const mentor = await prisma.mentor.update({
    where: { id: mentorId },
    data: { approvalStatus: 'REJECTED', rejectionReason: reason },
    include: { user: true },
  });

  // Run email side-effects safely
  try {
    await sendMentorApprovalEmail({ ...mentor.user, displayName: mentor.displayName }, false, reason);
  } catch (emailError) {
    console.error('[EMAIL] Failed to send mentor rejection email:', emailError.message);
  }

  // Run notification side-effects safely
  try {
    await sendNotification({
      mentorId: mentor.id,
      type: 'MENTOR_REJECTED',
      title: 'Application update',
      body: `Your application was not approved: ${reason}`,
      sendEmail: false,
      sendPush: true,
    });
  } catch (notifError) {
    console.error('[NOTIFICATION] Failed to create rejection notification:', notifError.message);
  }

  return mentor;
}

module.exports = { approveMentor, rejectMentor };
