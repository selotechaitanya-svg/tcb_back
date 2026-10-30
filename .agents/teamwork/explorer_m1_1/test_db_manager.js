const { DatabaseSync } = require('node:sqlite');
const fs = require('node:fs');
const path = require('node:path');

class DatabaseManager {
  constructor(dbPath = ':memory:', options = {}) {
    this.dbPath = dbPath;
    this.options = options;
    this.db = null;
    this._txDepth = 0;
    this._init();
  }

  _init() {
    if (this.dbPath !== ':memory:') {
      const dir = path.dirname(path.resolve(this.dbPath));
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
    }

    this.db = new DatabaseSync(this.dbPath);

    // Pragmas
    this.db.exec('PRAGMA foreign_keys = ON;');
    this.db.exec('PRAGMA busy_timeout = 5000;');

    if (this.dbPath !== ':memory:') {
      this.db.exec('PRAGMA journal_mode = WAL;');
      this.db.exec('PRAGMA synchronous = NORMAL;');
    }

    if (this.options.schemaPath) {
      const schemaSql = fs.readFileSync(this.options.schemaPath, 'utf8');
      this.db.exec(schemaSql);
    } else if (this.options.schemaSql) {
      this.db.exec(this.options.schemaSql);
    }
  }

  _normalizeParams(params) {
    if (params === undefined || params === null) {
      return [];
    }
    if (Array.isArray(params)) {
      return params;
    }
    // If it's an object (and not Array), node:sqlite accepts it as single arg for named parameters
    return [params];
  }

  query(sql, params) {
    const stmt = this.db.prepare(sql);
    const normalized = this._normalizeParams(params);
    if (normalized.length === 1 && typeof normalized[0] === 'object' && normalized[0] !== null && !Array.isArray(normalized[0])) {
      return stmt.all(normalized[0]);
    }
    return stmt.all(...normalized);
  }

  get(sql, params) {
    const stmt = this.db.prepare(sql);
    const normalized = this._normalizeParams(params);
    if (normalized.length === 1 && typeof normalized[0] === 'object' && normalized[0] !== null && !Array.isArray(normalized[0])) {
      return stmt.get(normalized[0]);
    }
    return stmt.get(...normalized);
  }

  run(sql, params) {
    const stmt = this.db.prepare(sql);
    const normalized = this._normalizeParams(params);
    if (normalized.length === 1 && typeof normalized[0] === 'object' && normalized[0] !== null && !Array.isArray(normalized[0])) {
      return stmt.run(normalized[0]);
    }
    return stmt.run(...normalized);
  }

  exec(sql) {
    return this.db.exec(sql);
  }

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

  close() {
    if (this.db) {
      this.db.close();
      this.db = null;
    }
  }

  getRawDb() {
    return this.db;
  }
}

// Test DatabaseManager
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
`;

const manager = new DatabaseManager(':memory:', { schemaSql });

// Test run with array
const res1 = manager.run('INSERT INTO users (username, email, password_hash, role) VALUES (?, ?, ?, ?)', [
  'spiderman',
  'spidey@queens.ny',
  'secret123',
  'Hero'
]);
console.log('Run res1:', res1);

// Test run with named parameters object
const res2 = manager.run('INSERT INTO users (username, email, password_hash, role) VALUES (:username, :email, :password_hash, :role)', {
  username: 'peter_parker',
  email: 'peter@ny.com',
  password_hash: 'secret456',
  role: 'Citizen'
});
console.log('Run res2:', res2);

// Test get
const user = manager.get('SELECT * FROM users WHERE id = ?', [res1.lastInsertRowid]);
console.log('Get user:', user);

// Test query
const allUsers = manager.query('SELECT * FROM users ORDER BY id ASC');
console.log('Query all users:', allUsers.length);

// Test transaction success
manager.transaction((dm) => {
  dm.run('INSERT INTO users (username, email, password_hash, role) VALUES (?, ?, ?, ?)', ['mj', 'mj@ny.com', 'pwd', 'Citizen']);
  dm.run('INSERT INTO users (username, email, password_hash, role) VALUES (?, ?, ?, ?)', ['ned', 'ned@ny.com', 'pwd', 'Citizen']);
});
console.log('Users after successful transaction:', manager.query('SELECT * FROM users').length);

// Test transaction rollback on error
try {
  manager.transaction((dm) => {
    dm.run('INSERT INTO users (username, email, password_hash, role) VALUES (?, ?, ?, ?)', ['gwen', 'gwen@ny.com', 'pwd', 'Citizen']);
    throw new Error('Transaction abort test');
  });
} catch (e) {
  console.log('Caught transaction error as expected:', e.message);
}
const gwen = manager.get('SELECT * FROM users WHERE username = ?', ['gwen']);
console.log('Gwen exists after rollback?', gwen !== undefined);

manager.close();
console.log('DatabaseManager test complete!');
