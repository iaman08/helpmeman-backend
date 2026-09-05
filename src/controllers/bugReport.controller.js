/**
 * Bug Report Controller
 * Handles submitting bug reports with photo/video attachments,
 * uploading media to Google Drive, and admin management endpoints.
 */

const prisma = require('../config/prisma');
const { uploadBugMediaToDrive } = require('../services/googleDrive.service');

const config = require('../config/env');

/**
 * Forward submission / update / delete data to a Google Sheets Apps Script Webhook.
 */
async function syncToGoogleDocsOrSheet(payload) {
  const webhookUrl =
    config.google?.sheetsWebhookUrl ||
    process.env.GOOGLE_SHEETS_WEBHOOK_URL ||
    process.env.GOOGLE_DOCS_WEBHOOK_URL;

  if (!webhookUrl) {
    console.log('[BugReport] No GOOGLE_SHEETS_WEBHOOK_URL configured, skipping Sheets sync.');
    return;
  }

  try {
    const res = await fetch(webhookUrl, {
      method: 'POST',
      redirect: 'follow',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    const text = await res.text();
    if (res.status >= 200 && res.status < 300) {
      if (text.includes('You need access') || text.includes('accounts.google.com')) {
        console.warn(
          '[BugReport] Google Sheets Webhook returned access error: Please ensure Google Apps Script is deployed with "Who has access: Anyone".'
        );
      } else {
        console.log(`[BugReport] Synced to Google Sheets Webhook (${payload.action || 'CREATE'}, status: ${res.status})`);
      }
    } else {
      console.warn(`[BugReport] Google Sheets Webhook error status ${res.status}:`, text.slice(0, 200));
    }
  } catch (err) {
    console.warn('[BugReport] Google Sheets sync error:', err.message);
  }
}

/**
 * Public: Submit a bug report with photo/video.
 * Uploads media to Google Drive and saves record.
 */
async function submitBugReport(req, res) {
  try {
    const { name, email, contactNo, bugName, description } = req.body;

    if (!name || !email || !contactNo || !bugName) {
      return res.status(400).json({
        error: 'Please provide all required fields: name, email, contactNo, and bugName.',
      });
    }

    // Basic email validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email.trim())) {
      return res.status(400).json({ error: 'Please enter a valid email address.' });
    }

    let driveData = { fileId: null, webViewLink: null, webContentLink: null };

    if (req.file) {
      try {
        driveData = await uploadBugMediaToDrive(req.file);
      } catch (uploadErr) {
        console.error('[BugReport] Media upload error:', uploadErr.message);
        // Continue even if file upload failed so we still capture the user's issue
      }
    }

    let bugReport;
    if (prisma.bugReport && typeof prisma.bugReport.create === 'function') {
      bugReport = await prisma.bugReport.create({
        data: {
          name: name.trim(),
          email: email.trim().toLowerCase(),
          contactNo: contactNo.trim(),
          bugName: bugName.trim(),
          description: description ? description.trim() : null,
          fileUrl: driveData.webViewLink,
          googleDriveLink: driveData.webViewLink,
          googleDriveFileId: driveData.fileId,
          fileType: req.file ? req.file.mimetype : null,
          fileName: req.file ? req.file.originalname : null,
          status: 'OPEN',
        },
      });
    } else {
      // Direct raw query if Prisma client query engine lock is pending
      const cuid = require('crypto').randomBytes(12).toString('hex');
      const [rawRecord] = await prisma.$queryRaw`
        INSERT INTO "BugReport" ("id", "name", "email", "contactNo", "bugName", "description", "fileUrl", "googleDriveLink", "googleDriveFileId", "fileType", "fileName", "status", "createdAt", "updatedAt")
        VALUES (${cuid}, ${name.trim()}, ${email.trim().toLowerCase()}, ${contactNo.trim()}, ${bugName.trim()}, ${description ? description.trim() : null}, ${driveData.webViewLink}, ${driveData.webViewLink}, ${driveData.fileId}, ${req.file ? req.file.mimetype : null}, ${req.file ? req.file.originalname : null}, 'OPEN', NOW(), NOW())
        RETURNING *
      `;
      bugReport = rawRecord;
    }

    console.log(`[BugReport] New report created: ${bugReport.id} by ${name} ("${bugName}")`);

    // Asynchronously forward to Google Sheets if webhook configured
    syncToGoogleDocsOrSheet({
      action: 'CREATE',
      id: bugReport.id,
      name: bugReport.name,
      email: bugReport.email,
      contactNo: bugReport.contactNo,
      bugName: bugReport.bugName,
      description: bugReport.description || '',
      googleDriveLink: bugReport.googleDriveLink || bugReport.fileUrl || '',
      fileType: bugReport.fileType || '',
      fileName: bugReport.fileName || '',
      status: bugReport.status || 'OPEN',
      submittedAt: bugReport.createdAt ? new Date(bugReport.createdAt).toISOString() : new Date().toISOString(),
      submittedAtFormatted: new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', hour12: true }),
      deadlineHours: 24,
    }).catch((e) => console.warn('[BugReport] Google Sheets sync error:', e.message));

    return res.status(201).json({
      success: true,
      message: 'Bug report submitted successfully to HelpMeMan Team.',
      data: bugReport,
    });
  } catch (error) {
    console.error('[BugReport] submitBugReport error:', error);
    return res.status(500).json({
      error: 'An error occurred while submitting your bug report. Please try again.',
    });
  }
}

/**
 * Admin: Get all bug reports with pagination and status filters.
 */
async function getBugReports(req, res) {
  try {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 20));
    const skip = (page - 1) * limit;
    const { status, search } = req.query;

    const where = {};

    if (status && ['OPEN', 'IN_PROGRESS', 'RESOLVED'].includes(status.toUpperCase())) {
      where.status = status.toUpperCase();
    }

    if (search && search.trim()) {
      const q = search.trim();
      where.OR = [
        { name: { contains: q, mode: 'insensitive' } },
        { email: { contains: q, mode: 'insensitive' } },
        { contactNo: { contains: q, mode: 'insensitive' } },
        { bugName: { contains: q, mode: 'insensitive' } },
        { description: { contains: q, mode: 'insensitive' } },
      ];
    }

    let reports, total, openCount, inProgressCount, resolvedCount;

    if (prisma.bugReport && typeof prisma.bugReport.findMany === 'function') {
      [reports, total, openCount, inProgressCount, resolvedCount] = await Promise.all([
        prisma.bugReport.findMany({
          where,
          orderBy: { createdAt: 'desc' },
          skip,
          take: limit,
        }),
        prisma.bugReport.count({ where }),
        prisma.bugReport.count({ where: { status: 'OPEN' } }),
        prisma.bugReport.count({ where: { status: 'IN_PROGRESS' } }),
        prisma.bugReport.count({ where: { status: 'RESOLVED' } }),
      ]);
    } else {
      // Raw query fallback
      let whereClause = '';
      const params = [];
      let paramIdx = 1;

      if (where.status) {
        whereClause += ` WHERE status = $${paramIdx++}`;
        params.push(where.status);
      }

      reports = await prisma.$queryRawUnsafe(
        `SELECT * FROM "BugReport" ${whereClause} ORDER BY "createdAt" DESC LIMIT ${limit} OFFSET ${skip}`,
        ...params
      );

      const [totalRow] = await prisma.$queryRawUnsafe(`SELECT COUNT(*)::int as count FROM "BugReport" ${whereClause}`, ...params);
      const [openRow] = await prisma.$queryRaw`SELECT COUNT(*)::int as count FROM "BugReport" WHERE status = 'OPEN'`;
      const [inProgRow] = await prisma.$queryRaw`SELECT COUNT(*)::int as count FROM "BugReport" WHERE status = 'IN_PROGRESS'`;
      const [resRow] = await prisma.$queryRaw`SELECT COUNT(*)::int as count FROM "BugReport" WHERE status = 'RESOLVED'`;

      total = totalRow?.count || 0;
      openCount = openRow?.count || 0;
      inProgressCount = inProgRow?.count || 0;
      resolvedCount = resRow?.count || 0;
    }

    return res.json({
      reports,
      pagination: {
        total,
        page,
        limit,
        pages: Math.ceil(total / limit) || 1,
      },
      stats: {
        total: openCount + inProgressCount + resolvedCount,
        open: openCount,
        inProgress: inProgressCount,
        resolved: resolvedCount,
      },
    });
  } catch (error) {
    console.error('[BugReport] getBugReports error:', error);
    return res.status(500).json({ error: 'Failed to fetch bug reports.' });
  }
}

