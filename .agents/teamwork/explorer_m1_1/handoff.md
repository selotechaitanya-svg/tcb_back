# Handoff Report: Milestone 1 Relational Database, Schema DDL, and SQLite Database Manager

## 1. Observation

1. **Target Environment & Runtime**:
   - `node -v` output: `v25.9.0`. Built-in `node:sqlite` is fully available via `const { DatabaseSync } = require('node:sqlite');`.
   - Inspection of `DatabaseSync.prototype` via `node -e "const { DatabaseSync } = require('node:sqlite'); console.log(Object.getOwnPropertyNames(DatabaseSync.prototype));"` revealed available methods:
     `['open', 'close', 'prepare', 'exec', 'function', 'createTagStore', 'location', 'aggregate', 'createSession', 'applyChangeset', 'enableLoadExtension', 'enableDefensive', 'loadExtension', 'setAuthorizer', 'constructor']`.
     Noticeably, there is **no built-in `.transaction()` method** on `DatabaseSync`.
   - Inspection of `StatementSync.prototype` via `node -e "..."` revealed:
     `['iterate', 'all', 'get', 'run', 'columns', 'setAllowBareNamedParameters', 'setAllowUnknownNamedParameters', 'setReadBigInts', 'setReturnArrays', 'constructor']`.

2. **Parameter Binding Behavior in `node:sqlite`**:
   - Running `stmt.run(['world', 99])` resulted in verbatim error:
     `Array error: Unknown named parameter '0'`.
   - In contrast, spreading array arguments `stmt.run(...params)` or passing named parameters as an object `{ name: 'Peter' }` to `:name` succeeded cleanly:
     `Spread args: [Object: null prototype] { id: 1, a: 'hello', b: 42 }`.
     `stmt.run()` returns `{ changes: 1, lastInsertRowid: 1 }`.
     `stmt.get()` returns a null-prototype object `[Object: null prototype] { ... }` or `undefined` when no match is found.

3. **Pragma and Constraint Observations**:
   - `PRAGMA foreign_keys` defaults to `1` (ON) in Node v25.9.0 `DatabaseSync`.
   - Child table `status_history` with foreign key `incident_id INTEGER NOT NULL REFERENCES incidents(id) ON DELETE CASCADE` successfully cascaded row deletions when the parent incident was deleted (`DELETE FROM incidents WHERE id = 1` reduced `status_history` count from 1 to 0).
   - Foreign key constraint failure throws `Error [ERR_SQLITE_ERROR]: FOREIGN KEY constraint failed`.
   - Unique constraint violation throws `Error [ERR_SQLITE_ERROR]: UNIQUE constraint failed: users.username`.
   - Check constraint failure on `severity BETWEEN 1 AND 5` throws `Error [ERR_SQLITE_ERROR]: CHECK constraint failed: severity BETWEEN 1 AND 5`.
   - Check constraint failure on `role IN ('Citizen', 'Hero')` throws `Error [ERR_SQLITE_ERROR]: CHECK constraint failed: role IN ('Citizen', 'Hero')`.

4. **WAL Mode and Concurrency**:
   - Disk database at `temp_test.db` successfully accepted:
     - `PRAGMA journal_mode = WAL;` (verified return value: `{ journal_mode: 'wal' }`).
     - `PRAGMA busy_timeout = 5000;` (verified return value: `{ timeout: 5000 }`).
     - `PRAGMA synchronous = NORMAL;`.
   - In-memory database (`:memory:`) returns `{ journal_mode: 'memory' }` when `PRAGMA journal_mode = WAL;` is executed, avoiding errors while maximizing execution speed for tests.
   - Atomic Compare-and-Swap verification in `test_cas.js`:
     `UPDATE incidents SET status = 'Claimed', hero_id = ? WHERE id = ? AND status = 'Reported'`
     Returned `res.changes = 1` for Hero 1, and `res.changes = 0` for concurrent Hero 2 attempt, perfectly guarding the race condition without application-level mutexes.

5. **Target Workspace State**:
   - Target workspace `C:\Users\CHAITANYA SELOTE\OneDrive\Desktop\tcb_back` is currently an empty directory. No conflicting files exist.

---

## 2. Logic Chain

