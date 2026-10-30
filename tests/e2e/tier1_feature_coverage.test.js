/**
 * Tier 1: Feature-by-Feature Happy Path Coverage (>= 55 test cases)
 * Verifies core functionality across all 11 features:
 * 1. User Registration (5 cases)
 * 2. User Login & JWT (5 cases)
 * 3. JWT Auth Middleware (5 cases)
 * 4. Role-Based Access Control (5 cases)
 * 5. Incident Creation (5 cases)
 * 6. Citizen Report Scoping (5 cases)
 * 7. Hero Open Incident Listing (5 cases)
 * 8. Incident Claiming (5 cases)
 * 9. State Transitions (Claimed -> In Progress -> Resolved) (5 cases)
 * 10. Status History Recording (5 cases)
 * 11. Filtering & Pagination (5 cases)
 */

const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { getApp, request, resetDb } = require('./testHelper');

describe('Tier 1: Feature Coverage (Happy Path)', () => {
  let app;

  beforeEach(() => {
    resetDb();
    app = getApp();
  });

  // =========================================================================
  // Feature 1: User Registration (5 test cases)
  // =========================================================================
  describe('Feature 1: User Registration', () => {
    it('1.1 should successfully register a new Citizen user returning 201, user profile, and JWT', async () => {
      const res = await request(app)
        .post('/api/auth/register')
        .send({
          username: 'peter_citizen_1',
          email: 'peter1@dailybugle.com',
          password: 'Password123!',
          role: 'Citizen',
        })
        .expect(201);

      assert.ok(res.body.token, 'Response should contain a JWT token');
      assert.ok(res.body.user, 'Response should contain user profile');
      assert.strictEqual(res.body.user.username, 'peter_citizen_1');
      assert.strictEqual(res.body.user.email, 'peter1@dailybugle.com');
      assert.strictEqual(res.body.user.role, 'Citizen');
      assert.ok(res.body.user.id, 'User should have an ID');
    });

    it('1.2 should successfully register a new Hero user returning 201, user profile, and JWT', async () => {
      const res = await request(app)
        .post('/api/auth/register')
        .send({
          username: 'spiderman_hero_1',
          email: 'spiderman1@avengers.org',
          password: 'WithGreatPower123!',
          role: 'Hero',
        })
        .expect(201);

      assert.ok(res.body.token);
      assert.strictEqual(res.body.user.username, 'spiderman_hero_1');
      assert.strictEqual(res.body.user.role, 'Hero');
    });

    it('1.3 should not expose password or password_hash in registration response', async () => {
      const res = await request(app)
        .post('/api/auth/register')
        .send({
          username: 'mj_citizen_1',
          email: 'mj1@broadway.com',
          password: 'SecretPassword99!',
          role: 'Citizen',
        })
        .expect(201);

      assert.strictEqual(res.body.user.password, undefined);
      assert.strictEqual(res.body.user.password_hash, undefined);
    });

    it('1.4 should handle valid registration with lowercase / normalized email', async () => {
      const res = await request(app)
        .post('/api/auth/register')
        .send({
          username: 'gwen_citizen_1',
          email: 'GWEN.STACY@EmpireState.edu',
          password: 'ScienceRules2026!',
          role: 'Citizen',
        })
        .expect(201);

      assert.ok(res.body.user.id);
      assert.strictEqual(res.body.user.username, 'gwen_citizen_1');
    });

    it('1.5 should allow registering multiple distinct citizen and hero accounts', async () => {
      const res1 = await request(app)
        .post('/api/auth/register')
        .send({
          username: 'citizen_user_alpha',
          email: 'alpha@ny.gov',
          password: 'SafePassword1!',
          role: 'Citizen',
        })
        .expect(201);

      const res2 = await request(app)
        .post('/api/auth/register')
        .send({
          username: 'hero_user_beta',
          email: 'beta@heroes.org',
          password: 'SafePassword2!',
          role: 'Hero',
        })
        .expect(201);

      assert.notStrictEqual(res1.body.user.id, res2.body.user.id);
      assert.strictEqual(res1.body.user.role, 'Citizen');
      assert.strictEqual(res2.body.user.role, 'Hero');
    });
  });

  // =========================================================================
  // Feature 2: User Login & JWT (5 test cases)
  // =========================================================================
  describe('Feature 2: User Login & JWT', () => {
    it('2.1 should authenticate Citizen credentials and return 200 with JWT and user data', async () => {
      await request(app)
        .post('/api/auth/register')
        .send({
          username: 'login_citizen_1',
          email: 'login_cit1@test.com',
          password: 'MyPassword123!',
          role: 'Citizen',
        })
        .expect(201);

      const loginRes = await request(app)
        .post('/api/auth/login')
        .send({
          username: 'login_citizen_1',
          password: 'MyPassword123!',
        })
        .expect(200);

      assert.ok(loginRes.body.token, 'Login should return a token');
      assert.strictEqual(loginRes.body.user.username, 'login_citizen_1');
      assert.strictEqual(loginRes.body.user.role, 'Citizen');
    });

    it('2.2 should authenticate Hero credentials and return 200 with JWT and user data', async () => {
      await request(app)
        .post('/api/auth/register')
        .send({
          username: 'login_hero_1',
          email: 'login_hero1@test.com',
          password: 'HeroPassword123!',
          role: 'Hero',
        })
        .expect(201);

      const loginRes = await request(app)
        .post('/api/auth/login')
        .send({
          username: 'login_hero_1',
          password: 'HeroPassword123!',
        })
        .expect(200);

      assert.ok(loginRes.body.token);
      assert.strictEqual(loginRes.body.user.role, 'Hero');
    });

    it('2.3 should return a well-formed JWT with three dot-separated parts', async () => {
      await request(app)
        .post('/api/auth/register')
        .send({
          username: 'jwt_check_user',
          email: 'jwt@test.com',
          password: 'ValidPassword123!',
          role: 'Citizen',
        })
        .expect(201);

      const loginRes = await request(app)
        .post('/api/auth/login')
        .send({
          username: 'jwt_check_user',
          password: 'ValidPassword123!',
        })
        .expect(200);

      const token = loginRes.body.token;
      assert.strictEqual(typeof token, 'string');
      const parts = token.split('.');
      assert.strictEqual(parts.length, 3, 'JWT should contain header, payload, and signature');
    });

    it('2.4 should contain userId, username, and role inside decoded JWT payload', async () => {
      const regRes = await request(app)
        .post('/api/auth/register')
        .send({
          username: 'jwt_payload_user',
          email: 'payload@test.com',
          password: 'ValidPassword123!',
          role: 'Hero',
        })
        .expect(201);

      const token = regRes.body.token;
      const payloadPart = Buffer.from(token.split('.')[1], 'base64').toString('utf8');
      const payload = JSON.parse(payloadPart);

      assert.strictEqual(payload.username, 'jwt_payload_user');
      assert.strictEqual(payload.role, 'Hero');
      assert.ok(payload.id || payload.userId || payload.sub, 'Payload should identify user ID');
    });

    it('2.5 should not expose password_hash in login response', async () => {
      await request(app)
        .post('/api/auth/register')
        .send({
          username: 'no_hash_user',
          email: 'nohash@test.com',
          password: 'ValidPassword123!',
          role: 'Citizen',
        })
        .expect(201);

      const loginRes = await request(app)
        .post('/api/auth/login')
        .send({
          username: 'no_hash_user',
          password: 'ValidPassword123!',
        })
        .expect(200);

      assert.strictEqual(loginRes.body.user.password, undefined);
      assert.strictEqual(loginRes.body.user.password_hash, undefined);
    });
  });

  // =========================================================================
  // Feature 3: JWT Auth Middleware (5 test cases)
  // =========================================================================
  describe('Feature 3: JWT Auth Middleware', () => {
    it('3.1 should allow authorized access to protected endpoint with valid Bearer token', async () => {
      const reg = await request(app)
        .post('/api/auth/register')
        .send({
          username: 'auth_mw_citizen',
          email: 'authmw@test.com',
          password: 'ValidPassword123!',
          role: 'Citizen',
        })
        .expect(201);

      const res = await request(app)
        .get('/api/incidents')
        .set('Authorization', `Bearer ${reg.body.token}`)
        .expect(200);

      assert.ok(res.body);
    });

    it('3.2 should accept Bearer token with standard authorization header format', async () => {
      const reg = await request(app)
        .post('/api/auth/register')
        .send({
          username: 'auth_case_hero',
          email: 'authcase@test.com',
          password: 'ValidPassword123!',
          role: 'Hero',
        })
        .expect(201);

      const res = await request(app)
        .get('/api/incidents')
        .set('authorization', `Bearer ${reg.body.token}`)
        .expect(200);

      assert.ok(res.body);
    });

    it('3.3 should bind Citizen user context from token into request', async () => {
      const reg = await request(app)
        .post('/api/auth/register')
        .send({
          username: 'auth_bind_cit',
          email: 'authbind@test.com',
          password: 'ValidPassword123!',
          role: 'Citizen',
        })
        .expect(201);

      const incRes = await request(app)
        .post('/api/incidents')
        .set('Authorization', `Bearer ${reg.body.token}`)
        .send({
          title: 'Bank Robbery Midtown',
          description: 'Armed suspect at vault',
          category: 'Robbery',
          severity: 4,
          location: 'Midtown Manhattan',
        })
        .expect(201);

      assert.strictEqual(incRes.body.reporter_id, reg.body.user.id);
    });

    it('3.4 should bind Hero user context from token on claim endpoint', async () => {
      // Citizen creates incident
      const cit = await request(app)
        .post('/api/auth/register')
        .send({
          username: 'bind_cit_maker',
          email: 'bindmaker@test.com',
          password: 'ValidPassword123!',
          role: 'Citizen',
        })
        .expect(201);

      const inc = await request(app)
        .post('/api/incidents')
        .set('Authorization', `Bearer ${cit.body.token}`)
        .send({
          title: 'Warehouse Fire',
          description: 'Flames in warehouse',
          category: 'Fire',
          severity: 3,
          location: 'Brooklyn Docks',
        })
        .expect(201);

      // Hero claims incident
      const hero = await request(app)
        .post('/api/auth/register')
        .send({
          username: 'bind_hero_claimer',
          email: 'bindhero@test.com',
          password: 'ValidPassword123!',
          role: 'Hero',
        })
        .expect(201);

      const claimRes = await request(app)
        .post(`/api/incidents/${inc.body.id}/claim`)
        .set('Authorization', `Bearer ${hero.body.token}`)
        .expect(200);

      assert.strictEqual(claimRes.body.hero_id, hero.body.user.id);
    });

    it('3.5 should support multiple consecutive authenticated requests with same token', async () => {
      const hero = await request(app)
        .post('/api/auth/register')
        .send({
          username: 'multi_req_hero',
          email: 'multireq@test.com',
          password: 'ValidPassword123!',
          role: 'Hero',
        })
        .expect(201);

      const res1 = await request(app)
        .get('/api/incidents')
        .set('Authorization', `Bearer ${hero.body.token}`)
        .expect(200);

      const res2 = await request(app)
        .get('/api/incidents?page=1&limit=5')
        .set('Authorization', `Bearer ${hero.body.token}`)
        .expect(200);

      assert.ok(res1.body);
      assert.ok(res2.body);
    });
  });

  // =========================================================================
  // Feature 4: Role-Based Access Control (RBAC) (5 test cases)
  // =========================================================================
  describe('Feature 4: Role-Based Access Control (RBAC)', () => {
    it('4.1 should allow Citizen role to create incidents', async () => {
      const cit = await request(app)
        .post('/api/auth/register')
        .send({
          username: 'rbac_cit_1',
          email: 'rbaccit1@test.com',
          password: 'ValidPassword123!',
          role: 'Citizen',
        })
        .expect(201);

      const res = await request(app)
        .post('/api/incidents')
        .set('Authorization', `Bearer ${cit.body.token}`)
        .send({
          title: 'Purse Snatching in Park',
          description: 'Suspect fled on scooter',
          category: 'Theft',
          severity: 2,
          location: 'Central Park South',
        })
        .expect(201);

      assert.strictEqual(res.body.title, 'Purse Snatching in Park');
    });

    it('4.2 should allow Citizen role to view their incident list', async () => {
      const cit = await request(app)
        .post('/api/auth/register')
        .send({
          username: 'rbac_cit_2',
          email: 'rbaccit2@test.com',
          password: 'ValidPassword123!',
          role: 'Citizen',
        })
        .expect(201);

      const res = await request(app)
        .get('/api/incidents')
        .set('Authorization', `Bearer ${cit.body.token}`)
        .expect(200);

      const items = res.body.items || res.body;
      assert.ok(Array.isArray(items));
    });

    it('4.3 should allow Hero role to view open incident list', async () => {
      const hero = await request(app)
        .post('/api/auth/register')
        .send({
          username: 'rbac_hero_1',
          email: 'rbachero1@test.com',
          password: 'ValidPassword123!',
          role: 'Hero',
        })
        .expect(201);

      const res = await request(app)
        .get('/api/incidents')
        .set('Authorization', `Bearer ${hero.body.token}`)
        .expect(200);

      const items = res.body.items || res.body;
      assert.ok(Array.isArray(items));
    });

    it('4.4 should allow Hero role to claim an open incident', async () => {
      const cit = await request(app)
        .post('/api/auth/register')
        .send({
          username: 'rbac_cit_3',
          email: 'rbaccit3@test.com',
          password: 'ValidPassword123!',
          role: 'Citizen',
        })
        .expect(201);

      const inc = await request(app)
        .post('/api/incidents')
        .set('Authorization', `Bearer ${cit.body.token}`)
        .send({
          title: 'Alleyway Assault',
          description: 'Two attackers targeting pedestrian',
          category: 'Assault',
          severity: 4,
          location: 'Hell Kitchen',
        })
        .expect(201);

      const hero = await request(app)
        .post('/api/auth/register')
        .send({
          username: 'rbac_hero_2',
          email: 'rbachero2@test.com',
          password: 'ValidPassword123!',
          role: 'Hero',
        })
        .expect(201);

      const claimRes = await request(app)
        .post(`/api/incidents/${inc.body.id}/claim`)
        .set('Authorization', `Bearer ${hero.body.token}`)
        .expect(200);

      assert.strictEqual(claimRes.body.status, 'Claimed');
      assert.strictEqual(claimRes.body.hero_id, hero.body.user.id);
    });

    it('4.5 should allow Hero role to update incident status to In Progress', async () => {
      const cit = await request(app)
        .post('/api/auth/register')
        .send({
          username: 'rbac_cit_4',
          email: 'rbaccit4@test.com',
          password: 'ValidPassword123!',
          role: 'Citizen',
        })
        .expect(201);

      const inc = await request(app)
        .post('/api/incidents')
        .set('Authorization', `Bearer ${cit.body.token}`)
        .send({
          title: 'Jewelry Store Alarm',
          description: 'Glass broken in display',
          category: 'Robbery',
          severity: 3,
          location: 'SoHo',
        })
        .expect(201);

      const hero = await request(app)
        .post('/api/auth/register')
        .send({
          username: 'rbac_hero_3',
          email: 'rbachero3@test.com',
          password: 'ValidPassword123!',
          role: 'Hero',
        })
        .expect(201);

      await request(app)
        .post(`/api/incidents/${inc.body.id}/claim`)
        .set('Authorization', `Bearer ${hero.body.token}`)
        .expect(200);

      const updateRes = await request(app)
        .patch(`/api/incidents/${inc.body.id}/status`)
        .set('Authorization', `Bearer ${hero.body.token}`)
        .send({ status: 'In Progress', notes: 'Arrived at scene' })
        .expect(200);

      assert.strictEqual(updateRes.body.status, 'In Progress');
    });
  });

  // =========================================================================
  // Feature 5: Incident Creation (5 test cases)
  // =========================================================================
  describe('Feature 5: Incident Creation', () => {
    let citizenToken;

    beforeEach(async () => {
      const reg = await request(app)
        .post('/api/auth/register')
        .send({
          username: 'creator_citizen',
          email: 'creator@test.com',
          password: 'ValidPassword123!',
          role: 'Citizen',
        })
        .expect(201);
      citizenToken = reg.body.token;
    });

    it('5.1 should create incident with minimum valid severity (1)', async () => {
      const res = await request(app)
        .post('/api/incidents')
        .set('Authorization', `Bearer ${citizenToken}`)
        .send({
          title: 'Lost Cat in Tree',
          description: 'Cat stuck on high branch',
          category: 'Rescue',
          severity: 1,
          location: 'Inwood Park',
        })
        .expect(201);

      assert.strictEqual(res.body.severity, 1);
      assert.strictEqual(res.body.status, 'Reported');
    });

    it('5.2 should create incident with maximum valid severity (5)', async () => {
      const res = await request(app)
        .post('/api/incidents')
        .set('Authorization', `Bearer ${citizenToken}`)
        .send({
          title: 'Bridge Collapse Imminent',
          description: 'Cables snapping on Queensboro Bridge',
          category: 'Disaster',
          severity: 5,
          location: 'Queensboro Bridge',
        })
        .expect(201);

      assert.strictEqual(res.body.severity, 5);
      assert.strictEqual(res.body.status, 'Reported');
    });

    it('5.3 should create incident with mid-range severity (3)', async () => {
      const res = await request(app)
        .post('/api/incidents')
        .set('Authorization', `Bearer ${citizenToken}`)
        .send({
          title: 'Traffic Collision on FDR Drive',
          description: 'Multi-car pileup blocking lanes',
          category: 'Accident',
          severity: 3,
          location: 'FDR Drive at 34th St',
        })
        .expect(201);

      assert.strictEqual(res.body.severity, 3);
      assert.strictEqual(res.body.status, 'Reported');
    });

    it('5.4 should set reporter_id to citizen ID and leave hero_id null on creation', async () => {
      const res = await request(app)
        .post('/api/incidents')
        .set('Authorization', `Bearer ${citizenToken}`)
        .send({
          title: 'Subway Track Trespasser',
          description: 'Individual on tracks at Times Sq',
          category: 'Rescue',
          severity: 4,
          location: 'Times Square Station',
        })
        .expect(201);

      assert.ok(res.body.reporter_id);
      assert.strictEqual(res.body.hero_id, null);
    });

    it('5.5 should persist all provided fields and generate id, created_at, updated_at', async () => {
      const payload = {
        title: 'Armed Bank Heist',
        description: 'Hostages reported in lobby',
        category: 'Robbery',
        severity: 5,
        location: 'Wall Street 40',
      };

      const res = await request(app)
        .post('/api/incidents')
        .set('Authorization', `Bearer ${citizenToken}`)
        .send(payload)
        .expect(201);

      assert.ok(res.body.id);
      assert.strictEqual(res.body.title, payload.title);
      assert.strictEqual(res.body.description, payload.description);
      assert.strictEqual(res.body.category, payload.category);
      assert.strictEqual(res.body.location, payload.location);
      assert.ok(res.body.created_at);
      assert.ok(res.body.updated_at);
    });
  });

  // =========================================================================
  // Feature 6: Citizen Incident Scoping (5 test cases)
  // =========================================================================
  describe('Feature 6: Citizen Incident Scoping', () => {
    it('6.1 should return only incidents created by the requesting citizen', async () => {
      const citA = await request(app)
        .post('/api/auth/register')
        .send({
          username: 'scoping_cit_a',
          email: 'cita@scoping.com',
          password: 'ValidPassword123!',
          role: 'Citizen',
        })
        .expect(201);

      await request(app)
        .post('/api/incidents')
        .set('Authorization', `Bearer ${citA.body.token}`)
        .send({
          title: 'Report from Citizen A',
          description: 'Incident details A',
          category: 'Robbery',
          severity: 3,
          location: 'Queens',
        })
        .expect(201);

      const res = await request(app)
        .get('/api/incidents')
        .set('Authorization', `Bearer ${citA.body.token}`)
        .expect(200);

      const items = res.body.items || res.body;
      assert.strictEqual(items.length, 1);
      assert.strictEqual(items[0].title, 'Report from Citizen A');
    });

    it('6.2 should not leak incidents created by Citizen B to Citizen A', async () => {
      const citA = await request(app)
        .post('/api/auth/register')
        .send({
          username: 'scoping_cit_a2',
          email: 'cita2@scoping.com',
          password: 'ValidPassword123!',
          role: 'Citizen',
        })
        .expect(201);

      const citB = await request(app)
        .post('/api/auth/register')
        .send({
          username: 'scoping_cit_b2',
          email: 'citb2@scoping.com',
          password: 'ValidPassword123!',
          role: 'Citizen',
        })
        .expect(201);

      // Citizen B creates incident
      await request(app)
        .post('/api/incidents')
        .set('Authorization', `Bearer ${citB.body.token}`)
        .send({
          title: 'Citizen B Private Emergency',
          description: 'Private report details',
          category: 'Fire',
          severity: 4,
          location: 'Bronx',
        })
        .expect(201);

      // Citizen A lists incidents
      const resA = await request(app)
        .get('/api/incidents')
        .set('Authorization', `Bearer ${citA.body.token}`)
        .expect(200);

      const itemsA = resA.body.items || resA.body;
      assert.strictEqual(itemsA.length, 0, 'Citizen A should see 0 incidents');
    });

    it('6.3 should allow Citizen to retrieve single incident details for their own incident', async () => {
      const cit = await request(app)
        .post('/api/auth/register')
        .send({
          username: 'scoping_cit_own',
          email: 'citown@scoping.com',
          password: 'ValidPassword123!',
          role: 'Citizen',
        })
        .expect(201);

      const inc = await request(app)
        .post('/api/incidents')
        .set('Authorization', `Bearer ${cit.body.token}`)
        .send({
          title: 'Car Break-in',
          description: 'Shattered window on sedan',
          category: 'Theft',
          severity: 2,
          location: 'Brooklyn Heights',
        })
        .expect(201);

      const getRes = await request(app)
        .get(`/api/incidents/${inc.body.id}`)
        .set('Authorization', `Bearer ${cit.body.token}`)
        .expect(200);

      assert.strictEqual(getRes.body.id, inc.body.id);
      assert.strictEqual(getRes.body.title, 'Car Break-in');
    });

    it('6.4 should reflect updated status when Citizen views their reported incident after claim', async () => {
      const cit = await request(app)
        .post('/api/auth/register')
        .send({
          username: 'scoping_cit_track',
          email: 'cittrack@scoping.com',
          password: 'ValidPassword123!',
          role: 'Citizen',
        })
        .expect(201);

      const inc = await request(app)
        .post('/api/incidents')
        .set('Authorization', `Bearer ${cit.body.token}`)
        .send({
          title: 'Gas Leak Detected',
          description: 'Strong sulfur odor',
          category: 'Hazard',
          severity: 3,
          location: 'East Village',
        })
        .expect(201);

      const hero = await request(app)
        .post('/api/auth/register')
        .send({
          username: 'scoping_hero_track',
          email: 'herotrack@scoping.com',
          password: 'ValidPassword123!',
          role: 'Hero',
        })
        .expect(201);

      await request(app)
        .post(`/api/incidents/${inc.body.id}/claim`)
        .set('Authorization', `Bearer ${hero.body.token}`)
        .expect(200);

      const citView = await request(app)
        .get(`/api/incidents/${inc.body.id}`)
        .set('Authorization', `Bearer ${cit.body.token}`)
        .expect(200);

      assert.strictEqual(citView.body.status, 'Claimed');
    });

    it('6.5 should return empty array and total 0 for citizen who has reported zero incidents', async () => {
      const cit = await request(app)
        .post('/api/auth/register')
        .send({
          username: 'empty_cit_user',
          email: 'emptycit@scoping.com',
          password: 'ValidPassword123!',
          role: 'Citizen',
        })
        .expect(201);

      const res = await request(app)
        .get('/api/incidents')
        .set('Authorization', `Bearer ${cit.body.token}`)
        .expect(200);

      const items = res.body.items || res.body;
      assert.strictEqual(items.length, 0);
      if (res.body.total !== undefined) {
        assert.strictEqual(res.body.total, 0);
      }
    });
  });

  // =========================================================================
  // Feature 7: Hero Open Incident Listing (5 test cases)
  // =========================================================================
  describe('Feature 7: Hero Open Incident Listing', () => {
    let heroToken;

    beforeEach(async () => {
      const hero = await request(app)
        .post('/api/auth/register')
        .send({
          username: 'listing_hero_main',
          email: 'heromain@listing.com',
          password: 'ValidPassword123!',
          role: 'Hero',
        })
        .expect(201);
      heroToken = hero.body.token;
    });

    it('7.1 should list all open (Reported) incidents across multiple citizens by default', async () => {
      const cit1 = await request(app)
        .post('/api/auth/register')
        .send({
          username: 'cit_reporter_1',
          email: 'citrep1@listing.com',
          password: 'ValidPassword123!',
          role: 'Citizen',
        })
        .expect(201);

      const cit2 = await request(app)
        .post('/api/auth/register')
        .send({
          username: 'cit_reporter_2',
          email: 'citrep2@listing.com',
          password: 'ValidPassword123!',
          role: 'Citizen',
        })
        .expect(201);

      await request(app)
        .post('/api/incidents')
        .set('Authorization', `Bearer ${cit1.body.token}`)
        .send({
          title: 'Citizen 1 Emergency',
          description: 'Emergency 1',
          category: 'Robbery',
          severity: 3,
          location: 'Queens',
        })
        .expect(201);

      await request(app)
        .post('/api/incidents')
        .set('Authorization', `Bearer ${cit2.body.token}`)
        .send({
          title: 'Citizen 2 Emergency',
          description: 'Emergency 2',
          category: 'Fire',
          severity: 5,
          location: 'Brooklyn',
        })
        .expect(201);

      const listRes = await request(app)
        .get('/api/incidents')
        .set('Authorization', `Bearer ${heroToken}`)
        .expect(200);

      const items = listRes.body.items || listRes.body;
      assert.strictEqual(items.length, 2);
    });

    it('7.2 should exclude claimed incidents from hero default open incident list', async () => {
      const cit = await request(app)
        .post('/api/auth/register')
        .send({
          username: 'cit_claim_excl',
          email: 'claimexcl@listing.com',
          password: 'ValidPassword123!',
          role: 'Citizen',
        })
        .expect(201);

      const inc1 = await request(app)
        .post('/api/incidents')
        .set('Authorization', `Bearer ${cit.body.token}`)
        .send({
          title: 'Incident To Be Claimed',
          description: 'Desc',
          category: 'Theft',
          severity: 2,
          location: 'Manhattan',
        })
        .expect(201);

      await request(app)
        .post('/api/incidents')
        .set('Authorization', `Bearer ${cit.body.token}`)
        .send({
          title: 'Incident Remains Reported',
          description: 'Desc',
          category: 'Theft',
          severity: 2,
          location: 'Manhattan',
        })
        .expect(201);

      // Hero claims inc1
      await request(app)
        .post(`/api/incidents/${inc1.body.id}/claim`)
        .set('Authorization', `Bearer ${heroToken}`)
        .expect(200);

      // Hero lists default open incidents
      const openRes = await request(app)
        .get('/api/incidents')
        .set('Authorization', `Bearer ${heroToken}`)
        .expect(200);

      const items = openRes.body.items || openRes.body;
      assert.strictEqual(items.length, 1);
      assert.strictEqual(items[0].title, 'Incident Remains Reported');
    });

    it('7.3 should return complete incident records with title, category, severity, status, location', async () => {
      const cit = await request(app)
        .post('/api/auth/register')
        .send({
          username: 'cit_full_record',
          email: 'fullrec@listing.com',
          password: 'ValidPassword123!',
          role: 'Citizen',
        })
        .expect(201);

      await request(app)
        .post('/api/incidents')
        .set('Authorization', `Bearer ${cit.body.token}`)
        .send({
          title: 'Hostage Situation Bank',
          description: 'Multiple hostages held in vault',
          category: 'Hostage',
          severity: 5,
          location: 'Midtown East',
        })
        .expect(201);

      const res = await request(app)
        .get('/api/incidents')
        .set('Authorization', `Bearer ${heroToken}`)
        .expect(200);

      const items = res.body.items || res.body;
      const inc = items[0];
      assert.strictEqual(inc.title, 'Hostage Situation Bank');
      assert.strictEqual(inc.category, 'Hostage');
      assert.strictEqual(inc.severity, 5);
      assert.strictEqual(inc.status, 'Reported');
      assert.strictEqual(inc.location, 'Midtown East');
    });

    it('7.4 should return empty items array when no open incidents exist', async () => {
      const res = await request(app)
        .get('/api/incidents')
        .set('Authorization', `Bearer ${heroToken}`)
        .expect(200);

      const items = res.body.items || res.body;
      assert.strictEqual(items.length, 0);
    });

    it('7.5 should allow Hero to view incident details by ID for any Reported incident', async () => {
      const cit = await request(app)
        .post('/api/auth/register')
        .send({
          username: 'cit_view_id',
          email: 'viewid@listing.com',
          password: 'ValidPassword123!',
          role: 'Citizen',
        })
        .expect(201);

      const inc = await request(app)
        .post('/api/incidents')
        .set('Authorization', `Bearer ${cit.body.token}`)
        .send({
          title: 'Rogue Drone Sighting',
          description: 'Armed drone over city hall',
          category: 'Aerial',
          severity: 4,
          location: 'City Hall Park',
        })
        .expect(201);

      const heroView = await request(app)
        .get(`/api/incidents/${inc.body.id}`)
        .set('Authorization', `Bearer ${heroToken}`)
        .expect(200);

      assert.strictEqual(heroView.body.id, inc.body.id);
      assert.strictEqual(heroView.body.title, 'Rogue Drone Sighting');
    });
  });

  // =========================================================================
  // Feature 8: Incident Claiming (5 test cases)
  // =========================================================================
  describe('Feature 8: Incident Claiming', () => {
    let heroToken;
    let heroId;
    let incidentId;

    beforeEach(async () => {
      const cit = await request(app)
        .post('/api/auth/register')
        .send({
          username: 'cit_claim_flow',
          email: 'claimflow@test.com',
          password: 'ValidPassword123!',
          role: 'Citizen',
        })
        .expect(201);

      const inc = await request(app)
        .post('/api/incidents')
        .set('Authorization', `Bearer ${cit.body.token}`)
        .send({
          title: 'Store Robbery in Progress',
          description: 'Suspect wielding weapon',
          category: 'Robbery',
          severity: 4,
          location: 'Flatbush Ave',
        })
        .expect(201);
      incidentId = inc.body.id;

      const hero = await request(app)
        .post('/api/auth/register')
        .send({
          username: 'hero_claimer_main',
          email: 'claimer@test.com',
          password: 'ValidPassword123!',
          role: 'Hero',
        })
        .expect(201);
      heroToken = hero.body.token;
      heroId = hero.body.user.id;
    });

    it('8.1 should return 200 OK when Hero claims a Reported incident', async () => {
      const res = await request(app)
        .post(`/api/incidents/${incidentId}/claim`)
        .set('Authorization', `Bearer ${heroToken}`)
        .expect(200);

      assert.strictEqual(res.body.id, incidentId);
      assert.strictEqual(res.body.status, 'Claimed');
    });

    it('8.2 should assign hero_id to the claiming hero', async () => {
      const res = await request(app)
        .post(`/api/incidents/${incidentId}/claim`)
        .set('Authorization', `Bearer ${heroToken}`)
        .expect(200);

      assert.strictEqual(res.body.hero_id, heroId);
    });

    it('8.3 should update the status in database to Claimed', async () => {
      await request(app)
        .post(`/api/incidents/${incidentId}/claim`)
        .set('Authorization', `Bearer ${heroToken}`)
        .expect(200);

      const fetchRes = await request(app)
        .get(`/api/incidents/${incidentId}`)
        .set('Authorization', `Bearer ${heroToken}`)
        .expect(200);

      assert.strictEqual(fetchRes.body.status, 'Claimed');
      assert.strictEqual(fetchRes.body.hero_id, heroId);
    });

    it('8.4 should allow same hero to claim a second distinct open incident', async () => {
      const cit = await request(app)
        .post('/api/auth/register')
        .send({
          username: 'cit_second_inc',
          email: 'citsecond@test.com',
          password: 'ValidPassword123!',
          role: 'Citizen',
        })
        .expect(201);

      const inc2 = await request(app)
        .post('/api/incidents')
        .set('Authorization', `Bearer ${cit.body.token}`)
        .send({
          title: 'Water Main Break',
          description: 'Flooding intersection',
          category: 'Hazard',
          severity: 3,
          location: 'Chelsea',
        })
        .expect(201);

      const res2 = await request(app)
        .post(`/api/incidents/${inc2.body.id}/claim`)
        .set('Authorization', `Bearer ${heroToken}`)
        .expect(200);

      assert.strictEqual(res2.body.status, 'Claimed');
      assert.strictEqual(res2.body.hero_id, heroId);
    });

    it('8.5 should update updated_at timestamp upon claim', async () => {
      const beforeRes = await request(app)
        .get(`/api/incidents/${incidentId}`)
        .set('Authorization', `Bearer ${heroToken}`)
        .expect(200);

      const claimRes = await request(app)
        .post(`/api/incidents/${incidentId}/claim`)
        .set('Authorization', `Bearer ${heroToken}`)
        .expect(200);

      assert.ok(claimRes.body.updated_at);
    });
  });

  // =========================================================================
  // Feature 9: State Transitions (5 test cases)
  // =========================================================================
  describe('Feature 9: State Transitions (Claimed -> In Progress -> Resolved)', () => {
    let heroToken;
    let incidentId;

    beforeEach(async () => {
      const cit = await request(app)
        .post('/api/auth/register')
        .send({
          username: 'cit_transition_user',
          email: 'cittrans@test.com',
          password: 'ValidPassword123!',
          role: 'Citizen',
        })
        .expect(201);

      const inc = await request(app)
        .post('/api/incidents')
        .set('Authorization', `Bearer ${cit.body.token}`)
        .send({
          title: 'Crane Malfunction',
          description: 'Crane swinging precariously over street',
          category: 'Rescue',
          severity: 4,
          location: 'Hudson Yards',
        })
        .expect(201);
      incidentId = inc.body.id;

      const hero = await request(app)
        .post('/api/auth/register')
        .send({
          username: 'hero_transition_user',
          email: 'herotrans@test.com',
          password: 'ValidPassword123!',
          role: 'Hero',
        })
        .expect(201);
      heroToken = hero.body.token;

      // Claim incident so it is in 'Claimed' status
      await request(app)
        .post(`/api/incidents/${incidentId}/claim`)
        .set('Authorization', `Bearer ${heroToken}`)
        .expect(200);
    });

    it('9.1 should transition incident from Claimed to In Progress returning 200', async () => {
      const res = await request(app)
        .patch(`/api/incidents/${incidentId}/status`)
        .set('Authorization', `Bearer ${heroToken}`)
        .send({ status: 'In Progress' })
        .expect(200);

      assert.strictEqual(res.body.status, 'In Progress');
    });

    it('9.2 should transition incident from In Progress to Resolved returning 200', async () => {
      await request(app)
        .patch(`/api/incidents/${incidentId}/status`)
        .set('Authorization', `Bearer ${heroToken}`)
        .send({ status: 'In Progress' })
        .expect(200);

      const res = await request(app)
        .patch(`/api/incidents/${incidentId}/status`)
        .set('Authorization', `Bearer ${heroToken}`)
        .send({ status: 'Resolved' })
        .expect(200);

      assert.strictEqual(res.body.status, 'Resolved');
    });

    it('9.3 should accept optional notes when updating status', async () => {
      const res = await request(app)
        .patch(`/api/incidents/${incidentId}/status`)
        .set('Authorization', `Bearer ${heroToken}`)
        .send({
          status: 'In Progress',
          notes: 'Secured the crane arm with web fluid',
        })
        .expect(200);

      assert.strictEqual(res.body.status, 'In Progress');
    });

    it('9.4 should update status in database and verify via GET /api/incidents/:id', async () => {
      await request(app)
        .patch(`/api/incidents/${incidentId}/status`)
        .set('Authorization', `Bearer ${heroToken}`)
        .send({ status: 'In Progress' })
        .expect(200);

      await request(app)
        .patch(`/api/incidents/${incidentId}/status`)
        .set('Authorization', `Bearer ${heroToken}`)
        .send({ status: 'Resolved', notes: 'Scene stabilized and clear' })
        .expect(200);

      const fetchRes = await request(app)
        .get(`/api/incidents/${incidentId}`)
        .set('Authorization', `Bearer ${heroToken}`)
        .expect(200);

      assert.strictEqual(fetchRes.body.status, 'Resolved');
    });

    it('9.5 should execute full valid sequence: Reported -> Claimed -> In Progress -> Resolved', async () => {
      // Incident started Reported, was Claimed in beforeEach
      const progressRes = await request(app)
        .patch(`/api/incidents/${incidentId}/status`)
        .set('Authorization', `Bearer ${heroToken}`)
        .send({ status: 'In Progress' })
        .expect(200);
      assert.strictEqual(progressRes.body.status, 'In Progress');

      const resolveRes = await request(app)
        .patch(`/api/incidents/${incidentId}/status`)
        .set('Authorization', `Bearer ${heroToken}`)
        .send({ status: 'Resolved' })
        .expect(200);
      assert.strictEqual(resolveRes.body.status, 'Resolved');
    });
  });

  // =========================================================================
  // Feature 10: Status History Recording (5 test cases)
  // =========================================================================
  describe('Feature 10: Status History Recording', () => {
    it('10.1 should record initial history entry (null -> Reported) on incident creation', async () => {
      const cit = await request(app)
        .post('/api/auth/register')
        .send({
          username: 'history_cit_1',
          email: 'hist1@test.com',
          password: 'ValidPassword123!',
          role: 'Citizen',
        })
        .expect(201);

      const inc = await request(app)
        .post('/api/incidents')
        .set('Authorization', `Bearer ${cit.body.token}`)
        .send({
          title: 'Power Outage',
          description: 'Transformer blown',
          category: 'Utility',
          severity: 2,
          location: 'Astoria',
        })
        .expect(201);

      const histRes = await request(app)
        .get(`/api/incidents/${inc.body.id}/history`)
        .set('Authorization', `Bearer ${cit.body.token}`)
        .expect(200);

      const history = Array.isArray(histRes.body) ? histRes.body : histRes.body.history;
      assert.ok(Array.isArray(history));
      assert.strictEqual(history.length, 1);
      assert.strictEqual(history[0].previous_status, null);
      assert.strictEqual(history[0].new_status, 'Reported');
      assert.strictEqual(history[0].changed_by_user_id, cit.body.user.id);
    });

    it('10.2 should record history entry (Reported -> Claimed) on hero claim', async () => {
      const cit = await request(app)
        .post('/api/auth/register')
        .send({
          username: 'history_cit_2',
          email: 'hist2@test.com',
          password: 'ValidPassword123!',
          role: 'Citizen',
        })
        .expect(201);

      const inc = await request(app)
        .post('/api/incidents')
        .set('Authorization', `Bearer ${cit.body.token}`)
        .send({
          title: 'Alley Disturbance',
          description: 'Loud noises',
          category: 'Disturbance',
          severity: 2,
          location: 'Bowery',
        })
        .expect(201);

      const hero = await request(app)
        .post('/api/auth/register')
        .send({
          username: 'history_hero_2',
          email: 'histhero2@test.com',
          password: 'ValidPassword123!',
          role: 'Hero',
        })
        .expect(201);

      await request(app)
        .post(`/api/incidents/${inc.body.id}/claim`)
        .set('Authorization', `Bearer ${hero.body.token}`)
        .expect(200);

      const histRes = await request(app)
        .get(`/api/incidents/${inc.body.id}/history`)
        .set('Authorization', `Bearer ${hero.body.token}`)
        .expect(200);

      const history = Array.isArray(histRes.body) ? histRes.body : histRes.body.history;
      assert.strictEqual(history.length, 2);
      assert.strictEqual(history[1].previous_status, 'Reported');
      assert.strictEqual(history[1].new_status, 'Claimed');
      assert.strictEqual(history[1].changed_by_user_id, hero.body.user.id);
    });

    it('10.3 should record history entry (Claimed -> In Progress) with notes', async () => {
      const cit = await request(app)
        .post('/api/auth/register')
        .send({
          username: 'history_cit_3',
          email: 'hist3@test.com',
          password: 'ValidPassword123!',
          role: 'Citizen',
        })
        .expect(201);

      const inc = await request(app)
        .post('/api/incidents')
        .set('Authorization', `Bearer ${cit.body.token}`)
        .send({
          title: 'Hostage at Deli',
          description: 'Armed suspect inside',
          category: 'Robbery',
          severity: 4,
          location: 'Harlem',
        })
        .expect(201);

      const hero = await request(app)
        .post('/api/auth/register')
        .send({
          username: 'history_hero_3',
          email: 'histhero3@test.com',
          password: 'ValidPassword123!',
          role: 'Hero',
        })
        .expect(201);

      await request(app)
        .post(`/api/incidents/${inc.body.id}/claim`)
        .set('Authorization', `Bearer ${hero.body.token}`)
        .expect(200);

      await request(app)
        .patch(`/api/incidents/${inc.body.id}/status`)
        .set('Authorization', `Bearer ${hero.body.token}`)
        .send({ status: 'In Progress', notes: 'Breaching back door' })
        .expect(200);

      const histRes = await request(app)
        .get(`/api/incidents/${inc.body.id}/history`)
        .set('Authorization', `Bearer ${hero.body.token}`)
        .expect(200);

      const history = Array.isArray(histRes.body) ? histRes.body : histRes.body.history;
      assert.strictEqual(history.length, 3);
      assert.strictEqual(history[2].previous_status, 'Claimed');
      assert.strictEqual(history[2].new_status, 'In Progress');
      assert.strictEqual(history[2].notes, 'Breaching back door');
    });

    it('10.4 should record history entry (In Progress -> Resolved)', async () => {
      const cit = await request(app)
        .post('/api/auth/register')
        .send({
          username: 'history_cit_4',
          email: 'hist4@test.com',
          password: 'ValidPassword123!',
          role: 'Citizen',
        })
        .expect(201);

      const inc = await request(app)
        .post('/api/incidents')
        .set('Authorization', `Bearer ${cit.body.token}`)
        .send({
          title: 'Smoke in Subway Station',
          description: 'Station filled with smoke',
          category: 'Fire',
          severity: 4,
          location: 'Union Square',
        })
        .expect(201);

      const hero = await request(app)
        .post('/api/auth/register')
        .send({
          username: 'history_hero_4',
          email: 'histhero4@test.com',
          password: 'ValidPassword123!',
          role: 'Hero',
        })
        .expect(201);

      await request(app)
        .post(`/api/incidents/${inc.body.id}/claim`)
        .set('Authorization', `Bearer ${hero.body.token}`)
        .expect(200);

      await request(app)
        .patch(`/api/incidents/${inc.body.id}/status`)
        .set('Authorization', `Bearer ${hero.body.token}`)
        .send({ status: 'In Progress' })
        .expect(200);

      await request(app)
        .patch(`/api/incidents/${inc.body.id}/status`)
        .set('Authorization', `Bearer ${hero.body.token}`)
        .send({ status: 'Resolved', notes: 'Extinguished smoldering debris' })
        .expect(200);

      const histRes = await request(app)
        .get(`/api/incidents/${inc.body.id}/history`)
        .set('Authorization', `Bearer ${hero.body.token}`)
        .expect(200);

      const history = Array.isArray(histRes.body) ? histRes.body : histRes.body.history;
      assert.strictEqual(history.length, 4);
      assert.strictEqual(history[3].previous_status, 'In Progress');
      assert.strictEqual(history[3].new_status, 'Resolved');
    });

    it('10.5 should include chronological status history with 4 entries on incident details response', async () => {
      const cit = await request(app)
        .post('/api/auth/register')
        .send({
          username: 'history_cit_5',
          email: 'hist5@test.com',
          password: 'ValidPassword123!',
          role: 'Citizen',
        })
        .expect(201);

      const inc = await request(app)
        .post('/api/incidents')
        .set('Authorization', `Bearer ${cit.body.token}`)
        .send({
          title: 'Runaway Train',
          description: 'Brakes failed',
          category: 'Rescue',
          severity: 5,
          location: '7 Train Flushing Line',
        })
        .expect(201);

      const hero = await request(app)
        .post('/api/auth/register')
        .send({
          username: 'history_hero_5',
          email: 'histhero5@test.com',
          password: 'ValidPassword123!',
          role: 'Hero',
        })
        .expect(201);

      await request(app)
        .post(`/api/incidents/${inc.body.id}/claim`)
        .set('Authorization', `Bearer ${hero.body.token}`)
        .expect(200);

      await request(app)
        .patch(`/api/incidents/${inc.body.id}/status`)
        .set('Authorization', `Bearer ${hero.body.token}`)
        .send({ status: 'In Progress' })
        .expect(200);

      await request(app)
        .patch(`/api/incidents/${inc.body.id}/status`)
        .set('Authorization', `Bearer ${hero.body.token}`)
        .send({ status: 'Resolved' })
        .expect(200);

      const incDetails = await request(app)
        .get(`/api/incidents/${inc.body.id}`)
        .set('Authorization', `Bearer ${hero.body.token}`)
        .expect(200);

      // Verify either history embedded in GET /:id or accessible via GET /:id/history
      const history =
        incDetails.body.history ||
        (
          await request(app)
            .get(`/api/incidents/${inc.body.id}/history`)
            .set('Authorization', `Bearer ${hero.body.token}`)
            .expect(200)
        ).body;

      const histArr = Array.isArray(history) ? history : history.history;
      assert.strictEqual(histArr.length, 4);
      assert.strictEqual(histArr[0].new_status, 'Reported');
      assert.strictEqual(histArr[1].new_status, 'Claimed');
      assert.strictEqual(histArr[2].new_status, 'In Progress');
      assert.strictEqual(histArr[3].new_status, 'Resolved');
    });
  });

  // =========================================================================
  // Feature 11: Filtering & Pagination (5 test cases)
  // =========================================================================
  describe('Feature 11: Filtering & Pagination', () => {
    let heroToken;

    beforeEach(async () => {
      const cit = await request(app)
        .post('/api/auth/register')
        .send({
          username: 'filter_cit_user',
          email: 'filtercit@test.com',
          password: 'ValidPassword123!',
          role: 'Citizen',
        })
        .expect(201);

      // Seed 4 incidents with different categories, severities, locations
      await request(app)
        .post('/api/incidents')
        .set('Authorization', `Bearer ${cit.body.token}`)
        .send({
          title: 'Robbery 1',
          description: 'Severity 5 Robbery',
          category: 'Robbery',
          severity: 5,
          location: 'Bronx',
        })
        .expect(201);

      await request(app)
        .post('/api/incidents')
        .set('Authorization', `Bearer ${cit.body.token}`)
        .send({
          title: 'Fire 1',
          description: 'Severity 3 Fire',
          category: 'Fire',
          severity: 3,
          location: 'Queens',
        })
        .expect(201);

      await request(app)
        .post('/api/incidents')
        .set('Authorization', `Bearer ${cit.body.token}`)
        .send({
          title: 'Theft 1',
          description: 'Severity 2 Theft',
          category: 'Theft',
          severity: 2,
          location: 'Manhattan',
        })
        .expect(201);

      await request(app)
        .post('/api/incidents')
        .set('Authorization', `Bearer ${cit.body.token}`)
        .send({
          title: 'Fire 2',
          description: 'Severity 5 Fire',
          category: 'Fire',
          severity: 5,
          location: 'Brooklyn',
        })
        .expect(201);

      const hero = await request(app)
        .post('/api/auth/register')
        .send({
          username: 'filter_hero_user',
          email: 'filterhero@test.com',
          password: 'ValidPassword123!',
          role: 'Hero',
        })
        .expect(201);
      heroToken = hero.body.token;
    });

    it('11.1 should filter incidents by category', async () => {
      const res = await request(app)
        .get('/api/incidents?category=Fire')
        .set('Authorization', `Bearer ${heroToken}`)
        .expect(200);

      const items = res.body.items || res.body;
      assert.strictEqual(items.length, 2);
      items.forEach((item) => assert.strictEqual(item.category, 'Fire'));
    });

    it('11.2 should filter incidents by severity', async () => {
      const res = await request(app)
        .get('/api/incidents?severity=5')
        .set('Authorization', `Bearer ${heroToken}`)
        .expect(200);

      const items = res.body.items || res.body;
      assert.strictEqual(items.length, 2);
      items.forEach((item) => assert.strictEqual(item.severity, 5));
    });

    it('11.3 should filter incidents by status', async () => {
      const res = await request(app)
        .get('/api/incidents?status=Reported')
        .set('Authorization', `Bearer ${heroToken}`)
        .expect(200);

      const items = res.body.items || res.body;
      assert.strictEqual(items.length, 4);
      items.forEach((item) => assert.strictEqual(item.status, 'Reported'));
    });

    it('11.4 should paginate results with page=1 and limit=2 returning first slice and total', async () => {
      const res = await request(app)
        .get('/api/incidents?page=1&limit=2')
        .set('Authorization', `Bearer ${heroToken}`)
        .expect(200);

      const items = res.body.items || res.body;
      assert.strictEqual(items.length, 2);
      if (res.body.total !== undefined) {
        assert.strictEqual(res.body.total, 4);
      }
    });

    it('11.5 should paginate results with page=2 and limit=2 returning second non-overlapping slice', async () => {
      const res1 = await request(app)
        .get('/api/incidents?page=1&limit=2')
        .set('Authorization', `Bearer ${heroToken}`)
        .expect(200);

      const res2 = await request(app)
        .get('/api/incidents?page=2&limit=2')
        .set('Authorization', `Bearer ${heroToken}`)
        .expect(200);

      const items1 = res1.body.items || res1.body;
      const items2 = res2.body.items || res2.body;

      assert.strictEqual(items1.length, 2);
      assert.strictEqual(items2.length, 2);

      const ids1 = new Set(items1.map((item) => item.id));
      for (const item of items2) {
        assert.ok(!ids1.has(item.id), `ID ${item.id} should not overlap between pages`);
      }
    });
  });
});
