/**
 * Tier 4: Real-World Multi-Step End-to-End Scenarios (5 Scenarios)
 *
 * 1. Midtown Bank Robbery full lifecycle
 * 2. Queens Fire multi-hero race condition (atomic CAS concurrency)
 * 3. Multi-Citizen neighborhood watch (strict tenant isolation)
 * 4. Hero shift workload (large batch traversal, multi-field filtering, pagination)
 * 5. Rogue actor defense (unauthorized, role violation, hijack, terminal state mutation)
 */

const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { getApp, request, resetDb } = require('./testHelper');

describe('Tier 4: Real-World Multi-Step End-to-End Workloads', () => {
  let app;

  beforeEach(() => {
    resetDb();
    app = getApp();
  });

  // =========================================================================
  // Scenario 1: Midtown Bank Robbery Full Lifecycle
  // =========================================================================
  it('Scenario 1: Midtown Bank Robbery full lifecycle (Reported -> Claimed -> In Progress -> Resolved + Audit)', async () => {
    // 1. Citizen Peter Parker registers
    const peterReg = await request(app)
      .post('/api/auth/register')
      .send({
        username: 'peter_parker_midtown',
        email: 'peter@dailybugle.nyc',
        password: 'SpideySecret123!',
        role: 'Citizen',
      })
      .expect(201);
    const peterToken = peterReg.body.token;

    // 2. Peter creates severity 5 incident
    const incRes = await request(app)
      .post('/api/incidents')
      .set('Authorization', `Bearer ${peterToken}`)
      .send({
        title: 'Midtown Manhattan Bank Robbery',
        description: 'Heavily armed crew with shock blasters breaching vault',
        category: 'Robbery',
        severity: 5,
        location: '5th Ave & 42nd St, Manhattan',
      })
      .expect(201);

    const incidentId = incRes.body.id;
    assert.strictEqual(incRes.body.status, 'Reported');
    assert.strictEqual(incRes.body.severity, 5);

    // 3. Hero Spider-Man registers and logs in
    await request(app)
      .post('/api/auth/register')
      .send({
        username: 'spiderman_midtown_hero',
        email: 'spiderman@heroes.org',
        password: 'GreatPowerGreatResponsibility123!',
        role: 'Hero',
      })
      .expect(201);

    const spideyLogin = await request(app)
      .post('/api/auth/login')
      .send({
        username: 'spiderman_midtown_hero',
        password: 'GreatPowerGreatResponsibility123!',
      })
      .expect(200);
    const spideyToken = spideyLogin.body.token;
    const spideyId = spideyLogin.body.user.id;

    // 4. Spider-Man scans open incidents and locates the robbery
    const openIncidents = await request(app)
      .get('/api/incidents')
      .set('Authorization', `Bearer ${spideyToken}`)
      .expect(200);

    const items = openIncidents.body.items || openIncidents.body;
    const robbery = items.find((inc) => inc.id === incidentId);
    assert.ok(robbery, 'Robbery incident should appear in open hero feed');

    // 5. Spider-Man claims the incident
    const claimRes = await request(app)
      .post(`/api/incidents/${incidentId}/claim`)
      .set('Authorization', `Bearer ${spideyToken}`)
      .expect(200);

    assert.strictEqual(claimRes.body.status, 'Claimed');
    assert.strictEqual(claimRes.body.hero_id, spideyId);

    // 6. Spider-Man transitions to In Progress
    const inProgressRes = await request(app)
      .patch(`/api/incidents/${incidentId}/status`)
      .set('Authorization', `Bearer ${spideyToken}`)
      .send({
        status: 'In Progress',
        notes: 'Infiltrated vault via ventilation duct; engaging crew',
      })
      .expect(200);

    assert.strictEqual(inProgressRes.body.status, 'In Progress');

    // 7. Spider-Man resolves the incident
    const resolveRes = await request(app)
      .patch(`/api/incidents/${incidentId}/status`)
      .set('Authorization', `Bearer ${spideyToken}`)
      .send({
        status: 'Resolved',
        notes: 'Crew webbed up, weapons secured, NYPD and paramedics arrived',
      })
      .expect(200);

    assert.strictEqual(resolveRes.body.status, 'Resolved');

    // 8. Inspect complete chronological audit trail
    const histRes = await request(app)
      .get(`/api/incidents/${incidentId}/history`)
      .set('Authorization', `Bearer ${spideyToken}`)
      .expect(200);

    const history = Array.isArray(histRes.body) ? histRes.body : histRes.body.history;
    assert.strictEqual(history.length, 4, 'History should contain exactly 4 status transition records');

    assert.strictEqual(history[0].previous_status, null);
    assert.strictEqual(history[0].new_status, 'Reported');
    assert.strictEqual(history[0].changed_by_user_id, peterReg.body.user.id);

    assert.strictEqual(history[1].previous_status, 'Reported');
    assert.strictEqual(history[1].new_status, 'Claimed');
    assert.strictEqual(history[1].changed_by_user_id, spideyId);

    assert.strictEqual(history[2].previous_status, 'Claimed');
    assert.strictEqual(history[2].new_status, 'In Progress');
    assert.strictEqual(history[2].changed_by_user_id, spideyId);
    assert.strictEqual(history[2].notes, 'Infiltrated vault via ventilation duct; engaging crew');

    assert.strictEqual(history[3].previous_status, 'In Progress');
    assert.strictEqual(history[3].new_status, 'Resolved');
    assert.strictEqual(history[3].changed_by_user_id, spideyId);
    assert.strictEqual(history[3].notes, 'Crew webbed up, weapons secured, NYPD and paramedics arrived');

    // 9. Citizen Peter verifies incident is Resolved
    const peterCheck = await request(app)
      .get(`/api/incidents/${incidentId}`)
      .set('Authorization', `Bearer ${peterToken}`)
      .expect(200);

    assert.strictEqual(peterCheck.body.status, 'Resolved');
  });

  // =========================================================================
  // Scenario 2: Queens Apartment Fire Multi-Hero Race Condition
  // =========================================================================
  it('Scenario 2: Queens Fire multi-hero race condition (atomic CAS concurrency)', async () => {
    // 1. Citizen reports severe fire
    const cit = await request(app)
      .post('/api/auth/register')
      .send({
        username: 'mary_jane_watson',
        email: 'mj@broadway.org',
        password: 'Password123!',
        role: 'Citizen',
      })
      .expect(201);

    const inc = await request(app)
      .post('/api/incidents')
      .set('Authorization', `Bearer ${cit.body.token}`)
      .send({
        title: 'Queens 4-Alarm Apartment Complex Fire',
        description: 'Families trapped on upper floors, intense smoke',
        category: 'Fire',
        severity: 5,
        location: 'Astoria Blvd & 31st St, Queens',
      })
      .expect(201);

    const incidentId = inc.body.id;

    // 2. Register Hero 1: Daredevil
    const hero1 = await request(app)
      .post('/api/auth/register')
      .send({
        username: 'daredevil_matt',
        email: 'daredevil@nelsonmurdock.com',
        password: 'ManWithoutFear123!',
        role: 'Hero',
      })
      .expect(201);

    // 3. Register Hero 2: Wolverine
    const hero2 = await request(app)
      .post('/api/auth/register')
      .send({
        username: 'wolverine_logan',
        email: 'logan@xmen.org',
        password: 'WeaponX123!',
        role: 'Hero',
      })
      .expect(201);

    // 4. Simultaneous race condition: Daredevil and Wolverine claim at the exact same moment
    const [res1, res2] = await Promise.all([
      request(app)
        .post(`/api/incidents/${incidentId}/claim`)
        .set('Authorization', `Bearer ${hero1.body.token}`),
      request(app)
        .post(`/api/incidents/${incidentId}/claim`)
        .set('Authorization', `Bearer ${hero2.body.token}`),
    ]);

    const statuses = [res1.status, res2.status];
    // Exactly one must succeed with 200, and exactly one must fail with 409 (or 400)
    assert.ok(
      statuses.includes(200),
      `One request must succeed with 200. Got: ${JSON.stringify(statuses)}`
    );
    assert.ok(
      statuses.includes(409) || statuses.includes(400),
      `The conflicting request must be rejected with 409 or 400. Got: ${JSON.stringify(statuses)}`
    );

    const winnerRes = res1.status === 200 ? res1 : res2;
    const loserRes = res1.status === 200 ? res2 : res1;
    const winnerHero = res1.status === 200 ? hero1 : hero2;
    const loserHero = res1.status === 200 ? hero2 : hero1;

    // Verify winner has Claimed status
    assert.strictEqual(winnerRes.body.status, 'Claimed');
    assert.strictEqual(winnerRes.body.hero_id, winnerHero.body.user.id);

    // Verify database state: exactly 1 hero assigned
    const dbCheck = await request(app)
      .get(`/api/incidents/${incidentId}`)
      .set('Authorization', `Bearer ${winnerHero.body.token}`)
      .expect(200);

    assert.strictEqual(dbCheck.body.status, 'Claimed');
    assert.strictEqual(dbCheck.body.hero_id, winnerHero.body.user.id);

    // Verify status history: exactly 2 records (creation + 1 claim)
    const histCheck = await request(app)
      .get(`/api/incidents/${incidentId}/history`)
      .set('Authorization', `Bearer ${winnerHero.body.token}`)
      .expect(200);

    const history = Array.isArray(histCheck.body) ? histCheck.body : histCheck.body.history;
    assert.strictEqual(history.length, 2, 'History must contain only 1 claim entry');

    // 5. Loser attempts to update status -> rejected with 403 Forbidden
    await request(app)
      .patch(`/api/incidents/${incidentId}/status`)
      .set('Authorization', `Bearer ${loserHero.body.token}`)
      .send({ status: 'In Progress' })
      .expect(403);

    // 6. Winner successfully resolves the emergency
    await request(app)
      .patch(`/api/incidents/${incidentId}/status`)
      .set('Authorization', `Bearer ${winnerHero.body.token}`)
      .send({ status: 'In Progress' })
      .expect(200);

    await request(app)
      .patch(`/api/incidents/${incidentId}/status`)
      .set('Authorization', `Bearer ${winnerHero.body.token}`)
      .send({ status: 'Resolved', notes: 'All tenants rescued safely' })
      .expect(200);
  });

  // =========================================================================
  // Scenario 3: Multi-Citizen Neighborhood Watch (Tenant Isolation)
  // =========================================================================
  it('Scenario 3: Multi-Citizen neighborhood watch (strict tenant isolation across boroughs)', async () => {
    // Citizen 1: Miles in Brooklyn
    const miles = await request(app)
      .post('/api/auth/register')
      .send({
        username: 'miles_morales_brooklyn',
        email: 'miles@visions.edu',
        password: 'Password123!',
        role: 'Citizen',
      })
      .expect(201);

    const incMiles = await request(app)
      .post('/api/incidents')
      .set('Authorization', `Bearer ${miles.body.token}`)
      .send({
        title: 'Stolen Particle Accelerator Component',
        description: 'Laboratory broken into overnight',
        category: 'Theft',
        severity: 3,
        location: 'Downtown Brooklyn',
      })
      .expect(201);

    // Citizen 2: Gwen in Manhattan
    const gwen = await request(app)
      .post('/api/auth/register')
      .send({
        username: 'gwen_stacy_manhattan',
        email: 'gwen@drummers.org',
        password: 'Password123!',
        role: 'Citizen',
      })
      .expect(201);

    const incGwen = await request(app)
      .post('/api/incidents')
      .set('Authorization', `Bearer ${gwen.body.token}`)
      .send({
        title: 'Oscorp Surveillance Drone Swarm',
        description: 'Unauthorized drones hovering over rooftops',
        category: 'Surveillance',
        severity: 2,
        location: 'Chelsea Manhattan',
      })
      .expect(201);

    // Citizen 3: Harry in Queens
    const harry = await request(app)
      .post('/api/auth/register')
      .send({
        username: 'harry_osborn_queens',
        email: 'harry@oscorp.corp',
        password: 'Password123!',
        role: 'Citizen',
      })
      .expect(201);

    const incHarry = await request(app)
      .post('/api/incidents')
      .set('Authorization', `Bearer ${harry.body.token}`)
      .send({
        title: 'Toxic Sludge Spill in Flushing Creek',
        description: 'Green chemical liquid leaking into waterway',
        category: 'Hazard',
        severity: 4,
        location: 'Flushing Meadows, Queens',
      })
      .expect(201);

    // Verify Miles sees ONLY his incident
    const milesList = await request(app)
      .get('/api/incidents')
      .set('Authorization', `Bearer ${miles.body.token}`)
      .expect(200);
    const milesItems = milesList.body.items || milesList.body;
    assert.strictEqual(milesItems.length, 1);
    assert.strictEqual(milesItems[0].id, incMiles.body.id);

    // Verify Gwen sees ONLY her incident
    const gwenList = await request(app)
      .get('/api/incidents')
      .set('Authorization', `Bearer ${gwen.body.token}`)
      .expect(200);
    const gwenItems = gwenList.body.items || gwenList.body;
    assert.strictEqual(gwenItems.length, 1);
    assert.strictEqual(gwenItems[0].id, incGwen.body.id);

    // Verify Harry sees ONLY his incident
    const harryList = await request(app)
      .get('/api/incidents')
      .set('Authorization', `Bearer ${harry.body.token}`)
      .expect(200);
    const harryItems = harryList.body.items || harryList.body;
    assert.strictEqual(harryItems.length, 1);
    assert.strictEqual(harryItems[0].id, incHarry.body.id);

    // Direct access across boundaries must be blocked (403 or 404)
    const cross1 = await request(app)
      .get(`/api/incidents/${incGwen.body.id}`)
      .set('Authorization', `Bearer ${miles.body.token}`);
    assert.ok(cross1.status === 403 || cross1.status === 404);

    const cross2 = await request(app)
      .get(`/api/incidents/${incHarry.body.id}`)
      .set('Authorization', `Bearer ${gwen.body.token}`);
    assert.ok(cross2.status === 403 || cross2.status === 404);

    const cross3 = await request(app)
      .get(`/api/incidents/${incMiles.body.id}`)
      .set('Authorization', `Bearer ${harry.body.token}`);
    assert.ok(cross3.status === 403 || cross3.status === 404);
  });

  // =========================================================================
  // Scenario 4: Hero Shift Workload (Batch Traversal & Pagination)
  // =========================================================================
  it('Scenario 4: Hero shift workload (large batch traversal, multi-field filtering, pagination)', async () => {
    // Seed 15 incidents across categories and severities
    const cit = await request(app)
      .post('/api/auth/register')
      .send({
        username: 'dispatcher_citizen',
        email: 'dispatch@ny.gov',
        password: 'Password123!',
        role: 'Citizen',
      })
      .expect(201);

    const categories = ['Robbery', 'Fire', 'Rescue', 'Hazard', 'Accident'];
    const createdIds = [];

    for (let i = 1; i <= 15; i++) {
      const category = categories[(i - 1) % categories.length];
      const severity = ((i - 1) % 5) + 1; // 1 to 5
      const res = await request(app)
        .post('/api/incidents')
        .set('Authorization', `Bearer ${cit.body.token}`)
        .send({
          title: `Shift Incident #${i} - ${category}`,
          description: `Description for incident ${i}`,
          category,
          severity,
          location: `District ${(i % 5) + 1}`,
        })
        .expect(201);
      createdIds.push(res.body.id);
    }

    assert.strictEqual(createdIds.length, 15);

    // Hero logs in to work the shift
    const hero = await request(app)
      .post('/api/auth/register')
      .send({
        username: 'ironman_tony',
        email: 'tony@stark.industries',
        password: 'IAmIronMan123!',
        role: 'Hero',
      })
      .expect(201);

    // Page 1: limit 5
    const p1 = await request(app)
      .get('/api/incidents?page=1&limit=5')
      .set('Authorization', `Bearer ${hero.body.token}`)
      .expect(200);

    const items1 = p1.body.items || p1.body;
    assert.strictEqual(items1.length, 5);

    // Page 2: limit 5
    const p2 = await request(app)
      .get('/api/incidents?page=2&limit=5')
      .set('Authorization', `Bearer ${hero.body.token}`)
      .expect(200);

    const items2 = p2.body.items || p2.body;
    assert.strictEqual(items2.length, 5);

    // Page 3: limit 5
    const p3 = await request(app)
      .get('/api/incidents?page=3&limit=5')
      .set('Authorization', `Bearer ${hero.body.token}`)
      .expect(200);

    const items3 = p3.body.items || p3.body;
    assert.strictEqual(items3.length, 5);

    // Check union: all 15 incidents traversed with 0 overlap
    const allTraversedIds = [...items1, ...items2, ...items3].map((item) => item.id);
    const uniqueIds = new Set(allTraversedIds);
    assert.strictEqual(uniqueIds.size, 15, 'All 15 items should be uniquely traversed across 3 pages');

    // Filtering: Filter by category 'Fire' (3 out of 15)
    const fireRes = await request(app)
      .get('/api/incidents?category=Fire')
      .set('Authorization', `Bearer ${hero.body.token}`)
      .expect(200);

    const fireItems = fireRes.body.items || fireRes.body;
    assert.strictEqual(fireItems.length, 3);
    fireItems.forEach((item) => assert.strictEqual(item.category, 'Fire'));

    // Filtering: Filter by severity 5 (3 out of 15)
    const sev5Res = await request(app)
      .get('/api/incidents?severity=5')
      .set('Authorization', `Bearer ${hero.body.token}`)
      .expect(200);

    const sev5Items = sev5Res.body.items || sev5Res.body;
    assert.strictEqual(sev5Items.length, 3);
    sev5Items.forEach((item) => assert.strictEqual(item.severity, 5));

    // Claim one of the incidents and verify open count decrements
    const targetInc = fireItems[0];
    await request(app)
      .post(`/api/incidents/${targetInc.id}/claim`)
      .set('Authorization', `Bearer ${hero.body.token}`)
      .expect(200);

    const openRemaining = await request(app)
      .get('/api/incidents')
      .set('Authorization', `Bearer ${hero.body.token}`)
      .expect(200);

    const remainingItems = openRemaining.body.items || openRemaining.body;
    assert.strictEqual(remainingItems.length, 14, 'Open incidents should decrement to 14');
  });

  // =========================================================================
  // Scenario 5: Rogue Actor Defense & Adversarial State Mutation Resistance
  // =========================================================================
  it('Scenario 5: Rogue actor defense (unauthorized, role violation, hijack, terminal state mutation)', async () => {
    // 1. Unauthenticated attacker hits protected endpoints
    await request(app).get('/api/incidents').expect(401);
    await request(app).post('/api/incidents').send({ title: 'Hack' }).expect(401);
    await request(app).post('/api/incidents/1/claim').expect(401);
    await request(app).patch('/api/incidents/1/status').send({ status: 'Resolved' }).expect(401);
    await request(app).get('/api/incidents/1/history').expect(401);

    // 2. Legitimate Citizen creates an incident
    const goodCit = await request(app)
      .post('/api/auth/register')
      .send({
        username: 'law_abiding_citizen',
        email: 'goodcit@ny.gov',
        password: 'Password123!',
        role: 'Citizen',
      })
      .expect(201);

    const inc = await request(app)
      .post('/api/incidents')
      .set('Authorization', `Bearer ${goodCit.body.token}`)
      .send({
        title: 'Armored Car Ambush',
        description: 'Robbers surrounded truck with plasma cutters',
        category: 'Robbery',
        severity: 5,
        location: 'Tribeca',
      })
      .expect(201);

    const incidentId = inc.body.id;

    // 3. Rogue Citizen attempts Hero actions
    const rogueCit = await request(app)
      .post('/api/auth/register')
      .send({
        username: 'rogue_citizen_hacker',
        email: 'rogue@darkweb.org',
        password: 'Password123!',
        role: 'Citizen',
      })
      .expect(201);

    // Rogue Citizen attempts claim -> 403 Forbidden
    await request(app)
      .post(`/api/incidents/${incidentId}/claim`)
      .set('Authorization', `Bearer ${rogueCit.body.token}`)
      .expect(403);

    // Rogue Citizen attempts direct status patch -> 403 Forbidden
    await request(app)
      .patch(`/api/incidents/${incidentId}/status`)
      .set('Authorization', `Bearer ${rogueCit.body.token}`)
      .send({ status: 'Resolved' })
      .expect(403);

    // 4. Hero A claims incident and starts work
    const heroA = await request(app)
      .post('/api/auth/register')
      .send({
        username: 'captain_america_hero',
        email: 'cap@avengers.org',
        password: 'ShieldPassword123!',
        role: 'Hero',
      })
      .expect(201);

    await request(app)
      .post(`/api/incidents/${incidentId}/claim`)
      .set('Authorization', `Bearer ${heroA.body.token}`)
      .expect(200);

    await request(app)
      .patch(`/api/incidents/${incidentId}/status`)
      .set('Authorization', `Bearer ${heroA.body.token}`)
      .send({ status: 'In Progress', notes: 'Shield deployed; neutralizing cutters' })
      .expect(200);

    // 5. Rogue Hero B attempts to hijack incident
    const rogueHeroB = await request(app)
      .post('/api/auth/register')
      .send({
        username: 'us_agent_rogue',
        email: 'usagent@shadow.org',
        password: 'Password123!',
        role: 'Hero',
      })
      .expect(201);

    // Rogue Hero B attempts re-claim -> 409 Conflict (or 400)
    const hijackClaim = await request(app)
      .post(`/api/incidents/${incidentId}/claim`)
      .set('Authorization', `Bearer ${rogueHeroB.body.token}`);
    assert.ok(hijackClaim.status === 409 || hijackClaim.status === 400);

    // Rogue Hero B attempts to resolve Cap's incident -> 403 Forbidden
    await request(app)
      .patch(`/api/incidents/${incidentId}/status`)
      .set('Authorization', `Bearer ${rogueHeroB.body.token}`)
      .send({ status: 'Resolved' })
      .expect(403);

    // 6. Hero A legitimately completes and resolves incident
    await request(app)
      .patch(`/api/incidents/${incidentId}/status`)
      .set('Authorization', `Bearer ${heroA.body.token}`)
      .send({ status: 'Resolved', notes: 'Guards secured, truck escorted to depository' })
      .expect(200);

    // 7. Attacker attempts terminal state mutations
    // Attempt to revert Resolved back to Reported -> 400 Bad Request
    await request(app)
      .patch(`/api/incidents/${incidentId}/status`)
      .set('Authorization', `Bearer ${heroA.body.token}`)
      .send({ status: 'Reported' })
      .expect(400);

    // Attempt to revert Resolved back to In Progress -> 400 Bad Request
    await request(app)
      .patch(`/api/incidents/${incidentId}/status`)
      .set('Authorization', `Bearer ${heroA.body.token}`)
      .send({ status: 'In Progress' })
      .expect(400);

    // Attempt to mutate to non-existent status -> 400 Bad Request
    await request(app)
      .patch(`/api/incidents/${incidentId}/status`)
      .set('Authorization', `Bearer ${heroA.body.token}`)
      .send({ status: 'DeletedOrVoided' })
      .expect(400);

    // 8. Final verification: Database state remains uncorrupted
    const finalCheck = await request(app)
      .get(`/api/incidents/${incidentId}`)
      .set('Authorization', `Bearer ${heroA.body.token}`)
      .expect(200);

    assert.strictEqual(finalCheck.body.status, 'Resolved');
    assert.strictEqual(finalCheck.body.hero_id, heroA.body.user.id);

    // History has exactly 4 clean records with 0 corrupted steps
    const finalHist = await request(app)
      .get(`/api/incidents/${incidentId}/history`)
      .set('Authorization', `Bearer ${heroA.body.token}`)
      .expect(200);

    const history = Array.isArray(finalHist.body) ? finalHist.body : finalHist.body.history;
    assert.strictEqual(history.length, 4);
    assert.strictEqual(history[0].new_status, 'Reported');
    assert.strictEqual(history[1].new_status, 'Claimed');
    assert.strictEqual(history[2].new_status, 'In Progress');
    assert.strictEqual(history[3].new_status, 'Resolved');
  });
});
