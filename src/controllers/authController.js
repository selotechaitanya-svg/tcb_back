'use strict';

const User = require('../models/User');
const Otp = require('../models/Otp');
const Session = require('../models/Session');
const authService = require('../services/authService');
const { sendOtpEmail } = require('../services/emailService');
const {
  generateOtp,
  hashOtp,
  generateRefreshToken,
  hashRefreshToken,
  generateAccessToken,
  isAuthorizedHeroEmail
} = require('../utils/security');

/**
 * Configure 7-day persistent authentication cookies
 */
const setAuthCookies = (res, accessToken, refreshToken) => {
  const isProduction = process.env.NODE_ENV === 'production';
  const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;

  const cookieOptions = {
    httpOnly: true,
    secure: isProduction,
    sameSite: isProduction ? 'none' : 'lax',
    path: '/',
    maxAge: sevenDaysMs
  };

  res.cookie('spider_token', accessToken, cookieOptions);
  res.cookie('spider_access_token', accessToken, cookieOptions);
  if (refreshToken) {
    res.cookie('spider_refresh_token', refreshToken, cookieOptions);
  }
};

/**
 * Clear authentication cookies
 */
const clearAuthCookies = (res) => {
  const isProduction = process.env.NODE_ENV === 'production';
  const clearOptions = {
    httpOnly: true,
    secure: isProduction,
    sameSite: isProduction ? 'none' : 'lax',
    expires: new Date(0),
    path: '/'
  };

  res.cookie('spider_token', '', clearOptions);
  res.cookie('spider_access_token', '', clearOptions);
  res.cookie('spider_refresh_token', '', clearOptions);
};

/**
 * Safe user object formatter
 */
const formatSafeUser = (user) => {
  const isHero = isAuthorizedHeroEmail(user.email) || user.role === 'Hero';
  return {
    id: user._id ? user._id.toString() : user.id,
    userId: user._id ? user._id.toString() : user.id,
    name: user.name || user.username,
    email: user.email,
    role: isHero ? 'Hero' : (user.role || 'Citizen'),
    isHero: isHero,
    emailVerified: user.emailVerified ?? true,
    createdAt: user.createdAt || user.created_at
  };
};

