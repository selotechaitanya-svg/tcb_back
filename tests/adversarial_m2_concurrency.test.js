'use strict';

const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const app = require('../src/app');
const { setupTestDb, resetTestDb, teardownTestDb, getDatabase } = require('./helpers/testDb');

describe('Adversarial Verification Suite: Milestone 2 Concurrency, Atomic CAS & Race Conditions', () => {
  before(() => {
    setupTestDb();
  });

  after(() => {
    teardownTestDb();
  });

  beforeEach(() => {
    resetTestDb();
  });

  // Helper to register a citizen and return credentials/token
  async function createCitizen(username = 'cit_concur', email = 'cit_concur@ny.gov') {
    const res = await request(app)
      .post('/api/auth/register')
      .send({ username, email, password: 'Password123!', role: 'Citizen' });
    assert.strictEqual(res.status, 201, `Failed to register citizen ${username}`);
    return res.body;
  }

  // Helper to register a hero and return credentials/token
  async function createHero(username, email) {
    const res = await request(app)
      .post('/api/auth/register')
      .send({ username, email, password: 'HeroPassword123!', role: 'Hero' });
    assert.strictEqual(res.status, 201, `Failed to register hero ${username}`);
    return res.body;
  }

  // Helper to report an incident
  async function reportIncident(citizenToken, overrides = {}) {
    const payload = {
      title: 'Emergency Alarm',
      description: 'Hostile takeover in progress',
      category: 'Robbery',
      severity: 4,
      location: 'Hell\'s Kitchen',
      ...overrides
    };
    const res = await request(app)
      .post('/api/incidents')
      .set('Authorization', `Bearer ${citizenToken}`)
      .send(payload);
    assert.strictEqual(res.status, 201, 'Failed to create incident');
    return res.body;
  }

  // =========================================================================
  // Challenge 1: 2-Hero Concurrent Claim Race Condition
  // =========================================================================
  describe('Challenge 1: Two Contending Heroes Claim Race', () => {
    it('should ensure exactly 1 hero receives HTTP 200 and exactly 1 receives HTTP 409', async () => {
      const citizen = await createCitizen('cit_two_race', 'cit_two@ny.gov');
      const incident = await reportIncident(citizen.token);

      const hero1 = await createHero('spiderman_c1', 'spidey_c1@ny.gov');
      const hero2 = await createHero('daredevil_c1', 'daredevil_c1@ny.gov');

      const [res1, res2] = await Promise.all([
        request(app)
          .post(`/api/incidents/${incident.id}/claim`)
          .set('Authorization', `Bearer ${hero1.token}`),
        request(app)
          .post(`/api/incidents/${incident.id}/claim`)
          .set('Authorization', `Bearer ${hero2.token}`)
      ]);

      const statuses = [res1.status, res2.status].sort();
      assert.deepStrictEqual(
        statuses,
        [200, 409],
        `Expected exactly [200, 409], got [${res1.status}, ${res2.status}]`
      );

      const winnerRes = res1.status === 200 ? res1 : res2;
      const winnerHero = res1.status === 200 ? hero1 : hero2;
      const loserRes = res1.status === 409 ? res1 : res2;

      // Winner verification
      assert.strictEqual(winnerRes.body.status, 'Claimed');
      assert.strictEqual(winnerRes.body.hero_id, winnerHero.user.id);

      // Loser verification
      assert.ok(loserRes.body.error, 'Loser response must contain error message');
      assert.match(loserRes.body.error, /cannot be claimed|Claimed/i);

      // Verify database state directly
      const db = getDatabase();
      const dbIncident = db.get('SELECT * FROM incidents WHERE id = ?', [incident.id]);
      assert.strictEqual(dbIncident.status, 'Claimed');
      assert.strictEqual(dbIncident.hero_id, winnerHero.user.id);

      // Verify status_history has exactly 2 records: NULL -> Reported, Reported -> Claimed
      const history = db.query(
        'SELECT * FROM status_history WHERE incident_id = ? ORDER BY id ASC',
        [incident.id]
      );
      assert.strictEqual(history.length, 2, 'History must contain exactly 2 entries (creation + 1 claim)');
      assert.strictEqual(history[0].previous_status, null);
      assert.strictEqual(history[0].new_status, 'Reported');
      assert.strictEqual(history[0].changed_by_user_id, citizen.user.id);

      assert.strictEqual(history[1].previous_status, 'Reported');
      assert.strictEqual(history[1].new_status, 'Claimed');
      assert.strictEqual(history[1].changed_by_user_id, winnerHero.user.id);
    });
  });

  // =========================================================================
  // Challenge 2: 5-Hero Concurrent Burst Contention
  // =========================================================================
  describe('Challenge 2: Five Contending Heroes Simultaneous Claim Burst', () => {
    it('should ensure exactly 1 hero receives HTTP 200 and all 4 losers receive HTTP 409', async () => {
      const citizen = await createCitizen('cit_five_race', 'cit_five@ny.gov');
      const incident = await reportIncident(citizen.token, { title: 'Five Hero Contest Incident' });

      // Register 5 distinct heroes
      const heroes = await Promise.all([
        createHero('hero_5_1', 'hero_5_1@ny.gov'),
        createHero('hero_5_2', 'hero_5_2@ny.gov'),
        createHero('hero_5_3', 'hero_5_3@ny.gov'),
        createHero('hero_5_4', 'hero_5_4@ny.gov'),
        createHero('hero_5_5', 'hero_5_5@ny.gov')
      ]);

      // Fire 5 simultaneous claim requests
      const responses = await Promise.all(
        heroes.map((h) =>
          request(app)
            .post(`/api/incidents/${incident.id}/claim`)
            .set('Authorization', `Bearer ${h.token}`)
        )
      );

      const statusCounts = responses.reduce((acc, res) => {
        acc[res.status] = (acc[res.status] || 0) + 1;
        return acc;
      }, {});

      assert.strictEqual(statusCounts[200], 1, `Exactly 1 winner must receive HTTP 200. Got: ${JSON.stringify(statusCounts)}`);
      assert.strictEqual(statusCounts[409], 4, `All 4 losing heroes must receive HTTP 409 Conflict. Got: ${JSON.stringify(statusCounts)}`);
      assert.strictEqual(statusCounts[500] || 0, 0, 'No 500 Internal Server Errors permitted');

      // Identify winner
      const winningIndex = responses.findIndex((r) => r.status === 200);
      assert.ok(winningIndex !== -1, 'Winner index must exist');
      const winningHero = heroes[winningIndex];

      // Verify DB state
      const db = getDatabase();
      const dbIncident = db.get('SELECT * FROM incidents WHERE id = ?', [incident.id]);
      assert.strictEqual(dbIncident.status, 'Claimed');
      assert.strictEqual(dbIncident.hero_id, winningHero.user.id);

      // Verify status_history has exactly 2 entries (creation + 1 claim) - zero phantom rows
      const history = db.query(
        'SELECT * FROM status_history WHERE incident_id = ? ORDER BY id ASC',
        [incident.id]
      );
      assert.strictEqual(history.length, 2, 'History must contain exactly 2 entries (0 phantom entries)');
      assert.strictEqual(history[1].new_status, 'Claimed');
      assert.strictEqual(history[1].changed_by_user_id, winningHero.user.id);
    });
  });

  // =========================================================================
  // Challenge 3: 10-Hero High-Contention Simultaneous Claim Burst
  // =========================================================================
  describe('Challenge 3: Ten Contending Heroes High-Contention Simultaneous Burst', () => {
    it('should ensure exactly 1 hero receives HTTP 200 and all 9 losers receive HTTP 409', async () => {
      const citizen = await createCitizen('cit_ten_race', 'cit_ten@ny.gov');
      const incident = await reportIncident(citizen.token, { title: 'Ten Hero High Contention Incident' });

      // Register 10 distinct heroes
      const heroes = [];
      for (let i = 1; i <= 10; i++) {
        heroes.push(await createHero(`hero_10_${i}`, `hero_10_${i}@ny.gov`));
      }

      // Fire 10 simultaneous claim requests
      const responses = await Promise.all(
        heroes.map((h) =>
          request(app)
            .post(`/api/incidents/${incident.id}/claim`)
            .set('Authorization', `Bearer ${h.token}`)
        )
      );

      const statusCounts = responses.reduce((acc, res) => {
        acc[res.status] = (acc[res.status] || 0) + 1;
        return acc;
      }, {});

      assert.strictEqual(statusCounts[200], 1, `Exactly 1 winner must receive HTTP 200. Got: ${JSON.stringify(statusCounts)}`);
      assert.strictEqual(statusCounts[409], 9, `All 9 losing heroes must receive HTTP 409. Got: ${JSON.stringify(statusCounts)}`);
      assert.strictEqual(statusCounts[500] || 0, 0, 'No 500 Internal Server Errors permitted');

      // Verify winner
      const winningIndex = responses.findIndex((r) => r.status === 200);
      const winningHero = heroes[winningIndex];

      const db = getDatabase();
      const dbIncident = db.get('SELECT * FROM incidents WHERE id = ?', [incident.id]);
      assert.strictEqual(dbIncident.status, 'Claimed');
      assert.strictEqual(dbIncident.hero_id, winningHero.user.id);

      // Verify status_history
      const history = db.query(
        'SELECT * FROM status_history WHERE incident_id = ? ORDER BY id ASC',
        [incident.id]
      );
      assert.strictEqual(history.length, 2, 'History must contain exactly 2 entries with 0 phantom rows');
      assert.strictEqual(history[1].new_status, 'Claimed');
      assert.strictEqual(history[1].changed_by_user_id, winningHero.user.id);
    });
  });

  // =========================================================================
  // Challenge 4: Multi-Round Repeated Race Condition Stress Test
  // =========================================================================
  describe('Challenge 4: Multi-Round Repeated Race Condition Stress Test (10 Rounds)', () => {
    it('should maintain strict atomic CAS determinism across 10 consecutive race rounds', async () => {
      const citizen = await createCitizen('cit_multiround', 'cit_multiround@ny.gov');

      // Pre-register 5 heroes
      const heroes = await Promise.all([
        createHero('mr_hero_1', 'mr_hero_1@ny.gov'),
        createHero('mr_hero_2', 'mr_hero_2@ny.gov'),
        createHero('mr_hero_3', 'mr_hero_3@ny.gov'),
        createHero('mr_hero_4', 'mr_hero_4@ny.gov'),
        createHero('mr_hero_5', 'mr_hero_5@ny.gov')
      ]);

      const db = getDatabase();

      for (let round = 1; round <= 10; round++) {
        const incident = await reportIncident(citizen.token, {
          title: `Multi-Round Race Incident Round ${round}`
        });

        const responses = await Promise.all(
          heroes.map((h) =>
            request(app)
              .post(`/api/incidents/${incident.id}/claim`)
              .set('Authorization', `Bearer ${h.token}`)
          )
        );

        const statusCounts = responses.reduce((acc, res) => {
          acc[res.status] = (acc[res.status] || 0) + 1;
          return acc;
        }, {});

        assert.strictEqual(
          statusCounts[200],
          1,
          `Round ${round}: exactly 1 winner expected, got: ${JSON.stringify(statusCounts)}`
        );
        assert.strictEqual(
          statusCounts[409],
          4,
          `Round ${round}: exactly 4 losers with 409 expected, got: ${JSON.stringify(statusCounts)}`
        );

        const winnerRes = responses.find((r) => r.status === 200);
        const dbInc = db.get('SELECT * FROM incidents WHERE id = ?', [incident.id]);
        assert.strictEqual(dbInc.status, 'Claimed');
        assert.strictEqual(dbInc.hero_id, winnerRes.body.hero_id);

        const history = db.query('SELECT * FROM status_history WHERE incident_id = ?', [incident.id]);
        assert.strictEqual(history.length, 2, `Round ${round}: status_history must have exactly 2 rows`);
      }
    });
  });

  // =========================================================================
  // Challenge 5: Multi-Incident Parallel Contention (Cross-Incident Concurrency)
  // =========================================================================
  describe('Challenge 5: Parallel Contention Across Multiple Incidents', () => {
    it('should resolve concurrent claims across 5 different incidents simultaneously with 25 total requests', async () => {
      const citizen = await createCitizen('cit_cross_inc', 'cit_cross@ny.gov');

      // Create 5 incidents
      const incidents = await Promise.all([
        reportIncident(citizen.token, { title: 'Incident Alpha' }),
        reportIncident(citizen.token, { title: 'Incident Beta' }),
        reportIncident(citizen.token, { title: 'Incident Gamma' }),
        reportIncident(citizen.token, { title: 'Incident Delta' }),
        reportIncident(citizen.token, { title: 'Incident Epsilon' })
      ]);

      // Create 5 heroes
      const heroes = await Promise.all([
        createHero('hero_x_1', 'hero_x_1@ny.gov'),
        createHero('hero_x_2', 'hero_x_2@ny.gov'),
        createHero('hero_x_3', 'hero_x_3@ny.gov'),
        createHero('hero_x_4', 'hero_x_4@ny.gov'),
        createHero('hero_x_5', 'hero_x_5@ny.gov')
      ]);

      // Launch 25 requests: every hero attempts to claim every incident simultaneously
      const claimRequests = [];
      for (const incident of incidents) {
        for (const hero of heroes) {
          claimRequests.push({
            incidentId: incident.id,
            heroId: hero.user.id,
            promise: request(app)
              .post(`/api/incidents/${incident.id}/claim`)
              .set('Authorization', `Bearer ${hero.token}`)
          });
        }
      }

      const results = await Promise.all(
        claimRequests.map(async (reqItem) => {
          const res = await reqItem.promise;
          return {
            incidentId: reqItem.incidentId,
            heroId: reqItem.heroId,
            status: res.status,
            body: res.body
          };
        })
      );

      // Overall: exactly 5 winners (200) and 20 losers (409)
      const overall200 = results.filter((r) => r.status === 200).length;
      const overall409 = results.filter((r) => r.status === 409).length;
      assert.strictEqual(overall200, 5, `Expected exactly 5 successful claims overall, got ${overall200}`);
      assert.strictEqual(overall409, 20, `Expected exactly 20 conflict rejections overall, got ${overall409}`);

      // Per incident: each incident must have exactly 1 winner and 4 losers
      const db = getDatabase();
      for (const incident of incidents) {
        const incResults = results.filter((r) => r.incidentId === incident.id);
        const inc200 = incResults.filter((r) => r.status === 200);
        const inc409 = incResults.filter((r) => r.status === 409);

        assert.strictEqual(inc200.length, 1, `Incident ${incident.id} must have exactly 1 winner`);
        assert.strictEqual(inc409.length, 4, `Incident ${incident.id} must have exactly 4 losers`);

        const dbInc = db.get('SELECT * FROM incidents WHERE id = ?', [incident.id]);
        assert.strictEqual(dbInc.status, 'Claimed');
        assert.strictEqual(dbInc.hero_id, inc200[0].heroId);

        const hist = db.query('SELECT * FROM status_history WHERE incident_id = ?', [incident.id]);
        assert.strictEqual(hist.length, 2);
      }
    });
  });

  // =========================================================================
  // Challenge 6: High-Concurrency Re-Claim on Already Claimed Incident
  // =========================================================================
  describe('Challenge 6: High-Concurrency Re-Claim Attempts on Already Claimed Incident', () => {
    it('should reject all 10 concurrent claim attempts with 409 Conflict when incident is already Claimed', async () => {
      const citizen = await createCitizen('cit_claimed_race', 'cit_claimed_race@ny.gov');
      const incident = await reportIncident(citizen.token, { title: 'Already Claimed Incident' });

      // First hero legitimately claims
      const initialHero = await createHero('initial_hero', 'initial_hero@ny.gov');
      const claimRes = await request(app)
        .post(`/api/incidents/${incident.id}/claim`)
        .set('Authorization', `Bearer ${initialHero.token}`)
        .expect(200);

      assert.strictEqual(claimRes.body.status, 'Claimed');
      assert.strictEqual(claimRes.body.hero_id, initialHero.user.id);

      // Now register 10 new heroes
      const rivalHeroes = [];
      for (let i = 1; i <= 10; i++) {
        rivalHeroes.push(await createHero(`rival_hero_${i}`, `rival_hero_${i}@ny.gov`));
      }

      // All 10 rival heroes attempt to claim the already claimed incident concurrently
      const responses = await Promise.all(
        rivalHeroes.map((h) =>
          request(app)
            .post(`/api/incidents/${incident.id}/claim`)
            .set('Authorization', `Bearer ${h.token}`)
        )
      );

      // Assert all 10 got 409
      for (let i = 0; i < responses.length; i++) {
        assert.strictEqual(
          responses[i].status,
          409,
          `Rival hero ${i + 1} claim must return 409 Conflict. Got: ${responses[i].status}`
        );
      }

      // Verify incident ownership was NOT corrupted or stolen
      const db = getDatabase();
      const dbInc = db.get('SELECT * FROM incidents WHERE id = ?', [incident.id]);
      assert.strictEqual(dbInc.status, 'Claimed');
      assert.strictEqual(dbInc.hero_id, initialHero.user.id);

      // History still has exactly 2 entries
      const hist = db.query('SELECT * FROM status_history WHERE incident_id = ?', [incident.id]);
      assert.strictEqual(hist.length, 2, 'History must not have extra entries from rejected claims');
    });
  });

  // =========================================================================
  // Challenge 7: Concurrent Claims on In Progress & Resolved Incidents
  // =========================================================================
  describe('Challenge 7: Concurrent Claims on In Progress and Terminal (Resolved) States', () => {
    it('should reject concurrent claims on In Progress incident with 409 Conflict', async () => {
      const citizen = await createCitizen('cit_prog_race', 'cit_prog_race@ny.gov');
      const incident = await reportIncident(citizen.token);

      const assignedHero = await createHero('assigned_hero_ip', 'assigned_ip@ny.gov');
      await request(app)
        .post(`/api/incidents/${incident.id}/claim`)
        .set('Authorization', `Bearer ${assignedHero.token}`)
        .expect(200);

      await request(app)
        .patch(`/api/incidents/${incident.id}/status`)
        .set('Authorization', `Bearer ${assignedHero.token}`)
        .send({ status: 'In Progress' })
        .expect(200);

      const rivals = await Promise.all([
        createHero('ip_rival_1', 'ip_rival_1@ny.gov'),
        createHero('ip_rival_2', 'ip_rival_2@ny.gov'),
        createHero('ip_rival_3', 'ip_rival_3@ny.gov'),
        createHero('ip_rival_4', 'ip_rival_4@ny.gov'),
        createHero('ip_rival_5', 'ip_rival_5@ny.gov')
      ]);

      const responses = await Promise.all(
        rivals.map((r) =>
          request(app)
            .post(`/api/incidents/${incident.id}/claim`)
            .set('Authorization', `Bearer ${r.token}`)
        )
      );

      responses.forEach((res) => {
        assert.strictEqual(res.status, 409);
        assert.match(res.body.error, /In Progress/i);
      });

      const db = getDatabase();
      const inc = db.get('SELECT * FROM incidents WHERE id = ?', [incident.id]);
      assert.strictEqual(inc.status, 'In Progress');
      assert.strictEqual(inc.hero_id, assignedHero.user.id);
    });

    it('should reject concurrent claims on Resolved incident with 409 Conflict', async () => {
      const citizen = await createCitizen('cit_res_race', 'cit_res_race@ny.gov');
      const incident = await reportIncident(citizen.token);

      const assignedHero = await createHero('assigned_hero_res', 'assigned_res@ny.gov');
      await request(app)
        .post(`/api/incidents/${incident.id}/claim`)
        .set('Authorization', `Bearer ${assignedHero.token}`)
        .expect(200);

      await request(app)
        .patch(`/api/incidents/${incident.id}/status`)
        .set('Authorization', `Bearer ${assignedHero.token}`)
        .send({ status: 'In Progress' })
        .expect(200);

      await request(app)
        .patch(`/api/incidents/${incident.id}/status`)
        .set('Authorization', `Bearer ${assignedHero.token}`)
        .send({ status: 'Resolved' })
        .expect(200);

      const rivals = await Promise.all([
        createHero('res_rival_1', 'res_rival_1@ny.gov'),
        createHero('res_rival_2', 'res_rival_2@ny.gov'),
        createHero('res_rival_3', 'res_rival_3@ny.gov'),
        createHero('res_rival_4', 'res_rival_4@ny.gov'),
        createHero('res_rival_5', 'res_rival_5@ny.gov')
      ]);

      const responses = await Promise.all(
        rivals.map((r) =>
          request(app)
            .post(`/api/incidents/${incident.id}/claim`)
            .set('Authorization', `Bearer ${r.token}`)
        )
      );

      responses.forEach((res) => {
        assert.strictEqual(res.status, 409);
        assert.match(res.body.error, /Resolved/i);
      });

      const db = getDatabase();
      const inc = db.get('SELECT * FROM incidents WHERE id = ?', [incident.id]);
      assert.strictEqual(inc.status, 'Resolved');
      assert.strictEqual(inc.hero_id, assignedHero.user.id);
    });
  });

  // =========================================================================
  // Challenge 8: Concurrent Claims on Non-Existent Incident ID
  // =========================================================================
  describe('Challenge 8: Concurrent Claims on Non-Existent Incident ID', () => {
    it('should return 404 Not Found for all 5 concurrent claim requests on invalid ID', async () => {
      const heroes = await Promise.all([
        createHero('ne_hero_1', 'ne_hero_1@ny.gov'),
        createHero('ne_hero_2', 'ne_hero_2@ny.gov'),
        createHero('ne_hero_3', 'ne_hero_3@ny.gov'),
        createHero('ne_hero_4', 'ne_hero_4@ny.gov'),
        createHero('ne_hero_5', 'ne_hero_5@ny.gov')
      ]);

      const nonExistentId = 9999999;
      const responses = await Promise.all(
        heroes.map((h) =>
          request(app)
            .post(`/api/incidents/${nonExistentId}/claim`)
            .set('Authorization', `Bearer ${h.token}`)
        )
      );

      responses.forEach((res) => {
        assert.strictEqual(res.status, 404, `Expected 404, got ${res.status}`);
        assert.match(res.body.error, /not found/i);
      });
    });
  });

  // =========================================================================
  // Challenge 9: Race Between Authorized Transition and Rogue Actions
  // =========================================================================
  describe('Challenge 9: Concurrent Contention Between Legitimate Transition and Rogue Re-Claims/Updates', () => {
    it('should permit only authorized assigned hero transition while rejecting rival re-claims and updates', async () => {
      const citizen = await createCitizen('cit_race_auth', 'cit_race_auth@ny.gov');
      const incident = await reportIncident(citizen.token);

      const assignedHero = await createHero('hero_owner', 'hero_owner@ny.gov');
      await request(app)
        .post(`/api/incidents/${incident.id}/claim`)
        .set('Authorization', `Bearer ${assignedHero.token}`)
        .expect(200);

      const rogueHeroes = await Promise.all([
        createHero('rogue_h_1', 'rogue_h_1@ny.gov'),
        createHero('rogue_h_2', 'rogue_h_2@ny.gov')
      ]);

      // Fire concurrent requests:
      // 1. Assigned hero transitions to 'In Progress'
      // 2. Rogue 1 attempts re-claim
      // 3. Rogue 2 attempts unauthorized status update to 'In Progress'
      const [resOwner, resRogueClaim, resRogueUpdate] = await Promise.all([
        request(app)
          .patch(`/api/incidents/${incident.id}/status`)
          .set('Authorization', `Bearer ${assignedHero.token}`)
          .send({ status: 'In Progress', notes: 'Legitimate start' }),
        request(app)
          .post(`/api/incidents/${incident.id}/claim`)
          .set('Authorization', `Bearer ${rogueHeroes[0].token}`),
        request(app)
          .patch(`/api/incidents/${incident.id}/status`)
          .set('Authorization', `Bearer ${rogueHeroes[1].token}`)
          .send({ status: 'In Progress' })
      ]);

      assert.strictEqual(resOwner.status, 200, 'Assigned hero transition must succeed (200)');
      assert.strictEqual(resOwner.body.status, 'In Progress');

      assert.strictEqual(resRogueClaim.status, 409, 'Rogue claim must be rejected (409 Conflict)');
      assert.strictEqual(resRogueUpdate.status, 403, 'Rogue status update must be forbidden (403)');

      const db = getDatabase();
      const inc = db.get('SELECT * FROM incidents WHERE id = ?', [incident.id]);
      assert.strictEqual(inc.status, 'In Progress');
      assert.strictEqual(inc.hero_id, assignedHero.user.id);
    });
  });
});
