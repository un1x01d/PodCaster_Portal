# Deep Correctness Audit Report

## Executive Verdict

Overall risk: **HIGH**  
Production readiness: **NOT READY**  
Confidence: **HIGH**

Biggest confirmed defect: **Production deployment config is internally inconsistent (DB env keys + migration command path), causing first deploy failures.**  
Biggest likely hidden defect: **Silent semantic-knowledge DB failure paths are masking runtime degradation and making failures non-obvious.**  
Most dangerous data correctness risk: **Planner/explainer behavior proceeds with degraded semantic context when DB lookups fail, producing low-quality or misleading analysis output without hard failure.**  
Most dangerous auth/permission risk: **No critical auth bypass confirmed in active route/controller paths reviewed.**  
Most broken or incomplete flow: **Source-free VPS deployment flow (`prod/ops` + `prod/docker/config`) is not executable as-is due to config/path mismatches.**  
First fix to make: **Fix deploy/runtime config contract (`backend.env` keys + migration command path) before any production rollout.**

## Execution Map

- frontend entry: `frontend/src/main.jsx` → `frontend/src/App.jsx` → `frontend/src/AppShell.jsx`
- backend entry: `backend/server.js`
- route registration: `server.js` mounts `authRoutes`, `sheetRoutes`, `emailRoutes`, `userRoutes`, `viewRoutes`, `chatRoutes`, `insightRoutes`, `localeRoutes`, `googleRoutes`, `dropboxRoutes`, `oneDriveRoutes`
- auth middleware:
  - global CSRF: `ensureCsrfCookie` + `csrfProtect` in `server.js`
  - per-route auth: `auth` middleware in route modules
- database layer: `backend/src/config/db.js` (`Pool`, `query`, tenant pool routing, schema bootstrap in `initDb`)
- major services:
  - spreadsheet ingestion/parsing: `sheetController` + workbook parser + worker threads
  - AI planning/execution: `chatQueryV3Controller` + `deterministicSpreadsheetPlannerV2` + `deterministicSpreadsheetExecutor` + `resultExplanationService`
  - settings/permissions/admin: `userController`, `viewController`, `authorization` utils
- build/start commands:
  - backend: `npm start` (`node --max-old-space-size=8192 server.js`)
  - frontend: `vite build`, `vite dev`
  - tests: `backend npm test` (`node --test --test-force-exit`)

## Flow Results

| Flow | Status | Evidence | Main Issue |
| --- | --- | --- | --- |
| Startup | Partial | `backend/server.js`, `backend/src/config/runtime.js` | Starts, but production deploy scripts/config are inconsistent and fail on first run. |
| Auth/session | Working | `backend/src/middleware/auth.js`, `backend/src/routes/authRoutes.js` | Core auth path works; no confirmed route-level bypass in reviewed active paths. |
| API contract | Broken | `frontend/src/api.js`, `frontend/src/hooks/useAuth.js`, `frontend/Dockerfile` | Frontend defaults API to `http://localhost:4000`, breaking browser clients behind nginx unless explicitly overridden. |
| Database access | Partial | `backend/src/config/db.js`, `prod/docker/config/backend.env.example` | Runtime DB parser expects `POSTGRES_*`/`PG*`, but provided prod template uses `DB_*`. |
| Upload/import | Working | `sheetRoutes.js`, `sheet/uploadHandlers.js`, `workbookParser` | Flow is implemented and protected; no hard failure found in current active path. |
| Permissions | Working | `viewController.js`, `sheetController.js`, `userController.js` | Active checks exist in reviewed endpoints; no confirmed privilege bypass in those paths. |
| AI/calculation | Partial | `chatQueryV3Controller.js`, `semanticKnowledgeService.js`, `deterministicSpreadsheetExecutor.js` | Semantic DB failures are swallowed, producing degraded behavior while returning success. |
| Export/download | Partial | frontend export utilities + backend routes | No single confirmed hard break, but export flow coverage is weak in tests. |
| Tests | Misleading | `backend/test/sheetDataSecurityRegression.test.js` and test run output | Many tests assert source text, not behavior; suite passes while DB failures spam runtime warnings. |

## Confirmed Defects

### DEFECT-001 — Frontend API default breaks production behind nginx unless manually overridden

Severity: High  
Category: API Contract  
Status: Confirmed  
Confidence: High

Files:

- `frontend/src/api.js`
- `frontend/src/hooks/useAuth.js`
- `frontend/Dockerfile`

