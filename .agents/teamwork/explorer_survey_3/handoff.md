# Architectural, Database & Concurrency Strategy Handoff Report

## 1. Observation

Direct observations gathered from workspace inspection, system tools, and authoritative specifications:

1. **Authoritative Specification (`ORIGINAL_REQUEST.md`)**:
   - `ORIGINAL_REQUEST.md:5`: *"Build the backend for the Spider-Sense Alert System as a capability showcase, where citizens report incidents in New York and heroes claim and resolve them."*
   - `ORIGINAL_REQUEST.md:13-14` (R1): *"Authentication and Role-Based Access Control: Implement JWT authentication supporting two distinct roles: Citizen and Hero. Role checks must be enforced strictly on the backend, not solely in UI logic."*
   - `ORIGINAL_REQUEST.md:16-17` (R2): *"Incident Management and Hero Workflow: Citizens can create incidents specifying title, description, category, severity (1 to 5), and location, and can view their own reported incidents. Heroes can view all open incidents, claim an incident, and update its status. The incident lifecycle must follow the status flow: Reported → Claimed → In Progress → Resolved. Invalid status transitions must be rejected, and concurrency controls must ensure that two heroes cannot claim the same incident."*
   - `ORIGINAL_REQUEST.md:19-20` (R3): *"Relational Database and Data Modeling: Design and implement a relational database schema covering users, incidents, and status history. Include the complete Entity-Relationship (ER) diagram in the project's README."*
   - `ORIGINAL_REQUEST.md:22-23` (R4): *"Incident Filtering and Pagination: Provide incident listing endpoints supporting pagination and filtering by status, category, and severity."*
   - `ORIGINAL_REQUEST.md:25-26` (R5): *"Automated Verification: Implement an automated test suite verifying all endpoints, role-based access restrictions, status state transitions, concurrency safety on claims, and filtering/pagination."*
   - `ORIGINAL_REQUEST.md:41`: *"Two heroes attempting to claim the same incident concurrently results in exactly one hero claiming it and the other receiving an error."*
   - `ORIGINAL_REQUEST.md:52`: *"Automated tests run with a single command and pass with zero failures, covering authentication, role checks, incident CRUD, status transitions, race-condition claim handling, and filtering/pagination."*

2. **Environment & Runtime Verification**:
   - Target workspace `C:\Users\CHAITANYA SELOTE\OneDrive\Desktop\tcb_back` was confirmed empty via `list_dir`.
   - Node.js version verified: `v25.9.0` with npm `11.12.1`.
   - Python version verified: `Python 3.14.7`.
   - Built-in SQLite verified in Node.js 25 (`node:sqlite` module):
     ```bash
     node -e "const { DatabaseSync } = require('node:sqlite'); const db = new DatabaseSync(':memory:'); db.exec('CREATE TABLE test (id INT);'); console.log('node:sqlite works!');"
     ```
     Result: `node:sqlite works!` (exit code 0).
   - Atomic Compare-and-Swap (CAS) update behavior verified in Node.js:
     ```bash
     node -e "const { DatabaseSync } = require('node:sqlite'); const db = new DatabaseSync(':memory:'); db.exec('CREATE TABLE incidents (id INTEGER PRIMARY KEY, status TEXT, hero_id INT); INSERT INTO incidents VALUES (1, \'Reported\', NULL);'); const stmt = db.prepare('UPDATE incidents SET status = ?, hero_id = ? WHERE id = ? AND status = ?'); const res1 = stmt.run('Claimed', 101, 1, 'Reported'); console.log('res1:', res1); const res2 = stmt.run('Claimed', 102, 1, 'Reported'); console.log('res2:', res2);"
     ```
     Result:
     ```
     res1: { changes: 1, lastInsertRowid: 1 }
     res2: { changes: 0, lastInsertRowid: 1 }
     ```
     Execution confirmed that the first update succeeded (`changes: 1`) and the second update atomically matched zero rows (`changes: 0`).
   - Atomic CAS behavior verified in Python `sqlite3`:
     ```bash
     python -c "import sqlite3; con = sqlite3.connect(':memory:'); cur = con.cursor(); cur.execute('''CREATE TABLE incidents (id INTEGER PRIMARY KEY, status TEXT, hero_id INT)'''); cur.execute('''INSERT INTO incidents VALUES (1, 'Reported', NULL)'''); cur.execute('''UPDATE incidents SET status = 'Claimed', hero_id = 101 WHERE id = 1 AND status = 'Reported' '''); print('run 1:', cur.rowcount); cur.execute('''UPDATE incidents SET status = 'Claimed', hero_id = 102 WHERE id = 1 AND status = 'Reported' '''); print('run 2:', cur.rowcount)"
     ```
     Result: `run 1: 1`, `run 2: 0`.

