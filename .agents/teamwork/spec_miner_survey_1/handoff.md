# Specification Mining Handoff Report: Spider-Sense Alert System Backend

## 1. Observation

Direct observations extracted from authoritative project specification sources:

1. **Source File: `ORIGINAL_REQUEST.md`** (`c:\Users\CHAITANYA SELOTE\OneDrive\Desktop\tcb_ml\.agents\teamwork\ORIGINAL_REQUEST.md`):
   - Line 5: *"Build the backend for the Spider-Sense Alert System as a capability showcase, where citizens report incidents in New York and heroes claim and resolve them."*
   - Line 7: *"Working directory: C:\Users\CHAITANYA SELOTE\OneDrive\Desktop\tcb_back"*
   - Line 8-9: *"Integrity mode: demo. The team must NOT: copy code from existing open-source projects for core logic, run external scripts or delegate execution to other tools"*
   - Line 13-14 (R1): *"Authentication and Role-Based Access Control: Implement JWT authentication supporting two distinct roles: Citizen and Hero. Role checks must be enforced strictly on the backend, not solely in UI logic."*
   - Line 16-17 (R2): *"Incident Management and Hero Workflow: Citizens can create incidents specifying title, description, category, severity (1 to 5), and location, and can view their own reported incidents. Heroes can view all open incidents, claim an incident, and update its status. The incident lifecycle must follow the status flow: Reported → Claimed → In Progress → Resolved. Invalid status transitions must be rejected, and concurrency controls must ensure that two heroes cannot claim the same incident."*
   - Line 19-20 (R3): *"Relational Database and Data Modeling: Design and implement a relational database schema covering users, incidents, and status history. Include the complete Entity-Relationship (ER) diagram in the project's README."*
   - Line 22-23 (R4): *"Incident Filtering and Pagination: Provide incident listing endpoints supporting pagination and filtering by status, category, and severity."*
   - Line 25-26 (R5): *"Automated Verification: Implement an automated test suite verifying all endpoints, role-based access restrictions, status state transitions, concurrency safety on claims, and filtering/pagination."*
   - Lines 30-33: Acceptance Criteria for Auth & RBAC:
     - User registration and login return a valid JWT token.
     - Protected endpoints verify JWT and enforce Citizen or Hero role permissions on the backend.
     - Unauthorized requests (missing/invalid token) return HTTP 401, role-mismatched requests return HTTP 403.
   - Lines 35-41: Acceptance Criteria for Incidents:
     - Citizens create incidents with title, description, category, severity (1-5), and location.
     - Citizens can retrieve only incidents they have created.
     - Heroes can view all open (Reported) incidents.
     - Status flow strictly enforces: `Reported` → `Claimed` → `In Progress` → `Resolved`.
     - Invalid status jumps (e.g. `Reported` directly to `Resolved` or `Claimed` to `Resolved`) rejected with HTTP 400.
     - Two heroes attempting to claim the same incident concurrently results in exactly one hero claiming it and the other receiving an error (HTTP 409 or 400).
   - Lines 43-45: Acceptance Criteria for DB & Docs:
     - Relational database schema models users, incidents, and status history with foreign keys and relationships.
     - Project README includes complete ER diagram representing the database design.
   - Lines 47-49: Acceptance Criteria for Filtering & Pagination:
     - Incidents list endpoint supports filtering by status, category, severity.
     - Incidents list endpoint supports pagination (limit/offset or page/pageSize).
   - Lines 51-52: Acceptance Criteria for Tests:
     - Single command execution, 0 failures, covering auth, roles, CRUD, status transitions, race-condition claim handling, filtering/pagination.

2. **Target Directory Observation**:
   - `C:\Users\CHAITANYA SELOTE\OneDrive\Desktop\tcb_back` was inspected via `list_dir` and found empty. The system is a clean-slate greenfield backend build.

---

## 2. Logic Chain

