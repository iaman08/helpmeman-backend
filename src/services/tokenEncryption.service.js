/**
 * Token Encryption Service
 * Provides AES-256-GCM encryption/decryption for sensitive OAuth tokens.
 * Uses TOKEN_ENCRYPTION_KEY from env (32-byte hex string = 64 hex chars).
 *
 * Generate a key: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
 */

const crypto = require('crypto');
const config = require('../config/env');

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;   // 96 bits — recommended for GCM
const TAG_LENGTH = 16;  // 128-bit auth tag

function getKey() {
  const hexKey = config.tokenEncryption?.key;
  if (!hexKey || hexKey.length !== 64) {
    throw new Error(
      '[tokenEncryption] TOKEN_ENCRYPTION_KEY must be a 64-character hex string. ' +
      'Generate one: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"'
    );
  }
  return Buffer.from(hexKey, 'hex');
}

/**
 * Encrypt a plaintext string.
 * Returns a colon-separated string: iv:authTag:ciphertext (all hex encoded).
 */
function encrypt(plaintext) {
  if (!plaintext) return null;
  const key = getKey();
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv, { authTagLength: TAG_LENGTH });

  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();

  // Format: iv:tag:ciphertext (hex)
  return `${iv.toString('hex')}:${tag.toString('hex')}:${encrypted.toString('hex')}`;
}

/**
 * Decrypt an encrypted string produced by encrypt().
 * Returns the original plaintext or null on failure.
 */
function decrypt(encryptedStr) {
  if (!encryptedStr) return null;
  try {
    const key = getKey();
    const parts = encryptedStr.split(':');
    if (parts.length !== 3) throw new Error('Invalid encrypted format');

    const [ivHex, tagHex, dataHex] = parts;
    const iv = Buffer.from(ivHex, 'hex');
    const tag = Buffer.from(tagHex, 'hex');
    const data = Buffer.from(dataHex, 'hex');

    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv, { authTagLength: TAG_LENGTH });
    decipher.setAuthTag(tag);

    const decrypted = Buffer.concat([decipher.update(data), decipher.final()]);
    return decrypted.toString('utf8');
  } catch (error) {
    console.error('[tokenEncryption] Decryption failed:', error.message);
    return null;
  }
}

module.exports = { encrypt, decrypt };
