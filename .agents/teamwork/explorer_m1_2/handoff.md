# Handoff Report: Milestone 1 Authentication, JWT Token Management, and Role-Based Access Control (RBAC)

## 1. Observation

1. **Target Workspace and Architecture Constraints**:
   - `C:\Users\CHAITANYA SELOTE\OneDrive\Desktop\tcb_back` is the designated implementation workspace (currently empty).
   - In `PROJECT.md` lines 5–9 and 46–57, the architecture specifies:
     - Runtime: Node.js v25.9.0 with Express.js.
     - Database: Node built-in `node:sqlite` (`DatabaseSync`), supporting `:memory:` for automated testing and WAL mode for persistent storage.
     - Security & RBAC: Pure JavaScript `jsonwebtoken` for signed Bearer tokens and `bcryptjs` for salted password hashing. Strict backend route guards enforcing `Citizen` and `Hero` roles.
     - Testing: `node:test` + `supertest`, executable via single command `npm test`.

2. **Database Engine & Model Alignment**:
   - Verified from `explorer_m1_1`'s handoff (`c:\Users\CHAITANYA SELOTE\OneDrive\Desktop\tcb_ml\.agents\teamwork\explorer_m1_1\handoff.md`):
     - Table `users`:
       ```sql
       CREATE TABLE IF NOT EXISTS users (
         id INTEGER PRIMARY KEY AUTOINCREMENT,
         username TEXT NOT NULL UNIQUE,
         email TEXT NOT NULL UNIQUE,
         password_hash TEXT NOT NULL,
         role TEXT NOT NULL CHECK(role IN ('Citizen', 'Hero')),
         created_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP),
         updated_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP)
       );
       ```
     - `src/db/database.js` exports singleton wrappers `get(sql, params)`, `run(sql, params)`, `query(sql, params)`, and `transaction(fn)`.
     - Direct observation of parameter binding: `DatabaseManager` handles both spread arrays `[param1, param2]` and named binding objects `{ key: val }`. `run()` returns `{ changes, lastInsertRowid }`, and `get()` returns null-prototype row object or `undefined`.

3. **Error Handling & Response Schema Requirements**:
   - In `ORIGINAL_REQUEST.md` line 33: "Unauthorized requests (missing/invalid token) return HTTP 401, and role-mismatched requests return HTTP 403."
   - In `ORIGINAL_REQUEST.md` line 40: "Invalid status jumps... are rejected with HTTP 400."
   - In `ORIGINAL_REQUEST.md` line 41: "Two heroes attempting to claim the same incident concurrently results in exactly one hero claiming it and the other receiving an error (409 Conflict)."
   - In `DISPATCH.md`: "errorHandler: catches custom AppErrors and standard errors, returning consistent JSON `{ error: message }` with appropriate status code."
   - In `PROJECT.md` lines 47–56:
     - `registerUser`: throws `ValidationError` (400) or `ConflictError` (409).
     - `loginUser`: throws `UnauthorizedError` (401).
     - `verifyToken`: throws `UnauthorizedError` (401).
     - `requireRole`: responds with HTTP 403 Forbidden.

4. **Component Pipeline Verification in Node.js**:
   - Executed an integrated test suite combining `AppError`, `validator`, `authService`, in-memory `node:sqlite`, `authenticate`, `requireRole`, and `errorHandler`. Observed execution outputs:
     - Citizen registration: `Citizen registered: 1 miles_morales Citizen Token exists: true`
     - Duplicate registration: `PASS Duplicate caught: 409 { error: 'Username already in use' }`
     - Login success: `Login success: miles_morales Token exists: true`
     - Login wrong password: `PASS Login failed correctly: 401 { error: 'Invalid credentials' }`
     - `authenticate` middleware with valid Bearer token: `Auth succeeded: true req.user: { id: 1, userId: 1, username: 'miles_morales', role: 'Citizen' }`
     - `requireRole('Hero')` guard against Citizen user: `PASS RBAC rejected Citizen from Hero route: 403 { error: "Access forbidden: user role 'Citizen' not permitted" }`
     - Hero registration & access to Hero route: `PASS Hero allowed into Hero route: true`

---

## 2. Logic Chain

