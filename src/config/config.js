'use strict';

require('dotenv').config();

const config = {
  port: parseInt(process.env.PORT || '3000', 10),
  nodeEnv: process.env.NODE_ENV || 'development',
  mongoUri: process.env.MONGODB_URI || 'mongodb+srv://savitaselote2_db_user:6mfCvZEn9Q6VwO54@gdg.hkjz12r.mongodb.net/spider-sense?retryWrites=true&w=majority&appName=GDG',
  jwtSecret: process.env.JWT_SECRET || 'spider-sense-secret-key-7days-2026-superhero',
  jwtExpiresIn: process.env.JWT_ACCESS_EXPIRE || '7d',
  bcryptSaltRounds: parseInt(process.env.BCRYPT_SALT_ROUNDS || '10', 10),
  otpHashSecret: process.env.OTP_HASH_SECRET || 'spider-sense-otp-hmac-secret-2026',
  heroEmails: (process.env.HERO_EMAILS || process.env.ADMIN_EMAILS || 'selotechaitanya09@gmail.com,admin@spidersense.nyc,spiderman@nyc.gov,peter@dailybugle.com')
    .split(',')
    .map(e => e.trim().toLowerCase())
    .filter(Boolean),
  resendApiKey: process.env.RESEND_API_KEY || '',
  emailFrom: process.env.EMAIL_FROM || 'Spider-Sense Dispatch <onboarding@resend.dev>',
  emailUser: process.env.EMAIL_USER || '',
  emailPass: (process.env.EMAIL_PASS || '').replace(/\s+/g, '')
};

module.exports = config;
