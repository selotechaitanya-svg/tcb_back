'use strict';

const { describe, it, beforeEach, afterEach, before, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const request = require('supertest');

const app = require('../src/app');
const {
  DatabaseManager,
  initDatabase,
  getDatabase,
  closeDatabase,
  query,
  get,
  run,
  transaction
} = require('../src/db/database');
const { setupTestDb, resetTestDb, teardownTestDb } = require('./helpers/testDb');

describe('Milestone 1 Adversarial Verification: Database Integrity, Constraints & Concurrency Safety', () => {
  beforeEach(() => {
    setupTestDb();
  });

  afterEach(() => {
    teardownTestDb();
  });

  // =========================================================================
  // 1. SQLite Constraint Enforcement (CHECK constraints)
  // =========================================================================
  describe('1. SQLite Constraint Enforcement (CHECK Constraints)', () => {
    it('should reject invalid roles in users table (NOT IN ("Citizen", "Hero"))', () => {
      const invalidRoles = ['Admin', 'Villain', 'Police', 'CitizenExtra', '', 'citizen', 'hero', 'SUPERHERO'];

      for (const invalidRole of invalidRoles) {
        assert.throws(
          () => {
            run(
              'INSERT INTO users (username, email, password_hash, role) VALUES (?, ?, ?, ?)',
              [`user_${invalidRole}`, `user_${invalidRole}@test.com`, 'hashed_pw', invalidRole]
            );
          },
          (err) => {
            return err && (err.code === 'ERR_SQLITE_ERROR' || err.message.includes('CHECK constraint failed'));
          },
          `Expected role '${invalidRole}' to violate CHECK(role IN ('Citizen', 'Hero'))`
        );
      }
    });

    it('should reject NULL role in users table (NOT NULL constraint)', () => {
      assert.throws(
        () => {
          run(
            'INSERT INTO users (username, email, password_hash, role) VALUES (?, ?, ?, ?)',
            ['user_null_role', 'user_null@test.com', 'hashed_pw', null]
          );
        },
        (err) => {
          return err && (err.code === 'ERR_SQLITE_ERROR' || err.message.includes('NOT NULL constraint failed'));
        }
      );
    });

    it('should allow valid roles "Citizen" and "Hero"', () => {
      const res1 = run(
        'INSERT INTO users (username, email, password_hash, role) VALUES (?, ?, ?, ?)',
        ['valid_citizen', 'citizen@test.com', 'hashed_pw', 'Citizen']
      );
      assert.ok(res1.lastInsertRowid);

      const res2 = run(
        'INSERT INTO users (username, email, password_hash, role) VALUES (?, ?, ?, ?)',
        ['valid_hero', 'hero@test.com', 'hashed_pw', 'Hero']
      );
      assert.ok(res2.lastInsertRowid);
    });

    it('should reject invalid severity in incidents table (severity < 1 or severity > 5)', () => {
      // First insert valid reporter
      const userRes = run(
        'INSERT INTO users (username, email, password_hash, role) VALUES (?, ?, ?, ?)',
        ['reporter_sev', 'reporter_sev@test.com', 'hash', 'Citizen']
      );
      const reporterId = userRes.lastInsertRowid;

      const invalidSeverities = [0, -1, -99, 6, 7, 10, 100];

      for (const sev of invalidSeverities) {
        assert.throws(
          () => {
            run(
              `INSERT INTO incidents (title, description, category, severity, location, reporter_id)
               VALUES (?, ?, ?, ?, ?, ?)`,
              ['Robbery', 'Bank robbery', 'Theft', sev, 'Times Square', reporterId]
            );
          },
          (err) => {
            return err && (err.code === 'ERR_SQLITE_ERROR' || err.message.includes('CHECK constraint failed'));
          },
          `Expected severity ${sev} to violate CHECK(severity >= 1 AND severity <= 5)`
        );
      }
    });

    it('should allow all valid severities (1 through 5) in incidents table', () => {
      const userRes = run(
        'INSERT INTO users (username, email, password_hash, role) VALUES (?, ?, ?, ?)',
        ['reporter_valid_sev', 'reporter_valid_sev@test.com', 'hash', 'Citizen']
      );
      const reporterId = userRes.lastInsertRowid;

      for (let sev = 1; sev <= 5; sev++) {
        const res = run(
          `INSERT INTO incidents (title, description, category, severity, location, reporter_id)
           VALUES (?, ?, ?, ?, ?, ?)`,
          [`Incident ${sev}`, `Description ${sev}`, 'Emergency', sev, 'Queens', reporterId]
        );
        assert.ok(res.lastInsertRowid);
      }

      const rows = query('SELECT COUNT(*) as cnt FROM incidents WHERE reporter_id = ?', [reporterId]);
      assert.strictEqual(rows[0].cnt, 5);
    });

    it('should reject invalid status in incidents table (not in Reported, Claimed, In Progress, Resolved)', () => {
      const userRes = run(
        'INSERT INTO users (username, email, password_hash, role) VALUES (?, ?, ?, ?)',
        ['reporter_stat', 'reporter_stat@test.com', 'hash', 'Citizen']
      );
      const reporterId = userRes.lastInsertRowid;

      const invalidStatuses = ['Open', 'Pending', 'Closed', 'Archived', 'In_Progress', 'in progress', 'resolved', ''];

      for (const status of invalidStatuses) {
        assert.throws(
          () => {
            run(
              `INSERT INTO incidents (title, description, category, severity, location, status, reporter_id)
               VALUES (?, ?, ?, ?, ?, ?, ?)`,
              ['Crime', 'Description', 'Fire', 3, 'Brooklyn', status, reporterId]
            );
          },
          (err) => {
            return err && (err.code === 'ERR_SQLITE_ERROR' || err.message.includes('CHECK constraint failed'));
          },
          `Expected status '${status}' to violate CHECK(status IN ('Reported', 'Claimed', 'In Progress', 'Resolved'))`
        );
      }
    });

    it('should reject invalid status transitions or invalid new_status in status_history table', () => {
      const userRes = run(
        'INSERT INTO users (username, email, password_hash, role) VALUES (?, ?, ?, ?)',
        ['status_user', 'status_user@test.com', 'hash', 'Citizen']
      );
      const userId = userRes.lastInsertRowid;

      const incRes = run(
        `INSERT INTO incidents (title, description, category, severity, location, reporter_id)
         VALUES (?, ?, ?, ?, ?, ?)`,
        ['Test Incident', 'Desc', 'Accident', 2, 'Manhattan', userId]
      );
      const incidentId = incRes.lastInsertRowid;

      // Invalid new_status
      assert.throws(
        () => {
          run(
            `INSERT INTO status_history (incident_id, previous_status, new_status, changed_by_user_id)
             VALUES (?, ?, ?, ?)`,
            [incidentId, 'Reported', 'InvalidStatus', userId]
          );
        },
        (err) => {
          return err && (err.code === 'ERR_SQLITE_ERROR' || err.message.includes('CHECK constraint failed'));
        }
      );

      // Invalid previous_status (not NULL and not valid status)
      assert.throws(
        () => {
          run(
            `INSERT INTO status_history (incident_id, previous_status, new_status, changed_by_user_id)
             VALUES (?, ?, ?, ?)`,
            [incidentId, 'PendingReview', 'Reported', userId]
          );
        },
        (err) => {
          return err && (err.code === 'ERR_SQLITE_ERROR' || err.message.includes('CHECK constraint failed'));
        }
      );
    });
  });

  // =========================================================================
  // 2. Foreign Key Constraint Enforcement
  // =========================================================================
  describe('2. Foreign Key Constraint Enforcement', () => {
    it('should reject inserting an incident with a non-existent reporter_id', () => {
      assert.throws(
        () => {
          run(
            `INSERT INTO incidents (title, description, category, severity, location, reporter_id)
             VALUES (?, ?, ?, ?, ?, ?)`,
            ['Ghost Report', 'No reporter exists', 'Mystery', 1, 'Hell\'s Kitchen', 999999]
          );
        },
        (err) => {
          return err && (err.code === 'ERR_SQLITE_ERROR' || err.message.includes('FOREIGN KEY constraint failed'));
        },
        'Expected non-existent reporter_id to violate foreign key constraint'
      );
    });

    it('should reject deleting a reporter while incidents exist (ON DELETE RESTRICT)', () => {
      const userRes = run(
        'INSERT INTO users (username, email, password_hash, role) VALUES (?, ?, ?, ?)',
        ['reporter_locked', 'locked@test.com', 'hash', 'Citizen']
      );
      const reporterId = userRes.lastInsertRowid;

      run(
        `INSERT INTO incidents (title, description, category, severity, location, reporter_id)
         VALUES (?, ?, ?, ?, ?, ?)`,
        ['Active Incident', 'Must prevent reporter deletion', 'Hazard', 4, 'Staten Island', reporterId]
      );

      // Attempt to delete user
      assert.throws(
        () => {
          run('DELETE FROM users WHERE id = ?', [reporterId]);
        },
        (err) => {
          return err && (err.code === 'ERR_SQLITE_ERROR' || err.message.includes('FOREIGN KEY constraint failed'));
        },
        'Expected DELETE on user with active incidents to fail due to ON DELETE RESTRICT'
      );

      // Confirm user record still exists intact
      const userStillExists = get('SELECT id, username FROM users WHERE id = ?', [reporterId]);
      assert.ok(userStillExists);
      assert.strictEqual(userStillExists.username, 'reporter_locked');
    });

    it('should delete associated status_history records when incident is deleted (ON DELETE CASCADE)', () => {
      const userRes = run(
        'INSERT INTO users (username, email, password_hash, role) VALUES (?, ?, ?, ?)',
        ['cascade_user', 'cascade@test.com', 'hash', 'Citizen']
      );
      const userId = userRes.lastInsertRowid;

      const incRes = run(
        `INSERT INTO incidents (title, description, category, severity, location, reporter_id)
         VALUES (?, ?, ?, ?, ?, ?)`,
        ['Incident to delete', 'Desc', 'Mischief', 2, 'Harlem', userId]
      );
      const incidentId = incRes.lastInsertRowid;

      // Insert multiple status_history entries
      run(
        `INSERT INTO status_history (incident_id, previous_status, new_status, changed_by_user_id, notes)
         VALUES (?, ?, ?, ?, ?)`,
        [incidentId, null, 'Reported', userId, 'Created incident']
      );
      run(
        `INSERT INTO status_history (incident_id, previous_status, new_status, changed_by_user_id, notes)
         VALUES (?, ?, ?, ?, ?)`,
        [incidentId, 'Reported', 'Claimed', userId, 'Claimed by hero']
      );
      run(
        `INSERT INTO status_history (incident_id, previous_status, new_status, changed_by_user_id, notes)
         VALUES (?, ?, ?, ?, ?)`,
        [incidentId, 'Claimed', 'In Progress', userId, 'Working on scene']
      );

      // Verify status_history has 3 entries
      const beforeHistory = query('SELECT COUNT(*) as cnt FROM status_history WHERE incident_id = ?', [incidentId]);
      assert.strictEqual(beforeHistory[0].cnt, 3);

      // Delete incident
      const delRes = run('DELETE FROM incidents WHERE id = ?', [incidentId]);
      assert.strictEqual(delRes.changes, 1);

      // Verify incident is gone
      const incCheck = get('SELECT id FROM incidents WHERE id = ?', [incidentId]);
      assert.strictEqual(incCheck, undefined);

      // Verify all status_history records were cascade deleted
      const afterHistory = query('SELECT COUNT(*) as cnt FROM status_history WHERE incident_id = ?', [incidentId]);
      assert.strictEqual(afterHistory[0].cnt, 0);
    });

    it('should set hero_id to NULL if hero user is deleted (ON DELETE SET NULL)', () => {
      const repRes = run(
        'INSERT INTO users (username, email, password_hash, role) VALUES (?, ?, ?, ?)',
        ['reporter_for_hero', 'rep_hero@test.com', 'hash', 'Citizen']
      );
      const reporterId = repRes.lastInsertRowid;

      const heroRes = run(
        'INSERT INTO users (username, email, password_hash, role) VALUES (?, ?, ?, ?)',
        ['temporary_hero', 'temp_hero@test.com', 'hash', 'Hero']
      );
      const heroId = heroRes.lastInsertRowid;

      const incRes = run(
        `INSERT INTO incidents (title, description, category, severity, location, status, reporter_id, hero_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        ['Hero Incident', 'Desc', 'Robbery', 3, 'Bronx', 'Claimed', reporterId, heroId]
      );
      const incidentId = incRes.lastInsertRowid;

      // Delete hero user
      run('DELETE FROM users WHERE id = ?', [heroId]);

      // Incident should still exist and hero_id should be NULL
      const inc = get('SELECT id, hero_id FROM incidents WHERE id = ?', [incidentId]);
      assert.ok(inc);
      assert.strictEqual(inc.hero_id, null);
    });
  });

  // =========================================================================
  // 3. Transaction Atomicity & Rollback Verification
  // =========================================================================
  describe('3. Transaction Atomicity & Rollback Verification', () => {
    it('should completely roll back single-table modifications when transaction throws an error', () => {
      assert.throws(
        () => {
          transaction((db) => {
            db.run(
              'INSERT INTO users (username, email, password_hash, role) VALUES (?, ?, ?, ?)',
              ['aborted_user', 'aborted@test.com', 'hash', 'Citizen']
            );
            throw new Error('Simulated mid-flight crash');
          });
        },
        /Simulated mid-flight crash/
      );

      const user = get('SELECT id FROM users WHERE username = ?', ['aborted_user']);
      assert.strictEqual(user, undefined, 'User must not exist after transaction rollback');
    });

    it('should completely roll back multi-table operations when an error occurs mid-flight', () => {
      // Create citizen outside transaction
      const citizenRes = run(
        'INSERT INTO users (username, email, password_hash, role) VALUES (?, ?, ?, ?)',
        ['tx_citizen', 'tx_citizen@test.com', 'hash', 'Citizen']
      );
      const citizenId = citizenRes.lastInsertRowid;

      assert.throws(
        () => {
          transaction((db) => {
            // Step 1: Insert incident
            const incRes = db.run(
              `INSERT INTO incidents (title, description, category, severity, location, reporter_id)
               VALUES (?, ?, ?, ?, ?, ?)`,
              ['Tx Incident', 'Desc', 'Fire', 4, 'Midtown', citizenId]
            );

            // Step 2: Insert status history
            db.run(
              `INSERT INTO status_history (incident_id, previous_status, new_status, changed_by_user_id)
               VALUES (?, ?, ?, ?)`,
              [incRes.lastInsertRowid, null, 'Reported', citizenId]
            );

            // Step 3: Trigger crash before commit
            throw new Error('Simulated network failure / abort mid-flight');
          });
        },
        /Simulated network failure/
      );

      // Verify neither incident nor status_history exists
      const inc = get('SELECT id FROM incidents WHERE title = ?', ['Tx Incident']);
      assert.strictEqual(inc, undefined);

      const history = query('SELECT COUNT(*) as cnt FROM status_history WHERE changed_by_user_id = ?', [citizenId]);
      assert.strictEqual(history[0].cnt, 0);
    });

    it('should roll back earlier statements when a subsequent statement triggers a SQLite constraint error', () => {
      assert.throws(
        () => {
          transaction((db) => {
            // Valid insert
            db.run(
              'INSERT INTO users (username, email, password_hash, role) VALUES (?, ?, ?, ?)',
              ['user_part1', 'user_part1@test.com', 'hash', 'Citizen']
            );

            // Illegal insert (violates CHECK constraint on role)
            db.run(
              'INSERT INTO users (username, email, password_hash, role) VALUES (?, ?, ?, ?)',
              ['user_part2', 'user_part2@test.com', 'hash', 'SuperVillain']
            );
          });
        },
        (err) => err && (err.code === 'ERR_SQLITE_ERROR' || err.message.includes('CHECK constraint failed'))
      );

      // Verify user_part1 was rolled back and is not in the database
      const u1 = get('SELECT id FROM users WHERE username = ?', ['user_part1']);
      assert.strictEqual(u1, undefined);
    });

    it('should support nested transactions via savepoints with partial rollback isolation', () => {
      transaction((db) => {
        // Outer tx inserts outer_user
        db.run(
          'INSERT INTO users (username, email, password_hash, role) VALUES (?, ?, ?, ?)',
          ['outer_user', 'outer@test.com', 'hash', 'Citizen']
        );

        // Inner nested transaction that fails
        try {
          db.transaction((innerDb) => {
            innerDb.run(
              'INSERT INTO users (username, email, password_hash, role) VALUES (?, ?, ?, ?)',
              ['inner_aborted', 'inner@test.com', 'hash', 'Hero']
            );
            throw new Error('Inner savepoint abort');
          });
        } catch (e) {
          assert.strictEqual(e.message, 'Inner savepoint abort');
        }

        // Outer tx inserts second valid user and commits
        db.run(
          'INSERT INTO users (username, email, password_hash, role) VALUES (?, ?, ?, ?)',
          ['outer_user2', 'outer2@test.com', 'hash', 'Hero']
        );
      });

      // outer_user and outer_user2 should exist, inner_aborted should NOT exist
      const u1 = get('SELECT username FROM users WHERE username = ?', ['outer_user']);
      const u2 = get('SELECT username FROM users WHERE username = ?', ['outer_user2']);
      const uInner = get('SELECT username FROM users WHERE username = ?', ['inner_aborted']);

      assert.ok(u1, 'outer_user should exist');
      assert.ok(u2, 'outer_user2 should exist');
      assert.strictEqual(uInner, undefined, 'inner_aborted should have been rolled back by savepoint');
    });

    it('should roll back both inner and outer changes when outer transaction fails after inner commits', () => {
      assert.throws(
        () => {
          transaction((db) => {
            db.run(
              'INSERT INTO users (username, email, password_hash, role) VALUES (?, ?, ?, ?)',
              ['outer_will_fail', 'owf@test.com', 'hash', 'Citizen']
            );

            db.transaction((innerDb) => {
              innerDb.run(
                'INSERT INTO users (username, email, password_hash, role) VALUES (?, ?, ?, ?)',
                ['inner_nested_ok', 'inok@test.com', 'hash', 'Hero']
              );
            });

            // Outer fails after inner succeeded
            throw new Error('Outer transaction abort after nested commit');
          });
        },
        /Outer transaction abort after nested commit/
      );

      const uOuter = get('SELECT username FROM users WHERE username = ?', ['outer_will_fail']);
      const uInner = get('SELECT username FROM users WHERE username = ?', ['inner_nested_ok']);

      assert.strictEqual(uOuter, undefined);
      assert.strictEqual(uInner, undefined);
    });

    it('should support async functions in transactions or prevent premature synchronous commits', async () => {
      let committedPrematurely = false;
      try {
        await transaction(async (db) => {
          db.run(
            'INSERT INTO users (username, email, password_hash, role) VALUES (?, ?, ?, ?)',
            ['async_tx_user', 'async_tx@test.com', 'hash', 'Citizen']
          );
          await new Promise((resolve) => setTimeout(resolve, 20));
          throw new Error('Simulated async failure after insert');
        });
      } catch (err) {
        const u = get('SELECT id FROM users WHERE username = ?', ['async_tx_user']);
        if (u) {
          committedPrematurely = true;
        }
      }

      assert.strictEqual(
        committedPrematurely,
        false,
        'Async callback inside transaction committed prematurely before error occurred! Database consistency compromised.'
      );
    });
  });

  // =========================================================================
  // 4. Concurrent Registration Stress Test
  // =========================================================================
  describe('4. Concurrent Registration Stress Testing', () => {
    it('should ensure exactly one request succeeds (201) and the duplicate gets 409 under 2 simultaneous registrations', async () => {
      const payload = {
        username: 'peter_parker_race',
        email: 'peter.parker.race@dailybugle.com',
        password: 'WebSlingerPassword123!',
        role: 'Hero'
      };

      const [res1, res2] = await Promise.all([
        request(app).post('/api/auth/register').send(payload),
        request(app).post('/api/auth/register').send(payload)
      ]);

      const statuses = [res1.status, res2.status].sort();
      assert.deepStrictEqual(
        statuses,
        [201, 409],
        `Expected exactly [201, 409] but received [${res1.status}, ${res2.status}]`
      );

      // Verify exactly one user exists in DB
      const users = query('SELECT id, username, email, role FROM users WHERE username = ?', [payload.username]);
      assert.strictEqual(users.length, 1);
    });

    it('should ensure exactly 1 succeeds (201) and 9 receive 409 under 10 simultaneous registrations', async () => {
      const payload = {
        username: 'miles_morales_burst',
        email: 'miles.burst@brooklynvisions.edu',
        password: 'BioElectricShock99!',
        role: 'Hero'
      };

      const promises = Array.from({ length: 10 }, () =>
        request(app).post('/api/auth/register').send(payload)
      );

      const responses = await Promise.all(promises);

      const statusCounts = responses.reduce((acc, res) => {
        acc[res.status] = (acc[res.status] || 0) + 1;
        return acc;
      }, {});

      assert.strictEqual(statusCounts[201], 1, 'Exactly one registration must receive 201 Created');
      assert.strictEqual(statusCounts[409], 9, 'All 9 duplicate registrations must receive 409 Conflict');
      assert.strictEqual(statusCounts[500] || 0, 0, 'No request should produce a 500 Internal Server Error');

      const users = query('SELECT id, username FROM users WHERE username = ?', [payload.username]);
      assert.strictEqual(users.length, 1);
    });

    it('should reject concurrent registrations with same username but different emails', async () => {
      const payloadA = {
        username: 'gwen_stacy_race',
        email: 'gwen1@spiderband.org',
        password: 'GhostSpiderDrummer1!',
        role: 'Hero'
      };
      const payloadB = {
        username: 'gwen_stacy_race',
        email: 'gwen2@spiderband.org',
        password: 'GhostSpiderDrummer1!',
        role: 'Hero'
      };

      const [resA, resB] = await Promise.all([
        request(app).post('/api/auth/register').send(payloadA),
        request(app).post('/api/auth/register').send(payloadB)
      ]);

      const statuses = [resA.status, resB.status].sort();
      assert.deepStrictEqual(statuses, [201, 409]);

      const users = query('SELECT id, username, email FROM users WHERE username = ?', [payloadA.username]);
      assert.strictEqual(users.length, 1);
    });

    it('should reject concurrent registrations with same email but different usernames', async () => {
      const payloadA = {
        username: 'may_parker_1',
        email: 'auntmay@feast.org',
        password: 'WheatCakesRecipe1!',
        role: 'Citizen'
      };
      const payloadB = {
        username: 'may_parker_2',
        email: 'auntmay@feast.org',
        password: 'WheatCakesRecipe1!',
        role: 'Citizen'
      };

      const [resA, resB] = await Promise.all([
        request(app).post('/api/auth/register').send(payloadA),
        request(app).post('/api/auth/register').send(payloadB)
      ]);

      const statuses = [resA.status, resB.status].sort();
      assert.deepStrictEqual(statuses, [201, 409]);

      const users = query('SELECT id, username, email FROM users WHERE email = ?', [payloadA.email]);
      assert.strictEqual(users.length, 1);
    });

    it('should reject concurrent registrations with case-insensitive collision ("PeterParker" vs "peterparker")', async () => {
      const payload1 = {
        username: 'PeterParkerCase',
        email: 'peter.case@dailybugle.com',
        password: 'Password123!',
        role: 'Citizen'
      };
      const payload2 = {
        username: 'peterparkercase',
        email: 'peter.case2@dailybugle.com',
        password: 'Password123!',
        role: 'Citizen'
      };

      const [res1, res2] = await Promise.all([
        request(app).post('/api/auth/register').send(payload1),
        request(app).post('/api/auth/register').send(payload2)
      ]);

      const statuses = [res1.status, res2.status].sort();
      assert.deepStrictEqual(
        statuses,
        [201, 409],
        `Expected case-insensitive collision to resolve as [201, 409], got [${res1.status}, ${res2.status}]`
      );

      const users = query('SELECT id, username FROM users WHERE username = ? COLLATE NOCASE', ['PeterParkerCase']);
      assert.strictEqual(users.length, 1);
    });
  });

  // =========================================================================
  // 5. File-Backed Disk Database & WAL Mode Verification
  // =========================================================================
  describe('5. File-Backed SQLite WAL Mode Verification', () => {
    const testDbDir = path.join(__dirname, '../data');
    const testDbFile = path.join(testDbDir, 'adversarial_disk_test.db');

    afterEach(() => {
      closeDatabase();
      if (fs.existsSync(testDbFile)) {
        try { fs.unlinkSync(testDbFile); } catch (e) {}
      }
      const walFile = `${testDbFile}-wal`;
      if (fs.existsSync(walFile)) {
        try { fs.unlinkSync(walFile); } catch (e) {}
      }
      const shmFile = `${testDbFile}-shm`;
      if (fs.existsSync(shmFile)) {
        try { fs.unlinkSync(shmFile); } catch (e) {}
      }
    });

    it('should configure WAL mode and enforce foreign keys on a disk-persisted database', () => {
      const diskDb = initDatabase(testDbFile);

      // Verify WAL mode
      const journalMode = diskDb.get('PRAGMA journal_mode;');
      assert.strictEqual(journalMode.journal_mode.toLowerCase(), 'wal');

      // Verify foreign keys ON
      const fkPragma = diskDb.get('PRAGMA foreign_keys;');
      assert.strictEqual(fkPragma.foreign_keys, 1);

      // Verify foreign key restriction works on disk
      const u = diskDb.run(
        'INSERT INTO users (username, email, password_hash, role) VALUES (?, ?, ?, ?)',
        ['disk_user', 'disk@test.com', 'hash', 'Citizen']
      );
      diskDb.run(
        'INSERT INTO incidents (title, description, category, severity, location, reporter_id) VALUES (?, ?, ?, ?, ?, ?)',
        ['Disk incident', 'Desc', 'Cat', 1, 'Loc', u.lastInsertRowid]
      );

      assert.throws(() => {
        diskDb.run('DELETE FROM users WHERE id = ?', [u.lastInsertRowid]);
      }, /FOREIGN KEY constraint failed/);

      diskDb.close();
    });
  });
});
