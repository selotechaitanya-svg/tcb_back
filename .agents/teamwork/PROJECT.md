# Project: Spider-Sense Alert System Backend

## Architecture
The Spider-Sense Alert System is a mission-critical backend service enabling citizens of New York to report emergencies and superheroes to claim and resolve them in real time.
- **Runtime**: Node.js v25.9.0 with Express.js.
- **Database Engine**: Built-in `node:sqlite` (`DatabaseSync`), running in-memory (`:memory:`) during automated test execution for zero-daemon operation and immunity to Windows/OneDrive file locks, with WAL mode support for disk-persisted operation (`data/spidersense.db`).
- **Security & RBAC**: Pure JavaScript `jsonwebtoken` for signed Bearer tokens and `bcryptjs` for salted password hashing. Strict backend route guards enforcing `Citizen` and `Hero` roles.
- **Concurrency & State Machine**: Atomic SQL Compare-and-Swap (`UPDATE ... WHERE id = :id AND status = 'Reported'`) ensuring exactly one hero claims an incident during race conditions, accompanied by an append-only audit trail in `status_history`.
- **Testing Architecture**: Automated test suite powered by `node:test` + `supertest`, executable via single command `npm test` with 0 external service dependencies.

## Feature Inventory
| # | Feature | Description | Milestone | Source |
|---|---------|-------------|-----------|--------|
| 1 | DB Schema & Constraints | Relational DDL for `users`, `incidents`, `status_history` with foreign keys, checks, cascades, indexes | M1 | Survey (R3) |
| 2 | User Registration | Registration endpoint supporting `Citizen` and `Hero` roles with salted password hashing | M1 | Survey (R1) |
| 3 | User Login & JWT | Authentication endpoint validating credentials and issuing signed JWT containing user ID and role | M1 | Survey (R1) |
| 4 | Token Authentication Middleware | Validates Bearer token on protected routes, returning 401 for missing/invalid/expired tokens | M1 | Survey (R1) |
| 5 | Role-Based Access Control (RBAC) | Route-level role enforcement returning 403 Forbidden when role does not match required permission | M1 | Survey (R1) |
| 6 | Incident Creation | Citizen endpoint to create incident with title, description, category, severity (1-5), and location | M2 | Survey (R2) |
| 7 | Incident Validation | Enforce non-empty fields, valid category, and severity between 1 and 5, returning 400 Bad Request | M2 | Survey (R2) |
| 8 | Citizen Incident Scoping | Citizens can retrieve only their own reported incidents; cannot view others' reports (403/404) | M2 | Survey (R2) |
| 9 | Hero Open Incident Visibility | Heroes can view all open (`Reported`) incidents by default | M2 | Survey (R2) |
| 10 | Incident Details & History | Endpoint to fetch full incident record including complete chronological status history audit trail | M2 | Survey (R2, R3) |
| 11 | Atomic Claiming & Concurrency | Atomic CAS update ensuring exactly one hero claims a Reported incident; rival claimants receive 409 Conflict | M2 | Survey (R2) |
| 12 | Deterministic State Transitions | Strict state machine flow: `Reported` -> `Claimed` -> `In Progress` -> `Resolved` | M2 | Survey (R2) |
| 13 | State Transition Validation | Rejection of illegal jumps (e.g. Reported -> In Progress/Resolved, Claimed -> Resolved) with HTTP 400 | M2 | Survey (R2) |
| 14 | Hero Claim Ownership | Once claimed, only the assigned hero can transition incident to `In Progress` and `Resolved` (403 for others) | M2 | Survey (R2) |
| 15 | Status History Audit Logging | Automatic insertion into `status_history` on creation and on every state transition | M2 | Survey (R3) |
| 16 | Multi-Criteria Filtering | Listing endpoint supporting filtering by `status`, `category`, and `severity` | M3 | Survey (R4) |
| 17 | Incident Pagination | Listing endpoint supporting pagination (`page`, `pageSize` / `limit`, `offset`) with metadata (`total`, `totalPages`) | M3 | Survey (R4) |
| 18 | ER Diagram & Documentation | Complete project README.md with full Mermaid ER diagram, architectural overview, and API documentation | M3 | Survey (R3) |
| 19 | Opaque-Box E2E Test Suite | Comprehensive multi-tier test suite verifying all user requirements independently | E2E Track | Survey (R5) |
| 20 | 100% Passing Verification & Hardening | Final milestone verifying 100% pass rate on full test suite via `npm test` and adversarial coverage hardening | M4 | Survey (R5) |

## Milestones
| # | Name | Scope | Dependencies | Status |
|---|------|-------|-------------|--------|
| E2E | E2E Test Suite Track | Build opaque-box test infrastructure and Tiers 1-4 test suites derived from requirements, publish TEST_READY.md | none | DONE |
| M1 | Relational DB & Auth RBAC | Schema DDL, SQLite manager, User model, Registration, Login, JWT auth middleware, RBAC guards | none | DONE |
| M2 | Incident Lifecycle & Concurrency | Incident CRUD, Citizen scoping, Hero claiming with atomic CAS, state transitions, ownership guards, status history | M1 | DONE |
| M3 | Filtering, Pagination & README ERD | Query filters (status, category, severity), pagination metadata, README.md with complete Mermaid ER diagram | M2 | DONE |
| M4 | Final E2E Pass & Adversarial Hardening | Pass 100% of E2E test suite (Tiers 1-4) with `npm test`, then Phase 2 adversarial coverage hardening | M3, E2E | DONE |