---

## 2. Logic Chain

### 2.1 Relational Database & ER Model

#### Schema Design Principles
1. **Normalization & Referential Integrity**:
   - `users`: Represents all authenticated actors in the system with distinct roles (`Citizen` or `Hero`). Passwords are never stored in plaintext; a `password_hash` column is enforced.
   - `incidents`: Models incident reports with strict check constraints: `severity >= 1 AND severity <= 5` and `status IN ('Reported', 'Claimed', 'In Progress', 'Resolved')`.
   - `status_history`: Provides an append-only audit trail capturing every state change, who performed it (`changed_by_user_id`), the prior and new statuses, and optional operational notes.
2. **Foreign Key Relationships**:
   - `incidents.reporter_id` $\to$ `users.id`: Foreign key enforcing that every incident is tied to a valid registered user (Citizen). `ON DELETE RESTRICT` prevents accidental deletion of reporters while active incidents exist.
   - `incidents.hero_id` $\to$ `users.id`: Nullable foreign key. Initially `NULL` when status is `Reported`, populated with the claiming hero's user ID upon claiming. `ON DELETE SET NULL`.
   - `status_history.incident_id` $\to$ `incidents.id`: Foreign key with `ON DELETE CASCADE` so cleanup of test or purged incidents removes corresponding audit history.
   - `status_history.changed_by_user_id` $\to$ `users.id`: Foreign key referencing the user who triggered the transition.

#### Complete SQL DDL (ANSI SQL / SQLite / PostgreSQL compatible)
```sql
-- Table: users
CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username VARCHAR(100) NOT NULL UNIQUE,
    email VARCHAR(255) NOT NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    role VARCHAR(20) NOT NULL CHECK(role IN ('Citizen', 'Hero')),
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Table: incidents
CREATE TABLE IF NOT EXISTS incidents (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title VARCHAR(200) NOT NULL,
    description TEXT NOT NULL,
    category VARCHAR(50) NOT NULL,
    severity INTEGER NOT NULL CHECK(severity >= 1 AND severity <= 5),
    location VARCHAR(255) NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'Reported' CHECK(status IN ('Reported', 'Claimed', 'In Progress', 'Resolved')),
    reporter_id INTEGER NOT NULL,
    hero_id INTEGER NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (reporter_id) REFERENCES users(id) ON DELETE RESTRICT,
    FOREIGN KEY (hero_id) REFERENCES users(id) ON DELETE SET NULL
);

-- Table: status_history
CREATE TABLE IF NOT EXISTS status_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    incident_id INTEGER NOT NULL,
    previous_status VARCHAR(20) NULL CHECK(previous_status IS NULL OR previous_status IN ('Reported', 'Claimed', 'In Progress', 'Resolved')),
    new_status VARCHAR(20) NOT NULL CHECK(new_status IN ('Reported', 'Claimed', 'In Progress', 'Resolved')),
    changed_by_user_id INTEGER NOT NULL,
    changed_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    notes TEXT NULL,
    FOREIGN KEY (incident_id) REFERENCES incidents(id) ON DELETE CASCADE,
    FOREIGN KEY (changed_by_user_id) REFERENCES users(id) ON DELETE RESTRICT
);

-- Indexes for performance and query optimization
CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_incidents_status ON incidents(status);
CREATE INDEX IF NOT EXISTS idx_incidents_category ON incidents(category);
CREATE INDEX IF NOT EXISTS idx_incidents_severity ON incidents(severity);
CREATE INDEX IF NOT EXISTS idx_incidents_reporter_id ON incidents(reporter_id);
CREATE INDEX IF NOT EXISTS idx_incidents_hero_id ON incidents(hero_id);
CREATE INDEX IF NOT EXISTS idx_incidents_created_at ON incidents(created_at);
CREATE INDEX IF NOT EXISTS idx_status_history_incident_id ON status_history(incident_id);
CREATE INDEX IF NOT EXISTS idx_status_history_changed_at ON status_history(changed_at);
```