What is broken:  
Frontend defaults API base to `http://localhost:4000`. In a real browser session on a remote domain, `localhost` points to the user’s machine, not the server.

Evidence:  
- `frontend/src/api.js:3` sets `API = ... || "http://localhost:4000"`.
- `frontend/src/hooks/useAuth.js:5` repeats same default.
- `frontend/Dockerfile:19` sets default `ARG VITE_API_URL=http://localhost:4000`, baking this into build when not overridden.

Why it fails:  
If env injection is missed or misconfigured, frontend calls local machine port 4000 and all authenticated/API features fail.

Impact:  
Production UI appears up but API-dependent features (login/session, data, chat, uploads) fail from browser.

How to reproduce:  
Build frontend without `VITE_API_URL` override; serve behind domain/nginx; open browser from another machine; inspect failed requests to `http://localhost:4000`.

Recommended fix:  
Use same-origin default (e.g., relative `/api`) for production builds and only use localhost in explicit dev config.

Regression test:  
Frontend integration test asserting built artifact does not contain hardcoded `http://localhost:4000` when production mode is used.

---

### DEFECT-002 — Production backend env template uses wrong DB variable names

Severity: Critical  
Category: Config  
Status: Confirmed  
Confidence: High

Files:

- `prod/docker/config/backend.env.example`
- `backend/src/config/db.js`

What is broken:  
Deployment template uses `DB_HOST/DB_PORT/DB_NAME/DB_USER/DB_PASSWORD`, but backend reads `POSTGRES_*` or `PG*` or `DATABASE_URL`.

Evidence:  
- `prod/docker/config/backend.env.example:5-9` uses `DB_*`.
- `backend/src/config/db.js:31-35` reads `POSTGRES_HOST`, `POSTGRES_USER`, `POSTGRES_DB`, `POSTGRES_PASSWORD`, `POSTGRES_PORT`.

Why it fails:  
Backend starts without valid DB connection settings from that template.

Impact:  
Production boot fails or DB queries fail across all features.

How to reproduce:  
Use template as documented, deploy backend container; DB connection attempts fail due to missing recognized env keys.

Recommended fix:  
Align template keys with runtime parser (`POSTGRES_*` or `DATABASE_URL`) and remove unsupported keys.

Regression test:  
Config-contract test that loads `backend.env.example` and validates required runtime keys are compatible with `buildConnectionConfig`.

---

### DEFECT-003 — Deploy migration command points to non-existent path inside backend image

Severity: High  
Category: Docker  
Status: Confirmed  
Confidence: High

Files:

- `prod/ops/deploy.sh`
- `backend/Dockerfile`

What is broken:  
Deploy runs `node backend/scripts/check_db.js` inside backend container, but image filesystem places backend files at `/app`, with scripts under `/app/scripts`.

Evidence:  
- `prod/ops/deploy.sh:17` default `MIGRATION_COMMAND=node backend/scripts/check_db.js`
- `backend/Dockerfile` copies `backend/.` to `/app` (no `/app/backend/...` path).

Why it fails:  
Migration step fails before service startup, aborting deployment.

Impact:  
Release deploy fails even when images are valid.

How to reproduce:  
Run `bash prod/ops/deploy.sh <tag>` with migration enabled; migration command exits non-zero with file-not-found.

Recommended fix:  
Set migration command to valid container path (e.g., `node scripts/check_db.js`) or an explicit migration script that exists in image.

Regression test:  
Ops test invoking deploy migration command in container and asserting exit code 0 in a smoke environment.

---

### DEFECT-004 — User controller returns swapped error codes/messages for list/create failures

Severity: Medium  
Category: API Contract  
Status: Confirmed  
Confidence: High

Files:

- `backend/src/controllers/userController.js`

What is broken:  
`listUsers` emits `user_create_failed`, while `createUser` emits `users_list_failed`.

Evidence:  
- `userController.js:423` in `listUsers` catch: `{ error: "user_create_failed" }`
- `userController.js:501` in `createUser` catch: `{ error: "users_list_failed" }`

Why it fails:  
Error contracts are inverted, misleading frontend handling and operational diagnostics.

Impact:  
UI displays wrong failure reason; alerting/log triage misclassifies failures.

How to reproduce:  
Trigger DB error in `/users` list and `/users` create; observe swapped `error` payload fields.

Recommended fix:  
Return route-accurate error codes/messages in each controller catch block.

