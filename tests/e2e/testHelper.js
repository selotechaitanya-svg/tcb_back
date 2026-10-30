/**
 * E2E Test Helper for Spider-Sense Alert System Backend
 *
 * Provides application loading, supertest integration (with zero-dependency fallback),
 * database reset hooks, and common testing utilities.
 */

process.env.NODE_ENV = 'test';

const http = require('node:http');
const assert = require('node:assert/strict');

let supertestModule = null;
try {
  supertestModule = require('supertest');
} catch (e) {
  // supertest not yet installed in node_modules, fallback will be used
}

/**
 * Lazily loads Express app from src/app
 */
function getApp() {
  try {
    return require('../../src/app');
  } catch (err) {
    throw new Error(
      `Could not load Express app from src/app: ${err.message}. Ensure implementation exists before running tests.`
    );
  }
}

/**
 * Resets the SQLite database tables between test suites
 */
function resetDb() {
  try {
    const dbModule = require('../../src/db/database');
    const db = typeof dbModule.getDb === 'function' ? dbModule.getDb() : (dbModule.db || dbModule);
    if (db && typeof db.exec === 'function') {
      try {
        db.exec('PRAGMA foreign_keys = OFF;');
        db.exec('DELETE FROM status_history;');
        db.exec('DELETE FROM incidents;');
        db.exec('DELETE FROM users;');
        db.exec('PRAGMA foreign_keys = ON;');
      } catch (err) {
        // Tables might not exist yet if schema hasn't run
      }
    }
  } catch (err) {
    // Database module may not be present yet during initial test writing
  }
}

/**
 * Native Node.js supertest shim when supertest package is not installed.
 * Perfectly mimics supertest(app).method(path).set().send().expect()
 */
class RequestBuilder {
  constructor(app, method, urlPath) {
    this.app = app;
    this.method = method.toUpperCase();
    this.urlPath = urlPath;
    this.headers = {};
    this.bodyData = null;
    this.expectedStatus = null;
  }

  set(headerOrObj, value) {
    if (typeof headerOrObj === 'object' && headerOrObj !== null) {
      for (const [k, v] of Object.entries(headerOrObj)) {
        this.headers[k.toLowerCase()] = String(v);
      }
    } else if (typeof headerOrObj === 'string') {
      this.headers[headerOrObj.toLowerCase()] = String(value);
    }
    return this;
  }

  send(data) {
    this.bodyData = data;
    if (data !== undefined && !this.headers['content-type']) {
      this.headers['content-type'] = 'application/json';
    }
    return this;
  }

  expect(statusOrFn) {
    if (typeof statusOrFn === 'number') {
      this.expectedStatus = statusOrFn;
    }
    return this;
  }

  async then(resolve, reject) {
    try {
      const response = await this._execute();
      if (this.expectedStatus !== null && response.status !== this.expectedStatus) {
        const errorMsg = `Expected status ${this.expectedStatus} but received ${response.status}. Body: ${JSON.stringify(response.body)}`;
        const err = new Error(errorMsg);
        err.status = response.status;
        err.response = response;
        if (reject) return reject(err);
        throw err;
      }
      return resolve ? resolve(response) : response;
    } catch (err) {
      if (reject) return reject(err);
      throw err;
    }
  }

  _execute() {
    return new Promise((resolve, reject) => {
      // Determine if app is already a running server or request listener
      const server = http.createServer(this.app);
      server.listen(0, '127.0.0.1', async () => {
        const address = server.address();
        const port = address.port;
        const targetUrl = `http://127.0.0.1:${port}${this.urlPath}`;

        try {
          const fetchOptions = {
            method: this.method,
            headers: { ...this.headers },
          };

          if (this.bodyData !== null && this.bodyData !== undefined) {
            fetchOptions.body =
              typeof this.bodyData === 'string'
                ? this.bodyData
                : JSON.stringify(this.bodyData);
          }

          const res = await fetch(targetUrl, fetchOptions);
          const rawText = await res.text();
          let parsedBody = rawText;
          try {
            parsedBody = JSON.parse(rawText);
          } catch (e) {
            // Keep as string if not JSON
          }

          const responseObj = {
            status: res.status,
            statusCode: res.status,
            ok: res.ok,
            headers: Object.fromEntries(res.headers.entries()),
            text: rawText,
            body: parsedBody,
          };

          server.close(() => resolve(responseObj));
        } catch (err) {
          server.close(() => reject(err));
        }
      });

      server.on('error', (err) => {
        reject(err);
      });
    });
  }
}

/**
 * Supertest-compatible request wrapper
 */
function request(appInstance) {
  const targetApp = appInstance || getApp();

  if (supertestModule) {
    return supertestModule(targetApp);
  }

  return {
    get: (path) => new RequestBuilder(targetApp, 'GET', path),
    post: (path) => new RequestBuilder(targetApp, 'POST', path),
    put: (path) => new RequestBuilder(targetApp, 'PUT', path),
    patch: (path) => new RequestBuilder(targetApp, 'PATCH', path),
    delete: (path) => new RequestBuilder(targetApp, 'DELETE', path),
  };
}

module.exports = {
  getApp,
  request,
  resetDb,
  assert,
};
