'use strict';

const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert');
const request = require('supertest');
const app = require('../src/app');
const { setupTestDb, resetTestDb, teardownTestDb } = require('./helpers/testDb');

describe('Incident Filtering and Pagination', () => {
  let heroToken;

  before(() => {
    setupTestDb();
  });

  after(() => {
    teardownTestDb();
  });

  beforeEach(async () => {
    resetTestDb();

    // Register citizen to seed incidents
    const cit = await request(app)
      .post('/api/auth/register')
      .send({ username: 'filter_cit', email: 'cit_filter@ny.gov', password: 'Password123!', role: 'Citizen' });

    // Seed 6 diverse incidents
    const incidents = [
      { title: 'Fire at Queens Warehouse', description: 'Flames in building', category: 'Fire', severity: 5, location: 'Queens' },
      { title: 'Apartment Kitchen Fire', description: 'Small kitchen fire', category: 'Fire', severity: 2, location: 'Brooklyn' },
      { title: 'Bank Robbery Midtown', description: 'Armed suspect at bank', category: 'Robbery', severity: 5, location: 'Manhattan' },
      { title: 'Purse Snatching Central Park', description: 'Suspect fled on foot', category: 'Robbery', severity: 1, location: 'Manhattan' },
      { title: 'Water Main Break Astoria', description: 'Flooding street', category: 'Hazard', severity: 3, location: 'Queens' },
      { title: 'Gas Leak Bronx', description: 'Sulfur smell in basement', category: 'Hazard', severity: 4, location: 'Bronx' }
    ];

    for (const inc of incidents) {
      await request(app)
        .post('/api/incidents')
        .set('Authorization', `Bearer ${cit.body.token}`)
        .send(inc);
    }

    // Register hero for viewing and filtering
    const hero = await request(app)
      .post('/api/auth/register')
      .send({ username: 'filter_hero', email: 'hero_filter@avengers.org', password: 'Password123!', role: 'Hero' });
    heroToken = hero.body.token;
  });

  it('should filter incidents by category', async () => {
    const res = await request(app)
      .get('/api/incidents?category=Fire')
      .set('Authorization', `Bearer ${heroToken}`);

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.items.length, 2);
    res.body.items.forEach((item) => assert.strictEqual(item.category, 'Fire'));
  });

  it('should filter incidents by severity', async () => {
    const res = await request(app)
      .get('/api/incidents?severity=5')
      .set('Authorization', `Bearer ${heroToken}`);

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.items.length, 2);
    res.body.items.forEach((item) => assert.strictEqual(item.severity, 5));
  });

  it('should filter incidents by multiple criteria (category AND severity)', async () => {
    const res = await request(app)
      .get('/api/incidents?category=Robbery&severity=5')
      .set('Authorization', `Bearer ${heroToken}`);

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.items.length, 1);
    assert.strictEqual(res.body.items[0].title, 'Bank Robbery Midtown');
  });

  it('should support pagination with page and limit parameters, returning metadata', async () => {
    const res = await request(app)
      .get('/api/incidents?page=1&limit=2')
      .set('Authorization', `Bearer ${heroToken}`);

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.items.length, 2);
    assert.strictEqual(res.body.total, 6);
    assert.strictEqual(res.body.page, 1);
    assert.strictEqual(res.body.pageSize, 2);
    assert.strictEqual(res.body.totalPages, 3);
  });

  it('should return non-overlapping slices across consecutive pages', async () => {
    const page1 = await request(app)
      .get('/api/incidents?page=1&limit=3')
      .set('Authorization', `Bearer ${heroToken}`);

    const page2 = await request(app)
      .get('/api/incidents?page=2&limit=3')
      .set('Authorization', `Bearer ${heroToken}`);

    assert.strictEqual(page1.body.items.length, 3);
    assert.strictEqual(page2.body.items.length, 3);

    const ids1 = new Set(page1.body.items.map((i) => i.id));
    for (const item of page2.body.items) {
      assert.ok(!ids1.has(item.id), `ID ${item.id} should not appear on both pages`);
    }
  });

  it('should return empty items array when requested page exceeds totalPages', async () => {
    const res = await request(app)
      .get('/api/incidents?page=999&limit=10')
      .set('Authorization', `Bearer ${heroToken}`);

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.items.length, 0);
    assert.strictEqual(res.body.total, 6);
  });
});