1. **Database Engine Choice & Compatibility**:
   - *From Observation 1*: Node.js v25.9.0 provides `node:sqlite` (`DatabaseSync`), fulfilling Requirement R3 and `PROJECT.md` without requiring external npm C++ native rebuilds (`better-sqlite3`, `sqlite3`), making it completely portable across Windows platforms and immune to compiler toolchain discrepancies.
2. **Transaction Implementation**:
   - *From Observation 1*: Because `DatabaseSync` lacks a native `.transaction(fn)` wrapper, `database.js` must implement an atomic transaction helper.
   - *From Observation 4*: Using `BEGIN IMMEDIATE;` locks the database for writing upfront, preventing SQLite busy/deadlock scenarios between concurrent transactions.
   - Implementing savepoint tracking (`SAVEPOINT sp_${depth}`) ensures that nested calls within the same call stack release or rollback gracefully without failing on `cannot start a transaction within a transaction`.
3. **Parameter Handling Wrapper**:
   - *From Observation 2*: Because `node:sqlite` treats arrays passed as single arguments as named parameter maps (causing `Unknown named parameter '0'`), the database manager must normalize parameters:
     - If `Array.isArray(params)`: spread into `stmt.run(...params)`, `stmt.all(...params)`, `stmt.get(...params)`.
     - If `params` is a non-null object: pass as a single argument for `:key` named bindings.
     - If `params === undefined || null`: invoke without arguments.
4. **Relational Integrity & Cascades**:
   - *From Observation 3*: Incidents must be preserved when users are retained (`ON DELETE RESTRICT`), but audit trails in `status_history` are strictly bound to an incident lifecycle, requiring `ON DELETE CASCADE` on `incident_id`.
   - Explicit indexes on `users(username)`, `users(email)`, `incidents(status)`, `incidents(category)`, `incidents(severity)`, `incidents(reporter_id)`, `incidents(hero_id)`, `incidents(created_at DESC)`, and `status_history(incident_id)` ensure optimal query execution plans for R2 incident claims, R4 multi-criteria filtering, and pagination.
5. **Environment Adaptability (Testing vs Production)**:
   - *From Observation 4*: In-memory mode (`:memory:`) provides sub-millisecond execution times and zero file lock issues on Windows/OneDrive during automated test runs (`npm test`). File mode (`data/spidersense.db`) provides persistence with WAL mode and `busy_timeout = 5000` for development and server operation.

---

## 3. Caveats

1. **Node.js Experimental Flag Warning**:
   In some Node versions `node:sqlite` emitted an experimental feature warning. On Node v25.9.0, `require('node:sqlite')` imports cleanly. No special command-line flags (`--experimental-sqlite`) are required on v25.9.0.
2. **Date Storage Format**:
   SQLite does not have a dedicated `DATETIME` storage class. Dates are stored as ISO 8601 strings (`TEXT`) using `DEFAULT (CURRENT_TIMESTAMP)` (format: `YYYY-MM-DD HH:MM:SS`). All queries ordering by `created_at DESC` or `changed_at ASC` work correctly because ISO timestamps sort lexicographically.
3. **Trigger Behavior**:
   The `updated_at` triggers use `WHEN NEW.updated_at = OLD.updated_at` to prevent recursive firing while automatically updating `updated_at` on rows whenever columns are updated.

---

## 4. Conclusion & Complete Implementation Specification

### A. Exact Specification for `src/db/schema.sql`

```sql
-- Spider-Sense Alert System Database Schema DDL
-- Target Engine: node:sqlite (SQLite 3)

-- 1. Users Table
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE,
  email TEXT NOT NULL UNIQUE,
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
CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
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
```

---

### B. Exact Specification for `src/db/database.js`

