Build the backend for the Spider-Sense Alert System as a capability showcase, where citizens report incidents in New York and heroes claim and resolve them.

Working directory: C:\Users\CHAITANYA SELOTE\OneDrive\Desktop\tcb_back
Integrity mode: demo
The team must NOT: copy code from existing open-source projects for core logic, run external scripts or delegate execution to other tools

## Requirements

### R1. Authentication and Role-Based Access Control
Implement JWT authentication supporting two distinct roles: Citizen and Hero. Role checks must be enforced strictly on the backend, not solely in UI logic.

### R2. Incident Management and Hero Workflow
Citizens can create incidents specifying title, description, category, severity (1 to 5), and location, and can view their own reported incidents. Heroes can view all open incidents, claim an incident, and update its status. The incident lifecycle must follow the status flow: Reported → Claimed → In Progress → Resolved. Invalid status transitions must be rejected, and concurrency controls must ensure that two heroes cannot claim the same incident.

### R3. Relational Database and Data Modeling
Design and implement a relational database schema covering users, incidents, and status history. Include the complete Entity-Relationship (ER) diagram in the project's README.

### R4. Incident Filtering and Pagination
Provide incident listing endpoints supporting pagination and filtering by status, category, and severity.

### R5. Automated Verification
Implement an automated test suite verifying all endpoints, role-based access restrictions, status state transitions, concurrency safety on claims, and filtering/pagination.

## Acceptance Criteria

### Authentication & Authorization
- [ ] User registration and login return a valid JWT token.
- [ ] Protected endpoints verify the JWT and enforce Citizen or Hero role permissions on the backend.
- [ ] Unauthorized requests (missing/invalid token) return HTTP 401, and role-mismatched requests return HTTP 403.

### Incident Reporting & Lifecycle Management
- [ ] Citizens can create incidents with title, description, category, severity (1 to 5), and location.
- [ ] Citizens can retrieve only incidents they have created.
- [ ] Heroes can view all open (Reported) incidents.
- [ ] Status flow strictly enforces: Reported → Claimed → In Progress → Resolved.
- [ ] Invalid status jumps (e.g. Reported directly to Resolved or Claimed to Resolved) are rejected with HTTP 400.
- [ ] Two heroes attempting to claim the same incident concurrently results in exactly one hero claiming it and the other receiving an error.

### Relational Database & Documentation
- [ ] Relational database schema models users, incidents, and status history with foreign keys and relationships.
- [ ] The project README includes the complete ER diagram representing the database design.

### Filtering & Pagination
- [ ] Incidents list endpoint supports filtering by status, category, and severity.
- [ ] Incidents list endpoint supports pagination (e.g. limit/offset or page/pageSize).

### Automated Test Verification
- [ ] Automated tests run with a single command and pass with zero failures, covering authentication, role checks, incident CRUD, status transitions, race-condition claim handling, and filtering/pagination.
