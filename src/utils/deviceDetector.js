/**
 * Device & Client Security Detector Utility
 *
 * Extracts detailed device, browser, operating system, and IP intelligence
 * from HTTP requests to identify clients and flag suspicious or unauthorized access.
 */

/**
 * Extract clean client IP address supporting CDNs and reverse proxies.
 *
 * @param {import('express').Request} req
 * @returns {string} Normalized IP address
 */
function getClientIp(req) {
  if (!req) return 'unknown';

  const cfConnectingIp = req.headers?.['cf-connecting-ip'];
  if (cfConnectingIp) return cfConnectingIp.trim();

  const xRealIp = req.headers?.['x-real-ip'];
  if (xRealIp) return xRealIp.trim();

  const forwarded = req.headers?.['x-forwarded-for'];
  if (forwarded) {
    const firstIp = forwarded.split(',')[0].trim();
    if (firstIp) return firstIp;
  }

  const rawIp = req.connection?.remoteAddress || req.socket?.remoteAddress || req.ip || 'unknown';
  
  // Clean IPv6 mapped IPv4 localhost
  if (rawIp === '::1' || rawIp === '::ffff:127.0.0.1') {
    return '127.0.0.1';
  }
  if (rawIp.startsWith('::ffff:')) {
    return rawIp.replace('::ffff:', '');
  }

  return rawIp;
}

/**
 * Parse user agent string and Client Hints into structured device intelligence.
 *
 * @param {string} ua - User-Agent header string
 * @param {object} [headers={}] - Optional request headers for Client Hints
 * @returns {object} { browser, browserVersion, os, osVersion, deviceType, deviceModel, isBot, botName }
 */
function parseUserAgent(ua = '', headers = {}) {
  const userAgent = (ua || '').toLowerCase();
  
  // ── Bot / Automated Scraper Detection ──
  const botPatterns = [
    { pattern: /googlebot/i, name: 'Googlebot' },
    { pattern: /bingbot/i, name: 'Bingbot' },
    { pattern: /postmanruntime/i, name: 'Postman' },
    { pattern: /insomnia/i, name: 'Insomnia' },
    { pattern: /python-requests/i, name: 'Python Requests' },
    { pattern: /python/i, name: 'Python Script' },
    { pattern: /curl/i, name: 'cURL' },
    { pattern: /wget/i, name: 'Wget' },
    { pattern: /go-http-client/i, name: 'Go HTTP Client' },
    { pattern: /node-fetch|axios|got/i, name: 'Node HTTP Client' },
    { pattern: /headlesschrome|puppeteer|playwright|selenium/i, name: 'Headless Browser / Automation' },
    { pattern: /sqlmap|nikto|nmap|masscan/i, name: 'Security Scanner' },
  ];

  for (const bot of botPatterns) {
    if (bot.pattern.test(ua)) {
      return {
        browser: bot.name,
        browserVersion: 'Bot',
        os: 'Automated Agent',
        osVersion: '',
        deviceType: 'Bot',
        deviceModel: 'Automated Script',
        isBot: true,
        botName: bot.name,
      };
    }
  }

  // ── Operating System Detection ──
  let os = 'Unknown OS';
  let osVersion = '';
  let deviceModel = 'Desktop';

  if (userAgent.includes('macintosh') || userAgent.includes('mac os x')) {
    os = 'macOS';
    deviceModel = 'Apple Mac';
    const match = ua.match(/Mac OS X ([0-9_]+)/);
    if (match) osVersion = match[1].replace(/_/g, '.');
  } else if (userAgent.includes('windows') || userAgent.includes('win32') || userAgent.includes('win64')) {
    os = 'Windows';
    deviceModel = 'PC';
    if (userAgent.includes('windows nt 10.0')) osVersion = '10/11';
    else if (userAgent.includes('windows nt 6.3')) osVersion = '8.1';
    else if (userAgent.includes('windows nt 6.1')) osVersion = '7';
  } else if (userAgent.includes('iphone')) {
    os = 'iOS';
    deviceModel = 'Apple iPhone';
    const match = ua.match(/OS ([0-9_]+) like Mac OS X/i);
    if (match) osVersion = match[1].replace(/_/g, '.');
  } else if (userAgent.includes('ipad')) {
    os = 'iPadOS';
    deviceModel = 'Apple iPad';
    const match = ua.match(/OS ([0-9_]+) like Mac OS X/i);
    if (match) osVersion = match[1].replace(/_/g, '.');
  } else if (userAgent.includes('android')) {
    os = 'Android';
    deviceModel = 'Android Device';
    const match = ua.match(/Android ([0-9.]+)/i);
    if (match) osVersion = match[1];
  } else if (userAgent.includes('cros')) {
    os = 'ChromeOS';
    deviceModel = 'Chromebook';
  } else if (userAgent.includes('linux')) {
    os = 'Linux';
    deviceModel = 'Linux Workstation';
  }

  // ── Browser Detection ──
  let browser = 'Unknown Browser';
  let browserVersion = '';

  if (userAgent.includes('edg/') || userAgent.includes('edge/')) {
    browser = 'Microsoft Edge';
    const match = ua.match(/Edg\/([0-9.]+)/i);
    if (match) browserVersion = match[1].split('.')[0];
  } else if (userAgent.includes('opr/') || userAgent.includes('opera/')) {
    browser = 'Opera';
    const match = ua.match(/OPR\/([0-9.]+)/i);
    if (match) browserVersion = match[1].split('.')[0];
  } else if (userAgent.includes('samsungbrowser/')) {
    browser = 'Samsung Internet';
    const match = ua.match(/SamsungBrowser\/([0-9.]+)/i);
    if (match) browserVersion = match[1].split('.')[0];
  } else if (userAgent.includes('chrome/') || userAgent.includes('crios/')) {
    browser = 'Google Chrome';
    const match = ua.match(/(?:Chrome|CriOS)\/([0-9.]+)/i);
    if (match) browserVersion = match[1].split('.')[0];
  } else if (userAgent.includes('firefox/') || userAgent.includes('fxios/')) {
    browser = 'Mozilla Firefox';
    const match = ua.match(/(?:Firefox|FxiOS)\/([0-9.]+)/i);
    if (match) browserVersion = match[1].split('.')[0];
  } else if (userAgent.includes('safari/') && !userAgent.includes('chrome')) {
    browser = 'Apple Safari';
    const match = ua.match(/Version\/([0-9.]+)/i);
    if (match) browserVersion = match[1].split('.')[0];
  }

  // ── Device Type Classification ──
  let deviceType = 'Desktop';
  if (headers['sec-ch-ua-mobile'] === '?1' || /mobile|iphone|ipod|android.*mobile/i.test(userAgent)) {
    deviceType = 'Mobile';
  } else if (/ipad|tablet|android(?!.*mobile)/i.test(userAgent)) {
    deviceType = 'Tablet';
  }

  return {
    browser: browserVersion ? `${browser} ${browserVersion}` : browser,
    rawBrowserName: browser,
    browserVersion,
    os: osVersion ? `${os} ${osVersion}` : os,
    rawOsName: os,
    osVersion,
    deviceType,
    deviceModel,
    isBot: false,
    botName: null,
  };
}

