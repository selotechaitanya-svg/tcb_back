'use strict';

const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert');
const request = require('supertest');
const app = require('../src/app');
const { setupTestDb, resetTestDb, teardownTestDb } = require('./helpers/testDb');

describe('Incident Management: CRUD & Access Scoping', () => {
  before(() => {
    setupTestDb();
  });

  after(() => {
    teardownTestDb();
  });

  beforeEach(() => {
    resetTestDb();
  });

  describe('POST /api/incidents (Incident Creation)', () => {
    it('should allow a Citizen to create an incident with severity 1-5 and all required fields', async () => {
      const reg = await request(app)
        .post('/api/auth/register')
        .send({
          username: 'incident_cit',
          email: 'inc_cit@ny.gov',
          password: 'Password123!',
          role: 'Citizen'
        });

      const res = await request(app)
        .post('/api/incidents')
        .set('Authorization', `Bearer ${reg.body.token}`)
        .send({
          title: 'Times Square Gas Leak',
          description: 'Strong gas smell reported near subway entrance',
          category: 'Hazard',
          severity: 3,
          location: '42nd St & Broadway'
        });

      assert.strictEqual(res.status, 201);
      assert.strictEqual(res.body.title, 'Times Square Gas Leak');
      assert.strictEqual(res.body.category, 'Hazard');
      assert.strictEqual(res.body.severity, 3);
      assert.strictEqual(res.body.status, 'Reported');
      assert.strictEqual(res.body.reporter_id, reg.body.user.id);
      assert.strictEqual(res.body.hero_id, null);
      assert.ok(res.body.id);
      assert.ok(res.body.created_at);
    });

    it('should reject incident creation by a Hero (403 Forbidden)', async () => {
      const reg = await request(app)
        .post('/api/auth/register')
        .send({
          username: 'incident_hero',
          email: 'inc_hero@avengers.org',
          password: 'Password123!',
          role: 'Hero'
        });

      const res = await request(app)
        .post('/api/incidents')
        .set('Authorization', `Bearer ${reg.body.token}`)
        .send({
          title: 'Hero Self Report',
          description: 'Hero filing an incident',
          category: 'Patrol',
          severity: 2,
          location: 'Central Park'
        });

      assert.strictEqual(res.status, 403);
    });

    it('should reject incident creation with missing required fields (400 Bad Request)', async () => {
      const reg = await request(app)
        .post('/api/auth/register')
        .send({
          username: 'bad_input_cit',
          email: 'bad_input@ny.gov',
          password: 'Password123!',
          role: 'Citizen'
        });

      const res = await request(app)
        .post('/api/incidents')
        .set('Authorization', `Bearer ${reg.body.token}`)
        .send({
          title: 'Incomplete Incident'
        });

      assert.strictEqual(res.status, 400);
    });

    it('should reject incident creation with invalid severity (e.g. 0, 6, "five") (400 Bad Request)', async () => {
      const reg = await request(app)
        .post('/api/auth/register')
        .send({
          username: 'sev_test_cit',
          email: 'sev_test@ny.gov',
          password: 'Password123!',
          role: 'Citizen'
        });

      const invalidSeverities = [0, 6, -1, 3.5, 'high'];
      for (const sev of invalidSeverities) {
        const res = await request(app)
          .post('/api/incidents')
          .set('Authorization', `Bearer ${reg.body.token}`)
          .send({
            title: 'Severity Boundary Test',
            description: 'Checking validation',
            category: 'Testing',
            severity: sev,
            location: 'Queens'
          });

        assert.strictEqual(res.status, 400, `Expected severity ${sev} to be rejected with 400`);
      }
    });
  });

  describe('GET /api/incidents (Listing & Scoping)', () => {
    it('should isolate Citizen views: citizens see only their own reported incidents', async () => {
      const cit1 = await request(app)
        .post('/api/auth/register')
        .send({ username: 'cit_one', email: 'cit1@ny.gov', password: 'Password123!', role: 'Citizen' });

      const cit2 = await request(app)
        .post('/api/auth/register')
        .send({ username: 'cit_two', email: 'cit2@ny.gov', password: 'Password123!', role: 'Citizen' });

      await request(app)
        .post('/api/incidents')
        .set('Authorization', `Bearer ${cit1.body.token}`)
        .send({ title: 'Report 1', description: 'Desc 1', category: 'Theft', severity: 2, location: 'Bronx' });

      await request(app)
        .post('/api/incidents')
        .set('Authorization', `Bearer ${cit2.body.token}`)
        .send({ title: 'Report 2', description: 'Desc 2', category: 'Fire', severity: 4, location: 'Queens' });

      const resCit1 = await request(app)
        .get('/api/incidents')
        .set('Authorization', `Bearer ${cit1.body.token}`);

      assert.strictEqual(resCit1.status, 200);
      assert.strictEqual(resCit1.body.items.length, 1);
      assert.strictEqual(resCit1.body.items[0].title, 'Report 1');

      const resCit2 = await request(app)
        .get('/api/incidents')
        .set('Authorization', `Bearer ${cit2.body.token}`);

      assert.strictEqual(resCit2.status, 200);
      assert.strictEqual(resCit2.body.items.length, 1);
      assert.strictEqual(resCit2.body.items[0].title, 'Report 2');
    });

    it('should allow Heroes to view all open (Reported) incidents across all citizens', async () => {
      const cit = await request(app)
        .post('/api/auth/register')
        .send({ username: 'cit_rep', email: 'citrep@ny.gov', password: 'Password123!', role: 'Citizen' });

      const hero = await request(app)
        .post('/api/auth/register')
        .send({ username: 'hero_scout', email: 'scout@avengers.org', password: 'Password123!', role: 'Hero' });

      await request(app)
        .post('/api/incidents')
        .set('Authorization', `Bearer ${cit.body.token}`)
        .send({ title: 'Incident A', description: 'Desc A', category: 'Hazard', severity: 3, location: 'SoHo' });

      await request(app)
        .post('/api/incidents')
        .set('Authorization', `Bearer ${cit.body.token}`)
        .send({ title: 'Incident B', description: 'Desc B', category: 'Rescue', severity: 5, location: 'Harlem' });

      const heroView = await request(app)
        .get('/api/incidents')
        .set('Authorization', `Bearer ${hero.body.token}`);

      assert.strictEqual(heroView.status, 200);
      assert.strictEqual(heroView.body.items.length, 2);
    });
  });

  describe('GET /api/incidents/:id (Individual Incident Details)', () => {
    it('should deny a citizen from viewing another citizen incident by ID (403 Forbidden)', async () => {
      const cit1 = await request(app)
        .post('/api/auth/register')
        .send({ username: 'priv_cit1', email: 'priv1@test.com', password: 'Password123!', role: 'Citizen' });

      const cit2 = await request(app)
        .post('/api/auth/register')
        .send({ username: 'priv_cit2', email: 'priv2@test.com', password: 'Password123!', role: 'Citizen' });

      const inc = await request(app)
        .post('/api/incidents')
        .set('Authorization', `Bearer ${cit1.body.token}`)
        .send({ title: 'Secret Report', description: 'Private info', category: 'Robbery', severity: 4, location: 'Midtown' });

      const res = await request(app)
        .get(`/api/incidents/${inc.body.id}`)
        .set('Authorization', `Bearer ${cit2.body.token}`);

      assert.strictEqual(res.status, 403);
    });

    it('should return 404 Not Found for non-existent incident ID', async () => {
      const hero = await request(app)
        .post('/api/auth/register')
        .send({ username: 'lookup_hero', email: 'lookup@heroes.org', password: 'Password123!', role: 'Hero' });

      const res = await request(app)
        .get('/api/incidents/99999')
        .set('Authorization', `Bearer ${hero.body.token}`);

      assert.strictEqual(res.status, 404);
    });
  });
});
