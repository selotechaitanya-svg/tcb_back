const { DatabaseSync } = require('node:sqlite');

const db = new DatabaseSync(':memory:');
db.exec('PRAGMA foreign_keys = ON;');
db.exec(`
CREATE TABLE incidents (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'Reported',
  hero_id INTEGER
);
CREATE TABLE status_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  incident_id INTEGER NOT NULL,
  previous_status TEXT,
  new_status TEXT NOT NULL,
  changed_by_user_id INTEGER NOT NULL
);
INSERT INTO incidents (title) VALUES ('Bank Robbery');
`);

function claimIncident(incidentId, heroId) {
  db.exec('BEGIN IMMEDIATE;');
  try {
    const stmt = db.prepare(`
      UPDATE incidents
      SET status = 'Claimed', hero_id = ?
      WHERE id = ? AND status = 'Reported'
    `);
    const res = stmt.run(heroId, incidentId);
    if (res.changes === 0) {
      const existing = db.prepare('SELECT id, status FROM incidents WHERE id = ?').get(incidentId);
      if (!existing) {
        throw new Error('404: Not found');
      }
      throw new Error(`409: Conflict - Incident already in status ${existing.status}`);
    }
    db.prepare(`
      INSERT INTO status_history (incident_id, previous_status, new_status, changed_by_user_id)
      VALUES (?, 'Reported', 'Claimed', ?)
    `).run(incidentId, heroId);
    db.exec('COMMIT;');
    return { success: true, heroId };
  } catch (err) {
    db.exec('ROLLBACK;');
    throw err;
  }
}

// Hero 1 claims
console.log('Hero 1 attempt:', claimIncident(1, 101));

// Hero 2 attempts to claim same incident
try {
  claimIncident(1, 102);
} catch (e) {
  console.log('Hero 2 attempt failed as expected:', e.message);
}

console.log('Final incident state:', db.prepare('SELECT * FROM incidents WHERE id = 1').get());
console.log('Final history count:', db.prepare('SELECT count(*) as c FROM status_history').get());
