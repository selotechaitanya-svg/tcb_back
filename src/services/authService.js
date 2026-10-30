'use strict';

const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const config = require('../config/config');
const { get, run } = require('../db/database');
const { ConflictError, UnauthorizedError } = require('../utils/errors');
const { validateRegisterPayload, validateLoginPayload } = require('../utils/validator');

const authService = {
  /**
   * Registers a new user (Citizen or Hero), hashes password, and issues JWT.
   * @param {string} username
   * @param {string} email
   * @param {string} password
   * @param {'Citizen'|'Hero'} role
   * @returns {Promise<{ user: { id: number, username: string, email: string, role: string, created_at: string, updated_at: string }, token: string }>}
   */
  async registerUser(username, email, password, role) {
    const validated = validateRegisterPayload({ username, email, password, role });

    // Check unique constraints (case-insensitive)
    const existingUser = get('SELECT id FROM users WHERE username = ? COLLATE NOCASE', [validated.username]);
    if (existingUser) {
      throw new ConflictError('Username already in use');
    }

    const existingEmail = get('SELECT id FROM users WHERE email = ? COLLATE NOCASE', [validated.email]);
    if (existingEmail) {
      throw new ConflictError('Email already in use');
    }

    // Hash password
    const passwordHash = await bcrypt.hash(validated.password, config.bcryptSaltRounds || 10);

    // Insert user
    let insertResult;
    try {
      insertResult = run(
        'INSERT INTO users (username, email, password_hash, role) VALUES (?, ?, ?, ?)',
        [validated.username, validated.email, passwordHash, validated.role]
      );
    } catch (err) {
      if (err.code === 'ERR_SQLITE_ERROR' && err.message && err.message.includes('UNIQUE constraint failed')) {
        if (err.message.includes('users.username')) {
          throw new ConflictError('Username already in use');
        }
        if (err.message.includes('users.email')) {
          throw new ConflictError('Email already in use');
        }
        throw new ConflictError('Username or email already in use');
      }
      throw err;
    }

    // Retrieve clean user record (never return password_hash)
    const user = get(
      'SELECT id, username, email, role, created_at, updated_at FROM users WHERE id = ?',
      [insertResult.lastInsertRowid]
    );

    // Generate JWT token
    const token = jwt.sign(
      { id: user.id, username: user.username, role: user.role },
      config.jwtSecret,
      { expiresIn: config.jwtExpiresIn }
    );

    return { user, token };
  },

  /**
   * Authenticates user credentials and issues a signed JWT.
   * @param {string} username
   * @param {string} password
   * @returns {Promise<{ user: { id: number, username: string, email: string, role: string, created_at: string, updated_at: string }, token: string }>}
   */
  async loginUser(username, password) {
    const validated = validateLoginPayload({ username, password });

    const user = get(
      'SELECT id, username, email, password_hash, role, created_at, updated_at FROM users WHERE username = ? COLLATE NOCASE',
      [validated.username]
    );

    if (!user) {
      throw new UnauthorizedError('Invalid credentials');
    }

    const isMatch = await bcrypt.compare(validated.password, user.password_hash);
    if (!isMatch) {
      throw new UnauthorizedError('Invalid credentials');
    }

    const token = jwt.sign(
      { id: user.id, username: user.username, role: user.role },
      config.jwtSecret,
      { expiresIn: config.jwtExpiresIn }
    );

    const { password_hash, ...safeUser } = user;
    return { user: safeUser, token };
  },

  /**
   * Verifies and decodes a JWT token.
   * @param {string} token
   * @returns {{ id: number, userId: number, username: string, role: 'Citizen'|'Hero' }}
   */
  verifyToken(token) {
    if (!token || typeof token !== 'string') {
      throw new UnauthorizedError('Authentication token is required');
    }

    try {
      const decoded = jwt.verify(token, config.jwtSecret);
      const userId = decoded.id !== undefined ? decoded.id : decoded.userId;
      return {
        id: userId,
        userId: userId,
        username: decoded.username,
        role: decoded.role
      };
    } catch (err) {
      if (err.name === 'TokenExpiredError') {
        throw new UnauthorizedError('Token has expired');
      }
      throw new UnauthorizedError('Invalid or corrupted authentication token');
    }
  }
};

module.exports = authService;
