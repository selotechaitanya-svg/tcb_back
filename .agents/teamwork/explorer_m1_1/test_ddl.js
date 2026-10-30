const { DatabaseSync } = require('node:sqlite');

const db = new DatabaseSync(':memory:');
db.exec('PRAGMA foreign_keys = ON;');

const ddl = `
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

CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_incidents_reporter ON incidents(reporter_id);
CREATE INDEX IF NOT EXISTS idx_incidents_hero ON incidents(hero_id);
CREATE INDEX IF NOT EXISTS idx_incidents_status ON incidents(status);
CREATE INDEX IF NOT EXISTS idx_incidents_category ON incidents(category);
CREATE INDEX IF NOT EXISTS idx_incidents_severity ON incidents(severity);
CREATE INDEX IF NOT EXISTS idx_incidents_created_at ON incidents(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_status_history_incident ON status_history(incident_id);
`;

db.exec(ddl);
console.log('SUCCESS: DDL applied cleanly.');

// Test inserting users
const insertUser = db.prepare('INSERT INTO users (username, email, password_hash, role) VALUES (?, ?, ?, ?)');
const u1 = insertUser.run('spidey', 'peter@dailybugle.com', 'hash123', 'Hero');
const u2 = insertUser.run('citizen_jane', 'jane@ny.com', 'hash456', 'Citizen');
console.log('Inserted users:', u1.lastInsertRowid, u2.lastInsertRowid);

// Test inserting incident
const insertIncident = db.prepare(`
  INSERT INTO incidents (title, description, category, severity, location, reporter_id)
  VALUES (?, ?, ?, ?, ?, ?)
`);
const inc = insertIncident.run('Bank Robbery', 'Armed robbery at 5th Ave', 'Crime', 4, '5th Ave & 42nd St', u2.lastInsertRowid);
console.log('Inserted incident:', inc.lastInsertRowid);

// Test inserting status history
const insertHistory = db.prepare(`
  INSERT INTO status_history (incident_id, previous_status, new_status, changed_by_user_id, notes)
  VALUES (?, ?, ?, ?, ?)
`);
const hist1 = insertHistory.run(inc.lastInsertRowid, null, 'Reported', u2.lastInsertRowid, 'Initial report');
console.log('Inserted status history:', hist1.lastInsertRowid);

// Test atomic claim
const claimStmt = db.prepare(`
  UPDATE incidents
  SET status = 'Claimed', hero_id = ?, updated_at = CURRENT_TIMESTAMP
  WHERE id = ? AND status = 'Reported'
`);
const claimRes = claimStmt.run(u1.lastInsertRowid, inc.lastInsertRowid);
console.log('Claim result (first attempt):', claimRes.changes); // should be 1

const claimRes2 = claimStmt.run(999, inc.lastInsertRowid);
console.log('Claim result (second attempt - concurrent race):', claimRes2.changes); // should be 0

// Test cascade delete on status_history when incident is deleted
db.exec('DELETE FROM incidents WHERE id = ' + inc.lastInsertRowid);
const remainingHist = db.prepare('SELECT count(*) as c FROM status_history WHERE incident_id = ?').get(inc.lastInsertRowid);
console.log('Remaining history records after incident delete:', remainingHist.c); // should be 0

// Test invalid severity check constraint
try {
  insertIncident.run('Minor thing', 'desc', 'Other', 6, 'loc', u2.lastInsertRowid);
  console.log('FAIL: Severity 6 should have thrown constraint error');
} catch (e) {
  console.log('SUCCESS: Severity 6 rejected:', e.message);
}

// Test invalid role check constraint
try {
  insertUser.run('badguy', 'bad@evil.com', 'hash', 'Villain');
  console.log('FAIL: Villain should have thrown constraint error');
} catch (e) {
  console.log('SUCCESS: Villain role rejected:', e.message);
}