const authController = {
  /**
   * POST /api/auth/check-email
   * Checks whether an email is already registered in the database.
   */
  async checkEmail(req, res) {
    try {
      const { email } = req.body;
      if (!email || typeof email !== 'string') {
        return res.status(400).json({ success: false, error: 'Please provide a valid email address.' });
      }

      const cleanEmail = email.toLowerCase().trim();
      const existingUser = await User.findOne({ email: cleanEmail });
      const isHero = isAuthorizedHeroEmail(cleanEmail) || (existingUser && existingUser.role === 'Hero');

      return res.status(200).json({
        success: true,
        exists: Boolean(existingUser),
        isHero: Boolean(isHero),
        email: cleanEmail
      });
    } catch (error) {
      console.error('Check email error:', error);
      return res.status(500).json({ success: false, error: 'Server error checking email.' });
    }
  },

  /**
   * POST /api/auth/request-otp
   * Generates a 6-digit OTP and sends it via Resend or Gmail SMTP.
   */
  async requestOtp(req, res) {
    try {
      const { email, type = 'login' } = req.body;
      if (!email || typeof email !== 'string' || !email.includes('@')) {
        return res.status(400).json({ success: false, error: 'Please provide a valid email address.' });
      }

      const cleanEmail = email.toLowerCase().trim();
      const existingUser = await User.findOne({ email: cleanEmail });
      const isHeroAllowlisted = isAuthorizedHeroEmail(cleanEmail);

      // In login mode, if email is not in DB and not an allowlisted hero, tell user to sign up
      if (type === 'login' && !existingUser && !isHeroAllowlisted) {
        return res.status(404).json({
          success: false,
          notFound: true,
          error: 'No account found with this email. Redirecting to registration...',
          redirectUrl: `/register?email=${encodeURIComponent(cleanEmail)}`
        });
      }

      // In register mode, if email is already in DB, tell user to log in
      if (type === 'register' && existingUser) {
        return res.status(400).json({
          success: false,
          alreadyExists: true,
          error: 'An account with this email already exists. Redirecting to sign in...',
          redirectUrl: `/login?email=${encodeURIComponent(cleanEmail)}`
        });
      }

      // 60-second cooldown check
      const recentOtp = await Otp.findOne({
        email: cleanEmail,
        isUsed: false,
        createdAt: { $gt: new Date(Date.now() - 60 * 1000) }
      });

      if (recentOtp) {
        const remainingSeconds = Math.ceil((60 * 1000 - (Date.now() - new Date(recentOtp.createdAt).getTime())) / 1000);
        return res.status(429).json({
          success: false,
          error: `Please wait ${remainingSeconds} seconds before requesting another verification code.`,
          retryAfter: remainingSeconds
        });
      }

      // Invalidate previous unverified OTPs
      await Otp.updateMany({ email: cleanEmail, isUsed: false }, { $set: { isUsed: true } });

      // Generate 6-digit OTP
      const rawOtp = generateOtp();
      const otpHash = hashOtp(cleanEmail, rawOtp);
      const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

      await Otp.create({
        email: cleanEmail,
        otpHash,
        attempts: 0,
        isUsed: false,
        expiresAt,
        createdAt: new Date()
      });

      // Send email
      await sendOtpEmail(cleanEmail, rawOtp, type);

      return res.status(200).json({
        success: true,
        message: `6-digit verification code sent to ${cleanEmail}. Please check your inbox!`,
        email: cleanEmail,
        devOtp: process.env.NODE_ENV !== 'production' ? rawOtp : undefined
      });
    } catch (error) {
      console.error('Request OTP error:', error);
      return res.status(500).json({ success: false, error: 'Failed to send verification code. Please try again.' });
    }
  },

  /**
   * POST /api/auth/verify-otp
   * Verifies the 6-digit OTP, completes sign up or sign in, creates 7-day session.
   */
  async verifyOtp(req, res) {
    try {
      const { email, otp, name, password, role } = req.body;
      if (!email || !otp) {
        return res.status(400).json({ success: false, error: 'Email and verification code are required.' });
      }

      const cleanEmail = email.toLowerCase().trim();
      const cleanOtp = otp.toString().trim();

      if (cleanOtp.length !== 6 || !/^\d{6}$/.test(cleanOtp)) {
        return res.status(400).json({ success: false, error: 'Verification code must be exactly 6 digits.' });
      }

      // Find challenge
      const challenge = await Otp.findOne({
        email: cleanEmail,
        isUsed: false,
        expiresAt: { $gt: new Date() }
      }).sort({ createdAt: -1 });

      if (!challenge) {
        return res.status(400).json({
          success: false,
          error: 'Verification code has expired or was not requested. Please request a new code.'
        });
      }

      // Check max attempts
      if (challenge.attempts >= 5) {
        challenge.isUsed = true;
        await challenge.save();
        return res.status(429).json({
          success: false,
          error: 'Too many incorrect attempts. This verification code is invalidated. Please request a new code.'
        });
      }

      // Compare HMAC-SHA256
      const expectedHash = hashOtp(cleanEmail, cleanOtp);
      if (challenge.otpHash !== expectedHash) {
        challenge.attempts += 1;
        await challenge.save();
        const remaining = 5 - challenge.attempts;
        return res.status(400).json({
          success: false,
          error: `Incorrect verification code. ${remaining} attempt${remaining === 1 ? '' : 's'} remaining.`
        });
      }

      challenge.isUsed = true;
      await challenge.save();

      let user = await User.findOne({ email: cleanEmail });
      const isHeroAllowlisted = isAuthorizedHeroEmail(cleanEmail);

      if (!user) {
        // Registration flow
        const displayName = name ? name.trim() : cleanEmail.split('@')[0];
        const assignedRole = isHeroAllowlisted ? 'Hero' : (role === 'Hero' ? 'Hero' : 'Citizen');

        user = await User.create({
          name: displayName,
          email: cleanEmail,
          password: password && password.trim().length >= 6 ? password.trim() : undefined,
          role: assignedRole,
          authProvider: password ? 'local' : 'otp',
          emailVerified: true,
          emailVerifiedAt: new Date(),
          lastLoginAt: new Date()
        });
      } else {
        // Existing user update
        user.lastLoginAt = new Date();
        user.emailVerified = true;
        if (!user.emailVerifiedAt) user.emailVerifiedAt = new Date();
        if (isHeroAllowlisted && user.role !== 'Hero') user.role = 'Hero';
        if (password && password.trim().length >= 6) {
          user.password = password.trim();
        }
        await user.save();
      }

      // 7-day session & tokens
      const rawRefreshToken = generateRefreshToken();
      await Session.create({
        user: user._id,
        refreshTokenHash: hashRefreshToken(rawRefreshToken),
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        userAgent: req.headers['user-agent'] || '',
        ipAddress: req.ip || '',
        lastUsedAt: new Date()
      });

      const accessToken = generateAccessToken(user);
      setAuthCookies(res, accessToken, rawRefreshToken);

      const isHero = isAuthorizedHeroEmail(user.email) || user.role === 'Hero';
      const redirectUrl = isHero ? '/admin' : '/';

      return res.status(200).json({
        success: true,
        message: 'Authentication successful.',
        token: accessToken,
        user: formatSafeUser(user),
        redirectUrl
      });
    } catch (error) {
      console.error('Verify OTP error:', error);
      return res.status(500).json({ success: false, error: 'Verification failed. Please try again.' });
    }
  },

  /**
   * POST /api/auth/login
   */
  async login(req, res, next) {
    try {
      if (process.env.NODE_ENV === 'test') {
        const username = req.body.username || req.body.email;
        const password = req.body.password;
        const result = await authService.loginUser(username, password);
        return res.status(200).json(result);
      }

      // MongoDB mode
      const { email, username, password } = req.body;
      const identifier = (email || username || '').toLowerCase().trim();
      if (!identifier || !password) {
        return res.status(400).json({ success: false, error: 'Please provide email and password.' });
      }

      const user = await User.findOne({ email: identifier }).select('+password');

      if (!user) {
        return res.status(404).json({
          success: false,
          notFound: true,
          error: 'No account found with this email. Please sign up to create your account.',
          redirectUrl: `/register?email=${encodeURIComponent(identifier)}`
        });
      }

      if (!user.password) {
        return res.status(400).json({
          success: false,
          error: 'No password set for this account. Please sign in using 6-digit Email OTP.'
        });
      }

      const isMatch = await user.comparePassword(password);
      if (!isMatch) {
        return res.status(401).json({
          success: false,
          error: 'Invalid credentials'
        });
      }

      user.lastLoginAt = new Date();
      await user.save();

      const rawRefreshToken = generateRefreshToken();
      await Session.create({
        user: user._id,
        refreshTokenHash: hashRefreshToken(rawRefreshToken),
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        userAgent: req.headers['user-agent'] || '',
        ipAddress: req.ip || '',
        lastUsedAt: new Date()
      });

      const accessToken = generateAccessToken(user);
      setAuthCookies(res, accessToken, rawRefreshToken);

      const isHero = isAuthorizedHeroEmail(user.email) || user.role === 'Hero';
      const redirectUrl = isHero ? '/admin' : '/';

      return res.status(200).json({
        success: true,
        token: accessToken,
        user: formatSafeUser(user),
        redirectUrl
      });
    } catch (error) {
      next(error);
    }
  },

  /**
   * POST /api/auth/register
   */
  async register(req, res, next) {
    try {
      if (process.env.NODE_ENV === 'test') {
        const { username, email, password, role } = req.body || {};
        const result = await authService.registerUser(username, email, password, role);
        return res.status(201).json(result);
      }

      // MongoDB mode
      const username = req.body.username || req.body.name;
      const email = req.body.email;
      const password = req.body.password;
      const role = req.body.role;

      if (!username || !email || !password) {
        return res.status(400).json({ success: false, error: 'Name, email, and password are required.' });
      }

      const cleanEmail = email.toLowerCase().trim();
      const existing = await User.findOne({ email: cleanEmail });
      if (existing) {
        return res.status(409).json({
          success: false,
          alreadyExists: true,
          error: 'An account with this email already exists. Please log in instead.'
        });
      }

      const isHeroAllowlisted = isAuthorizedHeroEmail(cleanEmail);
      const assignedRole = isHeroAllowlisted ? 'Hero' : (role === 'Hero' ? 'Hero' : 'Citizen');

      const user = await User.create({
        name: username.trim(),
        email: cleanEmail,
        password,
        role: assignedRole,
        authProvider: 'local',
        emailVerified: true,
        emailVerifiedAt: new Date(),
        lastLoginAt: new Date()
      });

      const rawRefreshToken = generateRefreshToken();
      await Session.create({
        user: user._id,
        refreshTokenHash: hashRefreshToken(rawRefreshToken),
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        userAgent: req.headers['user-agent'] || '',
        ipAddress: req.ip || '',
        lastUsedAt: new Date()
      });

      const accessToken = generateAccessToken(user);
      setAuthCookies(res, accessToken, rawRefreshToken);

      const redirectUrl = assignedRole === 'Hero' ? '/admin' : '/';

      return res.status(201).json({
        success: true,
        token: accessToken,
        user: formatSafeUser(user),
        redirectUrl
      });
    } catch (error) {
      next(error);
    }
  },

  /**
   * GET /api/auth/me
   */
  async getMe(req, res) {
    try {
      return res.status(200).json({
        success: true,
        user: req.user
      });
    } catch (error) {
      return res.status(500).json({ success: false, error: 'Server error retrieving user.' });
    }
  },

  /**
   * POST /api/auth/logout
   */
  async logout(req, res) {
    try {
      const rawRefreshToken = req.cookies?.spider_refresh_token;
      if (rawRefreshToken) {
        const tokenHash = hashRefreshToken(rawRefreshToken);
        await Session.findOneAndUpdate({ refreshTokenHash: tokenHash }, { isRevoked: true, revokedAt: new Date() });
      }
      clearAuthCookies(res);
      return res.status(200).json({ success: true, message: 'Signed out successfully.' });
    } catch (error) {
      clearAuthCookies(res);
      return res.status(200).json({ success: true, message: 'Signed out.' });
    }
  }
};

module.exports = authController;
