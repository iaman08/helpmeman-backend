require('dotenv').config();

module.exports = {
  nodeEnv: process.env.NODE_ENV || 'development',
  port: parseInt(process.env.PORT, 10) || 3001,
  frontendUrl: process.env.FRONTEND_URL || 'http://localhost:3000',
  jwtSecret: process.env.JWT_SECRET,
  jwtRefreshSecret: process.env.JWT_REFRESH_SECRET,
  database: {
    url: process.env.DATABASE_URL,
  },
  smtp: {
    host: process.env.SMTP_HOST || process.env.BREVO_SMTP_HOST,
    port: parseInt(process.env.SMTP_PORT || process.env.BREVO_SMTP_PORT, 10) || 587,
    user: process.env.SMTP_USER || process.env.BREVO_SMTP_USER,
    pass: process.env.SMTP_PASS || process.env.BREVO_SMTP_PASS,
    fromEmail: process.env.FROM_EMAIL || process.env.BREVO_FROM_EMAIL || 'noreply@helpmeman.com',
  },
  brevo: {
    apiKey: process.env.BREVO_API_KEY,
    fromEmail: process.env.BREVO_FROM_EMAIL || process.env.FROM_EMAIL || 'noreply@helpmeman.com',
  },
  google: {
    clientId: process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    redirectUri: process.env.GOOGLE_REDIRECT_URI,
    refreshToken: process.env.GOOGLE_REFRESH_TOKEN,
  },
  razorpay: {
    keyId: process.env.RAZORPAY_KEY_ID,
    keySecret: process.env.RAZORPAY_KEY_SECRET,
    webhookSecret: process.env.RAZORPAY_WEBHOOK_SECRET,
  },
  supabase: {
    url: process.env.SUPABASE_URL,
    serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY,
    bucketName: process.env.SUPABASE_STORAGE_BUCKET || 'helpmeman',
  },
  redis: {
    url: process.env.REDIS_URL || 'redis://localhost:6379',
  },
  admin: {
    email: process.env.ADMIN_EMAIL,
    notificationEmail: process.env.ADMIN_NOTIFICATION_EMAIL,
  },
  platformFeePercent: parseInt(process.env.PLATFORM_FEE_PERCENT, 10) || 20,
  groq: {
    apiKey: process.env.GROQ_API_KEY,
  },
  upstash: {
    url: process.env.UPSTASH_REDIS_REST_URL,
    token: process.env.UPSTASH_REDIS_REST_TOKEN,
  },
  resend: {
    apiKey: process.env.RESEND_API_KEY,
  },
  gmail: {
    user: process.env.GMAIL_USER,
    appPassword: process.env.GMAIL_APP_PASSWORD,
  },
  // AES-256-GCM key for encrypting OAuth tokens in the DB
  // Generate: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
  tokenEncryption: {
    key: process.env.TOKEN_ENCRYPTION_KEY,
  },
  // Web Push (VAPID) — replaces Firebase Cloud Messaging
  // Generate keys once with: npx web-push generate-vapid-keys
  vapid: {
    publicKey: process.env.VAPID_PUBLIC_KEY,
    privateKey: process.env.VAPID_PRIVATE_KEY,
    subject: process.env.VAPID_SUBJECT || 'mailto:noreply@helpmeman.com',
  },
};
