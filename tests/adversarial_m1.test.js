'use strict';

const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert');
const request = require('supertest');
const jwt = require('jsonwebtoken');
const app = require('../src/app');
const config = require('../src/config/config');
const { setupTestDb, resetTestDb, teardownTestDb, getDatabase } = require('./helpers/testDb');

describe('Adversarial Verification Suite: Milestone 1 Auth & RBAC', () => {
  before(() => {
    setupTestDb();
  });

  after(() => {
    teardownTestDb();
  });

  beforeEach(() => {
    resetTestDb();
  });

  // =========================================================================
  // Challenge 1: Malformed, Corrupted, Expired & Signature-Tampered JWT Tokens
  // =========================================================================
  describe('Challenge 1: JWT Integrity, Tampering & Lifecycle Verification', () => {
    it('1.1 should return HTTP 401 when Authorization header is completely missing', async () => {
      const res = await request(app).get('/api/auth/me');
      assert.strictEqual(res.status, 401);
      assert.ok(res.body.error, 'Must include error field');
    });

    it('1.2 should return HTTP 401 when Authorization header is empty string', async () => {
      const res = await request(app)
        .get('/api/auth/me')
        .set('Authorization', '');
      assert.strictEqual(res.status, 401);
    });

    it('1.3 should return HTTP 401 when Authorization header scheme is not Bearer', async () => {
      const res = await request(app)
        .get('/api/auth/me')
        .set('Authorization', 'Basic dXNlcjpwYXNz');
      assert.strictEqual(res.status, 401);
      assert.match(res.body.error, /Bearer/i);
    });

    it('1.4 should return HTTP 401 when Authorization header has "Bearer" but no token', async () => {
      const res = await request(app)
        .get('/api/auth/me')
        .set('Authorization', 'Bearer ');
      assert.strictEqual(res.status, 401);
    });

    it('1.5 should return HTTP 401 when Authorization header has trailing extra segments', async () => {
      const res = await request(app)
        .get('/api/auth/me')
        .set('Authorization', 'Bearer token_part_1 token_part_2');
      assert.strictEqual(res.status, 401);
    });

    it('1.6 should return HTTP 401 when token is completely corrupted non-base64 garbage', async () => {
      const res = await request(app)
        .get('/api/auth/me')
        .set('Authorization', 'Bearer !!!@@@###$$$%%%^^^&&&***()');
      assert.strictEqual(res.status, 401);
      assert.match(res.body.error, /token|invalid/i);
    });

    it('1.7 should return HTTP 401 when token has only two parts (missing signature segment)', async () => {
      const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
      const payload = Buffer.from(JSON.stringify({ id: 1, username: 'test', role: 'Citizen' })).toString('base64url');
      const truncatedToken = `${header}.${payload}`;

      const res = await request(app)
        .get('/api/auth/me')
        .set('Authorization', `Bearer ${truncatedToken}`);
      assert.strictEqual(res.status, 401);
    });

    it('1.8 should return HTTP 401 when token signature is tampered (bit-flip attack)', async () => {
      const validToken = jwt.sign(
        { id: 1, username: 'legit_user', role: 'Hero' },
        config.jwtSecret,
        { expiresIn: '1h' }
      );
      const parts = validToken.split('.');
      assert.strictEqual(parts.length, 3);

      // Mutate the signature
      const tamperedSignature = parts[2].slice(0, -4) + (parts[2].endsWith('a') ? 'b' : 'a') + 'xyz';
      const tamperedToken = `${parts[0]}.${parts[1]}.${tamperedSignature}`;

      const res = await request(app)
        .get('/api/auth/me')
        .set('Authorization', `Bearer ${tamperedToken}`);
      assert.strictEqual(res.status, 401);
      assert.match(res.body.error, /invalid|corrupted/i);
    });

    it('1.9 should return HTTP 401 when token is signed with an adversarial secret key', async () => {
      const forgedToken = jwt.sign(
        { id: 1, username: 'evil_hacker', role: 'Hero' },
        'adversarial-unauthorized-secret-key-666',
        { expiresIn: '1h' }
      );

      const res = await request(app)
        .get('/api/auth/hero-test')
        .set('Authorization', `Bearer ${forgedToken}`);
      assert.strictEqual(res.status, 401);
    });

    it('1.10 should return HTTP 401 when token uses algorithm "none" (unsecured token attack)', async () => {
      const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
      const payload = Buffer.from(JSON.stringify({ id: 1, username: 'admin', role: 'Hero' })).toString('base64url');
      const unsignedToken = `${header}.${payload}.`;

      const res = await request(app)
        .get('/api/auth/hero-test')
        .set('Authorization', `Bearer ${unsignedToken}`);
      assert.strictEqual(res.status, 401);
    });

    it('1.11 should return HTTP 401 when token is expired', async () => {
      const expiredToken = jwt.sign(
        { id: 1, username: 'old_citizen', role: 'Citizen' },
        config.jwtSecret,
        { expiresIn: -10 } // Expired 10 seconds ago
      );

      const res = await request(app)
        .get('/api/auth/me')
        .set('Authorization', `Bearer ${expiredToken}`);
      assert.strictEqual(res.status, 401);
      assert.match(res.body.error, /expired/i);
    });

    it('1.12 should return HTTP 401 (not 500 or 403) on protected role endpoints with bad tokens', async () => {
      const resHero = await request(app)
        .get('/api/auth/hero-test')
        .set('Authorization', 'Bearer totally-invalid-token');
      assert.strictEqual(resHero.status, 401);

      const resCitizen = await request(app)
        .get('/api/auth/citizen-test')
        .set('Authorization', 'Bearer totally-invalid-token');
      assert.strictEqual(resCitizen.status, 401);
    });
  });

  // =========================================================================
  // Challenge 2: Role Spoofing, Escalation & RBAC Boundary Enforcement
  // =========================================================================
  describe('Challenge 2: Role Spoofing, Escalation & RBAC Boundaries', () => {
    it('2.1 should return HTTP 403 when a token possesses an unknown or elevated role ("Admin")', async () => {
      const adminToken = jwt.sign(
        { id: 99, username: 'spoofed_admin', role: 'Admin' },
        config.jwtSecret,
        { expiresIn: '1h' }
      );

      const resHero = await request(app)
        .get('/api/auth/hero-test')
        .set('Authorization', `Bearer ${adminToken}`);
      assert.strictEqual(resHero.status, 403);

      const resCitizen = await request(app)
        .get('/api/auth/citizen-test')
        .set('Authorization', `Bearer ${adminToken}`);
      assert.strictEqual(resCitizen.status, 403);
    });

    it('2.2 should return HTTP 403 when a token possesses arbitrary role ("Villain")', async () => {
      const villainToken = jwt.sign(
        { id: 66, username: 'green_goblin', role: 'Villain' },
        config.jwtSecret,
        { expiresIn: '1h' }
      );

      const resHero = await request(app)
        .get('/api/auth/hero-test')
        .set('Authorization', `Bearer ${villainToken}`);
      assert.strictEqual(resHero.status, 403);
    });

    it('2.3 should return HTTP 401 when token payload lacks the "role" claim entirely', async () => {
      const noRoleToken = jwt.sign(
        { id: 10, username: 'roleless_user' },
        config.jwtSecret,
        { expiresIn: '1h' }
      );

      const res = await request(app)
        .get('/api/auth/hero-test')
        .set('Authorization', `Bearer ${noRoleToken}`);
      assert.strictEqual(res.status, 401);
      assert.match(res.body.error, /authentication required/i);
    });

    it('2.4 should return HTTP 401 when token role claim is null or empty string', async () => {
      const nullRoleToken = jwt.sign(
        { id: 11, username: 'null_role_user', role: null },
        config.jwtSecret,
        { expiresIn: '1h' }
      );

      const res = await request(app)
        .get('/api/auth/citizen-test')
        .set('Authorization', `Bearer ${nullRoleToken}`);
      assert.strictEqual(res.status, 401);
    });

    it('2.5 should enforce cross-role mutual exclusion (Citizen blocked from Hero, Hero blocked from Citizen)', async () => {
      const citizenToken = jwt.sign(
        { id: 1, username: 'a_citizen', role: 'Citizen' },
        config.jwtSecret,
        { expiresIn: '1h' }
      );
      const heroToken = jwt.sign(
        { id: 2, username: 'a_hero', role: 'Hero' },
        config.jwtSecret,
        { expiresIn: '1h' }
      );

      // Citizen -> Hero endpoint = 403
      const res1 = await request(app)
        .get('/api/auth/hero-test')
        .set('Authorization', `Bearer ${citizenToken}`);
      assert.strictEqual(res1.status, 403);

      // Hero -> Citizen endpoint = 403
      const res2 = await request(app)
        .get('/api/auth/citizen-test')
        .set('Authorization', `Bearer ${heroToken}`);
      assert.strictEqual(res2.status, 403);

      // Citizen -> Citizen endpoint = 200
      const res3 = await request(app)
        .get('/api/auth/citizen-test')
        .set('Authorization', `Bearer ${citizenToken}`);
      assert.strictEqual(res3.status, 200);

      // Hero -> Hero endpoint = 200
      const res4 = await request(app)
        .get('/api/auth/hero-test')
        .set('Authorization', `Bearer ${heroToken}`);
      assert.strictEqual(res4.status, 200);
    });

    it('2.6 should reject registration role escalation attempts with 400 Bad Request', async () => {
      const invalidRoles = ['Admin', 'SuperUser', 'Root', 'hero', 'CITIZEN', 'Moderator', '123'];

      for (const role of invalidRoles) {
        const res = await request(app)
          .post('/api/auth/register')
          .send({
            username: `user_${role.toLowerCase()}`,
            email: `${role.toLowerCase()}@test.com`,
            password: 'Password123!',
            role: role
          });
        assert.strictEqual(res.status, 400, `Expected 400 for role "${role}", got ${res.status}`);
        assert.match(res.body.error, /role/i);
      }
    });

    it('2.7 should ignore extra/poisoned body fields during registration and NOT elevate permissions', async () => {
      const res = await request(app)
        .post('/api/auth/register')
        .send({
          username: 'payload_polluter',
          email: 'polluter@test.com',
          password: 'Password123!',
          role: 'Citizen',
          isAdmin: true,
          role_override: 'Hero',
          is_admin: 1,
          permissions: ['ALL', 'HERO']
        });

      assert.strictEqual(res.status, 201);
      assert.strictEqual(res.body.user.role, 'Citizen');

      // Verify in DB directly
      const db = getDatabase();
      const dbUser = db.get('SELECT * FROM users WHERE username = ?', ['payload_polluter']);
      assert.strictEqual(dbUser.role, 'Citizen');

      // Test that the token issued cannot access Hero routes
      const heroAccessRes = await request(app)
        .get('/api/auth/hero-test')
        .set('Authorization', `Bearer ${res.body.token}`);
      assert.strictEqual(heroAccessRes.status, 403);
    });
  });

  // =========================================================================
  // Challenge 3: Case Sensitivity and Duplicate Collision
  // =========================================================================
  describe('Challenge 3: Username and Email Case Sensitivity & Collision', () => {
    it('3.1 should reject case-variant duplicate usernames with 409 Conflict (e.g. SpiderMan vs spiderman)', async () => {
      // Register initial user
      const initial = await request(app)
        .post('/api/auth/register')
        .send({
          username: 'SpiderMan',
          email: 'spidey@queens.nyc',
          password: 'Password123!',
          role: 'Hero'
        });
      assert.strictEqual(initial.status, 201);

      // Attempt exact lowercase collision
      const lower = await request(app)
        .post('/api/auth/register')
        .send({
          username: 'spiderman',
          email: 'spiderman_alt@queens.nyc',
          password: 'Password123!',
          role: 'Citizen'
        });
      assert.strictEqual(lower.status, 409, 'Lowercase duplicate username must return 409 Conflict');
      assert.match(lower.body.error, /username/i);

      // Attempt exact uppercase collision
      const upper = await request(app)
        .post('/api/auth/register')
        .send({
          username: 'SPIDERMAN',
          email: 'spiderman_upper@queens.nyc',
          password: 'Password123!',
          role: 'Hero'
        });
      assert.strictEqual(upper.status, 409, 'Uppercase duplicate username must return 409 Conflict');

      // Attempt mixed-case collision
      const mixed = await request(app)
        .post('/api/auth/register')
        .send({
          username: 'sPiDeRmAn',
          email: 'spiderman_mixed@queens.nyc',
          password: 'Password123!',
          role: 'Hero'
        });
      assert.strictEqual(mixed.status, 409, 'Mixed-case duplicate username must return 409 Conflict');

      // Attempt collision with padded whitespace
      const padded = await request(app)
        .post('/api/auth/register')
        .send({
          username: '  spiderman  ',
          email: 'spiderman_padded@queens.nyc',
          password: 'Password123!',
          role: 'Hero'
        });
      assert.strictEqual(padded.status, 409, 'Padded duplicate username must return 409 Conflict');
    });

    it('3.2 should allow login with case-insensitive username match', async () => {
      // Register with PascalCase username
      await request(app)
        .post('/api/auth/register')
        .send({
          username: 'PeterParker',
          email: 'peter@dailybugle.com',
          password: 'WebSlingerPassword123!',
          role: 'Citizen'
        });

      // Login with lowercase
      const resLower = await request(app)
        .post('/api/auth/login')
        .send({
          username: 'peterparker',
          password: 'WebSlingerPassword123!'
        });
      assert.strictEqual(resLower.status, 200, 'Login with lowercase username must succeed');
      assert.ok(resLower.body.token);

      // Login with uppercase
      const resUpper = await request(app)
        .post('/api/auth/login')
        .send({
          username: 'PETERPARKER',
          password: 'WebSlingerPassword123!'
        });
      assert.strictEqual(resUpper.status, 200, 'Login with uppercase username must succeed');

      // Login with mixed case
      const resMixed = await request(app)
        .post('/api/auth/login')
        .send({
          username: 'pEtErPaRkEr',
          password: 'WebSlingerPassword123!'
        });
      assert.strictEqual(resMixed.status, 200, 'Login with mixed-case username must succeed');

      // Login with case-insensitive username but incorrect password must return 401
      const resBadPass = await request(app)
        .post('/api/auth/login')
        .send({
          username: 'peterparker',
          password: 'WrongPassword999!'
        });
      assert.strictEqual(resBadPass.status, 401);
    });

    it('3.3 should reject case-variant duplicate emails with 409 Conflict', async () => {
      const initial = await request(app)
        .post('/api/auth/register')
        .send({
          username: 'user_orig',
          email: 'Tony.Stark@StarkIndustries.com',
          password: 'Password123!',
          role: 'Hero'
        });
      assert.strictEqual(initial.status, 201);

      // Attempt lowercase duplicate email
      const lower = await request(app)
        .post('/api/auth/register')
        .send({
          username: 'user_new1',
          email: 'tony.stark@starkindustries.com',
          password: 'Password123!',
          role: 'Citizen'
        });
      assert.strictEqual(lower.status, 409, 'Lowercase duplicate email must return 409 Conflict');
      assert.match(lower.body.error, /email/i);

      // Attempt all-caps duplicate email
      const upper = await request(app)
        .post('/api/auth/register')
        .send({
          username: 'user_new2',
          email: 'TONY.STARK@STARKINDUSTRIES.COM',
          password: 'Password123!',
          role: 'Hero'
        });
      assert.strictEqual(upper.status, 409, 'Uppercase duplicate email must return 409 Conflict');
    });

    it('3.4 should reject case-variant duplicate usernames even under concurrent registration race conditions (409 Conflict)', async () => {
      const [res1, res2] = await Promise.all([
        request(app).post('/api/auth/register').send({
          username: 'SpiderMan',
          email: 'concurrent1@queens.nyc',
          password: 'Password123!',
          role: 'Hero'
        }),
        request(app).post('/api/auth/register').send({
          username: 'spiderman',
          email: 'concurrent2@queens.nyc',
          password: 'Password456!',
          role: 'Citizen'
        })
      ]);

      const statuses = [res1.status, res2.status].sort();
      assert.deepStrictEqual(statuses, [201, 409], 'Exactly one registration should succeed with 201, and the case-colliding one must fail with 409 Conflict');
    });
  });

  // =========================================================================
  // Challenge 4: Payload Injection & Edge Case Boundaries
  // =========================================================================
  describe('Challenge 4: Payload Injection, Boundaries & Negative Inputs', () => {
    it('4.1 should safely handle SQL injection payloads in username and email without executing SQL', async () => {
      const sqliPayloads = [
        "' OR '1'='1",
        "'; DROP TABLE users; --",
        "admin'--",
        "' UNION SELECT 1, 'hacked', 'hacked@evil.com', 'hacked', 'Hero', '2026', '2026' --"
      ];

      for (let i = 0; i < sqliPayloads.length; i++) {
        const payload = sqliPayloads[i];
        const res = await request(app)
          .post('/api/auth/register')
          .send({
            username: `sqli_${i}_${payload.slice(0, 10)}`,
            email: `sqli_${i}@test.com`,
            password: 'Password123!',
            role: 'Citizen'
          });

        // The query must either succeed safely as a literal string or return 400 validation error
        assert.ok([201, 400].includes(res.status), `Unexpected status ${res.status} for payload: ${payload}`);

        // Verify users table was NOT dropped and remains queryable
        const db = getDatabase();
        const count = db.get('SELECT COUNT(*) as cnt FROM users');
        assert.ok(count.cnt >= 0, 'Database table must remain intact');
      }
    });

    it('4.2 should reject SQL injection attempts in login with 401 Unauthorized', async () => {
      const sqliLoginPayloads = [
        { username: "' OR '1'='1", password: "' OR '1'='1" },
        { username: "admin'--", password: "irrelevant" },
        { username: "' UNION SELECT 1, 'admin', 'admin@mail.com', 'hash', 'Hero', 'now', 'now' --", password: "any" }
      ];

      for (const payload of sqliLoginPayloads) {
        const res = await request(app)
          .post('/api/auth/login')
          .send(payload);

        assert.strictEqual(res.status, 401, `SQLi login should yield 401, got ${res.status}`);
        assert.match(res.body.error, /invalid credentials|unauthorized/i);
      }
    });

    it('4.3 should not be vulnerable to prototype pollution payloads', async () => {
      const protoPayload = JSON.parse(
        '{"__proto__": {"polluted": true, "role": "Hero"}, "username": "proto_user", "email": "proto@safe.com", "password": "Password123!", "role": "Citizen"}'
      );

      const res = await request(app)
        .post('/api/auth/register')
        .send(protoPayload);

      assert.strictEqual(res.status, 201);
      assert.strictEqual(res.body.user.role, 'Citizen');
      assert.strictEqual(Object.prototype.polluted, undefined, 'Global prototype must not be polluted');
    });

    it('4.4 should reject non-string types for all required registration fields with 400 Bad Request', async () => {
      const typeAttacks = [
        { username: 12345, email: 'valid@mail.com', password: 'Password123!', role: 'Citizen' },
        { username: true, email: 'valid@mail.com', password: 'Password123!', role: 'Citizen' },
        { username: ['array_user'], email: 'valid@mail.com', password: 'Password123!', role: 'Citizen' },
        { username: { obj: 'user' }, email: 'valid@mail.com', password: 'Password123!', role: 'Citizen' },
        { username: 'valid_user', email: 12345, password: 'Password123!', role: 'Citizen' },
        { username: 'valid_user', email: 'valid@mail.com', password: 123456, role: 'Citizen' },
        { username: 'valid_user', email: 'valid@mail.com', password: 'Password123!', role: 1 }
      ];

      for (const attack of typeAttacks) {
        const res = await request(app)
          .post('/api/auth/register')
          .send(attack);
        assert.strictEqual(res.status, 400, `Type mismatch should be rejected with 400: ${JSON.stringify(attack)}`);
      }
    });

    it('4.5 should enforce exact boundary limits on username length (min: 3, max: 50)', async () => {
      // Length 2: below min (3) -> 400
      const resTooShort = await request(app)
        .post('/api/auth/register')
        .send({ username: 'ab', email: 'short@test.com', password: 'Password123!', role: 'Citizen' });
      assert.strictEqual(resTooShort.status, 400);

      // Length 3: exact min -> 201
      const resExactMin = await request(app)
        .post('/api/auth/register')
        .send({ username: 'abc', email: 'exactmin@test.com', password: 'Password123!', role: 'Citizen' });
      assert.strictEqual(resExactMin.status, 201);

      // Length 50: exact max -> 201
      const max50Username = 'u'.repeat(50);
      const resExactMax = await request(app)
        .post('/api/auth/register')
        .send({ username: max50Username, email: 'exactmax@test.com', password: 'Password123!', role: 'Citizen' });
      assert.strictEqual(resExactMax.status, 201);

      // Length 51: above max (50) -> 400
      const tooLong51 = 'u'.repeat(51);
      const resTooLong = await request(app)
        .post('/api/auth/register')
        .send({ username: tooLong51, email: 'toolong@test.com', password: 'Password123!', role: 'Citizen' });
      assert.strictEqual(resTooLong.status, 400);
    });

    it('4.6 should enforce exact boundary limits on password length (min: 6, max: 100)', async () => {
      // Length 5: below min (6) -> 400
      const resShort = await request(app)
        .post('/api/auth/register')
        .send({ username: 'pass_short', email: 'p5@test.com', password: '12345', role: 'Citizen' });
      assert.strictEqual(resShort.status, 400);

      // Length 6: exact min -> 201
      const resMin = await request(app)
        .post('/api/auth/register')
        .send({ username: 'pass_min', email: 'p6@test.com', password: '123456', role: 'Citizen' });
      assert.strictEqual(resMin.status, 201);

      // Length 100: exact max -> 201
      const max100Pass = 'P'.repeat(100);
      const resMax = await request(app)
        .post('/api/auth/register')
        .send({ username: 'pass_max', email: 'p100@test.com', password: max100Pass, role: 'Citizen' });
      assert.strictEqual(resMax.status, 201);

      // Length 101: above max (100) -> 400
      const tooLong101Pass = 'P'.repeat(101);
      const resTooLong = await request(app)
        .post('/api/auth/register')
        .send({ username: 'pass_toolong', email: 'p101@test.com', password: tooLong101Pass, role: 'Citizen' });
      assert.strictEqual(resTooLong.status, 400);
    });

    it('4.7 should reject invalid email formats with 400 Bad Request', async () => {
      const invalidEmails = [
        'plainaddress',
        '@missingusername.com',
        'username@.com',
        'username@domain',
        'username space@domain.com',
        'username@domain com'
      ];

      for (const email of invalidEmails) {
        const res = await request(app)
          .post('/api/auth/register')
          .send({
            username: `email_test_${Math.random().toString(36).substring(7)}`,
            email: email,
            password: 'Password123!',
            role: 'Citizen'
          });
        assert.strictEqual(res.status, 400, `Expected 400 for invalid email: "${email}", got ${res.status}`);
      }
    });

    it('4.8 should handle malformed JSON syntax gracefully with 400 Bad Request', async () => {
      const res = await request(app)
        .post('/api/auth/register')
        .set('Content-Type', 'application/json')
        .send('{"username": "broken_json", "email": "broken@');

      assert.strictEqual(res.status, 400);
      assert.ok(res.body.error);
    });

    it('4.9 should reject empty or non-object bodies with 400 Bad Request', async () => {
      // Empty body
      const resEmptyReg = await request(app)
        .post('/api/auth/register')
        .send({});
      assert.strictEqual(resEmptyReg.status, 400);

      // Array body
      const resArrayReg = await request(app)
        .post('/api/auth/register')
        .send([1, 2, 3]);
      assert.strictEqual(resArrayReg.status, 400);

      // Empty login
      const resEmptyLogin = await request(app)
        .post('/api/auth/login')
        .send({});
      assert.strictEqual(resEmptyLogin.status, 400);

      // Array login
      const resArrayLogin = await request(app)
        .post('/api/auth/login')
        .send([]);
      assert.strictEqual(resArrayLogin.status, 400);
    });
  });
});
