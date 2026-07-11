const multer = require('multer');
const { uploadImage, uploadDocument } = require('../services/upload.service');

// Store in memory for Supabase upload
const storage = multer.memoryStorage();

const ALLOWED_MIME_TYPES = [
  'image/jpeg', 'image/png', 'image/webp', 'image/gif',
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/zip',
  'application/x-zip-compressed',
  'text/plain',
];

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB

const upload = multer({
  storage,
  limits: { fileSize: MAX_FILE_SIZE, files: 5 },
  fileFilter: (_req, file, cb) => {
    if (ALLOWED_MIME_TYPES.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error(`File type not allowed: ${file.mimetype}`));
    }
  },
});

const IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);

async function uploadAttachment(req, res) {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

    const file = req.file;
    const isImage = IMAGE_TYPES.has(file.mimetype);

    const url = isImage
      ? await uploadImage(file, 'chat-attachments')
      : await uploadDocument(file, 'chat-attachments');

    res.json({
      attachment: {
        url,
        name: file.originalname,
        type: file.mimetype,
        size: file.size,
        isImage,
      },
    });
  } catch (e) {
    console.error('[CHAT UPLOAD] error:', e.message);
    if (e.message.includes('File too large')) {
      return res.status(413).json({ error: 'File too large (max 10MB)' });
    }
    res.status(500).json({ error: e.message || 'Upload failed' });
  }
}

module.exports = { upload, uploadAttachment };
