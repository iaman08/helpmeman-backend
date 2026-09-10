const crypto = require('crypto');
const config = require('../config/env');

const CAPTCHA_CHARS = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
const CAPTCHA_EXPIRY_MS = 5 * 60 * 1000; // 5 minutes
const SECRET = config.jwtSecret || 'helpmeman-captcha-fallback-secret-2026';

/**
 * Generate a random alphanumeric CAPTCHA code.
 */
function randomCode(length = 4) {
  let code = '';
  const bytes = crypto.randomBytes(length);
  for (let i = 0; i < length; i++) {
    code += CAPTCHA_CHARS[bytes[i] % CAPTCHA_CHARS.length];
  }
  return code;
}

/**
 * Generate SVG markup for the CAPTCHA image.
 */
function renderSvg(code) {
  const width = 130;
  const height = 40;
  const charWidth = width / (code.length + 1);

  // Random noise dots
  let noiseDots = '';
  for (let i = 0; i < 24; i++) {
    const cx = Math.floor(Math.random() * width);
    const cy = Math.floor(Math.random() * height);
    const r = (Math.random() * 1.5 + 0.5).toFixed(1);
    const opacity = (Math.random() * 0.4 + 0.15).toFixed(2);
    noiseDots += `<circle cx="${cx}" cy="${cy}" r="${r}" fill="currentColor" opacity="${opacity}" />`;
  }

  // Random wavy interference curves
  const y1 = Math.floor(Math.random() * 20 + 10);
  const y2 = Math.floor(Math.random() * 20 + 10);
  const y3 = Math.floor(Math.random() * 20 + 10);
  const path1 = `<path d="M 0 ${y1} Q ${width / 2} ${y2}, ${width} ${y3}" stroke="currentColor" stroke-width="1.2" fill="none" opacity="0.35" />`;

  const y4 = Math.floor(Math.random() * 20 + 10);
  const y5 = Math.floor(Math.random() * 20 + 10);
  const y6 = Math.floor(Math.random() * 20 + 10);
  const path2 = `<path d="M 0 ${y4} Q ${width / 3} ${y5}, ${width} ${y6}" stroke="currentColor" stroke-width="1" fill="none" opacity="0.25" stroke-dasharray="3,3" />`;

  // Render individual rotated and shifted glyphs
  const glyphs = code
    .split('')
    .map((char, index) => {
      const x = (index + 0.7) * charWidth + (Math.random() * 4 - 2);
      const y = height / 2 + (Math.random() * 4 - 2) + 5;
      const rotate = Math.floor(Math.random() * 26 - 13); // -13 to +13 deg
      const fontSize = Math.floor(Math.random() * 4 + 20); // 20-24px

      return `<text
        x="${x.toFixed(1)}"
        y="${y.toFixed(1)}"
        font-family="system-ui, -apple-system, sans-serif"
        font-size="${fontSize}"
        font-weight="700"
        letter-spacing="2"
        fill="currentColor"
        transform="rotate(${rotate}, ${x.toFixed(1)}, ${y.toFixed(1)})"
        text-anchor="middle"
        dominant-baseline="central"
      >${char}</text>`;
    })
    .join('');

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" style="user-select:none;display:block;">
    <rect width="${width}" height="${height}" fill="transparent" />
    ${noiseDots}
    ${path1}
    ${path2}
    ${glyphs}
  </svg>`;
}

/**
 * Sign an answer with HMAC-SHA256 to create a stateless captchaId.
 */
function signToken(code, expiresAt, salt) {
  return crypto
    .createHmac('sha256', SECRET)
    .update(`${code.toUpperCase()}:${expiresAt}:${salt}`)
    .digest('hex');
}

/**
 * Generate a new CAPTCHA challenge.
 */
function generateCaptcha() {
  const code = randomCode(4);
  const expiresAt = Date.now() + CAPTCHA_EXPIRY_MS;
  const salt = crypto.randomBytes(8).toString('hex');
  const signature = signToken(code, expiresAt, salt);

  const tokenPayload = `${expiresAt}:${salt}:${signature}`;
  const captchaId = Buffer.from(tokenPayload).toString('base64url');
  const svg = renderSvg(code);

  return {
    captchaId,
    svg,
    expiresAt,
  };
}

/**
 * Verify a submitted CAPTCHA answer.
 */
function verifyCaptcha(captchaId, candidateAnswer) {
  if (!captchaId || typeof captchaId !== 'string') {
    return { valid: false, reason: 'CAPTCHA verification code is required.' };
  }

  if (!candidateAnswer || typeof candidateAnswer !== 'string') {
    return { valid: false, reason: 'Please enter the 4-character verification code shown.' };
  }

  let tokenPayload = '';
  try {
    tokenPayload = Buffer.from(captchaId, 'base64url').toString('utf-8');
  } catch {
    return { valid: false, reason: 'Invalid CAPTCHA token format.' };
  }

  const parts = tokenPayload.split(':');
  if (parts.length !== 3) {
    return { valid: false, reason: 'Malformed CAPTCHA challenge.' };
  }

  const [expiresAtStr, salt, expectedSig] = parts;
  const expiresAt = parseInt(expiresAtStr, 10);

  if (isNaN(expiresAt) || Date.now() > expiresAt) {
    return { valid: false, reason: 'Verification code expired. Please click refresh and try again.' };
  }

  const cleanAnswer = candidateAnswer.trim().toUpperCase();
  const actualSig = signToken(cleanAnswer, expiresAt, salt);

  // Constant-time buffer comparison to prevent timing attacks
  const expectedBuf = Buffer.from(expectedSig, 'hex');
  const actualBuf = Buffer.from(actualSig, 'hex');

  if (expectedBuf.length !== actualBuf.length || !crypto.timingSafeEqual(expectedBuf, actualBuf)) {
    return { valid: false, reason: 'Incorrect verification code. Please check the characters and try again.' };
  }

  return { valid: true };
}

module.exports = {
  generateCaptcha,
  verifyCaptcha,
};