Regression test:  
Controller tests forcing query failure and asserting exact route-specific error code values.

---

### DEFECT-005 — Chat restore function is stubbed; state restore path is dead

Severity: Medium  
Category: Frontend  
Status: Confirmed  
Confidence: High

Files:

- `frontend/src/hooks/useChatbotLogic.js`

What is broken:  
`restoreMessagesFromStorage` always returns `null`, while caller logic expects potential restored conversation.

Evidence:  
- `useChatbotLogic.js:211-213` returns `null`.
- Multiple effects call this function to restore per-sheet/tab chat state.

Why it fails:  
Conversation restore flow never works; behavior differs from implied design and calling logic.

Impact:  
Users always lose chat history across tab/sheet switches despite restore path being present.

How to reproduce:  
Use chatbot, switch sheet/tab, return; conversation resets consistently.

Recommended fix:  
Either implement storage read path or remove restore flow + related state logic to avoid dead behavior.

Regression test:  
Frontend hook test: store messages, reload hook context, assert restoration occurs.

---

### DEFECT-006 — Semantic DB failures are swallowed, causing silent degraded AI behavior

Severity: High  
Category: AI  
Status: Confirmed  
Confidence: High

Files:

- `backend/src/services/ai/semanticKnowledgeService.js`
- backend test execution output (`npm test`)

What is broken:  
DB failures in semantic knowledge loading are caught and replaced with empty data `{}`.

Evidence:  
- `semanticKnowledgeService.js:60-63` catches DB errors and returns `{}`.
- During `npm test`, repeated `SASL: ... client password must be a string` errors are logged while tests still pass.

Why it fails:  
Core semantic hinting degrades silently instead of failing fast/flagging hard dependency issues.

Impact:  
Planner quality drops unpredictably in production while system appears “healthy”.

How to reproduce:  
Run with broken DB credentials; semantic service logs errors but request flow continues using empty semantic knowledge.

Recommended fix:  
Make failure mode explicit (health signal or typed degraded-state propagation), and fail critical paths where semantic DB is required.

Regression test:  
Integration test with forced DB failure asserting explicit degraded-state response contract (not silent fallback).

---

### DEFECT-007 — Image cleanup script deletes tags by lexical sort, not age or deployed status

Severity: Medium  
Category: Runtime  
Status: Confirmed  
Confidence: High

Files:

- `prod/ops/cleanup_images.sh`

What is broken:  
Tag retention uses `sort -u` on repository:tag strings and removes earliest lexicographic entries.

Evidence:  
- `cleanup_images.sh:25` builds tag list with lexical `sort -u`
- `cleanup_images.sh:33-34` removes first N entries.

Why it fails:  
Lexicographic order does not represent recency or semantic version order. Script can delete currently needed images.

Impact:  
Rollback safety degrades; operational outages possible after cleanup.

How to reproduce:  
Create tags like `v1.9.0`, `v1.10.0`, `v1.2.0`; run cleanup and observe incorrect removals.

Recommended fix:  
Sort by creation time or protect deployed/current tags explicitly using release metadata before deletion.

Regression test:  
Script test fixture with mixed semantic tags asserting newest and current deployed tags are retained.

## Needs Verification

### VERIFY-001 — Potential CSRF/auth interaction edge cases on non-browser API clients

Why suspicious:  
Global CSRF middleware is enforced for all mutating methods except explicit path exemptions.  
What evidence exists:  
`server.js` applies `ensureCsrfCookie` + `csrfProtect` globally before route mounting.  
What would confirm it:  
Client integration tests for API consumers without cookie jar on mutating authenticated endpoints.  
What would disprove it:  
Documented and tested contract showing all supported clients send required CSRF token/cookie pair.  
Recommended verification step:  
Run API-client compatibility matrix (browser SPA, mobile client, server-to-server) against mutating endpoints.

### VERIFY-002 — View/sheet access SQL complexity may hide edge-case over/under-filtering

Why suspicious:  
Permission SQL in `sheetController` and `viewController` is complex and uses layered scope rules.  
What evidence exists:  
Multiple nested EXISTS + source/file/sheet hierarchy filters; tests are mostly source-string assertions.  
What would confirm it:  
End-to-end DB-backed tests with mixed user/group/view assignments and negative controls.  
What would disprove it:  
Comprehensive integration tests proving expected allow/deny matrix over real fixtures.  
Recommended verification step:  
Add integration tests covering cross-group, inherited report-source view scopes, and denied object access.

