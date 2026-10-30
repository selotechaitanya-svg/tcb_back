'use strict';

const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert');
const request = require('supertest');
const app = require('../src/app');
const { setupTestDb, resetTestDb, teardownTestDb } = require('./helpers/testDb');

describe('Incident Lifecycle & State Transitions', () => {
  before(() => {
    setupTestDb();
  });

  after(() => {
    teardownTestDb();
  });

  beforeEach(() => {
    resetTestDb();
  });

  it('should enforce the strict status flow: Reported -> Claimed -> In Progress -> Resolved', async () => {
    // 1. Citizen creates incident (Reported)
    const cit = await request(app)
      .post('/api/auth/register')
      .send({ username: 'flow_citizen', email: 'flow_cit@ny.gov', password: 'Password123!', role: 'Citizen' });

    const inc = await request(app)
      .post('/api/incidents')
      .set('Authorization', `Bearer ${cit.body.token}`)
      .send({
        title: 'Bank Vault Siren',
        description: 'Silent alarm tripped at Wall St bank',
        category: 'Robbery',
        severity: 5,
        location: 'Wall Street'
      });
    assert.strictEqual(inc.body.status, 'Reported');
    const incidentId = inc.body.id;

    // 2. Hero claims incident (Reported -> Claimed)
    const hero = await request(app)
      .post('/api/auth/register')
      .send({ username: 'flow_hero', email: 'flow_hero@avengers.org', password: 'Password123!', role: 'Hero' });

    const claimRes = await request(app)
      .post(`/api/incidents/${incidentId}/claim`)
      .set('Authorization', `Bearer ${hero.body.token}`);
    assert.strictEqual(claimRes.status, 200);
    assert.strictEqual(claimRes.body.status, 'Claimed');
    assert.strictEqual(claimRes.body.hero_id, hero.body.user.id);

    // 3. Hero transitions to In Progress (Claimed -> In Progress)
    const progressRes = await request(app)
      .patch(`/api/incidents/${incidentId}/status`)
      .set('Authorization', `Bearer ${hero.body.token}`)
      .send({ status: 'In Progress', notes: 'Arrived at scene, engaging perimeter' });
    assert.strictEqual(progressRes.status, 200);
    assert.strictEqual(progressRes.body.status, 'In Progress');

    // 4. Hero transitions to Resolved (In Progress -> Resolved)
    const resolveRes = await request(app)
      .patch(`/api/incidents/${incidentId}/status`)
      .set('Authorization', `Bearer ${hero.body.token}`)
      .send({ status: 'Resolved', notes: 'Robbers restrained, hostages freed' });
    assert.strictEqual(resolveRes.status, 200);
    assert.strictEqual(resolveRes.body.status, 'Resolved');

    // 5. Inspect status history audit log
    const histRes = await request(app)
      .get(`/api/incidents/${incidentId}/history`)
      .set('Authorization', `Bearer ${hero.body.token}`);
    assert.strictEqual(histRes.status, 200);

    const history = Array.isArray(histRes.body) ? histRes.body : histRes.body.history;
    assert.strictEqual(history.length, 4);

    assert.strictEqual(history[0].previous_status, null);
    assert.strictEqual(history[0].new_status, 'Reported');
    assert.strictEqual(history[0].changed_by_user_id, cit.body.user.id);

    assert.strictEqual(history[1].previous_status, 'Reported');
    assert.strictEqual(history[1].new_status, 'Claimed');
    assert.strictEqual(history[1].changed_by_user_id, hero.body.user.id);

    assert.strictEqual(history[2].previous_status, 'Claimed');
    assert.strictEqual(history[2].new_status, 'In Progress');
    assert.strictEqual(history[2].notes, 'Arrived at scene, engaging perimeter');

    assert.strictEqual(history[3].previous_status, 'In Progress');
    assert.strictEqual(history[3].new_status, 'Resolved');
    assert.strictEqual(history[3].notes, 'Robbers restrained, hostages freed');
  });

  it('should reject invalid status jumps with 400 Bad Request', async () => {
    const cit = await request(app)
      .post('/api/auth/register')
      .send({ username: 'jump_citizen', email: 'jump_cit@ny.gov', password: 'Password123!', role: 'Citizen' });

    const inc = await request(app)
      .post('/api/incidents')
      .set('Authorization', `Bearer ${cit.body.token}`)
      .send({ title: 'Warehouse Fire', description: 'Flames seen', category: 'Fire', severity: 4, location: 'Docks' });

    const hero = await request(app)
      .post('/api/auth/register')
      .send({ username: 'jump_hero', email: 'jump_hero@avengers.org', password: 'Password123!', role: 'Hero' });

    // Attempt Reported directly to Resolved (skipping Claimed and In Progress) -> 400
    const invalidJump1 = await request(app)
      .patch(`/api/incidents/${inc.body.id}/status`)
      .set('Authorization', `Bearer ${hero.body.token}`)
      .send({ status: 'Resolved' });
    assert.ok(invalidJump1.status === 400 || invalidJump1.status === 403);

    // Claim the incident
    await request(app)
      .post(`/api/incidents/${inc.body.id}/claim`)
      .set('Authorization', `Bearer ${hero.body.token}`);

    // Attempt Claimed directly to Resolved (skipping In Progress) -> 400
    const invalidJump2 = await request(app)
      .patch(`/api/incidents/${inc.body.id}/status`)
      .set('Authorization', `Bearer ${hero.body.token}`)
      .send({ status: 'Resolved' });
    assert.strictEqual(invalidJump2.status, 400);

    // Advance to In Progress
    await request(app)
      .patch(`/api/incidents/${inc.body.id}/status`)
      .set('Authorization', `Bearer ${hero.body.token}`)
      .send({ status: 'In Progress' });

    // Attempt backward jump In Progress to Reported -> 400
    const backwardJump = await request(app)
      .patch(`/api/incidents/${inc.body.id}/status`)
      .set('Authorization', `Bearer ${hero.body.token}`)
      .send({ status: 'Reported' });
    assert.strictEqual(backwardJump.status, 400);

    // Resolve incident
    await request(app)
      .patch(`/api/incidents/${inc.body.id}/status`)
      .set('Authorization', `Bearer ${hero.body.token}`)
      .send({ status: 'Resolved' });

    // Attempt to mutate a Resolved incident -> 400
    const terminalMutation = await request(app)
      .patch(`/api/incidents/${inc.body.id}/status`)
      .set('Authorization', `Bearer ${hero.body.token}`)
      .send({ status: 'In Progress' });
    assert.strictEqual(terminalMutation.status, 400);
  });

  it('should prevent an unassigned hero from updating or resolving another hero incident (403 Forbidden)', async () => {
    const cit = await request(app)
      .post('/api/auth/register')
      .send({ username: 'owner_cit', email: 'owner_cit@ny.gov', password: 'Password123!', role: 'Citizen' });

    const inc = await request(app)
      .post('/api/incidents')
      .set('Authorization', `Bearer ${cit.body.token}`)
      .send({ title: 'Jewelry Heist', description: 'Store broken into', category: 'Theft', severity: 3, location: '5th Ave' });

    const heroA = await request(app)
      .post('/api/auth/register')
      .send({ username: 'hero_assigned', email: 'hero_a@heroes.org', password: 'Password123!', role: 'Hero' });

    const heroB = await request(app)
      .post('/api/auth/register')
      .send({ username: 'hero_unassigned', email: 'hero_b@heroes.org', password: 'Password123!', role: 'Hero' });

    // Hero A claims incident
    await request(app)
      .post(`/api/incidents/${inc.body.id}/claim`)
      .set('Authorization', `Bearer ${heroA.body.token}`);

    // Hero B attempts to update status to In Progress -> 403 Forbidden
    const trespassRes = await request(app)
      .patch(`/api/incidents/${inc.body.id}/status`)
      .set('Authorization', `Bearer ${heroB.body.token}`)
      .send({ status: 'In Progress' });
    assert.strictEqual(trespassRes.status, 403);
  });
});