1. **Role Separation & Authentication Boundary**:
   - From R1, the system has two mutually exclusive roles: `Citizen` and `Hero`.
   - Registration must accept credentials (`username`, `password`, `role`) and validate that `role` is either `Citizen` or `Hero`. Passwords must be hashed (e.g. bcrypt/argon2) before persisting in `users`.
   - Login verifies credentials and issues a signed JWT containing at least `sub` (user_id), `username`, and `role`.
   - Middleware extracts the Bearer token from the `Authorization` header. If missing, malformed, or expired, HTTP 401 Unauthorized is immediately returned.
   - If token is valid, route-level guards inspect the token's `role`. If an endpoint requires `Hero` and user is `Citizen`, HTTP 403 Forbidden is returned. Similarly, if an endpoint requires `Citizen` (e.g. incident creation) and user is `Hero`, HTTP 403 is returned.

2. **Incident Creation & Ownership Isolation**:
   - From R2, incident creation requires: `title` (string), `description` (string), `category` (string), `severity` (integer between 1 and 5), and `location` (string).
   - Validation must enforce `severity >= 1 AND severity <= 5` and non-empty strings. Any violation returns HTTP 400 Bad Request.
   - Upon creation, `status` is automatically initialized to `Reported`. The `reporter_id` is bound to `req.user.id` (authenticated Citizen).
   - An initial row in `incident_status_history` is created (`from_status: null, to_status: 'Reported', changed_by_id: req.user.id`).
   - For incident retrieval, a Citizen is strictly scoped to `WHERE reporter_id = :userId`. A Citizen cannot view or list incidents filed by others (accessing another citizen's incident via ID returns HTTP 403 or 404).

3. **Lifecycle State Machine & Strict Jump Prevention**:
   - Permissible transitions are strictly deterministic:
     1. `Reported` -> `Claimed` (Triggered by Hero claiming the incident; sets `claimed_by_id = hero.id`).
     2. `Claimed` -> `In Progress` (Triggered by the assigned Hero starting action).
     3. `In Progress` -> `Resolved` (Triggered by the assigned Hero completing action).
   - Any other transition is illegal and must return HTTP 400 Bad Request:
     - `Reported` -> `In Progress` (HTTP 400)
     - `Reported` -> `Resolved` (HTTP 400)
     - `Claimed` -> `Resolved` (HTTP 400)
     - `Claimed` -> `Reported` (HTTP 400)
     - `In Progress` -> `Claimed` or `Reported` (HTTP 400)
     - `Resolved` -> anything (HTTP 400, terminal state)
   - In addition to state validity, Hero ownership must be enforced: once an incident is `Claimed`, only the hero whose `id == claimed_by_id` can transition it to `In Progress` and `Resolved`. Any other hero attempting this receives HTTP 403 Forbidden.

4. **Claim Concurrency & Race-Condition Safety**:
   - R2 explicitly requires: *"concurrency controls must ensure that two heroes cannot claim the same incident. Two heroes attempting to claim the same incident concurrently results in exactly one hero claiming it and the other receiving an error."*
   - In a relational database, this is implemented using atomic database conditional updates or transactional row-locking (`SELECT ... FOR UPDATE`):
     ```sql
     UPDATE incidents
     SET status = 'Claimed', claimed_by_id = :heroId, updated_at = CURRENT_TIMESTAMP
     WHERE id = :incidentId AND status = 'Reported';
     ```
   - If `rows_affected == 1`: Hero A succeeds, writes to `incident_status_history`, and receives HTTP 200 OK.
   - If `rows_affected == 0`: Hero B was beaten in the race; transaction rolls back and returns HTTP 409 Conflict (or HTTP 400) with a message like `"Incident already claimed or not in Reported status"`.
   - Concurrency tests must fire two or more simultaneous asynchronous HTTP requests against the same incident ID and verify that only 1 returns 200 and the other returns 409/400.

5. **Relational Database Schema & History Auditing**:
   - 3 relational tables:
     - `users`: `id`, `username`, `email`, `password_hash`, `role`, `created_at`, `updated_at`.
     - `incidents`: `id`, `title`, `description`, `category`, `severity`, `location`, `status`, `reporter_id` (FK -> users.id), `claimed_by_id` (FK -> users.id, nullable), `created_at`, `updated_at`.
     - `incident_status_history`: `id`, `incident_id` (FK -> incidents.id ON DELETE CASCADE), `from_status` (nullable), `to_status`, `changed_by_id` (FK -> users.id), `notes` (nullable), `created_at`.
   - Foreign key integrity, foreign key indexes, and enum/check constraints must be defined.
   - Complete ER diagram in Mermaid / ASCII format must be placed in `README.md`.

6. **Filtering & Pagination**:
   - Endpoint `GET /api/incidents` supports query params: `status`, `category`, `severity`, `page` (or `offset`), `pageSize` (or `limit`).
   - Query dynamic composition:
     - If Citizen: automatically injects `AND reporter_id = :userId`.
     - If Hero: defaults to `status = 'Reported'` if no status specified, or allows querying any status if specified.
     - Applies `WHERE category = :category` if provided.
     - Applies `WHERE severity = :severity` if provided.
     - Paginates with `LIMIT :limit OFFSET :offset`.
     - Computes `total` count matching filters to return `{ items, total, page, pageSize, totalPages }`.

7. **Automated Verification Harness**:
   - Must run with a single command (e.g. `npm test` or `pytest`) with 100% pass rate.
   - SQLite (file or in-memory) provides zero external daemon dependencies and instant test execution.

---

## 3. Features Discovered

| # | Category | Feature | Description | Inputs | Outputs | Error Behavior | Discovered Via |
|---|----------|---------|-------------|--------|---------|----------------|----------------|
| 1 | Auth | User Registration | Register a new user with Citizen or Hero role | JSON: `{ username, email, password, role }` | HTTP 201: `{ message, user: { id, username, role }, token }` | 400 if validation fails; 409 if username/email exists | ORIGINAL_REQUEST.md lines 13-14, 31 |
| 2 | Auth | User Login | Authenticate credentials and issue JWT | JSON: `{ username, password }` | HTTP 200: `{ token, user: { id, username, role } }` | 401 Unauthorized for wrong credentials; 400 for missing fields | ORIGINAL_REQUEST.md lines 13-14, 31 |
| 3 | Auth & RBAC | Token Authentication Middleware | Validates Bearer JWT on protected routes | Header: `Authorization: Bearer <token>` | Attaches decoded user payload (`id, role, username`) to request | 401 Unauthorized if missing, expired, or invalid token | ORIGINAL_REQUEST.md lines 14, 32-33 |
| 4 | Auth & RBAC | Role Authorization Guard | Enforces Citizen or Hero role requirements | Route role requirement + Request user role | Passes execution to next handler | 403 Forbidden if user role does not match required role | ORIGINAL_REQUEST.md lines 14, 32-33 |
| 5 | Incidents | Create Incident | Citizen creates new incident | JSON: `{ title, description, category, severity, location }` | HTTP 201: Incident object with status='Reported', reporter_id | 400 if validation fails (severity not 1-5, empty fields); 403 if user is not Citizen | ORIGINAL_REQUEST.md lines 16-17, 36 |
| 6 | Incidents | List Citizen Incidents | Citizen views only incidents they reported | Query params: `status, category, severity, page, limit` + Citizen JWT | HTTP 200: Paginated list of incidents created by current citizen | 401 if unauthenticated; 403 if accessed without Citizen role | ORIGINAL_REQUEST.md lines 16-17, 37 |
| 7 | Incidents | List Open Incidents | Hero views open incidents | Query params: `status, category, severity, page, limit` + Hero JWT | HTTP 200: Paginated list of open incidents (status='Reported' default) | 401 if unauthenticated; 403 if accessed by Citizen | ORIGINAL_REQUEST.md lines 17, 38 |
| 8 | Incidents | Get Incident By ID | Retrieve incident details with status history | Path param: `id`, JWT token | HTTP 200: Full incident record + status history | 404 if not found; 403 if Citizen tries to view another citizen's incident | ORIGINAL_REQUEST.md lines 16-20, 37-38 |
| 9 | Lifecycle | Claim Incident | Hero claims a Reported incident | Path param: `id`, Hero JWT | HTTP 200: Updated incident (status='Claimed', claimed_by_id=hero.id) | 400/409 if already claimed or not 'Reported'; 403 if not Hero; 404 if not found | ORIGINAL_REQUEST.md lines 17, 39-41 |
| 10 | Lifecycle | Start Incident Progress | Hero sets claimed incident to In Progress | Path param: `id`, Hero JWT | HTTP 200: Updated incident (status='In Progress') | 400 if status not 'Claimed'; 403 if requester is not the claiming hero | ORIGINAL_REQUEST.md lines 17, 39-40 |
| 11 | Lifecycle | Resolve Incident | Hero marks In Progress incident as Resolved | Path param: `id`, Hero JWT | HTTP 200: Updated incident (status='Resolved') | 400 if status not 'In Progress'; 403 if requester is not the claiming hero | ORIGINAL_REQUEST.md lines 17, 39-40 |
| 12 | Lifecycle | State Machine Jump Validation | Enforce strict transition ordering | Status change request | Passes if transition is valid | 400 Bad Request for any invalid transition (e.g. Reported -> Resolved) | ORIGINAL_REQUEST.md lines 17, 39-40 |
| 13 | Concurrency | Race-Condition Safe Claiming | Prevents simultaneous double claiming | 2+ simultaneous claim requests on same incident | Winner: HTTP 200; Loser: HTTP 409 Conflict or 400 Bad Request | Concurrency safe; exactly 1 succeeds | ORIGINAL_REQUEST.md lines 17, 41 |
| 14 | Database | Status History Auditing | Automatic audit log for every status transition | Internal DB trigger / service hook on status change | Insert into `incident_status_history` | Rollback parent transaction if history write fails | ORIGINAL_REQUEST.md lines 19-20, 44 |
| 15 | Filtering | Multi-Criteria Filtering | Filter incidents by status, category, and severity | Query params: `?status=Reported&category=Theft&severity=5` | HTTP 200: Filtered incident list matching all criteria | 400 Bad Request if filter values invalid | ORIGINAL_REQUEST.md lines 22-23, 48 |
| 16 | Pagination | Pagination Support | Paginate listing responses | Query params: `?page=1&limit=10` or `?offset=0&limit=10` | HTTP 200: `{ items, total, page, pageSize, totalPages }` | 400 Bad Request if negative limit/page; defaults applied if missing | ORIGINAL_REQUEST.md lines 22-23, 49 |
| 17 | Docs | Complete ER Diagram | Database schema visualization | Relational schema definition | Mermaid ER diagram in README.md | Missing ER diagram fails Acceptance Criteria R3 | ORIGINAL_REQUEST.md lines 19-20, 45 |
| 18 | Verification | Automated Test Suite | Single-command automated test execution | Command: `npm test` or `pytest` | 100% tests passing, zero failures | Any failure indicates regression | ORIGINAL_REQUEST.md lines 25-26, 51-52 |

---

## 4. Edge Cases

| # | Feature | Input / Condition | Expected / Specified Observable Behavior |
|---|---------|-------------------|------------------------------------------|
| 1 | Auth / Registration | Role not in `['Citizen', 'Hero']` (e.g. `role: "Admin"` or `role: "Supervillain"`) | HTTP 400 Bad Request with validation message: role must be Citizen or Hero. |
| 2 | Auth / Registration | Duplicate username or email registration | HTTP 409 Conflict with descriptive message indicating user already exists. |
| 3 | Auth / Registration | Missing or blank password, or password < 6 characters | HTTP 400 Bad Request. |
| 4 | Auth / Login | Valid username, wrong password | HTTP 401 Unauthorized (`Invalid credentials`). |
| 5 | Auth / Login | Non-existent username | HTTP 401 Unauthorized (`Invalid credentials`). Prevents username enumeration. |
| 6 | Auth Middleware | Header missing `Authorization` | HTTP 401 Unauthorized (`Missing authorization token`). |
| 7 | Auth Middleware | `Authorization: InvalidTokenValue` (malformed format) | HTTP 401 Unauthorized (`Invalid authorization header format`). |
| 8 | Auth Middleware | Tampered or expired JWT token | HTTP 401 Unauthorized (`Token expired or invalid`). |
| 9 | RBAC Authorization | Citizen attempts to claim incident (`POST /api/incidents/:id/claim`) | HTTP 403 Forbidden (`Access denied: Hero role required`). |
| 10 | RBAC Authorization | Hero attempts to create an incident (`POST /api/incidents`) | HTTP 403 Forbidden (`Access denied: Citizen role required`). |
| 11 | Incident Creation | `severity = 0` (below lower bound) | HTTP 400 Bad Request (`Severity must be an integer between 1 and 5`). |
| 12 | Incident Creation | `severity = 6` (above upper bound) | HTTP 400 Bad Request (`Severity must be an integer between 1 and 5`). |
| 13 | Incident Creation | `severity = 3.5` or `severity = "high"` | HTTP 400 Bad Request (integer validation failure). |
| 14 | Incident Creation | `title = ""` or whitespace-only `"   "` | HTTP 400 Bad Request (`Title is required and cannot be empty`). |
| 15 | Incident Creation | Missing `location`, `description`, or `category` | HTTP 400 Bad Request (`Missing required field: ...`). |
| 16 | Incident Isolation | Citizen A requests `GET /api/incidents/:id` where incident was created by Citizen B | HTTP 403 Forbidden or 404 Not Found (prevents viewing or enumerating other citizens' reports). |
| 17 | Incident Visibility | Citizen requests `GET /api/incidents` | Returns only incidents where `reporter_id == Citizen.id`. |
| 18 | Incident Visibility | Hero requests `GET /api/incidents` without filters | Returns open incidents (status = 'Reported'). |
| 19 | Lifecycle State Machine | Attempt transition `Reported` -> `In Progress` | HTTP 400 Bad Request (`Invalid status transition: Reported cannot transition to In Progress`). |
| 20 | Lifecycle State Machine | Attempt transition `Reported` -> `Resolved` | HTTP 400 Bad Request (`Invalid status transition: Reported cannot transition to Resolved`). |
| 21 | Lifecycle State Machine | Attempt transition `Claimed` -> `Resolved` (skipping `In Progress`) | HTTP 400 Bad Request (`Invalid status transition: Claimed cannot transition directly to Resolved`). |
| 22 | Lifecycle State Machine | Attempt transition `Claimed` -> `Reported` (backward leap) | HTTP 400 Bad Request (`Invalid status transition: cannot revert to Reported`). |
| 23 | Lifecycle State Machine | Attempt transition `In Progress` -> `Claimed` or `Reported` | HTTP 400 Bad Request (`Invalid backward transition`). |
| 24 | Lifecycle State Machine | Attempt transition on `Resolved` incident (terminal state) | HTTP 400 Bad Request (`Incident is already Resolved and cannot be updated`). |
| 25 | Lifecycle Ownership | Hero B attempts to update Hero A's claimed incident to `In Progress` or `Resolved` | HTTP 403 Forbidden (`Only the claiming hero can update this incident's status`). |
| 26 | Concurrency / Race | Hero 1 and Hero 2 send simultaneous `claim` requests for the same `Reported` incident | Atomically: Hero 1 receives HTTP 200; Hero 2 receives HTTP 409 Conflict (or 400). Only 1 claim entry in DB and history. |
| 27 | Concurrency / Double Claim | Hero attempts to claim an incident that is already `Claimed` | HTTP 409 Conflict or 400 Bad Request (`Incident is already claimed`). |
| 28 | Filtering | Filter by non-existent category or status (e.g. `?category=Unicorn`) | HTTP 200 OK with `{ items: [], total: 0 }`. |
| 29 | Filtering | Combined filters `?status=Reported&category=Fire&severity=4` | HTTP 200 with items matching ALL filters simultaneously. |
| 30 | Pagination | `page = 1, limit = 5` on 12 total incidents | Returns 5 items, `total: 12, totalPages: 3, page: 1`. |
| 31 | Pagination | `page = 10, limit = 5` on 12 total incidents (page beyond range) | HTTP 200 OK with `items: [], total: 12, page: 10, totalPages: 3`. |
| 32 | Pagination | Negative page or limit (`?page=-1` or `?limit=-5`) | HTTP 400 Bad Request or clamped to default values (`page=1, limit=10`). |
| 33 | Pagination | Excessively large limit (`?limit=10000`) | Clamped to maximum allowed limit (e.g. 50 or 100). |
| 34 | Database Cascades | Incident is deleted (e.g. in test cleanup) | Status history records cascade-deleted (`ON DELETE CASCADE`). |
| 35 | Audit History | Initial creation | Status history records `{ from_status: null, to_status: 'Reported', changed_by_id: reporter_id }`. |
| 36 | Audit History | Full lifecycle completion | Status history table contains exactly 3 entries for the incident: (null->Reported), (Reported->Claimed), (Claimed->In Progress), (In Progress->Resolved) - total 4 records reflecting every stage. |

---

## 5. Caveats

1. **Tech Stack Selection**:
   - `ORIGINAL_REQUEST.md` does not mandate a specific programming language (Node.js/Express, Python/FastAPI, Go, etc.). However, given requirements for single-command automated test execution with 100% pass rate, zero external dependencies, robust async concurrency handling, and clean relational modeling:
     - Node.js (TypeScript or JavaScript with Express/Fastify and SQLite / Better-SQLite3 / Prisma / TypeORM / Sequelize) or Python (FastAPI + SQLAlchemy + SQLite) are standard choices.
     - Node.js + Express/TypeScript with SQLite (or Python FastAPI + SQLite) requires zero external database servers (like Postgres/MySQL Docker containers), ensuring `npm test` or `pytest` runs reliably and instantly anywhere.
2. **Hero Incident Creation**:
   - R2 states: *"Citizens can create incidents specifying title, description... Heroes can view all open incidents, claim an incident, and update its status."*
   - Strictly speaking, incident creation is a Citizen role capability. Restricting incident creation to Citizens enforces clean role separation.
3. **Hero View Scope for Non-Reported Incidents**:
   - R2 states: *"Heroes can view all open incidents"*.
   - When heroes access the general list endpoint, the default view should be open (`Reported`) incidents, but they can query other statuses (e.g. `Claimed`, `In Progress`, `Resolved`) using the status filter parameter.

---

## 6. Conclusion

The specification for the Spider-Sense Alert System backend is clean, well-bounded, and fully articulated:
1. **Security & RBAC**: JWT Bearer auth, Citizens and Heroes with strict backend 401/403 separation.
2. **Data & Workflow**: Incidents with severity (1-5), strict deterministic lifecycle `Reported` -> `Claimed` -> `In Progress` -> `Resolved`, with invalid jumps rejected with HTTP 400.
3. **Claim Concurrency**: Atomic claim operation ensuring exactly one winner and HTTP 409/400 for concurrent claimants.
4. **Relational Schema**: 3 core tables (`users`, `incidents`, `incident_status_history`) with complete ER diagram in `README.md`.
5. **Search & Pagination**: Dynamic filtering (`status`, `category`, `severity`) and pagination (`page`/`limit`).
6. **Automated Testing**: 100% passing test suite runnable via a single command.

---

## 7. Verification Method

To verify these specifications:
1. Inspect the source file: `view_file` at `c:\Users\CHAITANYA SELOTE\OneDrive\Desktop\tcb_ml\.agents\teamwork\ORIGINAL_REQUEST.md`.
2. Cross-check all 5 requirement domains against the acceptance criteria on lines 28-53 of `ORIGINAL_REQUEST.md`.
3. In the implementation phase, run the test command (e.g., `npm test` or `pytest`) in `C:\Users\CHAITANYA SELOTE\OneDrive\Desktop\tcb_back`. Every edge case cataloged above can be directly converted into a test case in the automated test suite.