```javascript
'use strict';

const { DatabaseSync } = require('node:sqlite');
const fs = require('node:fs');
const path = require('node:path');

let activeInstance = null;

class DatabaseManager {
  /**
   * @param {string} dbPath - File path or ':memory:'
   * @param {object} [options]
   * @param {string} [options.schemaPath] - Path to schema.sql file
   * @param {string} [options.schemaSql] - Raw SQL string to execute upon connection
   */
  constructor(dbPath = ':memory:', options = {}) {
    this.dbPath = dbPath;
    this.options = options;
    this.db = null;
    this._txDepth = 0;
    this.init();
  }

  /**
   * Initialize SQLite connection, pragmas, and schema migration
   */
  init() {
    if (this.dbPath !== ':memory:') {
      const dir = path.dirname(path.resolve(this.dbPath));
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
    }

    this.db = new DatabaseSync(this.dbPath);

    // Enforce relational integrity and configure timeouts
    this.db.exec('PRAGMA foreign_keys = ON;');
    this.db.exec('PRAGMA busy_timeout = 5000;');

    // Disk-only pragmas for high-throughput concurrency
    if (this.dbPath !== ':memory:') {
      this.db.exec('PRAGMA journal_mode = WAL;');
      this.db.exec('PRAGMA synchronous = NORMAL;');
    }

    // Apply schema DDL
    if (this.options.schemaSql) {
      this.db.exec(this.options.schemaSql);
    } else {
      const schemaFile = this.options.schemaPath || path.join(__dirname, 'schema.sql');
      if (fs.existsSync(schemaFile)) {
        const sql = fs.readFileSync(schemaFile, 'utf8');
        this.db.exec(sql);
      }
    }
  }

  /**
   * Normalizes query parameters for node:sqlite StatementSync
   * @private
   */
  _normalizeParams(params) {
    if (params === undefined || params === null) {
      return [];
    }
    if (Array.isArray(params)) {
      return params;
    }
    // Single object parameter for named binds (:param, $param)
    return [params];
  }

  /**
   * Executes a SELECT query returning all matching rows as an array of plain objects.
   * @param {string} sql
   * @param {any[]|object} [params]
   * @returns {Array<object>}
   */
  query(sql, params) {
    const stmt = this.db.prepare(sql);
    const n = this._normalizeParams(params);
    return (n.length === 1 && typeof n[0] === 'object' && n[0] !== null && !Array.isArray(n[0]))
      ? stmt.all(n[0])
      : stmt.all(...n);
  }

  /**
   * Executes a SELECT query returning the first matching row or undefined.
   * @param {string} sql
   * @param {any[]|object} [params]
   * @returns {object|undefined}
   */
  get(sql, params) {
    const stmt = this.db.prepare(sql);
    const n = this._normalizeParams(params);
    return (n.length === 1 && typeof n[0] === 'object' && n[0] !== null && !Array.isArray(n[0]))
      ? stmt.get(n[0])
      : stmt.get(...n);
  }

  /**
   * Executes an INSERT, UPDATE, or DELETE statement.
   * @param {string} sql
   * @param {any[]|object} [params]
   * @returns {{ changes: number, lastInsertRowid: number|bigint }}
   */
  run(sql, params) {
    const stmt = this.db.prepare(sql);
    const n = this._normalizeParams(params);
    return (n.length === 1 && typeof n[0] === 'object' && n[0] !== null && !Array.isArray(n[0]))
      ? stmt.run(n[0])
      : stmt.run(...n);
  }

  /**
   * Executes multiple raw SQL statements without parameter binding (e.g. migrations or batch scripts).
   * @param {string} sql
   */
  exec(sql) {
    return this.db.exec(sql);
  }

  /**
   * Prepares a statement for direct execution.
   * @param {string} sql
   */
  prepare(sql) {
    return this.db.prepare(sql);
  }

  /**
   * Executes a synchronous callback within an immediate transaction.
   * Supports nested invocations via SQLite SAVEPOINT.
   * @template T
   * @param {function(DatabaseManager): T} fn
   * @returns {T}
   */
  transaction(fn) {
    const isTopLevel = this._txDepth === 0;
    const savepointName = `sp_${this._txDepth}`;
    this._txDepth++;

    if (isTopLevel) {
      this.db.exec('BEGIN IMMEDIATE;');
    } else {
      this.db.exec(`SAVEPOINT ${savepointName};`);
    }

    try {
      const result = fn(this);
      if (isTopLevel) {
        this.db.exec('COMMIT;');
      } else {
        this.db.exec(`RELEASE SAVEPOINT ${savepointName};`);
      }
      return result;
    } catch (err) {
      if (isTopLevel) {
        this.db.exec('ROLLBACK;');
      } else {
        this.db.exec(`ROLLBACK TO SAVEPOINT ${savepointName};`);
      }
      throw err;
    } finally {
      this._txDepth--;
    }
  }

  /**
   * Safely closes the database connection.
   */
  close() {
    if (this.db) {
      try {
        this.db.close();
      } catch (err) {
        // Silently tolerate if already closed
      }
      this.db = null;
    }
  }

  /**
   * Returns underlying node:sqlite DatabaseSync instance.
   */
  getRawDb() {
    return this.db;
  }
}

/**
 * Resolves the default database path according to environment variables and configuration.
 */
function resolveDbPath() {
  if (process.env.DATABASE_PATH) {
    return process.env.DATABASE_PATH;
  }
  if (process.env.NODE_ENV === 'test') {
    return ':memory:';
  }
  return path.join(__dirname, '../../data/spidersense.db');
}

/**
 * Initialize or reset the active singleton database instance.
 * @param {string} [dbPath]
 * @param {object} [options]
 * @returns {DatabaseManager}
 */
function initDatabase(dbPath, options = {}) {
  if (activeInstance) {
    activeInstance.close();
  }
  const targetPath = dbPath || resolveDbPath();
  activeInstance = new DatabaseManager(targetPath, options);
  return activeInstance;
}

/**
 * Retrieves the current database manager singleton, initializing lazily if needed.
 * @returns {DatabaseManager}
 */
function getDatabase() {
  if (!activeInstance) {
    initDatabase();
  }
  return activeInstance;
}

/**
 * Closes the active database singleton and cleans up references.
 */
function closeDatabase() {
  if (activeInstance) {
    activeInstance.close();
    activeInstance = null;
  }
}

// Convenient top-level query helper exports
const query = (sql, params) => getDatabase().query(sql, params);
const get = (sql, params) => getDatabase().get(sql, params);
const run = (sql, params) => getDatabase().run(sql, params);
const exec = (sql) => getDatabase().exec(sql);
const transaction = (fn) => getDatabase().transaction(fn);
const prepare = (sql) => getDatabase().prepare(sql);

module.exports = {
  DatabaseManager,
  initDatabase,
  getDatabase,
  closeDatabase,
  query,
  get,
  run,
  exec,
  transaction,
  prepare
};
```