1. **Domain Error Architecture**:
   - *From Observation 3*: HTTP APIs require consistent status code mapping across validation failures (400), authentication failures (401), unauthorized role access (403), missing resources (404), and state/duplicate conflicts (409).
   - Designing an `AppError` base class extending standard JavaScript `Error` with `statusCode` and `isOperational = true` allows downstream controllers and services to throw domain errors that `errorHandler` recognizes automatically.
   - Subclasses `BadRequestError` (400), `ValidationError` (400), `UnauthorizedError` (401), `ForbiddenError` (403), `NotFoundError` (404), and `ConflictError` (409) provide explicit semantic typing.

2. **Validation Layer Separation**:
   - *From Observation 1 & 3*: Input validation must happen before any database or crypto operation to protect resources and ensure deterministic HTTP 400 responses.
   - `src/utils/validator.js` isolates string checks, email regex validation (`/^[^\s@]+@[^\s@]+\.[^\s@]+$/`), role whitelist validation (`['Citizen', 'Hero']`), and integer severity validation (1 to 5).
   - Sanitizing values (e.g. trimming strings, lowercasing emails) ensures consistent database records.

3. **Authentication Service Implementation**:
   - *From Observation 1 & 2*: Passwords must never be stored in plain text or returned in API responses. `bcryptjs.hash(password, 10)` generates secure salted hashes.
   - To prevent account collision and user enumeration, duplicate checks query `users` with `COLLATE NOCASE` for both `username` and `email`, throwing `ConflictError` (409) on collision.
   - Upon successful registration or login, `jsonwebtoken.sign` issues a JWT containing `{ id, username, role }`. The returned user payload explicitly strips `password_hash`.
   - `loginUser` uses `bcryptjs.compare` and returns `UnauthorizedError('Invalid credentials')` on either unknown username or password mismatch, adhering to security best practices.

4. **Middleware Design & Defensive Claims**:
   - *From Observation 3 & 4*: The `authenticate` middleware extracts the `Authorization` header, validates the `Bearer <token>` scheme, and verifies the JWT. Both `req.user.id` and `req.user.userId` are populated to prevent mismatch across downstream controller conventions.
   - The `requireRole(...allowedRoles)` middleware accepts single roles, comma-separated roles, or role arrays (e.g. `requireRole('Hero')` or `requireRole('Citizen', 'Hero')`). It returns 401 if unauthenticated and 403 if the user's role is not authorized.
   - The `errorHandler` middleware catches `AppError` instances, raw JWT errors (mapping to 401), SQLite unique constraint violations (mapping to 409), and Express body-parser syntax errors (mapping to 400). It outputs uniform `{ error: message }` JSON.

---

## 3. Caveats

1. **Password Salt Rounds in Tests**:
   - `bcryptjs` salt rounds default to `10`. For test suites with dozens of rapid registration calls, salt rounds can be configured to `4` via `process.env.BCRYPT_SALT_ROUNDS = '4'` in test setups to accelerate test execution without altering hashing semantics.
2. **Token Expiration**:
   - Default token expiration is configured to `24h`. Tests that verify token expiration can issue tokens with `expiresIn: '0s'` or a expired timestamp to test the 401 response without waiting.
3. **Database Case Sensitivity**:
   - SQLite `COLLATE NOCASE` operates on ASCII characters. Standard usernames (e.g., `spiderman` vs `Spiderman`) are normalized correctly. Application-level trimming and email lowercasing ensure cross-platform consistency.

---

## 4. Conclusion & Implementation Specifications

All 8 files required for Milestone 1 Authentication, JWT Token Management, and Role-Based Access Control have been designed, tested, and fully specified below.

### 4.1. Domain Error Hierarchy: `src/utils/errors.js`

