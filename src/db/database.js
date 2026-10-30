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
      try {
        const dir = path.dirname(path.resolve(this.dbPath));
        if (!fs.existsSync(dir)) {
          fs.mkdirSync(dir, { recursive: true });
        }
      } catch (err) {
        console.warn('[SQLite] Readonly filesystem detected, switching to in-memory mode:', err.message);
        this.dbPath = ':memory:';
      }
    }

    try {
      this.db = new DatabaseSync(this.dbPath);
    } catch (err) {
      console.warn('[SQLite] Initialization failed, falling back to :memory:', err.message);
      this.dbPath = ':memory:';
      this.db = new DatabaseSync(':memory:');
    }

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
    let rolledBack = false;

    if (isTopLevel) {
      this.db.exec('BEGIN IMMEDIATE;');
    } else {
      this.db.exec(`SAVEPOINT ${savepointName};`);
    }

    try {
      const result = fn(this);

      // Guard: Detect if an async function or Promise/thenable was returned
      if (result !== null && typeof result === 'object' && typeof result.then === 'function') {
        if (typeof result.catch === 'function') {
          result.catch(() => {});
        }
        if (isTopLevel) {
          this.db.exec('ROLLBACK;');
        } else {
          this.db.exec(`ROLLBACK TO SAVEPOINT ${savepointName};`);
        }
        rolledBack = true;
        throw new Error(
          'DatabaseSync transaction() callback must be synchronous; async callbacks are not supported because node:sqlite is synchronous. Perform async operations outside the transaction.'
        );
      }

      if (isTopLevel) {
        this.db.exec('COMMIT;');
      } else {
        this.db.exec(`RELEASE SAVEPOINT ${savepointName};`);
      }
      return result;
    } catch (err) {
      if (!rolledBack) {
        if (isTopLevel) {
          this.db.exec('ROLLBACK;');
        } else {
          this.db.exec(`ROLLBACK TO SAVEPOINT ${savepointName};`);
        }
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
  if (process.env.NODE_ENV === 'test' || process.env.VERCEL) {
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
  getDb: getDatabase,
  closeDatabase,
  query,
  get,
  run,
  exec,
  transaction,
  prepare
};