## API Contract Mismatches

| Caller | Expected | Actual | Impact | Severity |
| --- | --- | --- | --- | --- |
| Frontend runtime (`api.js`, `useAuth`) | Same-origin or configured API endpoint usable in production | Defaults to `http://localhost:4000` | Remote browser users hit their own localhost, API fails | High |
| Prod backend env template | DB env keys recognized by backend DB parser | Template uses `DB_*`, backend reads `POSTGRES_*`/`PG*` | Backend cannot connect DB with provided template | Critical |
| Deploy migration step | Command path valid inside backend image | Default command references non-existent `backend/scripts/...` path | Deploy aborts before startup | High |
| `listUsers`/`createUser` error responses | Route-accurate error codes | Swapped codes (`user_create_failed` vs `users_list_failed`) | Wrong UI behavior and diagnostics | Medium |

## Database / Schema Mismatches

| Code Location | Expected Schema | Actual Schema | Impact | Severity |
| --- | --- | --- | --- | --- |
| `prod/docker/config/backend.env.example` + `backend/src/config/db.js` | Runtime DB config contract aligned | Template keys do not map to parser keys | DB init/query path fails at runtime | Critical |

## Dead, Duplicate, or Misleading Code

| File/Module | Problem | Why It Matters |
| --- | --- | --- |
| `frontend/src/hooks/useChatbotLogic.js` | `restoreMessagesFromStorage` is stubbed (`return null`) | Persistence/restore flow is non-functional while surrounding logic implies support |
| `backend/src/controllers/chatQueryV3Controller.js` | Unreachable `return q;` after prior return in `localizeClarificationQuestion` | Signals sloppy control flow in active user-facing localization path |
| `backend/src/routes/sheetRoutes.js` | Duplicate `/api/sheets/:id/accounting-mappings` aliases alongside `/sheets/:id/...` | Increases route surface and confusion without clear necessity |

## Weak or Misleading Tests

| Test | Problem | Missing Coverage |
| --- | --- | --- |
| `backend/test/sheetDataSecurityRegression.test.js` | Source-text regex assertions against controller files, not runtime behavior | Real DB-backed permission behavior, SQL execution correctness, and route integration |
| `backend/test/requestSizeLimit.test.js` | Verifies source text patterns | Actual app wiring behavior under real server route stack |
| Full backend test run | Passes despite repeated semantic DB connection failures logged (`SASL... client password must be a string`) | Explicit failure/degraded-state assertions for semantic dependency health |

## Priority Fix Order

1. Finding IDs: **DEFECT-002, DEFECT-003**
2. Why first: Deployment cannot reliably start/complete in production with current config/ops scripts.
3. Blast radius: Full production outage on deploy.
4. Safest fix approach: Align env contract to `POSTGRES_*`; fix migration command path to valid in-container script; validate with one dry-run deploy.
5. Regression test required: Ops integration test that runs preflight + migration + deploy with example env and asserts healthy services.

1. Finding IDs: **DEFECT-001**
2. Why first: Even if backend is healthy, frontend fails to reach API for real users when env is missed.
3. Blast radius: All browser-visible product features.
4. Safest fix approach: Default frontend API base to relative same-origin path, keep localhost only in dev-specific config.
5. Regression test required: Build-time test asserting production bundle has no localhost API fallback.

1. Finding IDs: **DEFECT-006**
2. Why first: Silent degraded AI behavior creates incorrect outcomes without clear operational signal.
3. Blast radius: Spreadsheet analysis quality and trustworthiness.
4. Safest fix approach: Convert swallowed semantic DB failures into explicit degraded-state responses/metrics.
5. Regression test required: Forced DB failure test asserting deterministic degraded-state contract and observable signal.

1. Finding IDs: **DEFECT-004**
2. Why first: Misleading API errors hinder support triage and frontend handling.
3. Blast radius: User/admin management error handling.
4. Safest fix approach: Correct response error codes and ensure per-route mapping consistency.
5. Regression test required: Controller error-path tests for `/users` list/create with forced DB errors.

1. Finding IDs: **DEFECT-007**
2. Why first: Cleanup can remove needed images, breaking rollback resilience.
3. Blast radius: Deployment recovery and downtime risk.
4. Safest fix approach: Retain by creation timestamp + protect current deployed tag from `prod/releases/current_release.env`.
5. Regression test required: Script unit test with mixed tag set proving current+newest retention rules.