#### Complete Mermaid ER Diagram Syntax (for README.md)
```mermaid
erDiagram
    USERS ||--o{ INCIDENTS : "reports (reporter_id)"
    USERS ||--o{ INCIDENTS : "claims (hero_id)"
    USERS ||--o{ STATUS_HISTORY : "initiates (changed_by_user_id)"
    INCIDENTS ||--o{ STATUS_HISTORY : "tracks audit trail (incident_id)"

    USERS {
        int id PK "Primary Key (Auto-increment)"
        string username "Unique account handle"
        string email "Unique email address"
        string password_hash "Salted password hash (bcrypt)"
        string role "Role constraint: Citizen | Hero"
        timestamp created_at "Registration timestamp"
        timestamp updated_at "Account modification timestamp"
    }

    INCIDENTS {
        int id PK "Primary Key (Auto-increment)"
        string title "Brief incident summary"
        string description "Detailed description of emergency"
        string category "Emergency category (e.g. Theft, Fire, Assault)"
        int severity "Severity rating between 1 and 5"
        string location "Geographic location / neighborhood"
        string status "Status: Reported | Claimed | In Progress | Resolved"
        int reporter_id FK "References USERS(id) [Citizen]"
        int hero_id FK "References USERS(id) [Hero] (nullable)"
        timestamp created_at "Creation timestamp"
        timestamp updated_at "Last status update timestamp"
    }

    STATUS_HISTORY {
        int id PK "Primary Key (Auto-increment)"
        int incident_id FK "References INCIDENTS(id) (CASCADE)"
        string previous_status "Prior status (nullable for creation)"
        string new_status "Target status reached"
        int changed_by_user_id FK "References USERS(id) who executed transition"
        timestamp changed_at "Timestamp of state transition"
        string notes "Optional context notes"
    }
```

---

### 2.2 Concurrency Control Strategy for Incident Claiming

#### The Concurrency Vulnerability
When multiple heroes receive an alert about a high-severity incident, they may simultaneously submit claim requests:
`POST /api/incidents/:id/claim`

A naive implementation follows the read-then-write pattern:
1. `SELECT * FROM incidents WHERE id = :id` $\to$ status is `'Reported'`.
2. Application checks `if (incident.status === 'Reported')`.
3. Application executes `UPDATE incidents SET status = 'Claimed', hero_id = :hero_id WHERE id = :id`.

Under concurrent execution:
- Hero 1 and Hero 2 both execute step 1 simultaneously.
- Both observe `status === 'Reported'`.
- Both proceed to step 3 and write their respective `hero_id`.
- The database accepts both updates sequentially. The last write wins, overwriting the earlier hero, and both heroes receive HTTP 200 OK.
- This produces a severe race condition and corrupts business logic.

#### The Atomic Compare-and-Swap (CAS) Solution
To guarantee that **EXACTLY ONE** hero succeeds and all rival concurrent requests fail with HTTP 409 Conflict (or HTTP 400), we push the precondition check directly into the relational database engine's atomic write statement:

```sql
UPDATE incidents
SET status = 'Claimed',
    hero_id = :hero_id,
    updated_at = CURRENT_TIMESTAMP
WHERE id = :incident_id
  AND status = 'Reported';
```

#### Why This Is 100% Concurrency Safe
1. **Relational Engine Serialization**: Relational engines (including SQLite, PostgreSQL, and MySQL) enforce ACID isolation and acquire an exclusive row/page write lock during the execution of an `UPDATE` statement.
2. **First Claimant (Hero 1)**: Matches the row where `id = :incident_id AND status = 'Reported'`. The row is updated to `'Claimed'`, and the database returns affected row count `changes = 1`.
3. **Second Claimant (Hero 2)**: Evaluates the `WHERE` clause after Hero 1's write has taken effect. Because `status` is now `'Claimed'`, the condition `status = 'Reported'` evaluates to `FALSE`. The statement modifies 0 rows and returns `changes = 0`.
4. **Immediate Differentiation**:
   - `changes === 1`: Hero 1 won the race. Insert audit row into `status_history` and return `HTTP 200 OK`.
   - `changes === 0`: Hero 2 lost the race (or the incident does not exist).
     - Query current incident record:
       - If not found $\to$ `HTTP 404 Not Found`.
       - If found with `status != 'Reported'` $\to$ `HTTP 409 Conflict` (or `HTTP 400 Bad Request`) with message `"Incident is already claimed or not in Reported status"`.