## Interface Contracts

### Auth Service ↔ API Controllers
- `registerUser(username, email, password, role)`: Promise<{ user: { id, username, email, role }, token: string }>
  - Throws `ValidationError` (400) if fields invalid or role not in `['Citizen', 'Hero']`.
  - Throws `ConflictError` (409) if username or email already exists.
- `loginUser(username, password)`: Promise<{ user: { id, username, email, role }, token: string }>
  - Throws `UnauthorizedError` (401) if credentials invalid.
- `verifyToken(token)`: { userId: number, username: string, role: 'Citizen' | 'Hero' }
  - Throws `UnauthorizedError` (401) if token invalid or expired.
- Middleware:
  - `authenticate`: Attaches `req.user = payload` or responds with HTTP 401.
  - `requireRole(allowedRoles)`: Checks `req.user.role`; responds with HTTP 403 if unauthorized.

### Incident Service ↔ API Controllers
- `createIncident(citizenId, { title, description, category, severity, location })`: Incident
  - Inserts into `incidents` with `status = 'Reported'`, `reporter_id = citizenId`.
  - Inserts into `status_history` with `previous_status = NULL`, `new_status = 'Reported'`, `changed_by_user_id = citizenId`.
  - Throws 400 if validation fails (`severity < 1 || severity > 5`, empty fields).
- `getIncidents({ userId, role, status, category, severity, page, limit })`: { items: Incident[], total: number, page: number, pageSize: number, totalPages: number }
  - If `role === 'Citizen'`: strictly filters `reporter_id = userId`.
  - If `role === 'Hero'`: defaults to `status = 'Reported'` if status not explicitly specified.
- `getIncidentById(incidentId, userId, role)`: Incident & { history: StatusHistory[] }
  - Enforces Citizen isolation: if `role === 'Citizen'` and `reporter_id !== userId`, throws 403 or 404.
- `claimIncident(incidentId, heroId)`: Incident
  - Executes atomic CAS `UPDATE incidents SET status = 'Claimed', hero_id = :heroId, updated_at = CURRENT_TIMESTAMP WHERE id = :id AND status = 'Reported'`.
  - If `changes === 0`: queries existing record. If not found -> 404; if status != 'Reported' -> throws `ConflictError` (409).
  - If `changes === 1`: inserts into `status_history` (`previous_status = 'Reported'`, `new_status = 'Claimed'`, `changed_by_user_id = heroId`) and returns updated incident.
- `updateIncidentStatus(incidentId, heroId, newStatus, notes)`: Incident
  - Verifies incident exists (404).
  - Verifies `incident.hero_id === heroId` (403 if different hero).
  - Validates transition:
    - If `incident.status === 'Claimed'` and `newStatus === 'In Progress'`: valid.
    - If `incident.status === 'In Progress'` and `newStatus === 'Resolved'`: valid.
    - Any other transition: throws `BadRequestError` (400).
  - Updates `incidents.status` and logs to `status_history`.

## Code Layout (Target Workspace: `C:\Users\CHAITANYA SELOTE\OneDrive\Desktop\tcb_back`)
```
C:\Users\CHAITANYA SELOTE\OneDrive\Desktop\tcb_back\
├── package.json
├── README.md                  # Complete architecture, API documentation, and Mermaid ER diagram
├── src/
│   ├── app.js                 # Express application initialization and middleware
│   ├── server.js              # Server entry point (starts HTTP listener)
│   ├── config/
│   │   └── config.js          # Port, JWT secret, DB path configuration
│   ├── db/
│   │   ├── database.js        # SQLite DatabaseSync connection, schema migration DDL, helper
│   │   └── schema.sql         # Raw SQL DDL definition
│   ├── middleware/
│   │   ├── auth.js            # JWT verification & req.user attachment
│   │   ├── rbac.js            # Role guard middleware (Citizen / Hero checks)
│   │   └── errorHandler.js    # Centralized JSON error response handler (400, 401, 403, 404, 409, 500)
│   ├── routes/
│   │   ├── authRoutes.js      # /api/auth (register, login)
│   │   └── incidentRoutes.js  # /api/incidents (CRUD, claim, status transitions, history)
│   ├── controllers/
│   │   ├── authController.js
│   │   └── incidentController.js
│   ├── services/
│   │   ├── authService.js
│   │   └── incidentService.js
│   └── utils/
│       ├── errors.js          # Custom AppError subclasses (BadRequest, Unauthorized, Forbidden, NotFound, Conflict)
│       └── validator.js       # Payload validation helpers
└── tests/
    ├── helpers/
    │   └── testDb.js          # Test in-memory database setup & teardown
    ├── e2e/
    │   ├── tier1_feature_coverage.test.js
    │   ├── tier2_boundary_corner.test.js
    │   ├── tier3_cross_feature.test.js
    │   └── tier4_real_world.test.js
    ├── auth.test.js
    ├── incidents.test.js
    ├── lifecycle.test.js
    ├── concurrency.test.js
    └── pagination.test.js
```
