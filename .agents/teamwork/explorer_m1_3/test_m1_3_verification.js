const { DatabaseSync } = require('node:sqlite');
const test = require('node:test');
const assert = require('node:assert');

// 1. Mock DatabaseManager matching explorer_m1_1's design
class DatabaseManager {
  constructor(dbPath = ':memory:', options = {}) {
    this.dbPath = dbPath;
    this.options = options;
    this.db = new DatabaseSync(this.dbPath);
    this.db.exec('PRAGMA foreign_keys = ON;');
    this.db.exec('PRAGMA busy_timeout = 5000;');
    if (this.options.schemaSql) {
      this.db.exec(this.options.schemaSql);
    }
  }

  run(sql, params = []) {
    const stmt = this.db.prepare(sql);
    const p = Array.isArray(params) ? params : [params];
    return stmt.run(...p);
  }

  get(sql, params = []) {
    const stmt = this.db.prepare(sql);
    const p = Array.isArray(params) ? params : [params];
    return stmt.get(...p);
  }

  query(sql, params = []) {
    const stmt = this.db.prepare(sql);
    const p = Array.isArray(params) ? params : [params];
    return stmt.all(...p);
  }

  exec(sql) {
    return this.db.exec(sql);
  }

  close() {
    if (this.db) {
      this.db.close();
      this.db = null;
    }
  }
}

// Singleton state
let currentDb = null;
function initDatabase(path = ':memory:', opts = {}) {
  if (currentDb) currentDb.close();
  currentDb = new DatabaseManager(path, opts);
  return currentDb;
}
function getDatabase() {
  if (!currentDb) currentDb = initDatabase();
  return currentDb;
}
function closeDatabase() {
  if (currentDb) {
    currentDb.close();
    currentDb = null;
  }
}

// 2. Test testDb helper pattern
const schemaSql = `
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('Citizen', 'Hero')),
  created_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP),
  updated_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP)
);

CREATE TABLE IF NOT EXISTS incidents (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  category TEXT NOT NULL,
  severity INTEGER NOT NULL CHECK(severity BETWEEN 1 AND 5),
  location TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'Reported' CHECK(status IN ('Reported', 'Claimed', 'In Progress', 'Resolved')),
  reporter_id INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  hero_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP),
  updated_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP)
);

CREATE TABLE IF NOT EXISTS status_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  incident_id INTEGER NOT NULL REFERENCES incidents(id) ON DELETE CASCADE,
  previous_status TEXT CHECK(previous_status IS NULL OR previous_status IN ('Reported', 'Claimed', 'In Progress', 'Resolved')),
  new_status TEXT NOT NULL CHECK(new_status IN ('Reported', 'Claimed', 'In Progress', 'Resolved')),
  changed_by_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  changed_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP),
  notes TEXT
);
`;

function setupTestDb() {
  return initDatabase(':memory:', { schemaSql });
}

function resetTestDb() {
  const db = getDatabase();
  db.exec('DELETE FROM status_history; DELETE FROM incidents; DELETE FROM users;');
}

function teardownTestDb() {
  closeDatabase();
}

// Run verification tests
test('testDb setup, reset, and teardown cycle', (t) => {
  setupTestDb();
  const db = getDatabase();
  assert.ok(db, 'DB initialized');

  db.run('INSERT INTO users (username, email, password_hash, role) VALUES (?, ?, ?, ?)', ['spidey', 'peter@dailybugle.com', 'h1', 'Hero']);
  const u = db.get('SELECT * FROM users WHERE username = ?', ['spidey']);
  assert.strictEqual(u.username, 'spidey');
  assert.strictEqual(u.role, 'Hero');

  resetTestDb();
  const afterReset = db.query('SELECT * FROM users');
  assert.strictEqual(afterReset.length, 0, 'Users cleared after reset');

  teardownTestDb();
  assert.strictEqual(currentDb, null, 'DB instance cleaned up after teardown');
});

console.log('testDb verification script defined successfully.');
