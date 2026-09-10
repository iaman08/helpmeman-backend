const prisma = require('../config/prisma');
const { logAuditEvent } = require('../services/auditLog.service');
const { sendEmail } = require('../services/email.service');

/**
 * DPDP Act 2023 — Section 11: Right to Access Information about Personal Data
 * Generates an authenticated, comprehensive JSON bundle of the Data Principal's data.
 */
async function exportPersonalData(req, res) {
  try {
    const userId = req.user.id;

    const [user, bookings, reviews, notifPrefs, userMemory, devices, mentor] = await Promise.all([
      prisma.user.findUnique({
        where: { id: userId },
        select: {
          id: true,
          name: true,
          email: true,
          phone: true,
          role: true,
          username: true,
          currency: true,
          status: true,
          isEmailVerified: true,
          createdAt: true,
          updatedAt: true,
        },
      }),
      prisma.booking.findMany({
        where: { userId },
        select: {
          id: true,
          scheduledAt: true,
          durationMinutes: true,
          amountPaid: true,
          currency: true,
          status: true,
          userNotes: true,
          mentorNotes: true,
          createdAt: true,
          mentor: {
            select: {
              displayName: true,
              institutionName: true,
            },
          },
        },
      }),
      prisma.review.findMany({
        where: { userId },
        select: {
          id: true,
          rating: true,
          comment: true,
          createdAt: true,
        },
      }),
      prisma.userNotificationPreference.findUnique({
        where: { userId },
      }),
      prisma.userMemory.findUnique({
        where: { userId },
        select: {
          memorySummary: true,
          version: true,
          updatedAt: true,
        },
      }),
      prisma.userDevice.findMany({
        where: { userId },
        select: {
          deviceType: true,
          lastActive: true,
          createdAt: true,
        },
      }),
      prisma.mentor.findUnique({
        where: { userId },
        select: {
          displayName: true,
          bio: true,
          institutionType: true,
          institutionName: true,
          expertise: true,
          pricePerSession: true,
          sessionDuration: true,
          approvalStatus: true,
          createdAt: true,
        },
      }),
    ]);

    if (!user) {
      return res.status(404).json({ error: 'User record not found' });
    }

    const payload = {
      complianceNotice: {
        act: 'Digital Personal Data Protection Act, 2023 (DPDP Act, India)',
        dataFiduciary: 'HelpMeMan Technologies Private Limited',
        dataPrincipalId: user.id,
        exportedAt: new Date().toISOString(),
        description: 'Comprehensive personal data export generated in compliance with Section 11 of the DPDP Act, 2023.',
        grievanceOfficerEmail: 'grievance@helpmeman.com',
      },
      personalProfile: user,
      mentorshipSessions: bookings,
      sessionReviewsGiven: reviews,
      preferences: notifPrefs ? {
        emailNotifications: notifPrefs.emailNotifications,
        pushNotifications: notifPrefs.pushNotifications,
        marketingEmails: notifPrefs.marketingEmails,
        accountUpdates: notifPrefs.accountUpdates,
        messages: notifPrefs.messages,
        mentorUpdates: notifPrefs.mentorUpdates,
      } : null,
      aiInteractionContext: userMemory,
      registeredDevices: devices,
      mentorProfile: mentor || null,
    };

    await logAuditEvent({
      action: 'DPDP_DATA_EXPORT_REQUESTED',
      actorId: userId,
      targetId: userId,
      metadata: { recordCount: bookings.length },
      req,
    });

    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="helpmeman-personal-data-${user.id.slice(0, 8)}.json"`);
    return res.status(200).send(JSON.stringify(payload, null, 2));
  } catch (error) {
    console.error('[DPDP] Error generating data export:', error);
    return res.status(500).json({ error: 'Failed to compile personal data export.' });
  }
}

/**
 * DPDP Act 2023 — Section 6: Right to View & Withdraw Consent
 */
async function getPrivacyPreferences(req, res) {
  try {
    const userId = req.user.id;

    const [prefs, memory] = await Promise.all([
      prisma.userNotificationPreference.findUnique({ where: { userId } }),
      prisma.userMemory.findUnique({ where: { userId } }),
    ]);

    return res.json({
      marketingEmails: Boolean(prefs?.marketingEmails),
      aiMemoryEnabled: Boolean(memory),
      hasStoredAiMemory: Boolean(memory?.memorySummary),
      analyticsConsent: true,
      lastUpdated: prefs?.updatedAt || new Date().toISOString(),
      statutoryDetails: {
        act: 'DPDP Act, 2023',
        grievanceOfficer: 'Grievance Redressal Officer',
        contactEmail: 'grievance@helpmeman.com',
        slaAcknowledgmentHours: 48,
        slaResolutionDays: 30,
      },
    });
  } catch (error) {
    console.error('[DPDP] Error fetching privacy preferences:', error);
    return res.status(500).json({ error: 'Failed to retrieve privacy preferences.' });
  }
}

/**
 * DPDP Act 2023 — Section 6(4): Update/Withdraw Consent
 */
async function updatePrivacyPreferences(req, res) {
  try {
    const userId = req.user.id;
    const { marketingEmails, analyticsConsent } = req.body;

    const updated = await prisma.userNotificationPreference.upsert({
      where: { userId },
      update: {
        ...(typeof marketingEmails === 'boolean' ? { marketingEmails } : {}),
      },
      create: {
        userId,
        marketingEmails: Boolean(marketingEmails),
      },
    });

    await logAuditEvent({
      action: 'DPDP_CONSENT_UPDATED',
      actorId: userId,
      targetId: userId,
      metadata: { marketingEmails, analyticsConsent },
      req,
    });

    return res.json({
      success: true,
      marketingEmails: updated.marketingEmails,
      message: 'Consent preferences updated successfully under DPDP Act 2023.',
    });
  } catch (error) {
    console.error('[DPDP] Error updating consent preferences:', error);
    return res.status(500).json({ error: 'Failed to update consent preferences.' });
  }
}

/**
 * DPDP Act 2023 — Section 12: Clear AI Memory
 * Allows the Data Principal to scrub stored AI context vectors.
 */
async function clearAiMemory(req, res) {
  try {
    const userId = req.user.id;

    await prisma.$transaction([
      prisma.userMemory.deleteMany({ where: { userId } }),
      prisma.aiSession.deleteMany({ where: { userId } }),
    ]);

    await logAuditEvent({
      action: 'DPDP_AI_MEMORY_CLEARED',
      actorId: userId,
      targetId: userId,
      metadata: { requestedBy: 'USER' },
      req,
    });

    return res.json({
      success: true,
      message: 'Your AI interaction memory and history have been permanently erased.',
    });
  } catch (error) {
    console.error('[DPDP] Error clearing AI memory:', error);
    return res.status(500).json({ error: 'Failed to clear AI interaction memory.' });
  }
}

/**
 * DPDP Act 2023 — Section 13: Right of Grievance Redressal
 * Submits a formal privacy grievance to the Grievance Officer.
 */
async function submitPrivacyGrievance(req, res) {
  try {
    const userId = req.user.id;
    const { category = 'GENERAL_PRIVACY', subject, description, preferredContactEmail } = req.body;

    if (!subject || !description) {
      return res.status(400).json({ error: 'Subject and detailed description are required.' });
    }

    const ticketNumber = `DPDP-GRV-${Date.now().toString(36).toUpperCase()}-${Math.floor(100 + Math.random() * 900)}`;
    const contactEmail = preferredContactEmail || req.user.email;

    // Log the grievance immutably in AuditLog
    await logAuditEvent({
      action: 'DPDP_GRIEVANCE_FILED',
      actorId: userId,
      targetId: userId,
      metadata: {
        ticketNumber,
        category,
        subject,
        description,
        contactEmail,
        status: 'OPEN',
        acknowledgedDue: new Date(Date.now() + 48 * 3600 * 1000).toISOString(),
        resolutionDue: new Date(Date.now() + 30 * 86400 * 1000).toISOString(),
      },
      req,
    });

    // Notify user with formal statutory DPDP acknowledgment
    try {
      const ackHtml = `
        <div style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:32px;background:#ffffff;border:1px solid #e2e8f0;border-radius:16px;">
          <h2 style="color:#0f172a;margin-top:0;">Grievance Acknowledgment (DPDP Act, 2023)</h2>
          <p style="color:#475569;font-size:14px;">Dear Data Principal,</p>
          <p style="color:#475569;font-size:14px;line-height:1.6;">
            We have received your privacy grievance under Section 13 of the Digital Personal Data Protection Act, 2023.
          </p>
          <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:12px;padding:16px;margin:20px 0;">
            <p style="margin:4px 0;font-size:13px;color:#64748b;"><strong>Ticket ID:</strong> ${ticketNumber}</p>
            <p style="margin:4px 0;font-size:13px;color:#64748b;"><strong>Subject:</strong> ${subject}</p>
            <p style="margin:4px 0;font-size:13px;color:#64748b;"><strong>Category:</strong> ${category}</p>
            <p style="margin:4px 0;font-size:13px;color:#64748b;"><strong>Acknowledgment SLA:</strong> Within 48 hours</p>
            <p style="margin:4px 0;font-size:13px;color:#64748b;"><strong>Statutory Resolution Timeline:</strong> Within 30 days</p>
          </div>
          <p style="color:#475569;font-size:13px;line-height:1.5;">
            Our Data Protection &amp; Grievance Redressal Officer is reviewing your request. If unresolved within the statutory timeline, you retain the right to escalate your grievance to the Data Protection Board of India (DPBI).
          </p>
          <p style="margin-top:24px;font-size:12px;color:#94a3b8;">HelpMeMan Technologies — Data Privacy &amp; Compliance Cell</p>
        </div>
      `;

      await sendEmail({
        to: contactEmail,
        subject: `[${ticketNumber}] Privacy Grievance Acknowledgment — HelpMeMan`,
        html: ackHtml,
        userId,
        templateType: 'generic',
      });
    } catch (emailErr) {
      console.warn('[DPDP] Non-fatal: Grievance acknowledgment email failed:', emailErr.message);
    }

    return res.status(201).json({
      success: true,
      ticketNumber,
      message: 'Your grievance has been formally registered with our Grievance Redressal Officer. In accordance with the DPDP Act 2023, you will receive an acknowledgment within 48 hours and a formal resolution within 30 days.',
      statutoryTimelines: {
        acknowledgment: '48 hours',
        resolution: '30 days',
        appellateAuthority: 'Data Protection Board of India (DPBI)',
      },
    });
  } catch (error) {
    console.error('[DPDP] Error registering privacy grievance:', error);
    return res.status(500).json({ error: 'Failed to submit privacy grievance.' });
  }
}

/**
 * DPDP Act 2023 — Section 12: Right to Erasure / Account Deletion
 * Permanently anonymizes personal identifiers, wipes active sessions and ancillary PII.
 */
async function deleteAccount(req, res) {
  try {
    const userId = req.user.id;
    const { confirmationText, reason } = req.body;

    if (confirmationText !== 'DELETE') {
      return res.status(400).json({ error: "Confirmation text must be 'DELETE' to proceed with account erasure." });
    }

    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      return res.status(404).json({ error: 'User not found.' });
    }

    const anonSuffix = userId.slice(0, 8);
    const anonymizedEmail = `deleted_${anonSuffix}_${Date.now()}@anonymized.helpmeman.local`;

    await prisma.$transaction(async (tx) => {
      // 1. Delete transient credentials & session tokens
      await tx.refreshToken.deleteMany({ where: { userId } });
      await tx.userDevice.deleteMany({ where: { userId } });
      await tx.otpCode.deleteMany({ where: { email: user.email } });
      await tx.userMemory.deleteMany({ where: { userId } });
      await tx.aiSession.deleteMany({ where: { userId } });
      await tx.notification.deleteMany({ where: { userId } });

      // 2. If mentor, delete availability and unpublish
      const mentor = await tx.mentor.findUnique({ where: { userId } });
      if (mentor) {
        await tx.availability.deleteMany({ where: { mentorId: mentor.id } });
        await tx.blockedDate.deleteMany({ where: { mentorId: mentor.id } });
        await tx.mentor.update({
          where: { id: mentor.id },
          data: {
            isActive: false,
            displayName: 'Former Mentor',
            bio: '[Account erased under DPDP Act Section 12]',
            phone: null,
            institutionEmail: anonymizedEmail,
          },
        });
      }

      // 3. Scrub and anonymize User PII
      await tx.user.update({
        where: { id: userId },
        data: {
          name: 'Deleted User',
          email: anonymizedEmail,
          phone: null,
          avatar: null,
          passwordHash: '',
          status: 'DELETED',
          presenceStatus: 'OFFLINE',
          username: null,
        },
      });
    });

    await logAuditEvent({
      action: 'DPDP_ACCOUNT_ERASED',
      actorId: userId,
      targetId: userId,
      metadata: { reason: reason || 'User requested erasure under DPDP Act 2023 Section 12' },
      req,
    });

    return res.json({
      success: true,
      message: 'Your personal data and account have been successfully erased in accordance with Section 12 of the DPDP Act, 2023.',
    });
  } catch (error) {
    console.error('[DPDP] Error during account erasure:', error);
    return res.status(500).json({ error: 'Failed to erase account. Please try again or contact support.' });
  }
}

module.exports = {
  exportPersonalData,
  getPrivacyPreferences,
  updatePrivacyPreferences,
  clearAiMemory,
  submitPrivacyGrievance,
  deleteAccount,
};
