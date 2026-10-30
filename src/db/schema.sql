-- Spider-Sense Alert System Database Schema DDL
-- Target Engine: node:sqlite (SQLite 3)

-- 1. Users Table
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE COLLATE NOCASE,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('Citizen', 'Hero')),
  created_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP),
  updated_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP)
);

-- 2. Incidents Table
CREATE TABLE IF NOT EXISTS incidents (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  category TEXT NOT NULL,
  severity INTEGER NOT NULL CHECK(severity >= 1 AND severity <= 5),
  location TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'Reported' CHECK(status IN ('Reported', 'Claimed', 'In Progress', 'Resolved')),
  reporter_id INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  hero_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP),
  updated_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP)
);

-- 3. Status History Audit Trail Table
CREATE TABLE IF NOT EXISTS status_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  incident_id INTEGER NOT NULL REFERENCES incidents(id) ON DELETE CASCADE,
  previous_status TEXT CHECK(previous_status IS NULL OR previous_status IN ('Reported', 'Claimed', 'In Progress', 'Resolved')),
  new_status TEXT NOT NULL CHECK(new_status IN ('Reported', 'Claimed', 'In Progress', 'Resolved')),
  changed_by_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  changed_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP),
  notes TEXT
);

-- Indexes for Fast Lookups, Authentication, Filtering & Pagination
CREATE INDEX IF NOT EXISTS idx_users_username ON users(username COLLATE NOCASE);
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email COLLATE NOCASE);
CREATE INDEX IF NOT EXISTS idx_incidents_reporter ON incidents(reporter_id);
CREATE INDEX IF NOT EXISTS idx_incidents_hero ON incidents(hero_id);
CREATE INDEX IF NOT EXISTS idx_incidents_status ON incidents(status);
CREATE INDEX IF NOT EXISTS idx_incidents_category ON incidents(category);
CREATE INDEX IF NOT EXISTS idx_incidents_severity ON incidents(severity);
CREATE INDEX IF NOT EXISTS idx_incidents_created_at ON incidents(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_status_history_incident ON status_history(incident_id);
CREATE INDEX IF NOT EXISTS idx_status_history_user ON status_history(changed_by_user_id);

-- Triggers for Automatic updated_at Timestamps
CREATE TRIGGER IF NOT EXISTS trg_users_updated_at
AFTER UPDATE ON users
FOR EACH ROW WHEN NEW.updated_at = OLD.updated_at
BEGIN
  UPDATE users SET updated_at = CURRENT_TIMESTAMP WHERE id = NEW.id;
END;

CREATE TRIGGER IF NOT EXISTS trg_incidents_updated_at
AFTER UPDATE ON incidents
FOR EACH ROW WHEN NEW.updated_at = OLD.updated_at
BEGIN
  UPDATE incidents SET updated_at = CURRENT_TIMESTAMP WHERE id = NEW.id;
END;