/**
 * Admin: Update bug report status.
 */
async function updateBugReportStatus(req, res) {
  try {
    const { id } = req.params;
    const { status } = req.body;

    if (!status || !['OPEN', 'IN_PROGRESS', 'RESOLVED'].includes(status.toUpperCase())) {
      return res.status(400).json({ error: 'Valid status required: OPEN, IN_PROGRESS, RESOLVED' });
    }

    let updated;
    if (prisma.bugReport && typeof prisma.bugReport.update === 'function') {
      updated = await prisma.bugReport.update({
        where: { id },
        data: { status: status.toUpperCase() },
      });
    } else {
      const rows = await prisma.$queryRaw`
        UPDATE "BugReport"
        SET status = ${status.toUpperCase()}, "updatedAt" = NOW()
        WHERE id = ${id}
        RETURNING *
      `;
      updated = rows[0];
    }

    // Sync updated status to Google Sheets (turns countdown to ✅ RESOLVED)
    syncToGoogleDocsOrSheet({
      action: 'UPDATE_STATUS',
      id,
      status: status.toUpperCase(),
      updatedAt: new Date().toISOString(),
    }).catch((e) => console.warn('[BugReport] Google Sheets status sync error:', e.message));

    return res.json({ success: true, data: updated });
  } catch (error) {
    console.error('[BugReport] updateBugReportStatus error:', error);
    return res.status(500).json({ error: 'Failed to update bug report status.' });
  }
}

/**
 * Admin: Delete a bug report.
 */
async function deleteBugReport(req, res) {
  try {
    const { id } = req.params;
    if (prisma.bugReport && typeof prisma.bugReport.delete === 'function') {
      await prisma.bugReport.delete({ where: { id } });
    } else {
      await prisma.$executeRaw`DELETE FROM "BugReport" WHERE id = ${id}`;
    }

    // Sync deletion to Google Sheets
    syncToGoogleDocsOrSheet({
      action: 'DELETE',
      id,
    }).catch((e) => console.warn('[BugReport] Google Sheets delete sync error:', e.message));

    return res.json({ success: true, message: 'Bug report deleted.' });
  } catch (error) {
    console.error('[BugReport] deleteBugReport error:', error);
    return res.status(500).json({ error: 'Failed to delete bug report.' });
  }
}

module.exports = {
  submitBugReport,
  getBugReports,
  updateBugReportStatus,
  deleteBugReport,
};