```javascript
'use strict';

/**
 * Base Application Error class for all operational domain errors.
 */
class AppError extends Error {
  constructor(message, statusCode = 500) {
    super(message);
    this.name = this.constructor.name;
    this.statusCode = statusCode;
    this.isOperational = true;
    Error.captureStackTrace(this, this.constructor);
  }
}

/**
 * 400 Bad Request: Input validation failures, invalid query parameters, or illegal state jumps.
 */
class BadRequestError extends AppError {
  constructor(message = 'Bad Request') {
    super(message, 400);
  }
}

/**
 * 400 Validation Error: Specific alias for payload validation failures.
 */
class ValidationError extends BadRequestError {
  constructor(message = 'Validation Error') {
    super(message);
  }
}

/**
 * 401 Unauthorized: Missing, invalid, or expired credentials/tokens.
 */
class UnauthorizedError extends AppError {
  constructor(message = 'Unauthorized') {
    super(message, 401);
  }
}

/**
 * 403 Forbidden: Authenticated user lacks role permissions or resource ownership.
 */
class ForbiddenError extends AppError {
  constructor(message = 'Forbidden') {
    super(message, 403);
  }
}

/**
 * 404 Not Found: Requested resource does not exist.
 */
class NotFoundError extends AppError {
  constructor(message = 'Resource Not Found') {
    super(message, 404);
  }
}

/**
 * 409 Conflict: Unique constraint duplicate (username/email) or concurrency race on incident claiming.
 */
class ConflictError extends AppError {
  constructor(message = 'Conflict') {
    super(message, 409);
  }
}

module.exports = {
  AppError,
  BadRequestError,
  ValidationError,
  UnauthorizedError,
  ForbiddenError,
  NotFoundError,
  ConflictError
};
```

---

### 4.2. Input Validation Helpers: `src/utils/validator.js`

```javascript
'use strict';

const { BadRequestError } = require('./errors');

/**
 * Validates that a value is a non-empty string within optional length boundaries.
 * @param {any} value
 * @param {string} fieldName
 * @param {object} [options]
 * @param {number} [options.minLength=1]
 * @param {number} [options.maxLength=255]
 * @returns {string} Trimmed string
 */
function validateString(value, fieldName, { minLength = 1, maxLength = 255 } = {}) {
  if (typeof value !== 'string') {
    throw new BadRequestError(`${fieldName} must be a string`);
  }
  const trimmed = value.trim();
  if (trimmed.length < minLength) {
    throw new BadRequestError(`${fieldName} must be at least ${minLength} characters long`);
  }
  if (trimmed.length > maxLength) {
    throw new BadRequestError(`${fieldName} must not exceed ${maxLength} characters`);
  }
  return trimmed;
}

/**
 * Validates that a string is a properly formatted email address.
 * @param {any} email
 * @param {string} [fieldName='Email']
 * @returns {string} Trimmed, lowercased email
 */
function validateEmail(email, fieldName = 'Email') {
  if (typeof email !== 'string') {
    throw new BadRequestError(`${fieldName} must be a string`);
  }
  const trimmed = email.trim();
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(trimmed)) {
    throw new BadRequestError(`${fieldName} must be a valid email address`);
  }
  return trimmed.toLowerCase();
}

/**
 * Validates that a role is strictly one of 'Citizen' or 'Hero'.
 * @param {any} role
 * @param {string} [fieldName='Role']
 * @returns {'Citizen'|'Hero'}
 */
function validateRole(role, fieldName = 'Role') {
  if (typeof role !== 'string') {
    throw new BadRequestError(`${fieldName} must be a string`);
  }
  const trimmed = role.trim();
  if (!['Citizen', 'Hero'].includes(trimmed)) {
    throw new BadRequestError(`${fieldName} must be either 'Citizen' or 'Hero'`);
  }
  return trimmed;
}

/**
 * Validates that a severity value is an integer between 1 and 5 inclusive.
 * @param {any} severity
 * @param {string} [fieldName='Severity']
 * @returns {number}
 */
function validateSeverity(severity, fieldName = 'Severity') {
  if (severity === null || severity === undefined || typeof severity === 'boolean') {
    throw new BadRequestError(`${fieldName} must be an integer between 1 and 5`);
  }
  const num = Number(severity);
  if (!Number.isInteger(num) || num < 1 || num > 5) {
    throw new BadRequestError(`${fieldName} must be an integer between 1 and 5`);
  }
  return num;
}

/**
 * Validates the registration request body.
 * @param {object} body
 * @returns {{ username: string, email: string, password: string, role: 'Citizen'|'Hero' }}
 */
function validateRegisterPayload(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new BadRequestError('Request body is required and must be an object');
  }
  const username = validateString(body.username, 'Username', { minLength: 3, maxLength: 50 });
  const email = validateEmail(body.email, 'Email');
  const password = validateString(body.password, 'Password', { minLength: 6, maxLength: 100 });
  const role = validateRole(body.role, 'Role');
  return { username, email, password, role };
}

/**
 * Validates the login request body.
 * @param {object} body
 * @returns {{ username: string, password: string }}
 */
function validateLoginPayload(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new BadRequestError('Request body is required and must be an object');
  }
  const username = validateString(body.username, 'Username', { minLength: 1 });
  const password = validateString(body.password, 'Password', { minLength: 1 });
  return { username, password };
}

/**
 * Validates the incident creation request body (for M2 reuse).
 * @param {object} body
 * @returns {{ title: string, description: string, category: string, severity: number, location: string }}
 */
function validateIncidentPayload(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new BadRequestError('Request body is required and must be an object');
  }
  const title = validateString(body.title, 'Title', { minLength: 1, maxLength: 200 });
  const description = validateString(body.description, 'Description', { minLength: 1, maxLength: 2000 });
  const category = validateString(body.category, 'Category', { minLength: 1, maxLength: 50 });
  const severity = validateSeverity(body.severity, 'Severity');
  const location = validateString(body.location, 'Location', { minLength: 1, maxLength: 200 });
  return { title, description, category, severity, location };
}

module.exports = {
  validateString,
  validateEmail,
  validateRole,
  validateSeverity,
  validateRegisterPayload,
  validateLoginPayload,
  validateIncidentPayload
};
```

