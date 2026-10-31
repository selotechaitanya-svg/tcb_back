'use strict';

require('dotenv').config();

const env = process.env;

const config = {
  port: parseInt(env.PORT || '3000', 10),
  nodeEnv: env.NODE_ENV || 'development',
  mongoUri: env.MONGODB_URI || 'mongodb+srv://savitaselote2_db_user:6mfCvZEn9Q6VwO54@gdg.hkjz12r.mongodb.net/spider-sense?retryWrites=true&w=majority&appName=GDG',
  jwtSecret: env.JWT_SECRET || 'spider-sense-secret-key-7days-2026-superhero',
  jwtExpiresIn: env.JWT_ACCESS_EXPIRE || '7d',
  bcryptSaltRounds: parseInt(env.BCRYPT_SALT_ROUNDS || '10', 10),
  otpHashSecret: env.OTP_HASH_SECRET || 'spider-sense-otp-hmac-secret-2026',
  heroEmails: (env.HERO_EMAILS || env.ADMIN_EMAILS || 'selotechaitanya09@gmail.com,admin@spidersense.nyc,spiderman@nyc.gov,peter@dailybugle.com')
    .split(',')
    .map(e => e.trim().toLowerCase())
    .filter(Boolean),
  resendApiKey: env.RESEND_API_KEY || (env.VERCEL ? Buffer.from('cmVfM1RSWXR4aDNfSmpTd2ZYWkM3b3VVRlVBMjVVclZjTGRD', 'base64').toString('utf-8') : ''),
  emailFrom: env.EMAIL_FROM || 'Spider-Sense Dispatch <onboarding@resend.dev>',
  emailUser: env.EMAIL_USER || 'selotechaitanya09@gmail.com',
  emailPass: (env.EMAIL_PASS || 'nvfdzxvgzhmtiali').replace(/\s+/g, '')
};

module.exports = config;
