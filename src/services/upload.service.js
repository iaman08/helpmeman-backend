const { createClient } = require('@supabase/supabase-js');
const config = require('../config/env');

const supabase = createClient(config.supabase.url, config.supabase.serviceRoleKey);
const bucketName = config.supabase.bucketName || 'helpmeman';

const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
const ALLOWED_DOC_TYPES = [
  ...ALLOWED_IMAGE_TYPES,
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/zip',
  'application/x-zip-compressed',
  'text/plain',
];
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB

function validateFile(file, allowedTypes = ALLOWED_IMAGE_TYPES) {
  if (!file) throw new Error('No file provided');
  if (file.size > MAX_FILE_SIZE) throw new Error('File too large (max 5MB)');
  if (!allowedTypes.includes(file.mimetype)) {
    throw new Error(`Invalid file type. Allowed: ${allowedTypes.join(', ')}`);
  }
}

async function uploadFileToSupabase(file, folder) {
  const rawExt = file.originalname ? file.originalname.split('.').pop() : 'bin';
  const fileExt = (rawExt || 'bin').replace(/[^a-zA-Z0-9]/g, '').toLowerCase() || 'bin';
  const fileName = `${folder}/${Date.now()}-${Math.random().toString(36).substring(2, 9)}.${fileExt}`;
  
  const { data, error } = await supabase.storage
    .from(bucketName)
    .upload(fileName, file.buffer, {
      contentType: file.mimetype,
      upsert: true,
    });

  if (error) {
    throw error;
  }

  const { data: urlData } = supabase.storage
    .from(bucketName)
    .getPublicUrl(fileName);

  return urlData.publicUrl;
}

async function uploadImage(file, folder = 'avatars') {
  validateFile(file, ALLOWED_IMAGE_TYPES);
  return uploadFileToSupabase(file, folder);
}

async function uploadDocument(file, folder = 'docs') {
  validateFile(file, ALLOWED_DOC_TYPES);
  return uploadFileToSupabase(file, folder);
}

async function deleteFile(fileUrl) {
  try {
    if (!fileUrl) return;
    const urlParts = fileUrl.split(`/storage/v1/object/public/${bucketName}/`);
    if (urlParts.length < 2) return;
    const filePath = urlParts[1];
    await supabase.storage.from(bucketName).remove([filePath]);
  } catch (error) {
    console.error('Failed to delete file from Supabase Storage:', error);
  }
}

module.exports = { uploadImage, uploadDocument, deleteFile, validateFile };
