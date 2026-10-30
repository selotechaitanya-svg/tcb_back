'use strict';

const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert');
const request = require('supertest');
const app = require('../src/app');
const { setupTestDb, resetTestDb, teardownTestDb } = require('./helpers/testDb');

describe('Milestone 1: Authentication & Role-Based Access Control (RBAC)', () => {
  before(() => {
    setupTestDb();
  });

  after(() => {
    teardownTestDb();
  });

  beforeEach(() => {
    resetTestDb();
  });

  // ==========================================
  // Section 1: User Registration
  // ==========================================
  describe('POST /api/auth/register', () => {
    it('should successfully register a Citizen and return 201 with JWT and sanitized user', async () => {
      const res = await request(app)
        .post('/api/auth/register')
        .send({
          username: 'peter_parker',
          email: 'peter@dailybugle.com',
          password: 'SpiderPassword123!',
          role: 'Citizen'
        });

      assert.strictEqual(res.status, 201);
      assert.ok(res.body.token, 'Response must include JWT token');
      assert.ok(res.body.user, 'Response must include user object');
      assert.strictEqual(res.body.user.username, 'peter_parker');
      assert.strictEqual(res.body.user.email, 'peter@dailybugle.com');
      assert.strictEqual(res.body.user.role, 'Citizen');
      assert.ok(res.body.user.id > 0, 'User ID must be positive integer');
      assert.strictEqual(res.body.user.password, undefined, 'Must not expose password');
      assert.strictEqual(res.body.user.password_hash, undefined, 'Must not expose password_hash');
    });

    it('should successfully register a Hero and return 201 with JWT and sanitized user', async () => {
      const res = await request(app)
        .post('/api/auth/register')
        .send({
          username: 'spiderman',
          email: 'spidey@queens.org',
          password: 'WithGreatPower2026!',
          role: 'Hero'
        });

      assert.strictEqual(res.status, 201);
      assert.ok(res.body.token, 'Response must include JWT token');
      assert.strictEqual(res.body.user.username, 'spiderman');
      assert.strictEqual(res.body.user.role, 'Hero');
    });

    it('should reject duplicate username with 409 Conflict', async () => {
      // First registration
      await request(app)
        .post('/api/auth/register')
        .send({
          username: 'duplicate_user',
          email: 'first@example.com',
          password: 'Password123!',
          role: 'Citizen'
        });

      // Second registration with same username
      const res = await request(app)
        .post('/api/auth/register')
        .send({
          username: 'duplicate_user',
          email: 'second@example.com',
          password: 'Password123!',
          role: 'Hero'
        });

      assert.strictEqual(res.status, 409);
      assert.ok(res.body.error, 'Error message must be present');
      assert.match(res.body.error, /username/i);
    });

    it('should reject duplicate email with 409 Conflict', async () => {
      await request(app)
        .post('/api/auth/register')
        .send({
          username: 'user_one',
          email: 'shared@example.com',
          password: 'Password123!',
          role: 'Citizen'
        });

      const res = await request(app)
        .post('/api/auth/register')
        .send({
          username: 'user_two',
          email: 'shared@example.com',
          password: 'Password123!',
          role: 'Hero'
        });

      assert.strictEqual(res.status, 409);
      assert.ok(res.body.error);
      assert.match(res.body.error, /email/i);
    });

    it('should reject registration missing username with 400 Bad Request', async () => {
      const res = await request(app)
        .post('/api/auth/register')
        .send({
          email: 'test@example.com',
          password: 'Password123!',
          role: 'Citizen'
        });

      assert.strictEqual(res.status, 400);
      assert.ok(res.body.error);
    });

    it('should reject registration missing email with 400 Bad Request', async () => {
      const res = await request(app)
        .post('/api/auth/register')
        .send({
          username: 'testuser',
          password: 'Password123!',
          role: 'Citizen'
        });

      assert.strictEqual(res.status, 400);
      assert.ok(res.body.error);
    });

    it('should reject registration missing password with 400 Bad Request', async () => {
      const res = await request(app)
        .post('/api/auth/register')
        .send({
          username: 'testuser',
          email: 'test@example.com',
          role: 'Citizen'
        });

      assert.strictEqual(res.status, 400);
      assert.ok(res.body.error);
    });

    it('should reject registration missing role with 400 Bad Request', async () => {
      const res = await request(app)
        .post('/api/auth/register')
        .send({
          username: 'testuser',
          email: 'test@example.com',
          password: 'Password123!'
        });

      assert.strictEqual(res.status, 400);
      assert.ok(res.body.error);
    });

    it('should reject invalid role not in ["Citizen", "Hero"] with 400 Bad Request', async () => {
      const res = await request(app)
        .post('/api/auth/register')
        .send({
          username: 'green_goblin',
          email: 'norman@oscorp.com',
          password: 'GliderPassword123!',
          role: 'Villain'
        });

      assert.strictEqual(res.status, 400);
      assert.ok(res.body.error);
      assert.match(res.body.error, /role/i);
    });

    it('should reject invalid email format with 400 Bad Request', async () => {
      const res = await request(app)
        .post('/api/auth/register')
        .send({
          username: 'bad_email_user',
          email: 'not-an-email-address',
          password: 'Password123!',
          role: 'Citizen'
        });

      assert.strictEqual(res.status, 400);
      assert.ok(res.body.error);
      assert.match(res.body.error, /email/i);
    });

    it('should reject registration with empty or whitespace-only username with 400 Bad Request', async () => {
      const res = await request(app)
        .post('/api/auth/register')
        .send({
          username: '   ',
          email: 'whitespace@example.com',
          password: 'Password123!',
          role: 'Citizen'
        });

      assert.strictEqual(res.status, 400);
      assert.ok(res.body.error);
    });

    it('should reject password shorter than 6 characters with 400 Bad Request', async () => {
      const res = await request(app)
        .post('/api/auth/register')
        .send({
          username: 'short_pass_user',
          email: 'short@example.com',
          password: '123',
          role: 'Citizen'
        });

      assert.strictEqual(res.status, 400);
      assert.ok(res.body.error);
      assert.match(res.body.error, /password/i);
    });
  });

  // ==========================================
  // Section 2: User Login
  // ==========================================
  describe('POST /api/auth/login', () => {
    beforeEach(async () => {
      // Seed an active citizen and hero
      await request(app)
        .post('/api/auth/register')
        .send({
          username: 'active_citizen',
          email: 'citizen@ny.gov',
          password: 'CorrectPassword123!',
          role: 'Citizen'
        });

      await request(app)
        .post('/api/auth/register')
        .send({
          username: 'active_hero',
          email: 'hero@avengers.org',
          password: 'ShieldPassword123!',
          role: 'Hero'
        });
    });

    it('should successfully log in with valid credentials and return 200 with JWT', async () => {
      const res = await request(app)
        .post('/api/auth/login')
        .send({
          username: 'active_citizen',
          password: 'CorrectPassword123!'
        });

      assert.strictEqual(res.status, 200);
      assert.ok(res.body.token, 'Must return JWT token');
      assert.strictEqual(res.body.user.username, 'active_citizen');
      assert.strictEqual(res.body.user.role, 'Citizen');
      assert.strictEqual(res.body.user.password_hash, undefined);
    });

    it('should successfully log in a Hero and return correct role payload', async () => {
      const res = await request(app)
        .post('/api/auth/login')
        .send({
          username: 'active_hero',
          password: 'ShieldPassword123!'
        });

      assert.strictEqual(res.status, 200);
      assert.ok(res.body.token);
      assert.strictEqual(res.body.user.role, 'Hero');
    });

    it('should reject login with incorrect password with 401 Unauthorized', async () => {
      const res = await request(app)
        .post('/api/auth/login')
        .send({
          username: 'active_citizen',
          password: 'WrongPassword456!'
        });

      assert.strictEqual(res.status, 401);
      assert.ok(res.body.error);
      assert.match(res.body.error, /invalid credentials|unauthorized/i);
    });

    it('should reject login for non-existent username with 401 Unauthorized', async () => {
      const res = await request(app)
        .post('/api/auth/login')
        .send({
          username: 'does_not_exist',
          password: 'AnyPassword123!'
        });

      assert.strictEqual(res.status, 401);
      assert.ok(res.body.error);
      assert.match(res.body.error, /invalid credentials|unauthorized/i);
    });

    it('should reject login with missing username with 400 Bad Request', async () => {
      const res = await request(app)
        .post('/api/auth/login')
        .send({
          password: 'CorrectPassword123!'
        });

      assert.strictEqual(res.status, 400);
      assert.ok(res.body.error);
    });

    it('should reject login with missing password with 400 Bad Request', async () => {
      const res = await request(app)
        .post('/api/auth/login')
        .send({
          username: 'active_citizen'
        });

      assert.strictEqual(res.status, 400);
      assert.ok(res.body.error);
    });

    it('should reject login with empty body with 400 Bad Request', async () => {
      const res = await request(app)
        .post('/api/auth/login')
        .send({});

      assert.strictEqual(res.status, 400);
      assert.ok(res.body.error);
    });
  });

  // ==========================================
  // Section 3: JWT Verification & RBAC Guards
  // ==========================================
  describe('JWT Authentication & RBAC Middleware Enforcement', () => {
    let citizenToken;
    let heroToken;

    beforeEach(async () => {
      const regCitizen = await request(app)
        .post('/api/auth/register')
        .send({
          username: 'rbac_citizen',
          email: 'rbac_c@ny.gov',
          password: 'Password123!',
          role: 'Citizen'
        });
      citizenToken = regCitizen.body.token;

      const regHero = await request(app)
        .post('/api/auth/register')
        .send({
          username: 'rbac_hero',
          email: 'rbac_h@avengers.org',
          password: 'Password123!',
          role: 'Hero'
        });
      heroToken = regHero.body.token;
    });

    it('should return 401 Unauthorized when accessing protected route without Authorization header', async () => {
      const res = await request(app).get('/api/auth/me');
      assert.strictEqual(res.status, 401);
      assert.ok(res.body.error);
      assert.match(res.body.error, /token|authorization/i);
    });

    it('should return 401 Unauthorized when accessing protected route with malformed Bearer token', async () => {
      const res = await request(app)
        .get('/api/auth/me')
        .set('Authorization', 'Bearer totally-invalid-jwt-token-string');

      assert.strictEqual(res.status, 401);
      assert.ok(res.body.error);
    });

    it('should return 401 Unauthorized when Bearer token header prefix is missing', async () => {
      const res = await request(app)
        .get('/api/auth/me')
        .set('Authorization', citizenToken); // Missing 'Bearer ' prefix

      assert.strictEqual(res.status, 401);
      assert.ok(res.body.error);
    });

    it('should return 200 OK and attached user payload when valid token is supplied to /api/auth/me', async () => {
      const res = await request(app)
        .get('/api/auth/me')
        .set('Authorization', `Bearer ${citizenToken}`);

      assert.strictEqual(res.status, 200);
      assert.ok(res.body.user);
      assert.strictEqual(res.body.user.username, 'rbac_citizen');
      assert.strictEqual(res.body.user.role, 'Citizen');
    });

    it('should return 403 Forbidden when Citizen attempts to access Hero-only endpoint', async () => {
      const res = await request(app)
        .get('/api/auth/hero-test')
        .set('Authorization', `Bearer ${citizenToken}`);

      assert.strictEqual(res.status, 403);
      assert.ok(res.body.error);
      assert.match(res.body.error, /forbidden|access denied|permission/i);
    });

    it('should return 200 OK when Hero accesses Hero-only endpoint', async () => {
      const res = await request(app)
        .get('/api/auth/hero-test')
        .set('Authorization', `Bearer ${heroToken}`);

      assert.strictEqual(res.status, 200);
      assert.ok(res.body.message);
    });

    it('should return 403 Forbidden when Hero attempts to access Citizen-only endpoint', async () => {
      const res = await request(app)
        .get('/api/auth/citizen-test')
        .set('Authorization', `Bearer ${heroToken}`);

      assert.strictEqual(res.status, 403);
      assert.ok(res.body.error);
      assert.match(res.body.error, /forbidden|access denied|permission/i);
    });

    it('should return 200 OK when Citizen accesses Citizen-only endpoint', async () => {
      const res = await request(app)
        .get('/api/auth/citizen-test')
        .set('Authorization', `Bearer ${citizenToken}`);

      assert.strictEqual(res.status, 200);
      assert.ok(res.body.message);
    });
  });
});