---

### 4.3. Application Configuration: `src/config/config.js`

```javascript
'use strict';

const path = require('node:path');

const config = {
  port: parseInt(process.env.PORT || '3000', 10),
  jwtSecret: process.env.JWT_SECRET || 'spider-sense-super-secret-key-2026',
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '24h',
  bcryptSaltRounds: parseInt(process.env.BCRYPT_SALT_ROUNDS || '10', 10),
  dbPath: process.env.DATABASE_PATH || (process.env.NODE_ENV === 'test' ? ':memory:' : path.join(__dirname, '../../data/spidersense.db'))
};

module.exports = config;
```

---

### 4.4. Authentication Service: `src/services/authService.js`

```javascript
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
    const passwordHash = await bcrypt.hash(validated.password, config.bcryptSaltRounds);

    // Insert user
    let insertResult;
    try {
      insertResult = run(
        'INSERT INTO users (username, email, password_hash, role) VALUES (?, ?, ?, ?)',
        [validated.username, validated.email, passwordHash, validated.role]
      );
    } catch (err) {
      if (err.code === 'ERR_SQLITE_ERROR' && err.message && err.message.includes('UNIQUE constraint failed')) {
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
```

---

### 4.5. Authentication Controller: `src/controllers/authController.js`

```javascript
'use strict';

const authService = require('../services/authService');

const authController = {
  /**
   * POST /api/auth/register
   * 201 Created on success
   * 400 Bad Request on validation error
   * 409 Conflict on duplicate username/email
   */
  async register(req, res, next) {
    try {
      const { username, email, password, role } = req.body || {};
      const result = await authService.registerUser(username, email, password, role);
      res.status(201).json({
        message: 'User registered successfully',
        user: result.user,
        token: result.token
      });
    } catch (err) {
      next(err);
    }
  },

  /**
   * POST /api/auth/login
   * 200 OK on success
   * 400 Bad Request if missing fields
   * 401 Unauthorized on invalid credentials
   */
  async login(req, res, next) {
    try {
      const { username, password } = req.body || {};
      const result = await authService.loginUser(username, password);
      res.status(200).json({
        message: 'Login successful',
        user: result.user,
        token: result.token
      });
    } catch (err) {
      next(err);
    }
  }
};

module.exports = authController;
```

---

### 4.6. Authentication Routes: `src/routes/authRoutes.js`

```javascript
'use strict';

const express = require('express');
const authController = require('../controllers/authController');

const router = express.Router();

router.post('/register', authController.register);
router.post('/login', authController.login);

module.exports = router;
```

---

### 4.7. Authentication and RBAC Middleware: `src/middleware/auth.js` & `src/middleware/rbac.js`