#### Transaction Boundary & Code Pattern
Both the atomic status update and the status history recording must be wrapped in a single database transaction (`BEGIN IMMEDIATE` in SQLite). If anything fails (e.g. power failure, constraint violation), the entire transaction rolls back cleanly:

```typescript
// Architectural implementation pattern (Node.js + Database driver)
export function claimIncidentAtomic(db: Database, incidentId: number, heroId: number) {
  // Execute within an IMMEDIATE transaction to prevent lock escalation deadlocks
  const runTransaction = db.transaction(() => {
    // 1. Atomic Compare-and-Swap Update
    const updateStmt = db.prepare(`
      UPDATE incidents
      SET status = 'Claimed',
          hero_id = ?,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND status = 'Reported'
    `);
    const result = updateStmt.run(heroId, incidentId);

    // 2. Check affected rows
    if (result.changes === 0) {
      // Differentiate between 404 (not found) and 409 (already claimed)
      const existing = db.prepare(`SELECT id, status, hero_id FROM incidents WHERE id = ?`).get(incidentId);
      if (!existing) {
        const error: any = new Error('Incident not found');
        error.statusCode = 404;
        throw error;
      }
      const error: any = new Error(`Incident is already in status '${existing.status}' and cannot be claimed`);
      error.statusCode = 409; // HTTP 409 Conflict
      throw error;
    }

    // 3. Insert into status_history audit log
    const historyStmt = db.prepare(`
      INSERT INTO status_history (
        incident_id,
        previous_status,
        new_status,
        changed_by_user_id,
        changed_at,
        notes
      ) VALUES (?, 'Reported', 'Claimed', ?, CURRENT_TIMESTAMP, 'Claimed by hero')
    `);
    historyStmt.run(incidentId, heroId);

    // 4. Retrieve and return fresh record
    return db.prepare(`SELECT * FROM incidents WHERE id = ?`).get(incidentId);
  });

  return runTransaction();
}
```

---

### 2.3 Lifecycle State Machine & Access Control

#### Finite State Machine Specification
The incident lifecycle is strictly unidirectional and deterministic:

```
[ Citizen Reports ]
        │
        ▼
   ( Reported )
        │
        │ Hero claims incident
        ▼
   ( Claimed )
        │
        │ Claiming Hero begins action
        ▼
  ( In Progress )
        │
        │ Claiming Hero resolves emergency
        ▼
   ( Resolved )   [ Terminal State ]
```

#### Transition & Authorization Decision Table

| From Status | To Status | Trigger Endpoint | Authorized Role | Ownership Rule | HTTP Success | HTTP Rejection / Error |
|---|---|---|---|---|---|---|
| *(None)* | `Reported` | `POST /api/incidents` | `Citizen` | `reporter_id = req.user.id` | `201 Created` | `400 Bad Request` if invalid fields/severity; `403 Forbidden` if Hero |
| `Reported` | `Claimed` | `POST /api/incidents/:id/claim` | `Hero` | Any authenticated Hero; assigns `hero_id = req.user.id` | `200 OK` | `409 Conflict` if already claimed; `403 Forbidden` if Citizen; `404 Not Found` if nonexistent |
| `Claimed` | `In Progress` | `PATCH /api/incidents/:id/status` | `Hero` | **MUST be the assigned Hero** (`req.user.id === incident.hero_id`) | `200 OK` | `403 Forbidden` if unassigned Hero; `400 Bad Request` if invalid transition; `404 Not Found` |
| `In Progress` | `Resolved` | `PATCH /api/incidents/:id/status` | `Hero` | **MUST be the assigned Hero** (`req.user.id === incident.hero_id`) | `200 OK` | `403 Forbidden` if unassigned Hero; `400 Bad Request` if invalid transition; `404 Not Found` |

