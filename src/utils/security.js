'use strict';

const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const config = require('../config/config');

/**
 * Generate a cryptographically secure 6-digit random OTP
 */
const generateOtp = () => {
  return crypto.randomInt(100000, 1000000).toString();
};

/**
 * Hash an OTP using HMAC-SHA256 bound to normalized email and server secret.
 * Plaintext OTP is NEVER stored in the database.
 */
const hashOtp = (email, otp) => {
  const secret = config.otpHashSecret;
  const normalized = email.toLowerCase().trim();
  const cleanOtp = otp.toString().trim();
  return crypto.createHmac('sha256', secret).update(`${normalized}:${cleanOtp}`).digest('hex');
};

/**
 * Generate a cryptographically secure random refresh token string
 */
const generateRefreshToken = () => {
  return crypto.randomBytes(40).toString('hex');
};

/**
 * Hash a refresh token using SHA-256 for safe database storage
 */
const hashRefreshToken = (token) => {
  return crypto.createHash('sha256').update(token.trim()).digest('hex');
};

/**
 * Generate 7-day JWT access token (so once logged in, you don't need to log in again for 7 days)
 */
const generateAccessToken = (user) => {
  const secret = config.jwtSecret;
  const isHero = isAuthorizedHeroEmail(user.email) || user.role === 'Hero';
  const role = isHero ? 'Hero' : (user.role || 'Citizen');

  return jwt.sign(
    {
      id: user._id.toString(),
      userId: user._id.toString(),
      email: user.email,
      name: user.name,
      role: role,
      isHero: isHero
    },
    secret,
    {
      expiresIn: config.jwtExpiresIn || '7d',
      subject: user._id.toString(),
      issuer: 'spider-sense-network',
      audience: 'spider-sense-client'
    }
  );
};

/**
 * Check if an email address is authorized as a Hero/Admin in the system allowlist
 */
const isAuthorizedHeroEmail = (email) => {
  if (!email || typeof email !== 'string') return false;
  const cleanEmail = email.toLowerCase().trim();
  return config.heroEmails.includes(cleanEmail);
};

module.exports = {
  generateOtp,
  hashOtp,
  generateRefreshToken,
  hashRefreshToken,
  generateAccessToken,
  isAuthorizedHeroEmail
};

