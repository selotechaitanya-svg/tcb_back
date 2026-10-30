/**
 * Tier 2: Boundary, Negative & Corner Cases (>= 55 test cases)
 * Verifies robust validation, security, and error handling:
 * 1. Registration Boundaries & Error Handling (6 cases)
 * 2. Login Boundaries & Security (5 cases)
 * 3. JWT Token Validation Boundaries (5 cases)
 * 4. Role-Based Authorization Guards (RBAC Mismatches) (5 cases)
 * 5. Incident Creation Validation & Boundaries (5 cases)
 * 6. Citizen Data Scoping & Privacy Enforcement (5 cases)
 * 7. Hero Open Incident Listing Boundaries (5 cases)
 * 8. Incident Claiming Boundaries & Conflicts (5 cases)
 * 9. State Machine Invalid Transitions (Rejections) (6 cases)
 * 10. Status History Boundaries & Integrity (5 cases)
 * 11. Filtering & Pagination Boundaries (5 cases)
 */

const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { getApp, request, resetDb } = require('./testHelper');

describe('Tier 2: Boundary & Corner Cases (Negative & Edge)', () => {
  let app;

  beforeEach(() => {
    resetDb();
    app = getApp();
  });

  // =========================================================================
  // Feature 1: Registration Boundaries (6 test cases)
  // =========================================================================
  describe('Feature 1: Registration Boundaries', () => {
    it('1.1 should reject registration with invalid role (400 Bad Request)', async () => {
      const res = await request(app)
        .post('/api/auth/register')
        .send({
          username: 'green_goblin',
          email: 'goblin@oscorp.com',
          password: 'PumpkinBomb123!',
          role: 'Villain',
        })
        .expect(400);

      assert.ok(res.body.error || res.body.message);
    });

    it('1.2 should reject registration with duplicate username (409 Conflict)', async () => {
      await request(app)
        .post('/api/auth/register')
        .send({
          username: 'duplicate_user_1',
          email: 'dup1@test.com',
          password: 'ValidPassword123!',
          role: 'Citizen',
        })
        .expect(201);

      const res = await request(app)
        .post('/api/auth/register')
        .send({
          username: 'duplicate_user_1',
          email: 'other_email@test.com',
          password: 'ValidPassword123!',
          role: 'Hero',
        })
        .expect(409);

      assert.ok(res.body.error || res.body.message);
    });

    it('1.3 should reject registration with duplicate email (409 Conflict)', async () => {
      await request(app)
        .post('/api/auth/register')
        .send({
          username: 'first_user_email',
          email: 'shared@test.com',
          password: 'ValidPassword123!',
          role: 'Citizen',
        })
        .expect(201);

      const res = await request(app)
        .post('/api/auth/register')
        .send({
          username: 'second_user_email',
          email: 'shared@test.com',
          password: 'ValidPassword123!',
          role: 'Citizen',
        })
        .expect(409);

      assert.ok(res.body.error || res.body.message);
    });

    it('1.4 should reject registration with missing or empty password (400 Bad Request)', async () => {
      const res = await request(app)
        .post('/api/auth/register')
        .send({
          username: 'no_pass_user',
          email: 'nopass@test.com',
          password: '',
          role: 'Citizen',
        })
        .expect(400);

      assert.ok(res.body.error || res.body.message);
    });

    it('1.5 should reject registration with invalid email format (400 Bad Request)', async () => {
      const res = await request(app)
        .post('/api/auth/register')
        .send({
          username: 'bad_email_user',
          email: 'not-an-email-address',
          password: 'ValidPassword123!',
          role: 'Citizen',
        })
        .expect(400);

      assert.ok(res.body.error || res.body.message);
    });

    it('1.6 should reject registration with missing or whitespace-only username (400 Bad Request)', async () => {
      const res = await request(app)
        .post('/api/auth/register')
        .send({
          username: '   ',
          email: 'spaces@test.com',
          password: 'ValidPassword123!',
          role: 'Citizen',
        })
        .expect(400);

      assert.ok(res.body.error || res.body.message);
    });
  });

  // =========================================================================
  // Feature 2: Login Boundaries & Security (5 test cases)
  // =========================================================================
  describe('Feature 2: Login Boundaries & Security', () => {
    it('2.1 should reject login for non-existent username with 401 Unauthorized', async () => {
      const res = await request(app)
        .post('/api/auth/login')
        .send({
          username: 'completely_nonexistent_user_9999',
          password: 'SomePassword123!',
        })
        .expect(401);

      assert.ok(res.body.error || res.body.message);
    });

    it('2.2 should reject login with correct username but wrong password with 401 Unauthorized', async () => {
      await request(app)
        .post('/api/auth/register')
        .send({
          username: 'real_user_wrong_pass',
          email: 'real@test.com',
          password: 'CorrectPassword123!',
          role: 'Citizen',
        })
        .expect(201);

      const res = await request(app)
        .post('/api/auth/login')
        .send({
          username: 'real_user_wrong_pass',
          password: 'WrongPassword456!',
        })
        .expect(401);

      assert.ok(res.body.error || res.body.message);
    });

    it('2.3 should reject login with empty username or empty password with 400 Bad Request', async () => {
      const res1 = await request(app)
        .post('/api/auth/login')
        .send({ username: '', password: 'SomePassword123!' })
        .expect(400);

      const res2 = await request(app)
        .post('/api/auth/login')
        .send({ username: 'some_user', password: '' })
        .expect(400);

      assert.ok(res1.body.error || res1.body.message);
      assert.ok(res2.body.error || res2.body.message);
    });

    it('2.4 should reject login with empty JSON body {} with 400 Bad Request', async () => {
      const res = await request(app)
        .post('/api/auth/login')
        .send({})
        .expect(400);

      assert.ok(res.body.error || res.body.message);
    });

    it('2.5 should reject SQL injection payload in login without crashing or granting access', async () => {
      const res = await request(app)
        .post('/api/auth/login')
        .send({
          username: "' OR '1'='1",
          password: "' OR '1'='1",
        })
        .expect(401);

      assert.strictEqual(res.body.token, undefined);
    });
  });

  // =========================================================================
  // Feature 3: JWT Token Validation Boundaries (5 test cases)
  // =========================================================================
  describe('Feature 3: JWT Token Validation Boundaries', () => {
    it('3.1 should reject protected requests with missing Authorization header (401)', async () => {
      const res = await request(app)
        .get('/api/incidents')
        .expect(401);

      assert.ok(res.body.error || res.body.message);
    });

    it('3.2 should reject requests with non-Bearer auth schemes (e.g. Basic) with 401', async () => {
      const res = await request(app)
        .get('/api/incidents')
        .set('Authorization', 'Basic dXNlcjpwYXNz')
        .expect(401);

      assert.ok(res.body.error || res.body.message);
    });

    it('3.3 should reject requests with empty Bearer header (401)', async () => {
      const res = await request(app)
        .get('/api/incidents')
        .set('Authorization', 'Bearer ')
        .expect(401);

      assert.ok(res.body.error || res.body.message);
    });

    it('3.4 should reject requests with garbage string Bearer token (401)', async () => {
      const res = await request(app)
        .get('/api/incidents')
        .set('Authorization', 'Bearer totally-invalid-random-string')
        .expect(401);

      assert.ok(res.body.error || res.body.message);
    });

    it('3.5 should reject requests with tampered JWT signature (401)', async () => {
      const reg = await request(app)
        .post('/api/auth/register')
        .send({
          username: 'tamper_test_user',
          email: 'tamper@test.com',
          password: 'ValidPassword123!',
          role: 'Citizen',
        })
        .expect(201);

      const parts = reg.body.token.split('.');
      // Tamper signature part
      const tamperedToken = `${parts[0]}.${parts[1]}.invalidsignaturexyz123`;

      const res = await request(app)
        .get('/api/incidents')
        .set('Authorization', `Bearer ${tamperedToken}`)
        .expect(401);

      assert.ok(res.body.error || res.body.message);
    });
  });

  // =========================================================================
  // Feature 4: Role-Based Authorization Guards (5 test cases)
  // =========================================================================
  describe('Feature 4: Role-Based Authorization Guards', () => {
    let citizenToken;
    let heroToken;
    let incidentId;

    beforeEach(async () => {
      const cit = await request(app)
        .post('/api/auth/register')
        .send({
          username: 'guard_cit_user',
          email: 'guardcit@test.com',
          password: 'ValidPassword123!',
          role: 'Citizen',
        })
        .expect(201);
      citizenToken = cit.body.token;

      const inc = await request(app)
        .post('/api/incidents')
        .set('Authorization', `Bearer ${citizenToken}`)
        .send({
          title: 'Hostage at Pier',
          description: 'Hostage in container',
          category: 'Robbery',
          severity: 5,
          location: 'Pier 17',
        })
        .expect(201);
      incidentId = inc.body.id;

      const hero = await request(app)
        .post('/api/auth/register')
        .send({
          username: 'guard_hero_user',
          email: 'guardhero@test.com',
          password: 'ValidPassword123!',
          role: 'Hero',
        })
        .expect(201);
      heroToken = hero.body.token;
    });

    it('4.1 should reject Citizen attempting to claim incident with 403 Forbidden', async () => {
      const res = await request(app)
        .post(`/api/incidents/${incidentId}/claim`)
        .set('Authorization', `Bearer ${citizenToken}`)
        .expect(403);

      assert.ok(res.body.error || res.body.message);
    });

    it('4.2 should reject Citizen attempting to update incident status with 403 Forbidden', async () => {
      // First hero claims it
      await request(app)
        .post(`/api/incidents/${incidentId}/claim`)
        .set('Authorization', `Bearer ${heroToken}`)
        .expect(200);

      // Citizen attempts status update
      const res = await request(app)
        .patch(`/api/incidents/${incidentId}/status`)
        .set('Authorization', `Bearer ${citizenToken}`)
        .send({ status: 'In Progress' })
        .expect(403);

      assert.ok(res.body.error || res.body.message);
    });

    it('4.3 should reject Hero attempting to create incident with 403 Forbidden', async () => {
      const res = await request(app)
        .post('/api/incidents')
        .set('Authorization', `Bearer ${heroToken}`)
        .send({
          title: 'Hero Self Report',
          description: 'Hero trying to file incident',
          category: 'Patrol',
          severity: 1,
          location: 'Midtown',
        })
        .expect(403);

      assert.ok(res.body.error || res.body.message);
    });

    it('4.4 should reject unassigned Hero attempting to transition status of another hero incident (403)', async () => {
      // Hero 1 claims incident
      await request(app)
        .post(`/api/incidents/${incidentId}/claim`)
        .set('Authorization', `Bearer ${heroToken}`)
        .expect(200);

      // Hero 2 registers
      const hero2 = await request(app)
        .post('/api/auth/register')
        .send({
          username: 'other_hero_interloper',
          email: 'interloper@test.com',
          password: 'ValidPassword123!',
          role: 'Hero',
        })
        .expect(201);

      // Hero 2 attempts to update status of Hero 1's incident
      const res = await request(app)
        .patch(`/api/incidents/${incidentId}/status`)
        .set('Authorization', `Bearer ${hero2.body.token}`)
        .send({ status: 'In Progress' })
        .expect(403);

      assert.ok(res.body.error || res.body.message);
    });

    it('4.5 should reject unassigned Hero attempting to resolve another hero incident (403)', async () => {
      // Hero 1 claims and moves to In Progress
      await request(app)
        .post(`/api/incidents/${incidentId}/claim`)
        .set('Authorization', `Bearer ${heroToken}`)
        .expect(200);

      await request(app)
        .patch(`/api/incidents/${incidentId}/status`)
        .set('Authorization', `Bearer ${heroToken}`)
        .send({ status: 'In Progress' })
        .expect(200);

      // Hero 2 registers
      const hero2 = await request(app)
        .post('/api/auth/register')
        .send({
          username: 'other_hero_resolver',
          email: 'otherresolver@test.com',
          password: 'ValidPassword123!',
          role: 'Hero',
        })
        .expect(201);

      // Hero 2 attempts to resolve
      const res = await request(app)
        .patch(`/api/incidents/${incidentId}/status`)
        .set('Authorization', `Bearer ${hero2.body.token}`)
        .send({ status: 'Resolved' })
        .expect(403);

      assert.ok(res.body.error || res.body.message);
    });
  });

  // =========================================================================
  // Feature 5: Incident Creation Validation & Boundaries (5 test cases)
  // =========================================================================
  describe('Feature 5: Incident Creation Validation & Boundaries', () => {
    let citizenToken;

    beforeEach(async () => {
      const cit = await request(app)
        .post('/api/auth/register')
        .send({
          username: 'val_cit_user',
          email: 'valcit@test.com',
          password: 'ValidPassword123!',
          role: 'Citizen',
        })
        .expect(201);
      citizenToken = cit.body.token;
    });

    it('5.1 should reject severity = 0 (below minimum 1) with 400 Bad Request', async () => {
      const res = await request(app)
        .post('/api/incidents')
        .set('Authorization', `Bearer ${citizenToken}`)
        .send({
          title: 'Severity Low Error',
          description: 'Testing lower bound',
          category: 'Rescue',
          severity: 0,
          location: 'Battery Park',
        })
        .expect(400);

      assert.ok(res.body.error || res.body.message);
    });

    it('5.2 should reject severity = 6 (above maximum 5) with 400 Bad Request', async () => {
      const res = await request(app)
        .post('/api/incidents')
        .set('Authorization', `Bearer ${citizenToken}`)
        .send({
          title: 'Severity High Error',
          description: 'Testing upper bound',
          category: 'Disaster',
          severity: 6,
          location: 'Times Square',
        })
        .expect(400);

      assert.ok(res.body.error || res.body.message);
    });

    it('5.3 should reject non-integer severity (e.g. 3.5 or string "high") with 400 Bad Request', async () => {
      const res1 = await request(app)
        .post('/api/incidents')
        .set('Authorization', `Bearer ${citizenToken}`)
        .send({
          title: 'Float Severity',
          description: 'Desc',
          category: 'Fire',
          severity: 3.5,
          location: 'SoHo',
        })
        .expect(400);

      const res2 = await request(app)
        .post('/api/incidents')
        .set('Authorization', `Bearer ${citizenToken}`)
        .send({
          title: 'String Severity',
          description: 'Desc',
          category: 'Fire',
          severity: 'high',
          location: 'SoHo',
        })
        .expect(400);

      assert.ok(res1.body.error || res1.body.message);
      assert.ok(res2.body.error || res2.body.message);
    });

    it('5.4 should reject empty or whitespace-only title with 400 Bad Request', async () => {
      const res = await request(app)
        .post('/api/incidents')
        .set('Authorization', `Bearer ${citizenToken}`)
        .send({
          title: '   ',
          description: 'Valid description',
          category: 'Theft',
          severity: 3,
          location: 'Harlem',
        })
        .expect(400);

      assert.ok(res.body.error || res.body.message);
    });

    it('5.5 should reject missing description or missing location with 400 Bad Request', async () => {
      const res1 = await request(app)
        .post('/api/incidents')
        .set('Authorization', `Bearer ${citizenToken}`)
        .send({
          title: 'Missing Desc Incident',
          category: 'Theft',
          severity: 3,
          location: 'Harlem',
        })
        .expect(400);

      const res2 = await request(app)
        .post('/api/incidents')
        .set('Authorization', `Bearer ${citizenToken}`)
        .send({
          title: 'Missing Location Incident',
          description: 'Desc',
          category: 'Theft',
          severity: 3,
        })
        .expect(400);

      assert.ok(res1.body.error || res1.body.message);
      assert.ok(res2.body.error || res2.body.message);
    });
  });

  // =========================================================================
  // Feature 6: Citizen Data Scoping Boundaries (5 test cases)
  // =========================================================================
  describe('Feature 6: Citizen Data Scoping Boundaries', () => {
    let citAToken;
    let citBToken;
    let incidentBId;

    beforeEach(async () => {
      const citA = await request(app)
        .post('/api/auth/register')
        .send({
          username: 'scope_bound_a',
          email: 'scopea@test.com',
          password: 'ValidPassword123!',
          role: 'Citizen',
        })
        .expect(201);
      citAToken = citA.body.token;

      const citB = await request(app)
        .post('/api/auth/register')
        .send({
          username: 'scope_bound_b',
          email: 'scopeb@test.com',
          password: 'ValidPassword123!',
          role: 'Citizen',
        })
        .expect(201);
      citBToken = citB.body.token;

      const incB = await request(app)
        .post('/api/incidents')
        .set('Authorization', `Bearer ${citBToken}`)
        .send({
          title: 'Citizen B Private Report',
          description: 'Private emergency',
          category: 'Hazard',
          severity: 4,
          location: 'Upper West Side',
        })
        .expect(201);
      incidentBId = incB.body.id;
    });

    it('6.1 should reject Citizen A accessing Citizen B incident by ID with 403 or 404', async () => {
      const res = await request(app)
        .get(`/api/incidents/${incidentBId}`)
        .set('Authorization', `Bearer ${citAToken}`);

      assert.ok(
        res.status === 403 || res.status === 404,
        `Expected 403 or 404 but got ${res.status}`
      );
    });

    it('6.2 should return 404 Not Found for non-existent incident ID', async () => {
      const res = await request(app)
        .get('/api/incidents/999999')
        .set('Authorization', `Bearer ${citAToken}`)
        .expect(404);

      assert.ok(res.body.error || res.body.message);
    });

    it('6.3 should return 400 or 404 for negative incident ID', async () => {
      const res = await request(app)
        .get('/api/incidents/-1')
        .set('Authorization', `Bearer ${citAToken}`);

      assert.ok(
        res.status === 400 || res.status === 404,
        `Expected 400 or 404 but got ${res.status}`
      );
    });

    it('6.4 should return 400 or 404 for non-numeric incident ID string', async () => {
      const res = await request(app)
        .get('/api/incidents/invalid-string-id')
        .set('Authorization', `Bearer ${citAToken}`);

      assert.ok(
        res.status === 400 || res.status === 404,
        `Expected 400 or 404 but got ${res.status}`
      );
    });

    it('6.5 should ensure Citizen list filters cannot leak other citizens incidents', async () => {
      const res = await request(app)
        .get('/api/incidents?category=Hazard')
        .set('Authorization', `Bearer ${citAToken}`)
        .expect(200);

      const items = res.body.items || res.body;
      assert.strictEqual(items.length, 0);
    });
  });

  // =========================================================================
  // Feature 7: Hero Open Incident Boundaries (5 test cases)
  // =========================================================================
  describe('Feature 7: Hero Open Incident Boundaries', () => {
    let heroToken;

    beforeEach(async () => {
      const hero = await request(app)
        .post('/api/auth/register')
        .send({
          username: 'hero_bound_check',
          email: 'herobound@test.com',
          password: 'ValidPassword123!',
          role: 'Hero',
        })
        .expect(201);
      heroToken = hero.body.token;
    });

    it('7.1 should return 404 Not Found when Hero queries non-existent incident ID', async () => {
      const res = await request(app)
        .get('/api/incidents/888888')
        .set('Authorization', `Bearer ${heroToken}`)
        .expect(404);

      assert.ok(res.body.error || res.body.message);
    });

    it('7.2 should return 400 or 404 when Hero queries non-numeric incident ID', async () => {
      const res = await request(app)
        .get('/api/incidents/xyz-not-an-id')
        .set('Authorization', `Bearer ${heroToken}`);

      assert.ok(
        res.status === 400 || res.status === 404,
        `Expected 400 or 404 but got ${res.status}`
      );
    });

    it('7.3 should return 400 or 404 when Hero queries negative incident ID', async () => {
      const res = await request(app)
        .get('/api/incidents/-42')
        .set('Authorization', `Bearer ${heroToken}`);

      assert.ok(
        res.status === 400 || res.status === 404,
        `Expected 400 or 404 but got ${res.status}`
      );
    });

    it('7.4 should safely handle SQL injection in filter parameters without crashing', async () => {
      const res = await request(app)
        .get("/api/incidents?category=' OR '1'='1")
        .set('Authorization', `Bearer ${heroToken}`)
        .expect(200);

      const items = res.body.items || res.body;
      assert.strictEqual(items.length, 0);
    });

    it('7.5 should reject unauthenticated hero queries with 401 Unauthorized', async () => {
      await request(app)
        .get('/api/incidents')
        .expect(401);
    });
  });

  // =========================================================================
  // Feature 8: Incident Claiming Boundaries & Conflicts (5 test cases)
  // =========================================================================
  describe('Feature 8: Incident Claiming Boundaries & Conflicts', () => {
    let heroToken;
    let incidentId;

    beforeEach(async () => {
      const cit = await request(app)
        .post('/api/auth/register')
        .send({
          username: 'cit_claim_bound',
          email: 'claimbound@test.com',
          password: 'ValidPassword123!',
          role: 'Citizen',
        })
        .expect(201);

      const inc = await request(app)
        .post('/api/incidents')
        .set('Authorization', `Bearer ${cit.body.token}`)
        .send({
          title: 'Robbery at Bodega',
          description: 'Cash register taken',
          category: 'Robbery',
          severity: 3,
          location: 'Bushwick',
        })
        .expect(201);
      incidentId = inc.body.id;

      const hero = await request(app)
        .post('/api/auth/register')
        .send({
          username: 'hero_claim_bound',
          email: 'heroboundclaim@test.com',
          password: 'ValidPassword123!',
          role: 'Hero',
        })
        .expect(201);
      heroToken = hero.body.token;
    });

    it('8.1 should return 404 Not Found when attempting to claim non-existent incident', async () => {
      const res = await request(app)
        .post('/api/incidents/999999/claim')
        .set('Authorization', `Bearer ${heroToken}`)
        .expect(404);

      assert.ok(res.body.error || res.body.message);
    });

    it('8.2 should return 409 Conflict when attempting to claim already Claimed incident', async () => {
      // First claim succeeds
      await request(app)
        .post(`/api/incidents/${incidentId}/claim`)
        .set('Authorization', `Bearer ${heroToken}`)
        .expect(200);

      // Hero 2 registers and attempts second claim
      const hero2 = await request(app)
        .post('/api/auth/register')
        .send({
          username: 'second_hero_claimer',
          email: 'secondclaim@test.com',
          password: 'ValidPassword123!',
          role: 'Hero',
        })
        .expect(201);

      const res = await request(app)
        .post(`/api/incidents/${incidentId}/claim`)
        .set('Authorization', `Bearer ${hero2.body.token}`);

      assert.ok(
        res.status === 409 || res.status === 400,
        `Expected 409 or 400 but got ${res.status}`
      );
    });

    it('8.3 should return 409 Conflict when attempting to claim an In Progress incident', async () => {
      await request(app)
        .post(`/api/incidents/${incidentId}/claim`)
        .set('Authorization', `Bearer ${heroToken}`)
        .expect(200);

      await request(app)
        .patch(`/api/incidents/${incidentId}/status`)
        .set('Authorization', `Bearer ${heroToken}`)
        .send({ status: 'In Progress' })
        .expect(200);

      const hero2 = await request(app)
        .post('/api/auth/register')
        .send({
          username: 'late_hero_claimer',
          email: 'lateclaim@test.com',
          password: 'ValidPassword123!',
          role: 'Hero',
        })
        .expect(201);

      const res = await request(app)
        .post(`/api/incidents/${incidentId}/claim`)
        .set('Authorization', `Bearer ${hero2.body.token}`);

      assert.ok(
        res.status === 409 || res.status === 400,
        `Expected 409 or 400 but got ${res.status}`
      );
    });

    it('8.4 should return 409 Conflict when attempting to claim a Resolved incident', async () => {
      await request(app)
        .post(`/api/incidents/${incidentId}/claim`)
        .set('Authorization', `Bearer ${heroToken}`)
        .expect(200);

      await request(app)
        .patch(`/api/incidents/${incidentId}/status`)
        .set('Authorization', `Bearer ${heroToken}`)
        .send({ status: 'In Progress' })
        .expect(200);

      await request(app)
        .patch(`/api/incidents/${incidentId}/status`)
        .set('Authorization', `Bearer ${heroToken}`)
        .send({ status: 'Resolved' })
        .expect(200);

      const res = await request(app)
        .post(`/api/incidents/${incidentId}/claim`)
        .set('Authorization', `Bearer ${heroToken}`);

      assert.ok(
        res.status === 409 || res.status === 400,
        `Expected 409 or 400 but got ${res.status}`
      );
    });

    it('8.5 should return 400 or 404 when claiming with invalid incident ID format', async () => {
      const res = await request(app)
        .post('/api/incidents/not-an-id/claim')
        .set('Authorization', `Bearer ${heroToken}`);

      assert.ok(
        res.status === 400 || res.status === 404,
        `Expected 400 or 404 but got ${res.status}`
      );
    });
  });

  // =========================================================================
  // Feature 9: State Machine Invalid Transitions (6 test cases)
  // =========================================================================
  describe('Feature 9: State Machine Invalid Transitions', () => {
    let heroToken;
    let incidentId;

    beforeEach(async () => {
      const cit = await request(app)
        .post('/api/auth/register')
        .send({
          username: 'state_bound_cit',
          email: 'statecit@test.com',
          password: 'ValidPassword123!',
          role: 'Citizen',
        })
        .expect(201);

      const inc = await request(app)
        .post('/api/incidents')
        .set('Authorization', `Bearer ${cit.body.token}`)
        .send({
          title: 'State Transition Incident',
          description: 'Testing illegal jumps',
          category: 'Rescue',
          severity: 3,
          location: 'Battery Park',
        })
        .expect(201);
      incidentId = inc.body.id;

      const hero = await request(app)
        .post('/api/auth/register')
        .send({
          username: 'state_bound_hero',
          email: 'statehero@test.com',
          password: 'ValidPassword123!',
          role: 'Hero',
        })
        .expect(201);
      heroToken = hero.body.token;
    });

    it('9.1 should reject direct jump from Reported to In Progress with 400 Bad Request', async () => {
      const res = await request(app)
        .patch(`/api/incidents/${incidentId}/status`)
        .set('Authorization', `Bearer ${heroToken}`)
        .send({ status: 'In Progress' });

      assert.ok(
        res.status === 400 || res.status === 403,
        `Expected 400 or 403 but got ${res.status}`
      );
    });

    it('9.2 should reject direct jump from Reported to Resolved with 400 Bad Request', async () => {
      const res = await request(app)
        .patch(`/api/incidents/${incidentId}/status`)
        .set('Authorization', `Bearer ${heroToken}`)
        .send({ status: 'Resolved' });

      assert.ok(
        res.status === 400 || res.status === 403,
        `Expected 400 or 403 but got ${res.status}`
      );
    });

    it('9.3 should reject direct jump from Claimed to Resolved (skipping In Progress) with 400', async () => {
      await request(app)
        .post(`/api/incidents/${incidentId}/claim`)
        .set('Authorization', `Bearer ${heroToken}`)
        .expect(200);

      const res = await request(app)
        .patch(`/api/incidents/${incidentId}/status`)
        .set('Authorization', `Bearer ${heroToken}`)
        .send({ status: 'Resolved' })
        .expect(400);

      assert.ok(res.body.error || res.body.message);
    });

    it('9.4 should reject backward leap from In Progress back to Reported with 400 Bad Request', async () => {
      await request(app)
        .post(`/api/incidents/${incidentId}/claim`)
        .set('Authorization', `Bearer ${heroToken}`)
        .expect(200);

      await request(app)
        .patch(`/api/incidents/${incidentId}/status`)
        .set('Authorization', `Bearer ${heroToken}`)
        .send({ status: 'In Progress' })
        .expect(200);

      const res = await request(app)
        .patch(`/api/incidents/${incidentId}/status`)
        .set('Authorization', `Bearer ${heroToken}`)
        .send({ status: 'Reported' })
        .expect(400);

      assert.ok(res.body.error || res.body.message);
    });

    it('9.5 should reject terminal state mutation: updating a Resolved incident returns 400', async () => {
      await request(app)
        .post(`/api/incidents/${incidentId}/claim`)
        .set('Authorization', `Bearer ${heroToken}`)
        .expect(200);

      await request(app)
        .patch(`/api/incidents/${incidentId}/status`)
        .set('Authorization', `Bearer ${heroToken}`)
        .send({ status: 'In Progress' })
        .expect(200);

      await request(app)
        .patch(`/api/incidents/${incidentId}/status`)
        .set('Authorization', `Bearer ${heroToken}`)
        .send({ status: 'Resolved' })
        .expect(200);

      const res = await request(app)
        .patch(`/api/incidents/${incidentId}/status`)
        .set('Authorization', `Bearer ${heroToken}`)
        .send({ status: 'In Progress' })
        .expect(400);

      assert.ok(res.body.error || res.body.message);
    });

    it('9.6 should reject invalid status string (e.g. "Pending", "Closed") with 400 Bad Request', async () => {
      await request(app)
        .post(`/api/incidents/${incidentId}/claim`)
        .set('Authorization', `Bearer ${heroToken}`)
        .expect(200);

      const res = await request(app)
        .patch(`/api/incidents/${incidentId}/status`)
        .set('Authorization', `Bearer ${heroToken}`)
        .send({ status: 'PendingReview' })
        .expect(400);

      assert.ok(res.body.error || res.body.message);
    });
  });

  // =========================================================================
  // Feature 10: Status History Boundaries & Integrity (5 test cases)
  // =========================================================================
  describe('Feature 10: Status History Boundaries & Integrity', () => {
    let citizenToken;
    let incidentId;

    beforeEach(async () => {
      const cit = await request(app)
        .post('/api/auth/register')
        .send({
          username: 'hist_bound_cit',
          email: 'histbound@test.com',
          password: 'ValidPassword123!',
          role: 'Citizen',
        })
        .expect(201);
      citizenToken = cit.body.token;

      const inc = await request(app)
        .post('/api/incidents')
        .set('Authorization', `Bearer ${citizenToken}`)
        .send({
          title: 'History Integrity Incident',
          description: 'Testing history boundary',
          category: 'Robbery',
          severity: 3,
          location: 'SoHo',
        })
        .expect(201);
      incidentId = inc.body.id;
    });

    it('10.1 should return 404 Not Found when querying history for non-existent incident', async () => {
      const res = await request(app)
        .get('/api/incidents/999999/history')
        .set('Authorization', `Bearer ${citizenToken}`)
        .expect(404);

      assert.ok(res.body.error || res.body.message);
    });

    it('10.2 should reject Citizen querying history of another citizen incident with 403 or 404', async () => {
      const citOther = await request(app)
        .post('/api/auth/register')
        .send({
          username: 'hist_other_cit',
          email: 'histother@test.com',
          password: 'ValidPassword123!',
          role: 'Citizen',
        })
        .expect(201);

      const res = await request(app)
        .get(`/api/incidents/${incidentId}/history`)
        .set('Authorization', `Bearer ${citOther.body.token}`);

      assert.ok(
        res.status === 403 || res.status === 404,
        `Expected 403 or 404 but got ${res.status}`
      );
    });

    it('10.3 should return 400 or 404 when querying history with invalid ID format', async () => {
      const res = await request(app)
        .get('/api/incidents/not-a-number/history')
        .set('Authorization', `Bearer ${citizenToken}`);

      assert.ok(
        res.status === 400 || res.status === 404,
        `Expected 400 or 404 but got ${res.status}`
      );
    });

    it('10.4 should not record history entry when a status transition is rejected with 400', async () => {
      const hero = await request(app)
        .post('/api/auth/register')
        .send({
          username: 'hist_hero_reject',
          email: 'histreject@test.com',
          password: 'ValidPassword123!',
          role: 'Hero',
        })
        .expect(201);

      await request(app)
        .post(`/api/incidents/${incidentId}/claim`)
        .set('Authorization', `Bearer ${hero.body.token}`)
        .expect(200);

      // Attempt invalid jump Claimed -> Resolved (should fail)
      await request(app)
        .patch(`/api/incidents/${incidentId}/status`)
        .set('Authorization', `Bearer ${hero.body.token}`)
        .send({ status: 'Resolved' })
        .expect(400);

      const histRes = await request(app)
        .get(`/api/incidents/${incidentId}/history`)
        .set('Authorization', `Bearer ${hero.body.token}`)
        .expect(200);

      const history = Array.isArray(histRes.body) ? histRes.body : histRes.body.history;
      // Should only have initial Reported + Claimed (2 entries)
      assert.strictEqual(history.length, 2);
    });

    it('10.5 should reject unauthenticated requests to history endpoint with 401', async () => {
      await request(app)
        .get(`/api/incidents/${incidentId}/history`)
        .expect(401);
    });
  });

  // =========================================================================
  // Feature 11: Filtering & Pagination Boundaries (5 test cases)
  // =========================================================================
  describe('Feature 11: Filtering & Pagination Boundaries', () => {
    let heroToken;

    beforeEach(async () => {
      const hero = await request(app)
        .post('/api/auth/register')
        .send({
          username: 'pag_hero_user',
          email: 'paghero@test.com',
          password: 'ValidPassword123!',
          role: 'Hero',
        })
        .expect(201);
      heroToken = hero.body.token;
    });

    it('11.1 should handle negative page number (?page=-1) with 400 or clamped to page 1', async () => {
      const res = await request(app)
        .get('/api/incidents?page=-1')
        .set('Authorization', `Bearer ${heroToken}`);

      assert.ok(
        res.status === 400 || res.status === 200,
        `Expected 400 or 200 but got ${res.status}`
      );
    });

    it('11.2 should handle negative limit (?limit=-5) with 400 or clamped to default limit', async () => {
      const res = await request(app)
        .get('/api/incidents?limit=-5')
        .set('Authorization', `Bearer ${heroToken}`);

      assert.ok(
        res.status === 400 || res.status === 200,
        `Expected 400 or 200 but got ${res.status}`
      );
    });

    it('11.3 should handle non-numeric page and limit parameters gracefully', async () => {
      const res = await request(app)
        .get('/api/incidents?page=first&limit=all')
        .set('Authorization', `Bearer ${heroToken}`);

      assert.ok(
        res.status === 400 || res.status === 200,
        `Expected 400 or 200 but got ${res.status}`
      );
    });

    it('11.4 should return empty items array when page is far beyond total records (?page=9999)', async () => {
      const res = await request(app)
        .get('/api/incidents?page=9999&limit=10')
        .set('Authorization', `Bearer ${heroToken}`)
        .expect(200);

      const items = res.body.items || res.body;
      assert.strictEqual(items.length, 0);
    });

    it('11.5 should return empty items array without error for unknown filter category', async () => {
      const res = await request(app)
        .get('/api/incidents?category=ExtraterrestrialInvasion')
        .set('Authorization', `Bearer ${heroToken}`)
        .expect(200);

      const items = res.body.items || res.body;
      assert.strictEqual(items.length, 0);
      if (res.body.total !== undefined) {
        assert.strictEqual(res.body.total, 0);
      }
    });
  });
});
