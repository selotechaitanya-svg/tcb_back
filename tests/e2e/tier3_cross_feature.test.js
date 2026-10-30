/**
 * Tier 3: Cross-Feature Interactions & Pairwise Combinatorial Tests (>= 11 test cases)
 * Verifies complex multi-feature interactions, pairwise query combinations,
 * cross-actor lifecycles, and audit trail consistency.
 */

const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { getApp, request, resetDb } = require('./testHelper');

describe('Tier 3: Cross-Feature Interactions & Pairwise Tests', () => {
  let app;

  beforeEach(() => {
    resetDb();
    app = getApp();
  });

  it('3.1 Registration followed by immediate incident creation using returned token', async () => {
    const regRes = await request(app)
      .post('/api/auth/register')
      .send({
        username: 'immediate_reporter',
        email: 'immediate@test.com',
        password: 'Password123!',
        role: 'Citizen',
      })
      .expect(201);

    const token = regRes.body.token;
    assert.ok(token);

    const incRes = await request(app)
      .post('/api/incidents')
      .set('Authorization', `Bearer ${token}`)
      .send({
        title: 'Immediate Alert After Registration',
        description: 'Testing registration-to-creation pipeline',
        category: 'Hazard',
        severity: 3,
        location: 'Williamsburg Bridge',
      })
      .expect(201);

    assert.strictEqual(incRes.body.title, 'Immediate Alert After Registration');
    assert.strictEqual(incRes.body.reporter_id, regRes.body.user.id);
    assert.strictEqual(incRes.body.status, 'Reported');
  });

  it('3.2 Citizen creation followed by Hero login and claiming incident', async () => {
    // 1. Citizen registers and creates incident
    const citReg = await request(app)
      .post('/api/auth/register')
      .send({
        username: 'cross_cit_user',
        email: 'crosscit@test.com',
        password: 'Password123!',
        role: 'Citizen',
      })
      .expect(201);

    const incRes = await request(app)
      .post('/api/incidents')
      .set('Authorization', `Bearer ${citReg.body.token}`)
      .send({
        title: 'Armed Robbery at Diamond District',
        description: 'Masked group inside store',
        category: 'Robbery',
        severity: 5,
        location: '47th St Manhattan',
      })
      .expect(201);

    const incidentId = incRes.body.id;

    // 2. Hero registers
    await request(app)
      .post('/api/auth/register')
      .send({
        username: 'cross_hero_user',
        email: 'crosshero@test.com',
        password: 'HeroPassword123!',
        role: 'Hero',
      })
      .expect(201);

    // 3. Hero logs in
    const heroLogin = await request(app)
      .post('/api/auth/login')
      .send({
        username: 'cross_hero_user',
        password: 'HeroPassword123!',
      })
      .expect(200);

    const heroToken = heroLogin.body.token;

    // 4. Hero claims the incident created by the citizen
    const claimRes = await request(app)
      .post(`/api/incidents/${incidentId}/claim`)
      .set('Authorization', `Bearer ${heroToken}`)
      .expect(200);

    assert.strictEqual(claimRes.body.status, 'Claimed');
    assert.strictEqual(claimRes.body.hero_id, heroLogin.body.user.id);
  });

  it('3.3 Pairwise filtering: Status AND Severity multi-criteria filtering', async () => {
    const cit = await request(app)
      .post('/api/auth/register')
      .send({
        username: 'pair_cit_1',
        email: 'pair1@test.com',
        password: 'Password123!',
        role: 'Citizen',
      })
      .expect(201);

    const hero = await request(app)
      .post('/api/auth/register')
      .send({
        username: 'pair_hero_1',
        email: 'pairhero1@test.com',
        password: 'Password123!',
        role: 'Hero',
      })
      .expect(201);

    // Create 3 incidents:
    // Inc 1: Reported, Severity 5
    await request(app)
      .post('/api/incidents')
      .set('Authorization', `Bearer ${cit.body.token}`)
      .send({
        title: 'Reported Sev 5',
        description: 'Desc',
        category: 'Fire',
        severity: 5,
        location: 'Loc 1',
      })
      .expect(201);

    // Inc 2: Reported, Severity 2
    await request(app)
      .post('/api/incidents')
      .set('Authorization', `Bearer ${cit.body.token}`)
      .send({
        title: 'Reported Sev 2',
        description: 'Desc',
        category: 'Theft',
        severity: 2,
        location: 'Loc 2',
      })
      .expect(201);

    // Inc 3: Claimed, Severity 5
    const inc3 = await request(app)
      .post('/api/incidents')
      .set('Authorization', `Bearer ${cit.body.token}`)
      .send({
        title: 'Claimed Sev 5',
        description: 'Desc',
        category: 'Robbery',
        severity: 5,
        location: 'Loc 3',
      })
      .expect(201);

    await request(app)
      .post(`/api/incidents/${inc3.body.id}/claim`)
      .set('Authorization', `Bearer ${hero.body.token}`)
      .expect(200);

    // Query status=Reported AND severity=5
    const filterRes = await request(app)
      .get('/api/incidents?status=Reported&severity=5')
      .set('Authorization', `Bearer ${hero.body.token}`)
      .expect(200);

    const items = filterRes.body.items || filterRes.body;
    assert.strictEqual(items.length, 1);
    assert.strictEqual(items[0].title, 'Reported Sev 5');
    assert.strictEqual(items[0].status, 'Reported');
    assert.strictEqual(items[0].severity, 5);
  });

  it('3.4 Pairwise filtering: Status AND Category multi-criteria filtering', async () => {
    const cit = await request(app)
      .post('/api/auth/register')
      .send({
        username: 'pair_cit_2',
        email: 'pair2@test.com',
        password: 'Password123!',
        role: 'Citizen',
      })
      .expect(201);

    const hero = await request(app)
      .post('/api/auth/register')
      .send({
        username: 'pair_hero_2',
        email: 'pairhero2@test.com',
        password: 'Password123!',
        role: 'Hero',
      })
      .expect(201);

    // Seed Reported Fire
    await request(app)
      .post('/api/incidents')
      .set('Authorization', `Bearer ${cit.body.token}`)
      .send({
        title: 'Reported Fire 1',
        description: 'Desc',
        category: 'Fire',
        severity: 3,
        location: 'Loc A',
      })
      .expect(201);

    // Seed Reported Robbery
    await request(app)
      .post('/api/incidents')
      .set('Authorization', `Bearer ${cit.body.token}`)
      .send({
        title: 'Reported Robbery 1',
        description: 'Desc',
        category: 'Robbery',
        severity: 4,
        location: 'Loc B',
      })
      .expect(201);

    // Seed Claimed Fire
    const incClaimed = await request(app)
      .post('/api/incidents')
      .set('Authorization', `Bearer ${cit.body.token}`)
      .send({
        title: 'Claimed Fire 1',
        description: 'Desc',
        category: 'Fire',
        severity: 4,
        location: 'Loc C',
      })
      .expect(201);

    await request(app)
      .post(`/api/incidents/${incClaimed.body.id}/claim`)
      .set('Authorization', `Bearer ${hero.body.token}`)
      .expect(200);

    // Filter status=Reported AND category=Fire
    const res = await request(app)
      .get('/api/incidents?status=Reported&category=Fire')
      .set('Authorization', `Bearer ${hero.body.token}`)
      .expect(200);

    const items = res.body.items || res.body;
    assert.strictEqual(items.length, 1);
    assert.strictEqual(items[0].title, 'Reported Fire 1');
    assert.strictEqual(items[0].category, 'Fire');
  });

  it('3.5 Pairwise filtering: Category AND Severity multi-criteria filtering', async () => {
    const cit = await request(app)
      .post('/api/auth/register')
      .send({
        username: 'pair_cit_3',
        email: 'pair3@test.com',
        password: 'Password123!',
        role: 'Citizen',
      })
      .expect(201);

    const hero = await request(app)
      .post('/api/auth/register')
      .send({
        username: 'pair_hero_3',
        email: 'pairhero3@test.com',
        password: 'Password123!',
        role: 'Hero',
      })
      .expect(201);

    await request(app)
      .post('/api/incidents')
      .set('Authorization', `Bearer ${cit.body.token}`)
      .send({
        title: 'Robbery Severity 5',
        description: 'Desc',
        category: 'Robbery',
        severity: 5,
        location: 'Loc 1',
      })
      .expect(201);

    await request(app)
      .post('/api/incidents')
      .set('Authorization', `Bearer ${cit.body.token}`)
      .send({
        title: 'Robbery Severity 2',
        description: 'Desc',
        category: 'Robbery',
        severity: 2,
        location: 'Loc 2',
      })
      .expect(201);

    await request(app)
      .post('/api/incidents')
      .set('Authorization', `Bearer ${cit.body.token}`)
      .send({
        title: 'Fire Severity 5',
        description: 'Desc',
        category: 'Fire',
        severity: 5,
        location: 'Loc 3',
      })
      .expect(201);

    const res = await request(app)
      .get('/api/incidents?category=Robbery&severity=5')
      .set('Authorization', `Bearer ${hero.body.token}`)
      .expect(200);

    const items = res.body.items || res.body;
    assert.strictEqual(items.length, 1);
    assert.strictEqual(items[0].title, 'Robbery Severity 5');
  });

  it('3.6 Triple criteria filtering: Status AND Category AND Severity together', async () => {
    const cit = await request(app)
      .post('/api/auth/register')
      .send({
        username: 'triple_cit',
        email: 'triple@test.com',
        password: 'Password123!',
        role: 'Citizen',
      })
      .expect(201);

    const hero = await request(app)
      .post('/api/auth/register')
      .send({
        username: 'triple_hero',
        email: 'triplehero@test.com',
        password: 'Password123!',
        role: 'Hero',
      })
      .expect(201);

    await request(app)
      .post('/api/incidents')
      .set('Authorization', `Bearer ${cit.body.token}`)
      .send({
        title: 'Target Incident',
        description: 'Exact match',
        category: 'Rescue',
        severity: 4,
        location: 'Astoria',
      })
      .expect(201);

    await request(app)
      .post('/api/incidents')
      .set('Authorization', `Bearer ${cit.body.token}`)
      .send({
        title: 'Distractor Incident',
        description: 'Different category',
        category: 'Fire',
        severity: 4,
        location: 'Astoria',
      })
      .expect(201);

    const res = await request(app)
      .get('/api/incidents?status=Reported&category=Rescue&severity=4')
      .set('Authorization', `Bearer ${hero.body.token}`)
      .expect(200);

    const items = res.body.items || res.body;
    assert.strictEqual(items.length, 1);
    assert.strictEqual(items[0].title, 'Target Incident');
  });

  it('3.7 Paginating filtered results: page, limit, and category combined', async () => {
    const cit = await request(app)
      .post('/api/auth/register')
      .send({
        username: 'pag_filter_cit',
        email: 'pagfilter@test.com',
        password: 'Password123!',
        role: 'Citizen',
      })
      .expect(201);

    const hero = await request(app)
      .post('/api/auth/register')
      .send({
        username: 'pag_filter_hero',
        email: 'pagfilterhero@test.com',
        password: 'Password123!',
        role: 'Hero',
      })
      .expect(201);

    // Create 4 'Theft' incidents and 2 'Hazard' incidents
    for (let i = 1; i <= 4; i++) {
      await request(app)
        .post('/api/incidents')
        .set('Authorization', `Bearer ${cit.body.token}`)
        .send({
          title: `Theft Item ${i}`,
          description: 'Desc',
          category: 'Theft',
          severity: 2,
          location: `Street ${i}`,
        })
        .expect(201);
    }

    for (let i = 1; i <= 2; i++) {
      await request(app)
        .post('/api/incidents')
        .set('Authorization', `Bearer ${cit.body.token}`)
        .send({
          title: `Hazard Item ${i}`,
          description: 'Desc',
          category: 'Hazard',
          severity: 3,
          location: `Ave ${i}`,
        })
        .expect(201);
    }

    // Page 1 for Theft with limit=2
    const page1Res = await request(app)
      .get('/api/incidents?category=Theft&page=1&limit=2')
      .set('Authorization', `Bearer ${hero.body.token}`)
      .expect(200);

    const items1 = page1Res.body.items || page1Res.body;
    assert.strictEqual(items1.length, 2);
    if (page1Res.body.total !== undefined) {
      assert.strictEqual(page1Res.body.total, 4);
    }

    // Page 2 for Theft with limit=2
    const page2Res = await request(app)
      .get('/api/incidents?category=Theft&page=2&limit=2')
      .set('Authorization', `Bearer ${hero.body.token}`)
      .expect(200);

    const items2 = page2Res.body.items || page2Res.body;
    assert.strictEqual(items2.length, 2);

    // Verify disjoint sets
    const idsPage1 = new Set(items1.map((item) => item.id));
    for (const item of items2) {
      assert.ok(!idsPage1.has(item.id), `ID ${item.id} should not appear on both pages`);
    }
  });

  it('3.8 Status transition sequence verifying status history records match user IDs at each step', async () => {
    // 1. Citizen creates
    const cit = await request(app)
      .post('/api/auth/register')
      .send({
        username: 'actor_cit_audit',
        email: 'actoraudit@test.com',
        password: 'Password123!',
        role: 'Citizen',
      })
      .expect(201);

    const inc = await request(app)
      .post('/api/incidents')
      .set('Authorization', `Bearer ${cit.body.token}`)
      .send({
        title: 'Full Audit Verification Incident',
        description: 'Tracking each actor ID',
        category: 'Rescue',
        severity: 4,
        location: 'Times Square',
      })
      .expect(201);

    // 2. Hero claims
    const hero = await request(app)
      .post('/api/auth/register')
      .send({
        username: 'actor_hero_audit',
        email: 'actorheroaudit@test.com',
        password: 'Password123!',
        role: 'Hero',
      })
      .expect(201);

    await request(app)
      .post(`/api/incidents/${inc.body.id}/claim`)
      .set('Authorization', `Bearer ${hero.body.token}`)
      .expect(200);

    // 3. Hero moves to In Progress
    await request(app)
      .patch(`/api/incidents/${inc.body.id}/status`)
      .set('Authorization', `Bearer ${hero.body.token}`)
      .send({ status: 'In Progress', notes: 'First action taken' })
      .expect(200);

    // 4. Hero resolves
    await request(app)
      .patch(`/api/incidents/${inc.body.id}/status`)
      .set('Authorization', `Bearer ${hero.body.token}`)
      .send({ status: 'Resolved', notes: 'Action complete' })
      .expect(200);

    // 5. Inspect history
    const histRes = await request(app)
      .get(`/api/incidents/${inc.body.id}/history`)
      .set('Authorization', `Bearer ${hero.body.token}`)
      .expect(200);

    const history = Array.isArray(histRes.body) ? histRes.body : histRes.body.history;
    assert.strictEqual(history.length, 4);

    // Step 1: Citizen reported
    assert.strictEqual(history[0].previous_status, null);
    assert.strictEqual(history[0].new_status, 'Reported');
    assert.strictEqual(history[0].changed_by_user_id, cit.body.user.id);

    // Step 2: Hero claimed
    assert.strictEqual(history[1].previous_status, 'Reported');
    assert.strictEqual(history[1].new_status, 'Claimed');
    assert.strictEqual(history[1].changed_by_user_id, hero.body.user.id);

    // Step 3: Hero in progress
    assert.strictEqual(history[2].previous_status, 'Claimed');
    assert.strictEqual(history[2].new_status, 'In Progress');
    assert.strictEqual(history[2].changed_by_user_id, hero.body.user.id);

    // Step 4: Hero resolved
    assert.strictEqual(history[3].previous_status, 'In Progress');
    assert.strictEqual(history[3].new_status, 'Resolved');
    assert.strictEqual(history[3].changed_by_user_id, hero.body.user.id);
  });

  it('3.9 Claim removes incident from Hero default open listing while keeping it visible in Citizen list', async () => {
    const cit = await request(app)
      .post('/api/auth/register')
      .send({
        username: 'visibility_cit',
        email: 'viscit@test.com',
        password: 'Password123!',
        role: 'Citizen',
      })
      .expect(201);

    const inc = await request(app)
      .post('/api/incidents')
      .set('Authorization', `Bearer ${cit.body.token}`)
      .send({
        title: 'Visibility Test Incident',
        description: 'Desc',
        category: 'Fire',
        severity: 3,
        location: 'Queens',
      })
      .expect(201);

    const hero = await request(app)
      .post('/api/auth/register')
      .send({
        username: 'visibility_hero',
        email: 'vishero@test.com',
        password: 'Password123!',
        role: 'Hero',
      })
      .expect(201);

    // Hero claims it
    await request(app)
      .post(`/api/incidents/${inc.body.id}/claim`)
      .set('Authorization', `Bearer ${hero.body.token}`)
      .expect(200);

    // Hero default open list -> should NOT contain it
    const heroList = await request(app)
      .get('/api/incidents')
      .set('Authorization', `Bearer ${hero.body.token}`)
      .expect(200);
    const heroItems = heroList.body.items || heroList.body;
    assert.strictEqual(heroItems.length, 0);

    // Citizen list -> SHOULD contain it with status 'Claimed'
    const citList = await request(app)
      .get('/api/incidents')
      .set('Authorization', `Bearer ${cit.body.token}`)
      .expect(200);
    const citItems = citList.body.items || citList.body;
    assert.strictEqual(citItems.length, 1);
    assert.strictEqual(citItems[0].status, 'Claimed');
  });

  it('3.10 Multi-Citizen isolation with filters and pagination', async () => {
    const citA = await request(app)
      .post('/api/auth/register')
      .send({
        username: 'iso_cit_a',
        email: 'isocita@test.com',
        password: 'Password123!',
        role: 'Citizen',
      })
      .expect(201);

    const citB = await request(app)
      .post('/api/auth/register')
      .send({
        username: 'iso_cit_b',
        email: 'isocitb@test.com',
        password: 'Password123!',
        role: 'Citizen',
      })
      .expect(201);

    // Citizen A reports 3 Fire incidents
    for (let i = 1; i <= 3; i++) {
      await request(app)
        .post('/api/incidents')
        .set('Authorization', `Bearer ${citA.body.token}`)
        .send({
          title: `Cit A Fire ${i}`,
          description: 'Desc',
          category: 'Fire',
          severity: 3,
          location: 'Bronx',
        })
        .expect(201);
    }

    // Citizen B reports 4 Fire incidents
    for (let i = 1; i <= 4; i++) {
      await request(app)
        .post('/api/incidents')
        .set('Authorization', `Bearer ${citB.body.token}`)
        .send({
          title: `Cit B Fire ${i}`,
          description: 'Desc',
          category: 'Fire',
          severity: 3,
          location: 'Brooklyn',
        })
        .expect(201);
    }

    // Citizen A queries their Fire incidents
    const citARes = await request(app)
      .get('/api/incidents?category=Fire')
      .set('Authorization', `Bearer ${citA.body.token}`)
      .expect(200);

    const citAItems = citARes.body.items || citARes.body;
    assert.strictEqual(citAItems.length, 3);
    for (const item of citAItems) {
      assert.strictEqual(item.reporter_id, citA.body.user.id);
    }
  });

  it('3.11 Hero re-login and resuming claimed incident workflow with fresh JWT', async () => {
    const cit = await request(app)
      .post('/api/auth/register')
      .send({
        username: 'relogin_cit',
        email: 'relogincit@test.com',
        password: 'Password123!',
        role: 'Citizen',
      })
      .expect(201);

    const inc = await request(app)
      .post('/api/incidents')
      .set('Authorization', `Bearer ${cit.body.token}`)
      .send({
        title: 'Gas Explosion Threat',
        description: 'Industrial plant leak',
        category: 'Hazard',
        severity: 5,
        location: 'Long Island City',
      })
      .expect(201);

    const hero = await request(app)
      .post('/api/auth/register')
      .send({
        username: 'relogin_hero',
        email: 'reloginhero@test.com',
        password: 'Password123!',
        role: 'Hero',
      })
      .expect(201);

    // Initial claim
    await request(app)
      .post(`/api/incidents/${inc.body.id}/claim`)
      .set('Authorization', `Bearer ${hero.body.token}`)
      .expect(200);

    // Hero re-authenticates via login
    const loginRes = await request(app)
      .post('/api/auth/login')
      .send({
        username: 'relogin_hero',
        password: 'Password123!',
      })
      .expect(200);

    const freshToken = loginRes.body.token;

    // Advance to In Progress with new token
    const progRes = await request(app)
      .patch(`/api/incidents/${inc.body.id}/status`)
      .set('Authorization', `Bearer ${freshToken}`)
      .send({ status: 'In Progress' })
      .expect(200);
    assert.strictEqual(progRes.body.status, 'In Progress');

    // Advance to Resolved with new token
    const resRes = await request(app)
      .patch(`/api/incidents/${inc.body.id}/status`)
      .set('Authorization', `Bearer ${freshToken}`)
      .send({ status: 'Resolved' })
      .expect(200);
    assert.strictEqual(resRes.body.status, 'Resolved');
  });

  it('3.12 Hero status updates preserve custom notes in chronological history', async () => {
    const cit = await request(app)
      .post('/api/auth/register')
      .send({
        username: 'notes_cit',
        email: 'notescit@test.com',
        password: 'Password123!',
        role: 'Citizen',
      })
      .expect(201);

    const inc = await request(app)
      .post('/api/incidents')
      .set('Authorization', `Bearer ${cit.body.token}`)
      .send({
        title: 'Hostage Crisis',
        description: 'Active situation',
        category: 'Hostage',
        severity: 5,
        location: 'Midtown',
      })
      .expect(201);

    const hero = await request(app)
      .post('/api/auth/register')
      .send({
        username: 'notes_hero',
        email: 'noteshero@test.com',
        password: 'Password123!',
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
      .send({ status: 'In Progress', notes: 'Perimeter secured by hero' })
      .expect(200);

    await request(app)
      .patch(`/api/incidents/${inc.body.id}/status`)
      .set('Authorization', `Bearer ${hero.body.token}`)
      .send({ status: 'Resolved', notes: 'All hostages evacuated safely' })
      .expect(200);

    const histRes = await request(app)
      .get(`/api/incidents/${inc.body.id}/history`)
      .set('Authorization', `Bearer ${hero.body.token}`)
      .expect(200);

    const history = Array.isArray(histRes.body) ? histRes.body : histRes.body.history;
    assert.strictEqual(history[2].notes, 'Perimeter secured by hero');
    assert.strictEqual(history[3].notes, 'All hostages evacuated safely');
  });
});
