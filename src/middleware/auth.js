'use strict';

const jwt = require('jsonwebtoken');
const config = require('../config/config');

/**
 * Protect routes - verify 7-day JWT access token
 * Checks Authorization header first, then cookies.
 */
const authenticate = async (req, res, next) => {
  let token = null;

  const authHeader = req.headers.authorization;

  // 1. Explicit Authorization Header check
  if (authHeader !== undefined) {
    if (typeof authHeader !== 'string' || !authHeader.trim()) {
      return res.status(401).json({
        success: false,
        error: 'Authentication token is required. Authorization header cannot be empty.'
      });
    }

    const parts = authHeader.trim().split(/\s+/);
    if (parts[0] !== 'Bearer') {
      return res.status(401).json({
        success: false,
        error: 'Authorization header scheme must be Bearer.'
      });
    }

    if (parts.length !== 2 || !parts[1] || !parts[1].trim()) {
      return res.status(401).json({
        success: false,
        error: 'Invalid Authorization header format. Expected Bearer <token>.'
      });
    }

    token = parts[1].trim();
  } else if (req.cookies) {
    // 2. Cookie fallback for persistent web sessions
    token = req.cookies.spider_token || req.cookies.spider_access_token || req.cookies.gdg_token;
  }

  if (!token) {
    return res.status(401).json({
      success: false,
      error: 'Authentication token is required. Authorization header missing.'
    });
  }

  // Structural sanity check
  const tokenParts = token.split('.');
  if (tokenParts.length !== 3) {
    return res.status(401).json({
      success: false,
      error: 'Invalid or corrupted authentication token format.'
    });
  }

  try {
    const rawHeader = Buffer.from(tokenParts[0], 'base64url').toString('utf8');
    const parsedHeader = JSON.parse(rawHeader);
    if (!parsedHeader.alg || parsedHeader.alg === 'none' || parsedHeader.alg !== 'HS256') {
      return res.status(401).json({
        success: false,
        error: 'Invalid or unsupported token algorithm.'
      });
    }
  } catch (err) {
    return res.status(401).json({
      success: false,
      error: 'Invalid or corrupted authentication token header.'
    });
  }

  try {
    const decoded = jwt.verify(token, config.jwtSecret, { algorithms: ['HS256'] });

    // Enforce role claim presence
    if (decoded.role === undefined || decoded.role === null || decoded.role === '') {
      return res.status(401).json({
        success: false,
        error: 'Authentication required: Token missing or invalid role claim.'
      });
    }

    const userId = decoded.id !== undefined ? decoded.id : decoded.userId;

    req.user = {
      id: userId,
      userId: userId,
      _id: userId,
      username: decoded.username || decoded.name || 'User',
      name: decoded.name || decoded.username || 'User',
      email: decoded.email || '',
      role: decoded.role,
      isHero: decoded.role === 'Hero'
    };

    // In live MongoDB mode (non-test), enrich from Mongo database if available
    if (process.env.NODE_ENV !== 'test') {
      try {
        const mongoose = require('mongoose');
        if (mongoose.connection && mongoose.connection.readyState === 1) {
          const User = require('../models/User');
          const { isAuthorizedHeroEmail } = require('../utils/security');
          const dbUser = await User.findById(userId);
          if (dbUser) {
            const isHero = isAuthorizedHeroEmail(dbUser.email) || dbUser.role === 'Hero';
            req.user.id = dbUser._id.toString();
            req.user.userId = dbUser._id.toString();
            req.user._id = dbUser._id;
            req.user.name = dbUser.name;
            req.user.email = dbUser.email;
            req.user.role = isHero ? 'Hero' : (dbUser.role || 'Citizen');
            req.user.isHero = isHero;
          }
        }
      } catch (e) {
        // Fall back gracefully to token claims
      }
    }

    next();
  } catch (error) {
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({
        success: false,
        code: 'TOKEN_EXPIRED',
        error: 'Session expired. Token has expired.'
      });
    }
    return res.status(401).json({
      success: false,
      code: 'TOKEN_INVALID',
      error: 'Invalid or corrupted authentication token.'
    });
  }
};

module.exports = {
  authenticate,
  protect: authenticate
};
