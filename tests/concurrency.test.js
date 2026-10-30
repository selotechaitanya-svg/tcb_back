'use strict';

const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert');
const request = require('supertest');
const app = require('../src/app');
const { setupTestDb, resetTestDb, teardownTestDb } = require('./helpers/testDb');

describe('Concurrency Control: Race Conditions on Incident Claiming', () => {
  before(() => {
    setupTestDb();
  });

  after(() => {
    teardownTestDb();
  });

  beforeEach(() => {
    resetTestDb();
  });

  it('should ensure exactly one hero claims an incident during concurrent claim race conditions', async () => {
    // 1. Citizen reports emergency
    const cit = await request(app)
      .post('/api/auth/register')
      .send({ username: 'race_citizen', email: 'race_cit@ny.gov', password: 'Password123!', role: 'Citizen' });

    const inc = await request(app)
      .post('/api/incidents')
      .set('Authorization', `Bearer ${cit.body.token}`)
      .send({
        title: 'Midtown Rooftop Hostage Situation',
        description: 'Multiple hostages held on penthouse balcony',
        category: 'Hostage',
        severity: 5,
        location: 'Midtown Manhattan'
      });
    const incidentId = inc.body.id;

    // 2. Register Hero 1 and Hero 2
    const hero1 = await request(app)
      .post('/api/auth/register')
      .send({ username: 'spider_man_hero', email: 'spidey@avengers.org', password: 'Password123!', role: 'Hero' });

    const hero2 = await request(app)
      .post('/api/auth/register')
      .send({ username: 'iron_man_hero', email: 'ironman@avengers.org', password: 'Password123!', role: 'Hero' });

    // 3. Fire simultaneous claim requests
    const [res1, res2] = await Promise.all([
      request(app)
        .post(`/api/incidents/${incidentId}/claim`)
        .set('Authorization', `Bearer ${hero1.body.token}`),
      request(app)
        .post(`/api/incidents/${incidentId}/claim`)
        .set('Authorization', `Bearer ${hero2.body.token}`)
    ]);

    const statuses = [res1.status, res2.status];
    assert.ok(statuses.includes(200), `One claim must succeed with 200 OK. Got: ${JSON.stringify(statuses)}`);
    assert.ok(
      statuses.includes(409) || statuses.includes(400),
      `Conflicting claim must be rejected with 409 Conflict. Got: ${JSON.stringify(statuses)}`
    );

    const winnerRes = res1.status === 200 ? res1 : res2;
    const winnerHero = res1.status === 200 ? hero1 : hero2;

    assert.strictEqual(winnerRes.body.status, 'Claimed');
    assert.strictEqual(winnerRes.body.hero_id, winnerHero.body.user.id);

    // 4. Verify status history audit records: exactly 2 entries (creation + 1 claim)
    const histRes = await request(app)
      .get(`/api/incidents/${incidentId}/history`)
      .set('Authorization', `Bearer ${winnerHero.body.token}`);

    const history = Array.isArray(histRes.body) ? histRes.body : histRes.body.history;
    assert.strictEqual(history.length, 2, 'History must contain exactly one claim entry');
    assert.strictEqual(history[1].new_status, 'Claimed');
    assert.strictEqual(history[1].changed_by_user_id, winnerHero.body.user.id);
  });

  it('should reject claim on already Claimed incident with 409 Conflict', async () => {
    const cit = await request(app)
      .post('/api/auth/register')
      .send({ username: 'cit_claimed', email: 'cit_claimed@ny.gov', password: 'Password123!', role: 'Citizen' });

    const inc = await request(app)
      .post('/api/incidents')
      .set('Authorization', `Bearer ${cit.body.token}`)
      .send({ title: 'Car Crash', description: 'Two vehicle collision', category: 'Accident', severity: 2, location: 'Queens' });

    const hero1 = await request(app)
      .post('/api/auth/register')
      .send({ username: 'hero_first', email: 'hero1@ny.gov', password: 'Password123!', role: 'Hero' });

    const hero2 = await request(app)
      .post('/api/auth/register')
      .send({ username: 'hero_second', email: 'hero2@ny.gov', password: 'Password123!', role: 'Hero' });

    // Hero 1 claims
    await request(app)
      .post(`/api/incidents/${inc.body.id}/claim`)
      .set('Authorization', `Bearer ${hero1.body.token}`)
      .expect(200);

    // Hero 2 attempts claim on already Claimed incident
    const res = await request(app)
      .post(`/api/incidents/${inc.body.id}/claim`)
      .set('Authorization', `Bearer ${hero2.body.token}`);

    assert.strictEqual(res.status, 409);
  });
});
