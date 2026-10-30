'use strict';

const path = require('node:path');
const { initDatabase, getDatabase, closeDatabase } = require('../../src/db/database');

const schemaPath = path.resolve(__dirname, '../../src/db/schema.sql');

/**
 * Initializes a clean in-memory SQLite database and applies full DDL schema migrations.
 * Replaces any existing singleton database instance.
 * @returns {DatabaseManager} Active test database instance
 */
function setupTestDb() {
  process.env.NODE_ENV = 'test';
  return initDatabase(':memory:', { schemaPath });
}

/**
 * Clears all table records between individual test runs while preserving schemas.
 * Deletion order respects foreign-key constraints: status_history -> incidents -> users.
 */
function resetTestDb() {
  const db = getDatabase();
  db.exec(`
    DELETE FROM status_history;
    DELETE FROM incidents;
    DELETE FROM users;
  `);
}

/**
 * Closes the active database connection and nullifies the singleton instance.
 */
function teardownTestDb() {
  closeDatabase();
}

module.exports = {
  setupTestDb,
  resetTestDb,
  teardownTestDb,
  getDatabase
};