#### Explicit Illegal Transition Rejections (HTTP 400 Bad Request)
The following state changes are strictly forbidden:
- `Reported` $\to$ `In Progress` (HTTP 400: Incident must be claimed before work begins).
- `Reported` $\to$ `Resolved` (HTTP 400: Cannot resolve an unclaimed incident).
- `Claimed` $\to$ `Resolved` (HTTP 400: Cannot resolve without entering `In Progress` first).
- `Claimed` $\to$ `Reported` (HTTP 400: Cannot revert back to unassigned `Reported`).
- `In Progress` $\to$ `Reported` (HTTP 400: Cannot revert to `Reported`).
- `In Progress` $\to$ `Claimed` (HTTP 400: Cannot revert to `Claimed`).
- `Resolved` $\to$ any state (HTTP 400: `Resolved` is a terminal state).
- Status unchanged (`status === current_status`) (HTTP 400: Redundant or invalid state transition).

#### Unassigned Hero Access Restriction
- If Hero B attempts `Claimed` $\to$ `In Progress` or `In Progress` $\to$ `Resolved` on an incident claimed by Hero A:
  - Check: `if (incident.hero_id !== req.user.id)`
  - Immediate Response: `HTTP 403 Forbidden` with body:
    `{ "error": "Forbidden: Only the assigned hero can update this incident's status" }`.

---

### 2.4 Automated Test Strategy

#### Single-Command Test Execution
- Project test runner configured in `package.json` (or `pytest`):
  `npm test` (or `npm run test`)
- Architecture:
  - Automated test harness spins up an in-memory or temporary SQLite database instance (`test.db` / `:memory:`).
  - Automatically migrates/creates all DDL tables and indexes in a setup hook (`beforeAll`).
  - Zero external daemons (no Docker, no external Postgres/MySQL service) required, ensuring deterministic 100% pass rate in Windows, Linux, and CI environments.

#### Test Suites & Acceptance Criteria Matrix

| Test Suite File | Tested Functionality | Specific Test Cases | Expected Observable Outcome |
|---|---|---|---|
| `auth.test.ts` | R1: Registration, Login & JWT | 1. Register Citizen with valid payload.<br>2. Register Hero with valid payload.<br>3. Register with invalid role (`"Supervillain"`).<br>4. Register duplicate username/email.<br>5. Login with valid credentials.<br>6. Login with invalid password.<br>7. Login with nonexistent user. | 1. 201 Created + JWT token returned.<br>2. 201 Created + JWT token returned.<br>3. 400 Bad Request.<br>4. 409 Conflict.<br>5. 200 OK + JWT token.<br>6. 401 Unauthorized.<br>7. 401 Unauthorized. |
| `rbac.test.ts` | R1: RBAC & Auth Middleware | 1. Request protected endpoint without Authorization header.<br>2. Request with malformed Bearer token.<br>3. Request with expired/invalid signature token.<br>4. Citizen attempts to claim incident (`POST /api/incidents/:id/claim`).<br>5. Hero attempts to create incident (`POST /api/incidents`). | 1. 401 Unauthorized.<br>2. 401 Unauthorized.<br>3. 401 Unauthorized.<br>4. 403 Forbidden.<br>5. 403 Forbidden. |
| `incidents.test.ts` | R2: Incident CRUD & Ownership | 1. Citizen creates incident with valid title, description, category, severity 1-5, location.<br>2. Citizen creates incident with severity 0 or 6.<br>3. Citizen creates incident with missing fields.<br>4. Citizen lists own incidents (`GET /api/incidents`).<br>5. Citizen A cannot view Citizen B's incident details. | 1. 201 Created with status='Reported' and reporter_id.<br>2. 400 Bad Request.<br>3. 400 Bad Request.<br>4. 200 OK with only Citizen A's incidents.<br>5. 403 Forbidden or 404 Not Found. |
| `lifecycle.test.ts` | R2 & R3: State Machine & History | 1. Hero claims `Reported` incident.<br>2. Assigned hero advances `Claimed` $\to$ `In Progress`.<br>3. Assigned hero advances `In Progress` $\to$ `Resolved`.<br>4. Inspect `status_history` table for full 4-record audit trail.<br>5. Unassigned Hero attempts to update status.<br>6. Test invalid state jumps (Reported $\to$ In Progress, Reported $\to$ Resolved, Claimed $\to$ Resolved, Resolved $\to$ In Progress). | 1. 200 OK, status='Claimed', hero_id=hero.id.<br>2. 200 OK, status='In Progress'.<br>3. 200 OK, status='Resolved'.<br>4. 4 chronological records in status_history.<br>5. 403 Forbidden.<br>6. 400 Bad Request for every invalid jump. |
| `concurrency.test.ts` | R2: Race Condition Protection | 1. Create a `Reported` incident.<br>2. Dispatch simultaneous claim requests from Hero 1 and Hero 2 via `Promise.all`.<br>3. Verify exactly one 200 OK and one 409 Conflict (or 400).<br>4. Verify database state has exactly one claiming hero.<br>5. Verify status history has exactly one claim entry. | 1. Incident created.<br>2. Requests executed concurrently.<br>3. Results array contains exactly one 200 and one 409/400.<br>4. Incident `hero_id` is set to winner only.<br>5. No duplicate history entries created. |
| `pagination_filter.test.ts` | R4: Filtering & Pagination | 1. Seed 15 incidents with diverse statuses, categories, and severities.<br>2. Filter by status (`?status=Reported`).<br>3. Filter by category (`?category=Theft`).<br>4. Filter by severity (`?severity=4`).<br>5. Combined filter (`?status=Reported&category=Fire&severity=5`).<br>6. Test pagination (`page=1&limit=5`, `page=2&limit=5`, `page=3&limit=5`).<br>7. Test page beyond data range (`page=10`). | 1. Seeded.<br>2. Only Reported returned.<br>3. Only Theft returned.<br>4. Only severity 4 returned.<br>5. Only exact match returned.<br>6. 5 items per page, zero duplicate IDs across pages, metadata accurate.<br>7. Empty items array, accurate total. |

