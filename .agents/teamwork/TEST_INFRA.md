# E2E Test Infra: Spider-Sense Alert System Backend

## Test Philosophy
- Opaque-box, requirement-driven derived strictly from ORIGINAL_REQUEST.md.
- Independent of internal implementation details.
- Methodology: Category-Partition + Boundary Value Analysis + Pairwise Combinatorial Testing + Real-World Workload Testing.

## Feature Inventory
| # | Feature | Source (requirement) | Tier 1 (Coverage) | Tier 2 (Boundary) | Tier 3 (Cross-Feature) | Tier 4 (Real-World) |
|---|---------|---------------------|:-----------------:|:-----------------:|:----------------------:|:--------------------:|
| 1 | User Registration | ORIGINAL_REQUEST §R1 | ≥5 cases | ≥5 cases | Yes | Yes |
| 2 | User Login & JWT | ORIGINAL_REQUEST §R1 | ≥5 cases | ≥5 cases | Yes | Yes |
| 3 | RBAC Role Enforcement | ORIGINAL_REQUEST §R1 | ≥5 cases | ≥5 cases | Yes | Yes |
| 4 | Incident Creation | ORIGINAL_REQUEST §R2 | ≥5 cases | ≥5 cases | Yes | Yes |
| 5 | Citizen Incident Scoping | ORIGINAL_REQUEST §R2 | ≥5 cases | ≥5 cases | Yes | Yes |
| 6 | Hero Open Incident Listing | ORIGINAL_REQUEST §R2 | ≥5 cases | ≥5 cases | Yes | Yes |
| 7 | Incident Claiming & Concurrency | ORIGINAL_REQUEST §R2 | ≥5 cases | ≥5 cases | Yes | Yes |
| 8 | Lifecycle State Machine | ORIGINAL_REQUEST §R2 | ≥5 cases | ≥5 cases | Yes | Yes |
| 9 | Status History Auditing | ORIGINAL_REQUEST §R3 | ≥5 cases | ≥5 cases | Yes | Yes |
| 10 | Filtering (status, category, severity) | ORIGINAL_REQUEST §R4 | ≥5 cases | ≥5 cases | Yes | Yes |
| 11 | Pagination (page, limit, total) | ORIGINAL_REQUEST §R4 | ≥5 cases | ≥5 cases | Yes | Yes |

## Test Architecture
- **Location**: `C:\Users\CHAITANYA SELOTE\OneDrive\Desktop\tcb_back\tests\e2e\`
- **Runner**: Node.js test runner (`node:test`) + `supertest` executing `npm test`.
- **Database**: In-memory SQLite (`:memory:`) ensuring zero-daemon dependency and high-speed deterministic execution.
- **Entry Points**:
  - `POST /api/auth/register`
  - `POST /api/auth/login`
  - `POST /api/incidents`
  - `GET /api/incidents`
  - `GET /api/incidents/:id`
  - `POST /api/incidents/:id/claim`
  - `PATCH /api/incidents/:id/status`
  - `GET /api/incidents/:id/history`

## Real-World Application Scenarios (Tier 4)
| # | Scenario | Features Exercised | Complexity |
|---|----------|--------------------|------------|
| 1 | Midtown Bank Robbery Lifecyle | Citizen Registration, Incident Creation (High Severity), Hero Login, Claim, In Progress, Resolution, Audit Trail | High |
| 2 | Queens Apartment Fire Multi-Hero Race | Citizen Report (Fire, Severity 5), Hero 1 & Hero 2 simultaneous claim race (CAS), Winner advances to Resolved, Loser rejected with 409 | High |
| 3 | Multi-Citizen Neighborhood Watch | Multiple citizens reporting separate incidents in Brooklyn & Queens, verifying strict scoping (citizens see only own) | Medium |
| 4 | Hero Shift Work: Cross-Incident Filtering & Pagination | Hero logging in, filtering 20+ incidents across categories and severity levels, paging through results with limit/offset | Medium |
| 5 | Rogue Actor & Invalid Jump Adversarial Defense | Unauthenticated intruder, Citizen attempting Hero claim, Hero attempting invalid state jumps (Reported->Resolved), Unassigned hero hijacking | High |

## Coverage Thresholds
- **Tier 1 (Feature Coverage)**: ≥55 test cases (≥5 per feature across 11 features)
- **Tier 2 (Boundary & Corner Cases)**: ≥55 test cases (≥5 per feature across limits, invalid types, extreme values)
- **Tier 3 (Cross-Feature Combinations)**: ≥11 pairwise interaction test cases
- **Tier 4 (Real-World Application Scenarios)**: ≥5 end-to-end multi-step workflow test cases
- **Total Minimum Test Count**: ≥126 test cases
