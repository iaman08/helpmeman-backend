const { PrismaClient } = require('@prisma/client');
const { sendEmail, approvalEmailTemplate, rejectionEmailTemplate } = require('./email.service');
const { createNotification } = require('./notification.service');

const prisma = new PrismaClient();

async function approveMentor(mentorId) {
  const mentor = await prisma.mentor.update({
    where: { id: mentorId },
    data: { approvalStatus: 'APPROVED', isActive: true },
    include: { user: true },
  });

  await sendEmail({
    to: mentor.user.email,
    subject: '🎉 You are approved on HelpMeMan!',
    html: approvalEmailTemplate(mentor),
  });

  await sendEmail({
    to: mentor.institutionEmail,
    subject: 'HelpMeMan mentor verification confirmed',
    html: approvalEmailTemplate(mentor),
  });

  await createNotification({
    mentorId: mentor.id,
    type: 'MENTOR_APPROVED',
    title: 'Your profile is live!',
    body: 'Congratulations! Students can now book sessions with you.',
  });

  return mentor;
}

async function rejectMentor(mentorId, reason) {
  const mentor = await prisma.mentor.update({
    where: { id: mentorId },
    data: { approvalStatus: 'REJECTED', rejectionReason: reason },
    include: { user: true },
  });

  await sendEmail({
    to: mentor.user.email,
    subject: 'Update on your HelpMeMan mentor application',
    html: rejectionEmailTemplate(mentor, reason),
  });

  await createNotification({
    mentorId: mentor.id,
    type: 'MENTOR_REJECTED',
    title: 'Application update',
    body: `Your application was not approved: ${reason}`,
  });

  return mentor;
}

module.exports = { approveMentor, rejectMentor };
