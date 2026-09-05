/**
 * Google Drive Service
 * Handles uploading bug report media (images, videos, screenshots)
 * directly to Google Drive and generating shareable web links.
 */

const { google } = require('googleapis');
const { Readable } = require('stream');
const config = require('../config/env');
const { uploadDocument } = require('./upload.service');

let cachedFolderId = null;

/**
 * Build authorized Google Drive client using environment refresh token or service credentials.
 */
function getDriveClient() {
  if (!config.google?.clientId || !config.google?.clientSecret || !config.google?.refreshToken) {
    return null;
  }

  const oauth2Client = new google.auth.OAuth2(
    config.google.clientId,
    config.google.clientSecret,
    config.google.redirectUri
  );

  oauth2Client.setCredentials({
    refresh_token: config.google.refreshToken,
  });

  return google.drive({ version: 'v3', auth: oauth2Client });
}

/**
 * Ensure a dedicated folder exists on Google Drive for Bug Reports.
 */
async function getOrCreateFolder(drive) {
  if (cachedFolderId) return cachedFolderId;

  try {
    const listRes = await drive.files.list({
      q: "name = 'HelpMeMan_Bug_Reports' and mimeType = 'application/vnd.google-apps.folder' and trashed = false",
      fields: 'files(id, name)',
      spaces: 'drive',
    });

    if (listRes.data.files && listRes.data.files.length > 0) {
      cachedFolderId = listRes.data.files[0].id;
      return cachedFolderId;
    }

    const folderMetadata = {
      name: 'HelpMeMan_Bug_Reports',
      mimeType: 'application/vnd.google-apps.folder',
    };

    const folderRes = await drive.files.create({
      resource: folderMetadata,
      fields: 'id',
    });

    cachedFolderId = folderRes.data.id;
    return cachedFolderId;
  } catch (err) {
    console.warn('[GoogleDrive] Failed to create or find folder, defaulting to root:', err.message);
    return null;
  }
}

const { uploadBugMedia } = require('./upload.service');

/**
 * Upload file to Google Drive via the deployed Google Apps Script Webhook.
 * Uses native DriveApp inside the user's authorized Google account.
 */
async function uploadViaAppsScriptDrive(file) {
  const webhookUrl =
    config.google?.sheetsWebhookUrl ||
    process.env.GOOGLE_SHEETS_WEBHOOK_URL ||
    process.env.GOOGLE_DOCS_WEBHOOK_URL;

  if (!webhookUrl || !file.buffer) return null;

  try {
    // Only attempt if file <= 35MB to keep base64 within Apps Script POST limits
    if (file.size > 35 * 1024 * 1024) return null;

    const base64 = file.buffer.toString('base64');
    const res = await fetch(webhookUrl, {
      method: 'POST',
      redirect: 'follow',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'UPLOAD_FILE',
        fileName: `BUG_${Date.now()}_${file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_')}`,
        fileType: file.mimetype,
        fileBase64: base64,
      }),
    });

    if (res.ok) {
      const data = await res.json();
      if (data.success && data.url) {
        console.log(`[GoogleDrive:AppsScript] Successfully uploaded to Google Drive: ${data.url}`);
        return {
          fileId: data.fileId || `drive_${Date.now()}`,
          webViewLink: data.url,
          webContentLink: data.url,
          thumbnailLink: null,
          fallback: false,
        };
      }
    }
  } catch (err) {
    console.warn('[GoogleDrive:AppsScript] Apps Script upload failed, falling back:', err.message);
  }
  return null;
}

/**
 * Upload an image or video buffer to Google Drive.
 * 1. Tries Google Drive API (OAuth).
 * 2. Tries Google Apps Script DriveApp (direct Drive folder).
 * 3. Falls back to Supabase Storage (supporting up to 50MB photos and videos).
 *
 * @param {Object} file - Multer file object
 * @returns {Promise<{ fileId: string, webViewLink: string, webContentLink: string, fallback: boolean }>}
 */
async function uploadBugMediaToDrive(file) {
  if (!file) return { fileId: null, webViewLink: null, webContentLink: null, fallback: false };

  // Tier 1: Try direct Google Drive OAuth API
  const drive = getDriveClient();
  if (drive) {
    try {
      const folderId = await getOrCreateFolder(drive);
      const fileStream = Readable.from(file.buffer);

      const fileMetadata = {
        name: `BUG_${Date.now()}_${file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_')}`,
        parents: folderId ? [folderId] : undefined,
      };

      const media = {
        mimeType: file.mimetype,
        body: fileStream,
      };

      const uploaded = await drive.files.create({
        resource: fileMetadata,
        media: media,
        fields: 'id, name, webViewLink, webContentLink, thumbnailLink',
      });

      const fileId = uploaded.data.id;
      let webViewLink = uploaded.data.webViewLink || `https://drive.google.com/file/d/${fileId}/view`;
      let webContentLink = uploaded.data.webContentLink || `https://drive.google.com/uc?id=${fileId}&export=download`;

      try {
        await drive.permissions.create({
          fileId: fileId,
          requestBody: { role: 'reader', type: 'anyone' },
        });
      } catch (permErr) {
        console.warn('[GoogleDrive] Could not set public permission on file:', permErr.message);
      }

      console.log(`[GoogleDrive] Successfully uploaded bug media: ${fileId} (${file.originalname})`);
      return {
        fileId,
        webViewLink,
        webContentLink,
        thumbnailLink: uploaded.data.thumbnailLink || null,
        fallback: false,
      };
    } catch (driveErr) {
      console.warn('[GoogleDrive] Direct API error:', driveErr.message);
    }
  }

  // Tier 2: Try Google Apps Script DriveApp (Native Google Drive folder)
  const scriptDriveResult = await uploadViaAppsScriptDrive(file);
  if (scriptDriveResult) {
    return scriptDriveResult;
  }

  // Tier 3: Fallback to Supabase Storage (supports photos and videos up to 50MB)
  try {
    const publicUrl = await uploadBugMedia(file, 'bug-reports');
    console.log(`[GoogleDrive:Fallback] Saved to Supabase storage: ${publicUrl}`);
    return {
      fileId: `supabase_${Date.now()}`,
      webViewLink: publicUrl,
      webContentLink: publicUrl,
      thumbnailLink: publicUrl,
      fallback: true,
    };
  } catch (fallbackErr) {
    console.error('[GoogleDrive:Fallback] Failed to upload to Supabase storage:', fallbackErr.message);
    throw new Error('Failed to upload bug media to storage');
  }
}

module.exports = {
  uploadBugMediaToDrive,
  getDriveClient,
};
