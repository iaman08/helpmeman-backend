const { PrismaClient } = require('@prisma/client');
const { sendMentorApprovalEmail } = require('./email.service');
const { sendNotification } = require('./notification.service');

const prisma = new PrismaClient();

async function approveMentor(mentorId) {
  const mentor = await prisma.mentor.update({
    where: { id: mentorId },
    data: { approvalStatus: 'APPROVED', isActive: true },
    include: { user: true },
  });

  await sendMentorApprovalEmail({ ...mentor.user, displayName: mentor.displayName }, true);
  await sendMentorApprovalEmail(
    { email: mentor.institutionEmail, name: mentor.displayName, userId: mentor.userId },
    true
  );

  await sendNotification({
    mentorId: mentor.id,
    type: 'MENTOR_APPROVED',
    title: 'Your profile is live!',
    body: 'Congratulations! Students can now book sessions with you.',
    sendEmail: false,
    sendPush: true,
  });

  return mentor;
}

async function rejectMentor(mentorId, reason) {
  const mentor = await prisma.mentor.update({
    where: { id: mentorId },
    data: { approvalStatus: 'REJECTED', rejectionReason: reason },
    include: { user: true },
  });

  await sendMentorApprovalEmail({ ...mentor.user, displayName: mentor.displayName }, false, reason);

  await sendNotification({
    mentorId: mentor.id,
    type: 'MENTOR_REJECTED',
    title: 'Application update',
    body: `Your application was not approved: ${reason}`,
    sendEmail: false,
    sendPush: true,
  });

  return mentor;
}

module.exports = { approveMentor, rejectMentor };
