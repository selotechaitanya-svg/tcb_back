const { DatabaseSync } = require('node:sqlite');
const fs = require('node:fs');
const path = require('node:path');

let activeInstance = null;

class DatabaseManager {
  constructor(dbPath = ':memory:', options = {}) {
    this.dbPath = dbPath;
    this.options = options;
    this.db = null;
    this._txDepth = 0;
    this.init();
  }

  init() {
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

    if (this.options.schemaSql) {
      this.db.exec(this.options.schemaSql);
    }
  }

  _normalize(params) {
    if (params === undefined || params === null) return [];
    if (Array.isArray(params)) return params;
    return [params];
  }

  query(sql, params) {
    const stmt = this.db.prepare(sql);
    const n = this._normalize(params);
    return (n.length === 1 && typeof n[0] === 'object' && n[0] !== null && !Array.isArray(n[0]))
      ? stmt.all(n[0])
      : stmt.all(...n);
  }

  get(sql, params) {
    const stmt = this.db.prepare(sql);
    const n = this._normalize(params);
    return (n.length === 1 && typeof n[0] === 'object' && n[0] !== null && !Array.isArray(n[0]))
      ? stmt.get(n[0])
      : stmt.get(...n);
  }

  run(sql, params) {
    const stmt = this.db.prepare(sql);
    const n = this._normalize(params);
    return (n.length === 1 && typeof n[0] === 'object' && n[0] !== null && !Array.isArray(n[0]))
      ? stmt.run(n[0])
      : stmt.run(...n);
  }

  exec(sql) {
    return this.db.exec(sql);
  }

  transaction(fn) {
    const isTopLevel = this._txDepth === 0;
    const sp = `sp_${this._txDepth}`;
    this._txDepth++;

    if (isTopLevel) {
      this.db.exec('BEGIN IMMEDIATE;');
    } else {
      this.db.exec(`SAVEPOINT ${sp};`);
    }

    try {
      const res = fn(this);
      if (isTopLevel) {
        this.db.exec('COMMIT;');
      } else {
        this.db.exec(`RELEASE SAVEPOINT ${sp};`);
      }
      return res;
    } catch (e) {
      if (isTopLevel) {
        this.db.exec('ROLLBACK;');
      } else {
        this.db.exec(`ROLLBACK TO SAVEPOINT ${sp};`);
      }
      throw e;
    } finally {
      this._txDepth--;
    }
  }

  close() {
    if (this.db) {
      try {
        this.db.close();
      } catch (e) {
        // Ignore if already closed
      }
      this.db = null;
    }
  }
}

function initDatabase(dbPath = ':memory:', options = {}) {
  if (activeInstance) {
    activeInstance.close();
  }
  activeInstance = new DatabaseManager(dbPath, options);
  return activeInstance;
}

function getDatabase() {
  if (!activeInstance) {
    initDatabase();
  }
  return activeInstance;
}

function closeDatabase() {
  if (activeInstance) {
    activeInstance.close();
    activeInstance = null;
  }
}

// Module-level proxy helper functions
const query = (sql, params) => getDatabase().query(sql, params);
const get = (sql, params) => getDatabase().get(sql, params);
const run = (sql, params) => getDatabase().run(sql, params);
const exec = (sql) => getDatabase().exec(sql);
const transaction = (fn) => getDatabase().transaction(fn);

// Self-test
initDatabase(':memory:', {
  schemaSql: 'CREATE TABLE test (id INTEGER PRIMARY KEY, msg TEXT);'
});
run('INSERT INTO test (msg) VALUES (?)', ['Hello Node 25 SQLite']);
console.log('Result:', get('SELECT * FROM test'));
closeDatabase();
console.log('Lazy reinit test:');
exec('CREATE TABLE test2 (id INTEGER PRIMARY KEY);');
console.log('Lazy init created db:', getDatabase().dbPath);
closeDatabase();
