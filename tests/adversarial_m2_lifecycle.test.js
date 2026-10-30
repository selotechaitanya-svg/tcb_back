'use strict';

const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert');
const request = require('supertest');
const app = require('../src/app');
const { setupTestDb, resetTestDb, teardownTestDb, getDatabase } = require('./helpers/testDb');

describe('Adversarial Verification Suite: Milestone 2 Lifecycle, State Machine & Ownership Guards', () => {
  before(() => {
    setupTestDb();
  });

  after(() => {
    teardownTestDb();
  });

  beforeEach(() => {
    resetTestDb();
  });

  // Helper to register users
  async function registerUser(username, role, email = null) {
    const res = await request(app)
      .post('/api/auth/register')
      .send({
        username,
        email: email || `${username.toLowerCase()}@test.ny.gov`,
        password: 'Password123!',
        role
      });
    assert.strictEqual(res.status, 201, `Failed to register ${username}: ${JSON.stringify(res.body)}`);
    return { token: res.body.token, user: res.body.user };
  }

  // Helper to create an incident as Citizen
  async function createIncident(citizenToken, customProps = {}) {
    const res = await request(app)
      .post('/api/incidents')
      .set('Authorization', `Bearer ${citizenToken}`)
      .send({
        title: 'Emergency Siren Alarm',
        description: 'Bank vault intrusion alert',
        category: 'Robbery',
        severity: 4,
        location: 'Wall Street 42',
        ...customProps
      });
    assert.strictEqual(res.status, 201, `Failed to create incident: ${JSON.stringify(res.body)}`);
    return res.body;
  }

  // =========================================================================
  // Challenge 1: State Machine Transitions, Illegal Jumps & Boundary Edge Cases
  // =========================================================================
  describe('Challenge 1: State Machine Edges & Illegal Transitions', () => {
    it('1.1 should reject direct status transition on Reported incident without claiming (Reported -> In Progress) with 400 Bad Request', async () => {
      const citizen = await registerUser('cit_jump_1', 'Citizen');
      const hero = await registerUser('hero_jump_1', 'Hero');
      const inc = await createIncident(citizen.token);

      const res = await request(app)
        .patch(`/api/incidents/${inc.id}/status`)
        .set('Authorization', `Bearer ${hero.token}`)
        .send({ status: 'In Progress' });

      assert.strictEqual(res.status, 400);
      assert.ok(res.body.error);
    });

    it('1.2 should reject direct status transition on Reported incident to Resolved (Reported -> Resolved) with 400 Bad Request', async () => {
      const citizen = await registerUser('cit_jump_2', 'Citizen');
      const hero = await registerUser('hero_jump_2', 'Hero');
      const inc = await createIncident(citizen.token);

      const res = await request(app)
        .patch(`/api/incidents/${inc.id}/status`)
        .set('Authorization', `Bearer ${hero.token}`)
        .send({ status: 'Resolved' });

      assert.strictEqual(res.status, 400);
      assert.ok(res.body.error);
    });

    it('1.3 should reject setting status back to Reported on a Reported incident via PATCH with 400 Bad Request', async () => {
      const citizen = await registerUser('cit_jump_3', 'Citizen');
      const hero = await registerUser('hero_jump_3', 'Hero');
      const inc = await createIncident(citizen.token);

      const res = await request(app)
        .patch(`/api/incidents/${inc.id}/status`)
        .set('Authorization', `Bearer ${hero.token}`)
        .send({ status: 'Reported' });

      assert.strictEqual(res.status, 400);
    });

    it('1.4 should reject skipping In Progress (Claimed -> Resolved) with 400 Bad Request', async () => {
      const citizen = await registerUser('cit_skip_1', 'Citizen');
      const hero = await registerUser('hero_skip_1', 'Hero');
      const inc = await createIncident(citizen.token);

      // Hero claims the incident (Reported -> Claimed)
      const claimRes = await request(app)
        .post(`/api/incidents/${inc.id}/claim`)
        .set('Authorization', `Bearer ${hero.token}`);
      assert.strictEqual(claimRes.status, 200);

      // Attempt Claimed -> Resolved directly
      const skipRes = await request(app)
        .patch(`/api/incidents/${inc.id}/status`)
        .set('Authorization', `Bearer ${hero.token}`)
        .send({ status: 'Resolved' });

      assert.strictEqual(skipRes.status, 400);
      assert.match(skipRes.body.error, /Invalid status transition/i);
    });

    it('1.5 should reject idempotent self-transition on Claimed (Claimed -> Claimed) with 400 Bad Request', async () => {
      const citizen = await registerUser('cit_self_1', 'Citizen');
      const hero = await registerUser('hero_self_1', 'Hero');
      const inc = await createIncident(citizen.token);

      await request(app)
        .post(`/api/incidents/${inc.id}/claim`)
        .set('Authorization', `Bearer ${hero.token}`);

      const selfRes = await request(app)
        .patch(`/api/incidents/${inc.id}/status`)
        .set('Authorization', `Bearer ${hero.token}`)
        .send({ status: 'Claimed' });

      assert.strictEqual(selfRes.status, 400);
      assert.match(selfRes.body.error, /Invalid status transition/i);
    });

    it('1.6 should reject backward transition from Claimed to Reported with 400 Bad Request', async () => {
      const citizen = await registerUser('cit_back_1', 'Citizen');
      const hero = await registerUser('hero_back_1', 'Hero');
      const inc = await createIncident(citizen.token);

      await request(app)
        .post(`/api/incidents/${inc.id}/claim`)
        .set('Authorization', `Bearer ${hero.token}`);

      const backRes = await request(app)
        .patch(`/api/incidents/${inc.id}/status`)
        .set('Authorization', `Bearer ${hero.token}`)
        .send({ status: 'Reported' });

      assert.strictEqual(backRes.status, 400);
    });

    it('1.7 should reject backward transition from In Progress to Claimed with 400 Bad Request', async () => {
      const citizen = await registerUser('cit_back_2', 'Citizen');
      const hero = await registerUser('hero_back_2', 'Hero');
      const inc = await createIncident(citizen.token);

      await request(app)
        .post(`/api/incidents/${inc.id}/claim`)
        .set('Authorization', `Bearer ${hero.token}`);

      await request(app)
        .patch(`/api/incidents/${inc.id}/status`)
        .set('Authorization', `Bearer ${hero.token}`)
        .send({ status: 'In Progress' });

      const backRes = await request(app)
        .patch(`/api/incidents/${inc.id}/status`)
        .set('Authorization', `Bearer ${hero.token}`)
        .send({ status: 'Claimed' });

      assert.strictEqual(backRes.status, 400);
      assert.match(backRes.body.error, /Invalid status transition/i);
    });

    it('1.8 should reject backward transition from In Progress to Reported with 400 Bad Request', async () => {
      const citizen = await registerUser('cit_back_3', 'Citizen');
      const hero = await registerUser('hero_back_3', 'Hero');
      const inc = await createIncident(citizen.token);

      await request(app)
        .post(`/api/incidents/${inc.id}/claim`)
        .set('Authorization', `Bearer ${hero.token}`);

      await request(app)
        .patch(`/api/incidents/${inc.id}/status`)
        .set('Authorization', `Bearer ${hero.token}`)
        .send({ status: 'In Progress' });

      const backRes = await request(app)
        .patch(`/api/incidents/${inc.id}/status`)
        .set('Authorization', `Bearer ${hero.token}`)
        .send({ status: 'Reported' });

      assert.strictEqual(backRes.status, 400);
    });

    it('1.9 should reject idempotent self-transition on In Progress (In Progress -> In Progress) with 400 Bad Request', async () => {
      const citizen = await registerUser('cit_self_2', 'Citizen');
      const hero = await registerUser('hero_self_2', 'Hero');
      const inc = await createIncident(citizen.token);

      await request(app)
        .post(`/api/incidents/${inc.id}/claim`)
        .set('Authorization', `Bearer ${hero.token}`);

      await request(app)
        .patch(`/api/incidents/${inc.id}/status`)
        .set('Authorization', `Bearer ${hero.token}`)
        .send({ status: 'In Progress' });

      const selfRes = await request(app)
        .patch(`/api/incidents/${inc.id}/status`)
        .set('Authorization', `Bearer ${hero.token}`)
        .send({ status: 'In Progress' });

      assert.strictEqual(selfRes.status, 400);
      assert.match(selfRes.body.error, /Invalid status transition/i);
    });

    it('1.10 should reject all mutation attempts on terminal state Resolved (Resolved -> In Progress, Claimed, Reported, Resolved)', async () => {
      const citizen = await registerUser('cit_term_1', 'Citizen');
      const hero = await registerUser('hero_term_1', 'Hero');
      const inc = await createIncident(citizen.token);

      // Advance full lifecycle to Resolved
      await request(app)
        .post(`/api/incidents/${inc.id}/claim`)
        .set('Authorization', `Bearer ${hero.token}`);
      await request(app)
        .patch(`/api/incidents/${inc.id}/status`)
        .set('Authorization', `Bearer ${hero.token}`)
        .send({ status: 'In Progress' });
      const resolveRes = await request(app)
        .patch(`/api/incidents/${inc.id}/status`)
        .set('Authorization', `Bearer ${hero.token}`)
        .send({ status: 'Resolved' });
      assert.strictEqual(resolveRes.status, 200);

      // Attempt 1: Resolved -> In Progress
      const mutate1 = await request(app)
        .patch(`/api/incidents/${inc.id}/status`)
        .set('Authorization', `Bearer ${hero.token}`)
        .send({ status: 'In Progress' });
      assert.strictEqual(mutate1.status, 400);

      // Attempt 2: Resolved -> Claimed
      const mutate2 = await request(app)
        .patch(`/api/incidents/${inc.id}/status`)
        .set('Authorization', `Bearer ${hero.token}`)
        .send({ status: 'Claimed' });
      assert.strictEqual(mutate2.status, 400);

      // Attempt 3: Resolved -> Reported
      const mutate3 = await request(app)
        .patch(`/api/incidents/${inc.id}/status`)
        .set('Authorization', `Bearer ${hero.token}`)
        .send({ status: 'Reported' });
      assert.strictEqual(mutate3.status, 400);

      // Attempt 4: Resolved -> Resolved
      const mutate4 = await request(app)
        .patch(`/api/incidents/${inc.id}/status`)
        .set('Authorization', `Bearer ${hero.token}`)
        .send({ status: 'Resolved' });
      assert.strictEqual(mutate4.status, 400);
    });

    it('1.11 should reject invalid, corrupted, or arbitrary status strings with 400 Bad Request', async () => {
      const citizen = await registerUser('cit_str_1', 'Citizen');
      const hero = await registerUser('hero_str_1', 'Hero');
      const inc = await createIncident(citizen.token);

      await request(app)
        .post(`/api/incidents/${inc.id}/claim`)
        .set('Authorization', `Bearer ${hero.token}`);

      const invalidStatuses = [
        'Pending',
        'Closed',
        'Cancelled',
        'Completed',
        'Open',
        'Assigned',
        'in progress',
        'in_progress',
        'IN PROGRESS',
        'resolved',
        'RESOLVED',
        'claimed',
        'CLAIMED',
        'DROP TABLE incidents;',
        '<script>alert(1)</script>'
      ];

      for (const badStatus of invalidStatuses) {
        const res = await request(app)
          .patch(`/api/incidents/${inc.id}/status`)
          .set('Authorization', `Bearer ${hero.token}`)
          .send({ status: badStatus });
        assert.strictEqual(res.status, 400, `Expected 400 for status '${badStatus}', got ${res.status}`);
      }
    });

    it('1.12 should reject non-string, empty, or missing status payloads with 400 Bad Request', async () => {
      const citizen = await registerUser('cit_str_2', 'Citizen');
      const hero = await registerUser('hero_str_2', 'Hero');
      const inc = await createIncident(citizen.token);

      await request(app)
        .post(`/api/incidents/${inc.id}/claim`)
        .set('Authorization', `Bearer ${hero.token}`);

      const badPayloads = [
        {},
        { status: '' },
        { status: '    ' },
        { status: null },
        { status: 123 },
        { status: true },
        { status: false },
        { status: [] },
        { status: {} }
      ];

      for (const payload of badPayloads) {
        const res = await request(app)
          .patch(`/api/incidents/${inc.id}/status`)
          .set('Authorization', `Bearer ${hero.token}`)
          .send(payload);
        assert.strictEqual(res.status, 400, `Expected 400 for payload ${JSON.stringify(payload)}, got ${res.status}`);
      }
    });
  });

  // =========================================================================
  // Challenge 2: Ownership Enforcement, Hero Impersonation & Role Boundaries
  // =========================================================================
  describe('Challenge 2: Ownership Enforcement & Role Guards', () => {
    it('2.1 should prevent Hero B from updating status of an incident claimed by Hero A (403 Forbidden)', async () => {
      const citizen = await registerUser('cit_own_1', 'Citizen');
      const heroA = await registerUser('hero_assigned_a', 'Hero');
      const heroB = await registerUser('hero_intruder_b', 'Hero');
      const inc = await createIncident(citizen.token);

      // Hero A claims incident
      const claimRes = await request(app)
        .post(`/api/incidents/${inc.id}/claim`)
        .set('Authorization', `Bearer ${heroA.token}`);
      assert.strictEqual(claimRes.status, 200);

      // Hero B attempts to advance status to In Progress
      const hijackRes1 = await request(app)
        .patch(`/api/incidents/${inc.id}/status`)
        .set('Authorization', `Bearer ${heroB.token}`)
        .send({ status: 'In Progress' });

      assert.strictEqual(hijackRes1.status, 403);
      assert.match(hijackRes1.body.error, /only the assigned hero/i);

      // Hero A advances to In Progress
      await request(app)
        .patch(`/api/incidents/${inc.id}/status`)
        .set('Authorization', `Bearer ${heroA.token}`)
        .send({ status: 'In Progress' });

      // Hero B attempts to resolve Hero A's incident
      const hijackRes2 = await request(app)
        .patch(`/api/incidents/${inc.id}/status`)
        .set('Authorization', `Bearer ${heroB.token}`)
        .send({ status: 'Resolved' });

      assert.strictEqual(hijackRes2.status, 403);
      assert.match(hijackRes2.body.error, /only the assigned hero/i);
    });

    it('2.2 should prevent Citizen from claiming an incident (403 Forbidden)', async () => {
      const citizen = await registerUser('cit_claim_fail', 'Citizen');
      const inc = await createIncident(citizen.token);

      const res = await request(app)
        .post(`/api/incidents/${inc.id}/claim`)
        .set('Authorization', `Bearer ${citizen.token}`);

      assert.strictEqual(res.status, 403);
      assert.match(res.body.error, /forbidden|denied/i);
    });

    it('2.3 should prevent Citizen from updating incident status (403 Forbidden)', async () => {
      const citizen = await registerUser('cit_patch_fail', 'Citizen');
      const hero = await registerUser('hero_patch_owner', 'Hero');
      const inc = await createIncident(citizen.token);

      await request(app)
        .post(`/api/incidents/${inc.id}/claim`)
        .set('Authorization', `Bearer ${hero.token}`);

      const res = await request(app)
        .patch(`/api/incidents/${inc.id}/status`)
        .set('Authorization', `Bearer ${citizen.token}`)
        .send({ status: 'In Progress' });

      assert.strictEqual(res.status, 403);
      assert.match(res.body.error, /forbidden|denied/i);
    });

    it('2.4 should reject claim attempt by any hero on already Claimed incident with 409 Conflict', async () => {
      const citizen = await registerUser('cit_con_1', 'Citizen');
      const heroA = await registerUser('hero_first_claim', 'Hero');
      const heroB = await registerUser('hero_second_claim', 'Hero');
      const inc = await createIncident(citizen.token);

      // First claim succeeds
      const firstClaim = await request(app)
        .post(`/api/incidents/${inc.id}/claim`)
        .set('Authorization', `Bearer ${heroA.token}`);
      assert.strictEqual(firstClaim.status, 200);

      // Hero B attempts to claim -> 409 Conflict
      const rivalClaim = await request(app)
        .post(`/api/incidents/${inc.id}/claim`)
        .set('Authorization', `Bearer ${heroB.token}`);
      assert.strictEqual(rivalClaim.status, 409);
      assert.match(rivalClaim.body.error, /cannot be claimed/i);

      // Hero A attempts to re-claim their own incident -> 409 Conflict
      const selfReclaim = await request(app)
        .post(`/api/incidents/${inc.id}/claim`)
        .set('Authorization', `Bearer ${heroA.token}`);
      assert.strictEqual(selfReclaim.status, 409);
    });

    it('2.5 should reject claim on In Progress or Resolved incidents with 409 Conflict', async () => {
      const citizen = await registerUser('cit_con_2', 'Citizen');
      const heroA = await registerUser('hero_flow_owner', 'Hero');
      const heroB = await registerUser('hero_late_claim', 'Hero');
      const inc = await createIncident(citizen.token);

      await request(app)
        .post(`/api/incidents/${inc.id}/claim`)
        .set('Authorization', `Bearer ${heroA.token}`);

      await request(app)
        .patch(`/api/incidents/${inc.id}/status`)
        .set('Authorization', `Bearer ${heroA.token}`)
        .send({ status: 'In Progress' });

      // Claim while In Progress -> 409
      const claimInProgress = await request(app)
        .post(`/api/incidents/${inc.id}/claim`)
        .set('Authorization', `Bearer ${heroB.token}`);
      assert.strictEqual(claimInProgress.status, 409);

      await request(app)
        .patch(`/api/incidents/${inc.id}/status`)
        .set('Authorization', `Bearer ${heroA.token}`)
        .send({ status: 'Resolved' });

      // Claim while Resolved -> 409
      const claimResolved = await request(app)
        .post(`/api/incidents/${inc.id}/claim`)
        .set('Authorization', `Bearer ${heroB.token}`);
      assert.strictEqual(claimResolved.status, 409);
    });

    it('2.6 should return 401 Unauthorized for unauthenticated requests to claim and status', async () => {
      const citizen = await registerUser('cit_unauth', 'Citizen');
      const inc = await createIncident(citizen.token);

      const claimUnauth = await request(app)
        .post(`/api/incidents/${inc.id}/claim`);
      assert.strictEqual(claimUnauth.status, 401);

      const statusUnauth = await request(app)
        .patch(`/api/incidents/${inc.id}/status`)
        .send({ status: 'In Progress' });
      assert.strictEqual(statusUnauth.status, 401);
    });

    it('2.7 should return 404 Not Found when claiming or updating a non-existent incident ID', async () => {
      const hero = await registerUser('hero_404_test', 'Hero');

      const claim404 = await request(app)
        .post('/api/incidents/99999/claim')
        .set('Authorization', `Bearer ${hero.token}`);
      assert.strictEqual(claim404.status, 404);

      const status404 = await request(app)
        .patch('/api/incidents/99999/status')
        .set('Authorization', `Bearer ${hero.token}`)
        .send({ status: 'In Progress' });
      assert.strictEqual(status404.status, 404);
    });

    it('2.8 should return 400 Bad Request for invalid incident ID formats', async () => {
      const hero = await registerUser('hero_bad_id', 'Hero');

      const badIds = ['abc', '-1', '0', '3.14', 'null'];
      for (const id of badIds) {
        const claimRes = await request(app)
          .post(`/api/incidents/${id}/claim`)
          .set('Authorization', `Bearer ${hero.token}`);
        assert.strictEqual(claimRes.status, 400, `Expected 400 for claim id '${id}', got ${claimRes.status}`);

        const statusRes = await request(app)
          .patch(`/api/incidents/${id}/status`)
          .set('Authorization', `Bearer ${hero.token}`)
          .send({ status: 'In Progress' });
        assert.strictEqual(statusRes.status, 400, `Expected 400 for status id '${id}', got ${statusRes.status}`);
      }
    });
  });

  // =========================================================================
  // Challenge 3: Audit Trail Integrity, Transaction Atomicity & State Preservation
  // =========================================================================
  describe('Challenge 3: Audit Trail Integrity & State Invariance Under Attack', () => {
    it('3.1 should NOT pollute status_history when illegal transitions or unauthorized updates fail', async () => {
      const citizen = await registerUser('cit_audit_clean', 'Citizen');
      const heroA = await registerUser('hero_audit_a', 'Hero');
      const heroB = await registerUser('hero_audit_b', 'Hero');
      const inc = await createIncident(citizen.token);

      const db = getDatabase();

      // At creation: exactly 1 status_history entry (null -> Reported)
      let historyRows = db.query('SELECT * FROM status_history WHERE incident_id = ?', [inc.id]);
      assert.strictEqual(historyRows.length, 1);
      assert.strictEqual(historyRows[0].previous_status, null);
      assert.strictEqual(historyRows[0].new_status, 'Reported');

      // Attempt illegal jump on Reported -> In Progress (400)
      await request(app)
        .patch(`/api/incidents/${inc.id}/status`)
        .set('Authorization', `Bearer ${heroA.token}`)
        .send({ status: 'In Progress' });

      // Verify zero extra rows added
      historyRows = db.query('SELECT * FROM status_history WHERE incident_id = ?', [inc.id]);
      assert.strictEqual(historyRows.length, 1);

      // Hero A claims incident (valid: 1 row added -> total 2)
      await request(app)
        .post(`/api/incidents/${inc.id}/claim`)
        .set('Authorization', `Bearer ${heroA.token}`);

      historyRows = db.query('SELECT * FROM status_history WHERE incident_id = ?', [inc.id]);
      assert.strictEqual(historyRows.length, 2);

      // Hero B attempts unauthorized jump (403)
      await request(app)
        .patch(`/api/incidents/${inc.id}/status`)
        .set('Authorization', `Bearer ${heroB.token}`)
        .send({ status: 'In Progress' });

      // Verify zero extra rows added
      historyRows = db.query('SELECT * FROM status_history WHERE incident_id = ?', [inc.id]);
      assert.strictEqual(historyRows.length, 2);

      // Hero A attempts illegal skip to Resolved (400)
      await request(app)
        .patch(`/api/incidents/${inc.id}/status`)
        .set('Authorization', `Bearer ${heroA.token}`)
        .send({ status: 'Resolved' });

      // Verify zero extra rows added
      historyRows = db.query('SELECT * FROM status_history WHERE incident_id = ?', [inc.id]);
      assert.strictEqual(historyRows.length, 2);

      // Incident status in DB must still be 'Claimed' and hero_id must be heroA
      const incRecord = db.get('SELECT * FROM incidents WHERE id = ?', [inc.id]);
      assert.strictEqual(incRecord.status, 'Claimed');
      assert.strictEqual(incRecord.hero_id, heroA.user.id);
    });

    it('3.2 should maintain chronological ordering and exact actor IDs across complete lifecycle', async () => {
      const citizen = await registerUser('cit_lifecycle_audit', 'Citizen');
      const hero = await registerUser('hero_lifecycle_audit', 'Hero');
      const inc = await createIncident(citizen.token);

      // Reported -> Claimed
      await request(app)
        .post(`/api/incidents/${inc.id}/claim`)
        .set('Authorization', `Bearer ${hero.token}`);

      // Claimed -> In Progress
      await request(app)
        .patch(`/api/incidents/${inc.id}/status`)
        .set('Authorization', `Bearer ${hero.token}`)
        .send({ status: 'In Progress', notes: 'Arrived on scene, deploying web-shooters' });

      // In Progress -> Resolved
      await request(app)
        .patch(`/api/incidents/${inc.id}/status`)
        .set('Authorization', `Bearer ${hero.token}`)
        .send({ status: 'Resolved', notes: 'Hostages safe, villain webbed to lamp post' });

      // Fetch history via API
      const histRes = await request(app)
        .get(`/api/incidents/${inc.id}/history`)
        .set('Authorization', `Bearer ${hero.token}`);

      assert.strictEqual(histRes.status, 200);
      const history = histRes.body;
      assert.strictEqual(history.length, 4);

      // Row 0
      assert.strictEqual(history[0].previous_status, null);
      assert.strictEqual(history[0].new_status, 'Reported');
      assert.strictEqual(history[0].changed_by_user_id, citizen.user.id);

      // Row 1
      assert.strictEqual(history[1].previous_status, 'Reported');
      assert.strictEqual(history[1].new_status, 'Claimed');
      assert.strictEqual(history[1].changed_by_user_id, hero.user.id);

      // Row 2
      assert.strictEqual(history[2].previous_status, 'Claimed');
      assert.strictEqual(history[2].new_status, 'In Progress');
      assert.strictEqual(history[2].changed_by_user_id, hero.user.id);
      assert.strictEqual(history[2].notes, 'Arrived on scene, deploying web-shooters');

      // Row 3
      assert.strictEqual(history[3].previous_status, 'In Progress');
      assert.strictEqual(history[3].new_status, 'Resolved');
      assert.strictEqual(history[3].changed_by_user_id, hero.user.id);
      assert.strictEqual(history[3].notes, 'Hostages safe, villain webbed to lamp post');
    });

    it('3.3 should handle custom notes with SQL injection syntax, special characters, and null gracefully', async () => {
      const citizen = await registerUser('cit_notes_edge', 'Citizen');
      const hero = await registerUser('hero_notes_edge', 'Hero');
      const inc = await createIncident(citizen.token);

      await request(app)
        .post(`/api/incidents/${inc.id}/claim`)
        .set('Authorization', `Bearer ${hero.token}`);

      // Notes with SQL injection payload and quotes
      const maliciousNotes = "'; DROP TABLE status_history; -- <script>alert('xss')</script> 😊 蜘蛛俠";
      const step1 = await request(app)
        .patch(`/api/incidents/${inc.id}/status`)
        .set('Authorization', `Bearer ${hero.token}`)
        .send({ status: 'In Progress', notes: maliciousNotes });
      assert.strictEqual(step1.status, 200);

      // Notes with null
      const step2 = await request(app)
        .patch(`/api/incidents/${inc.id}/status`)
        .set('Authorization', `Bearer ${hero.token}`)
        .send({ status: 'Resolved', notes: null });
      assert.strictEqual(step2.status, 200);

      const db = getDatabase();
      const rows = db.query('SELECT notes FROM status_history WHERE incident_id = ? ORDER BY id ASC', [inc.id]);
      assert.strictEqual(rows[2].notes, maliciousNotes);
      assert.strictEqual(rows[3].notes, null);
    });
  });
});