/**
 * Full security context extractor for incoming Express requests.
 *
 * @param {import('express').Request} req
 * @returns {object} Security Context Object
 */
function getSecurityContext(req) {
  if (!req) {
    return {
      ip: 'unknown',
      userAgent: 'unknown',
      browser: 'Unknown Browser',
      os: 'Unknown OS',
      deviceType: 'Unknown',
      deviceModel: 'Unknown',
      language: 'unknown',
      country: 'unknown',
      isSuspicious: false,
      flagReason: null,
    };
  }

  const ip = getClientIp(req);
  const rawUserAgent = req.headers['user-agent'] || 'Unknown';
  const parsed = parseUserAgent(rawUserAgent, req.headers);
  const language = req.headers['accept-language']?.split(',')[0] || 'unknown';
  const country = req.headers['cf-ipcountry'] || req.headers['x-country-code'] || null;

  // Evaluate suspicion flags
  let isSuspicious = false;
  let flagReason = null;

  if (parsed.isBot) {
    isSuspicious = true;
    flagReason = `Automated tool (${parsed.botName}) accessed route`;
  } else if (!req.headers['user-agent'] || req.headers['user-agent'].length < 5) {
    isSuspicious = true;
    flagReason = 'Missing or empty User-Agent header';
  }

  return {
    ip,
    userAgent: rawUserAgent,
    browser: parsed.browser,
    rawBrowserName: parsed.rawBrowserName,
    os: parsed.os,
    rawOsName: parsed.rawOsName,
    deviceType: parsed.deviceType,
    deviceModel: parsed.deviceModel,
    language,
    country,
    isSuspicious,
    flagReason,
  };
}

module.exports = {
  getClientIp,
  parseUserAgent,
  getSecurityContext,
};