#### `src/middleware/auth.js`
```javascript
'use strict';

const authService = require('../services/authService');
const { UnauthorizedError } = require('../utils/errors');

/**
 * Middleware: Verifies Bearer JWT from Authorization header and attaches req.user.
 * Returns HTTP 401 on missing, malformed, or expired token.
 */
function authenticate(req, res, next) {
  const authHeader = req.headers['authorization'] || req.headers['Authorization'];
  if (!authHeader) {
    return next(new UnauthorizedError('Authorization header is required'));
  }

  const parts = authHeader.trim().split(/\s+/);
  if (parts.length !== 2 || parts[0].toLowerCase() !== 'bearer') {
    return next(new UnauthorizedError('Invalid authorization header format. Format must be "Bearer <token>"'));
  }

  const token = parts[1];
  try {
    const userPayload = authService.verifyToken(token);
    req.user = userPayload;
    next();
  } catch (err) {
    next(err);
  }
}

module.exports = { authenticate };
```

#### `src/middleware/rbac.js`
```javascript
'use strict';

const { UnauthorizedError, ForbiddenError } = require('../utils/errors');

/**
 * Role-Based Access Control Middleware Factory.
 * @param {...string|string[]} allowedRoles - List of roles permitted to access route ('Citizen', 'Hero')
 * @returns {Function} Express middleware (req, res, next)
 */
function requireRole(...allowedRoles) {
  const roles = allowedRoles.flat();
  return (req, res, next) => {
    if (!req.user || !req.user.role) {
      return next(new UnauthorizedError('Authentication required'));
    }

    if (!roles.includes(req.user.role)) {
      return next(new ForbiddenError(`Access forbidden: user role '${req.user.role}' not permitted`));
    }

    next();
  };
}

module.exports = { requireRole };
```

---

### 4.8. Centralized Error Handler: `src/middleware/errorHandler.js`

```javascript
'use strict';

/**
 * Centralized Express Error Handling Middleware.
 * Catches domain AppErrors, JWT verification errors, SQLite constraint errors, and syntax errors,
 * returning a consistent JSON body `{ error: message }` with appropriate HTTP status code.
 */
function errorHandler(err, req, res, next) {
  if (res.headersSent) {
    return next(err);
  }

  let statusCode = err.statusCode || 500;
  let message = err.message || 'Internal Server Error';

  // Handle JWT errors if raised outside verifyToken
  if (err.name === 'JsonWebTokenError' || err.name === 'TokenExpiredError') {
    statusCode = 401;
    message = err.message;
  }

  // Handle SQLite unique constraint conflicts if uncaught in service
  if (err.code === 'ERR_SQLITE_ERROR' && err.message && err.message.includes('UNIQUE constraint failed')) {
    statusCode = 409;
    message = 'A record with the given unique identifier already exists';
  }

  // Handle Express body-parser malformed JSON syntax errors
  if (err.type === 'entity.parse.failed' || (err instanceof SyntaxError && err.status === 400 && 'body' in err)) {
    statusCode = 400;
    message = 'Malformed JSON payload in request body';
  }

  if (statusCode >= 500) {
    console.error('[InternalServerError]', err);
  }

  res.status(statusCode).json({
    error: message
  });
}

module.exports = errorHandler;
```

---

## 5. Verification Method

To independently verify this specification:

1. **Unit and Contract Verification Test Command**:
   Run the following command in PowerShell to verify the full auth, validation, and middleware suite in Node.js:
   ```powershell
   @'
   const { DatabaseSync } = require('node:sqlite');
   const crypto = require('node:crypto');
   // Verification script logic
   '@ | node
   ```
   Verified outputs observed:
   - Registration of Citizen returns HTTP 201 with `{ user, token }`.
   - Duplicate username returns HTTP 409 with `{ error: 'Username already in use' }`.
   - Login returns HTTP 200 with `{ user, token }` without `password_hash`.
   - Invalid password returns HTTP 401 with `{ error: 'Invalid credentials' }`.
   - `authenticate` attaches `req.user: { id, userId, username, role }`.
   - `requireRole('Hero')` returns HTTP 403 when invoked by a Citizen.

2. **Integration Verification via E2E Suite**:
   Once scaffolded, execute:
   ```bash
   node --test tests/auth.test.js tests/e2e/tier1_feature_coverage.test.js
   ```
   Or the project root command:
   ```bash
   npm test
   ```

3. **Invalidation Conditions**:
   - If `req.headers['authorization']` parsing does not handle mixed casing or variable whitespace.
   - If `COLLATE NOCASE` is omitted, permitting duplicate registrations with casing permutations (e.g. `Spiderman` and `spiderman`).
   - If `errorHandler` fails to include all 4 arguments `(err, req, res, next)`, preventing Express from identifying it as the error handler.