---

### C. Test Integration Specification for `tests/helpers/testDb.js`

```javascript
'use strict';

const { initDatabase, closeDatabase, getDatabase } = require('../../src/db/database');

/**
 * Configures an isolated in-memory SQLite database instance populated with clean schema.
 */
function setupTestDb() {
  process.env.NODE_ENV = 'test';
  return initDatabase(':memory:');
}

/**
 * Closes the in-memory database instance.
 */
function teardownTestDb() {
  closeDatabase();
}

module.exports = {
  setupTestDb,
  teardownTestDb,
  getDatabase
};
```

---

## 5. Verification Method

To independently verify this specification:

1. **Verify DDL and Constraints**:
   Run the test script located at:
   `node "c:\Users\CHAITANYA SELOTE\OneDrive\Desktop\tcb_ml\.agents\teamwork\explorer_m1_1\test_ddl.js"`
   Expected output:
   - `SUCCESS: DDL applied cleanly.`
   - Insertion of users with roles `Hero` and `Citizen`.
   - Insertion of incident and status history records.
   - First claim succeeds (`changes: 1`), concurrent claim returns (`changes: 0`).
   - Deletion of incident cascades to 0 status_history records.
   - Severity > 5 and invalid roles throw `CHECK constraint failed`.

2. **Verify DatabaseManager Lifecycle, Normalization & Transactions**:
   Run:
   `node "c:\Users\CHAITANYA SELOTE\OneDrive\Desktop\tcb_ml\.agents\teamwork\explorer_m1_1\test_db_manager.js"`
   Expected output:
   - `Run res1: { changes: 1, lastInsertRowid: 1 }`
   - Successful query and single-row get.
   - Commits persist, rollbacks clean up uncommitted rows.

3. **Verify Atomic CAS Concurrency**:
   Run:
   `node "c:\Users\CHAITANYA SELOTE\OneDrive\Desktop\tcb_ml\.agents\teamwork\explorer_m1_1\test_cas.js"`
   Expected output:
   - Hero 1 claim succeeds.
   - Hero 2 claim fails with conflict (status already Claimed).

4. **Invalidation Conditions**:
   - If Node.js version is downgraded below v22.5.0 where `node:sqlite` is unavailable.
   - If SQLite foreign keys are not enabled via `PRAGMA foreign_keys = ON;`, cascades and relational integrity checks will be bypassed.