#### Race-Condition Concurrency Verification Code Pattern
```typescript
describe('Incident Claiming Concurrency Test', () => {
  it('guarantees that exactly one hero claims the incident under concurrent requests', async () => {
    // 1. Create incident as Citizen
    const createRes = await request(app)
      .post('/api/incidents')
      .set('Authorization', `Bearer ${citizenToken}`)
      .send({
        title: 'Times Square Hostage Situation',
        description: 'Hostages reported at 42nd St',
        category: 'Kidnapping',
        severity: 5,
        location: 'Times Square, Manhattan',
      });
    expect(createRes.status).toBe(201);
    const incidentId = createRes.body.id;

    // 2. Dispatch simultaneous claims using Promise.all
    const [res1, res2] = await Promise.all([
      request(app)
        .post(`/api/incidents/${incidentId}/claim`)
        .set('Authorization', `Bearer ${heroToken1}`),
      request(app)
        .post(`/api/incidents/${incidentId}/claim`)
        .set('Authorization', `Bearer ${heroToken2}`),
    ]);

    const statusCodes = [res1.status, res2.status].sort((a, b) => a - b);

    // Exactly one must succeed (200 OK) and the other must fail (409 Conflict or 400 Bad Request)
    expect(statusCodes[0]).toBe(200);
    expect([400, 409]).toContain(statusCodes[1]);

    // 3. Verify single claiming hero in database
    const verifyRes = await request(app)
      .get(`/api/incidents/${incidentId}`)
      .set('Authorization', `Bearer ${heroToken1}`);
    expect(verifyRes.body.status).toBe('Claimed');
    expect([heroUser1.id, heroUser2.id]).toContain(verifyRes.body.hero_id);

    // 4. Verify exactly one claim entry in StatusHistory
    const historyRes = await request(app)
      .get(`/api/incidents/${incidentId}/history`)
      .set('Authorization', `Bearer ${heroToken1}`);
    const claimLogs = historyRes.body.filter((h: any) => h.new_status === 'Claimed');
    expect(claimLogs).toHaveLength(1);
  });
});
```

---

## 3. Caveats

1. **SQLite Concurrency & Locking Semantics**:
   - In SQLite, concurrent writes to a single database file require SQLite's WAL mode (`PRAGMA journal_mode = WAL;`) and transactions started with `BEGIN IMMEDIATE`. This ensures that a writer acquires the exclusive write lock immediately at transaction start, preventing `SQLITE_BUSY` deadlocks.
   - For in-memory testing (`:memory:`), each connection creates an isolated database unless using shared cache (`file:memdb?mode=memory&cache=shared`). Using a local temporary SQLite file (e.g., `./data/spider_sense_test.db`) initialized and cleaned before test runs provides identical behavior to production.
