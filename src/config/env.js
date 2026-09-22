require('dotenv').config();

function required(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

module.exports = {
  nodeEnv: process.env.NODE_ENV || 'development',
  port: Number(process.env.PORT) || 4000,

  mongodbUri: process.env.MONGODB_URI, // validated by connectDB itself

  jwt: {
    accessSecret: process.env.JWT_ACCESS_SECRET,
    refreshSecret: process.env.JWT_REFRESH_SECRET,
    accessTtl: process.env.JWT_ACCESS_TTL || '15m',
    refreshTtl: process.env.JWT_REFRESH_TTL || '7d',
  },

  google: {
    clientId: process.env.GOOGLE_CLIENT_ID,
  },

  mail: {
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT) || 587,
    user: process.env.SMTP_USER,
    password: process.env.SMTP_PASSWORD,
    fromAddress: process.env.MAIL_FROM || 'no-reply@workzen.app',
  },

  clientUrl: process.env.CLIENT_URL || 'http://localhost:3000',

  cloudinary: {
    cloudName: process.env.CLOUDINARY_CLOUD_NAME,
    apiKey: process.env.CLOUDINARY_API_KEY,
    apiSecret: process.env.CLOUDINARY_API_SECRET,
  },

  upload: {
    maxImageBytes: Number(process.env.MAX_IMAGE_UPLOAD_BYTES) || 5 * 1024 * 1024,
  },

  tokenExpiry: {
    emailVerificationHours: 24,
    passwordResetMinutes: 60,
  },

  required, // exported so server.js can assert secrets exist before boot
};
