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
    host: process.env.SMTP_HOST,
    port: parseInt(process.env.SMTP_PORT, 10) || 587,
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
    fromEmail: process.env.FROM_EMAIL || 'noreply@helpmeman.com',
  },
  resend: {
    apiKey: process.env.RESEND_API_KEY || process.env.SMTP_PASS,
    fromEmail: process.env.FROM_EMAIL || 'onboarding@resend.dev',
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
  cloudinary: {
    cloudName: process.env.CLOUDINARY_CLOUD_NAME,
    apiKey: process.env.CLOUDINARY_API_KEY,
    apiSecret: process.env.CLOUDINARY_API_SECRET,
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
};