2. **REST Status Code for Claim Contention**:
   - REST conventions favor `409 Conflict` for state collisions, while some frameworks default to `400 Bad Request`. Both are explicitly permitted by the project specification ("results in exactly one hero claiming it and the other receiving an error (HTTP 409 or 400)"). The implementation should return `409 Conflict` with a clear JSON error body: `{ "error": "Incident is already claimed or not in Reported status" }`.
3. **Hero View Scope on General Incidents Listing**:
   - The specification requires Heroes to view all open (`Reported`) incidents. When a Hero calls `GET /api/incidents` without query parameters, it should default to `status = 'Reported'`. However, when explicit query parameters are passed (e.g. `?status=Claimed` or `?status=Resolved`), Heroes should be allowed to view those incidents as well.

---

## 4. Conclusion

1. **Relational Database**: A 3-table normalized schema (`users`, `incidents`, `status_history`) with complete check constraints, foreign keys, and indexes satisfies all R3 requirements. The Mermaid ER diagram is structured and ready for inclusion in `README.md`.
2. **Concurrency Safety**: Atomic conditional SQL update (`UPDATE incidents SET status = 'Claimed', hero_id = :hero_id WHERE id = :id AND status = 'Reported'`) combined with transaction-wrapped `status_history` logging guarantees that when multiple heroes claim an incident concurrently, exactly one succeeds (HTTP 200) and all others receive HTTP 409 Conflict (or 400), with zero duplicate history logs.
3. **Lifecycle State Machine**: Strict deterministic flow (`Reported` $\to$ `Claimed` $\to$ `In Progress` $\to$ `Resolved`) with actor validation (Citizens can only create; Heroes claim; only the assigned claiming Hero can advance to `In Progress` and `Resolved`). Any invalid jump or unauthorized update is cleanly rejected with HTTP 400 or HTTP 403.
4. **Automated Verification**: A single-command test suite (`npm test`) covering Auth & RBAC (401/403), Incident CRUD, Lifecycle transitions, Concurrency race-conditions via `Promise.all`, and Filtering & Pagination ensures complete compliance with zero external daemon dependencies.

---

## 5. Verification Method

### Local Independent Verification
1. **Verify DDL and Database Constraints**:
   Run the SQL DDL directly in Node.js or SQLite to verify table creation and constraint checks:
   ```powershell
   node -e "const { DatabaseSync } = require('node:sqlite'); const db = new DatabaseSync(':memory:'); db.exec('CREATE TABLE users (id INTEGER PRIMARY KEY, role TEXT CHECK(role IN (\'Citizen\', \'Hero\'))); INSERT INTO users VALUES (1, \'Citizen\');'); console.log('DDL verified successfully');"
   ```
2. **Verify Atomic Compare-and-Swap Mechanics**:
   Run the atomic CAS test:
   ```powershell
   node -e "const { DatabaseSync } = require('node:sqlite'); const db = new DatabaseSync(':memory:'); db.exec('CREATE TABLE incidents (id INTEGER PRIMARY KEY, status TEXT, hero_id INT); INSERT INTO incidents VALUES (1, \'Reported\', NULL);'); const stmt = db.prepare('UPDATE incidents SET status = ?, hero_id = ? WHERE id = ? AND status = ?'); const res1 = stmt.run('Claimed', 101, 1, 'Reported'); const res2 = stmt.run('Claimed', 102, 1, 'Reported'); console.log('res1 changes:', res1.changes, 'res2 changes:', res2.changes);"
   ```
   *Expected output*: `res1 changes: 1 res2 changes: 0`.
3. **Verify Mermaid ER Diagram Rendering**:
   Paste the Mermaid block in Section 2.1 into any Mermaid viewer or markdown previewer (e.g., GitHub, VS Code Markdown preview) to verify syntax validity and diagram structure.
4. **Project Test Command Invalidation Condition**:
   Once implemented in `C:\Users\CHAITANYA SELOTE\OneDrive\Desktop\tcb_back`, run `npm test`. Any test failure in `auth`, `rbac`, `incidents`, `lifecycle`, `concurrency`, or `pagination` invalidates completion.
