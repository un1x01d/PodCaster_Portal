# PodCaster Portal Merged Correctness + Security Audit Register - 2026-05-27

User asked to remember the merged list from the last two scans with duplicates removed.

Scope:
- Deep Correctness Audit
- Deep Security Audit
- Repository: `/home/zed/git/tforn/PodCaster_Portal`
- Status: read-only audits; no fixes applied as part of the scans.

Executive verdict:
- Overall risk: HIGH
- Production readiness: NOT READY
- Confidence: HIGH
- Biggest confirmed security defect: `/sheets/:id/data` can trigger AI semantic enrichment with unprojected spreadsheet sample values before view/column restrictions are applied.
- Biggest confirmed correctness defect: 2FA-enabled users cannot complete login from the frontend.
- Biggest data correctness risk: active AI spreadsheet path still contains backend hardcoded NLP/plan mutation that can override planner intent.
- Biggest auth/authorization risk: group-admin view bypass and inconsistent platform-admin role semantics.
- First fixes: secure AI enrichment/projection, fix view authorization scope, remove hardcoded AI plan mutation, wire frontend MFA.

Deduplicated confirmed issues:

1. AI semantic enrichment can disclose unauthorized spreadsheet samples to the LLM provider.
   - Category: Security / AI / Permission / Data Exposure
   - Severity: High
   - Files: `backend/src/controllers/sheetController.js`
   - Evidence: `getSheetData` queries raw `sheet_rows.row_data` for AI header enrichment before server-side projection and row-filter enforcement.
   - Fix direction: remove enrichment from `getSheetData` or only enrich from a permission-aware safe profile.

2. Group admins can bypass locked-view assignment checks globally by supplying `viewId`.
   - Category: Security / Authorization / IDOR / Tenant Scope
   - Severity: High
   - Files: `backend/src/controllers/sheetController.js`
   - Evidence: `canBypassViewAssignmentCheck = isPlatformAdmin || isGroupAdmin`, where `isGroupAdmin` means admin of any group, not the requested sheet/view group.
   - Fix direction: scope group-admin bypass to the requested sheet/report-source group or require explicit view assignment.

3. Storage-provider integrations create SSRF-capable outbound requests.
   - Category: Security / SSRF / Storage Integrations
   - Severity: High
   - Files: `backend/src/controllers/storageController.js`, `backend/src/utils/storageProviders/common.js`, `backend/src/utils/storageProviders/s3.js`
   - Evidence: S3 `endpointUrl`, GCS `tokenUri`, Azure `endpointSuffix`, and SFTP host are user-configurable by authorized admins and fetched/probed from backend without private-network allow/block checks.
   - Fix direction: provider allowlists, DNS/IP private-range blocking, HTTPS restrictions, and sanitized provider errors.

4. Storage-provider upstream response bodies are reflected to callers.
   - Category: Security / SSRF Amplification / Error Disclosure
   - Severity: Medium
   - Files: `backend/src/controllers/storageController.js`, `backend/src/utils/storageProviders/s3.js`
   - Evidence: provider probes/list/download include `text.slice(0, 300/400)` in returned `details` or thrown error messages.
   - Fix direction: return stable error codes only; log sanitized provider/status metadata.

5. Default Docker Compose returns backend stack traces to clients.
   - Category: Security / Error Disclosure / Compose
   - Severity: Medium
   - Files: `docker-compose.yml`, `backend/server.js`
   - Evidence: Compose defaults `NODE_ENV=development`; global error handler returns `message` and `stack` whenever `NODE_ENV !== "production"`.
   - Fix direction: production-like error behavior by default or explicit local-only stack flag.

6. Email ingest can fail open without shared secret outside production/default Compose.
   - Category: Security / Upload / Auth
   - Severity: Medium
   - Files: `backend/src/routes/emailRoutes.js`, `backend/src/controllers/sheet/uploadValidation.js`, `backend/src/controllers/sheetController.js`
   - Evidence: no `EMAIL_INGEST_SHARED_SECRET` returns allowed when `NODE_ENV !== "production"`.
   - Fix direction: require secret unless an explicit local-only override is enabled.

7. Chat audio can bypass sheet-level feature/quota checks when `sheetId` is omitted.
   - Category: Security / AI Cost Abuse / Feature Authorization
   - Severity: Medium
   - Files: `backend/src/controllers/chatController.js`, `backend/src/routes/chatRoutes.js`
   - Evidence: sheet access, `chatAudioEnabled`, and `reserveAiQueryForSheet` are inside `if (sheetId)`; omitted `sheetId` still reaches TTS.
   - Fix direction: require `sheetId` or enforce user/group-level audio controls and quota without it.

8. 2FA/MFA login cannot complete from frontend.
   - Category: Correctness + Security / Auth / Frontend
   - Severity: Medium
   - Files: `backend/src/controllers/authController.js`, `backend/src/routes/authRoutes.js`, `frontend/src/hooks/useAuth.js`, `frontend/src/AppShell.jsx`
   - Evidence: backend returns `requiresTwoFactor` and `challengeId`; frontend assumes `res.data.user` and has no verified `/auth/2fa/verify` login continuation.
   - Fix direction: add frontend MFA challenge state and only authenticate after verification succeeds.

9. Platform-admin role semantics are inconsistent across auth and data flows.
   - Category: Correctness + Security / Auth / Authorization
   - Severity: Medium
   - Files: `backend/src/utils/authorization.js`, `backend/src/controllers/authController.js`, `backend/src/controllers/googleController.js`, `backend/src/controllers/insightController.js`, `backend/src/controllers/insight/insightAnalyticsHelpers.js`, `backend/src/controllers/viewController.js`
   - Evidence: helper accepts `admin`, `super_admin`, `superadmin`, flags; several call sites check only `role === "admin"`.
   - Impacts: invitation/Google auth restrictions miss `super_admin`; insight/view full-access behavior is inconsistent.
   - Fix direction: use `isPlatformAdminUser()` everywhere admin semantics matter.

10. AI clarification state is process-local and not tenant/session scoped.
   - Category: Correctness + Security / AI Session Isolation
   - Severity: Medium
   - Files: `backend/src/services/ai/clarificationManager.js`, `backend/src/controllers/chatQueryV3Controller.js`
   - Evidence: module-level `Map`; key is only `userId:sheetId`.
   - Fix direction: persist by tenant ID, user ID, conversation/session ID, sheet ID, with TTL.

11. One-option clarification auto-continuation drops locale.
   - Category: Correctness / AI Chat UX
   - Severity: Medium
   - Files: `backend/src/controllers/chatQueryV3Controller.js`
   - Evidence: auto-resolve retry does not pass `locale`.
   - Fix direction: preserve locale in every planner retry/continuation.

12. Active AI planner path still contains hardcoded NLP and mutates planner output.
   - Category: Correctness / AI Architecture
   - Severity: High
   - Files: `backend/src/services/ai/deterministicSpreadsheetPlannerV2.js`, `backend/src/controllers/chatQueryV3Controller.js`
   - Evidence: regex/includes logic injects YoY/driver/total steps.
   - Fix direction: backend must validate and execute planner output, not parse user language or inject semantic plans.

13. Planner client still uses legacy `calculation_plan` contract.
   - Category: Correctness / AI Contract
   - Severity: High
   - Files: `backend/src/services/ai/aiCalculationPlanner.js`, `backend/src/services/ai/aiAnalystPlannerClient.js`
   - Evidence: active provider schema asks for legacy `calculation_plan` and converts to `analysis_plan`.
   - Fix direction: make final multi-step `analysis_plan` schema the active provider contract.

14. Multi-step explanation drops computed results and ignores requested sections.
   - Category: Correctness / AI Explanation / Reporting
   - Severity: High
   - Files: `backend/src/services/ai/resultExplanationService.js`, `backend/src/services/ai/deterministicSpreadsheetExecutor.js`
   - Evidence: explanation layer handles only a subset of executor operations in multi-step branch.
   - Fix direction: explain every computed step result with grounded values and tables where appropriate.

15. Sheet cursor pagination generates invalid SQL.
   - Category: Correctness / API / Database
   - Severity: Medium
   - Files: `backend/src/controllers/sheetController.js`
   - Evidence: cursor predicate is appended after `ORDER BY`.
   - Fix direction: build cursor predicates before `ORDER BY`; add route-level pagination regression test.

16. Frontend exports only currently loaded client rows.
   - Category: Correctness / Export
   - Severity: Medium
   - Files: `frontend/src/AppShell.jsx`
   - Evidence: CSV/XLSX/PDF export serializes `sortedData` only.
   - Security note: formula-prefix sanitization exists for CSV/XLSX values.
   - Fix direction: backend export endpoint for full authorized filtered export if full export is intended.

17. Default Compose runs frontend as root with host bind mount and startup `npm install`.
   - Category: Security / Docker / Supply Chain
   - Severity: Medium
   - Files: `docker-compose.yml`, `frontend/Dockerfile`
   - Evidence: Compose overrides runtime user to `0:0`, bind-mounts `./frontend:/app`, and runs `npm install && npm run dev`.
   - Fix direction: separate dev/prod Compose profiles; non-root runtime; no startup install on host bind mount.

18. Backend and frontend dev services are host-exposed by default.
   - Category: Security / Docker / Compose Exposure
   - Severity: Medium
   - Files: `docker-compose.yml`
   - Evidence: backend `4000:4000` and frontend `5173:5173` bind all interfaces.
   - Fix direction: bind local dev ports to `127.0.0.1` or split public deployment Compose.

19. CSP allows browser connections to any HTTPS origin.
   - Category: Security / Headers / XSS Defense-in-depth
   - Severity: Low
   - Files: `backend/server.js`
   - Evidence: `connect-src 'self' http://localhost:* https: ws://localhost:* wss:`.
   - Fix direction: restrict production `connect-src` to required origins.

20. Tests are weak/misleading for security and AI correctness boundaries.
   - Category: Test Quality
   - Severity: Medium
   - Files: `backend/test/security.test.js`, `backend/test/csrfAndRoutes.test.js`, `backend/test/auth.test.js`, `backend/test/uploadRouteHardening.test.js`, `backend/test/composeDefaults.test.js`, `backend/test/aiAnalystArchitecture.test.js`, `backend/test/chatQueryV3.integration.test.js`, `backend/test/aiStructuredPlannerContract.test.js`
   - Evidence: tests mock away active defects, use source-string assertions, miss IDOR/tenant/SSRF/AI-permission/audio-quota tests, and still assert legacy schema.
   - Fix direction: add real route-level and service-level regression tests for each confirmed boundary.

21. Root package cannot run project tests or builds.
   - Category: Correctness / CI / Developer Workflow
   - Severity: Low
   - Files: `package.json`, `backend/package.json`, `frontend/package.json`
   - Evidence: root package has no useful scripts; frontend has no test script.
   - Fix direction: add root orchestration scripts that call existing backend/frontend build/test commands.

22. Supply-chain hygiene risks exist but no CVEs were asserted.
   - Category: Security / Supply Chain
   - Severity: Low
   - Files: `backend/package.json`, `frontend/package.json`, `backend/package-lock.json`, `frontend/package-lock.json`, `backend/Dockerfile`, `frontend/Dockerfile`
   - Evidence: `xlsx` is installed from `cdn.sheetjs.com` tarball with lockfile integrity; Docker images are tag-pinned not digest-pinned; frontend installs `serve@14` globally outside app lockfile.
   - Fix direction: prefer registry or vendored verified artifact for xlsx, digest-pin images for production, avoid global install outside lockfile.

Deduplicated needs-verification items:

1. SFTP username/host may allow OpenSSH option injection.
   - Files: `backend/src/utils/storageProviders/sftp.js`
   - Evidence: user-controlled `username`/`host` build `target` passed to `ssh`/`scp` without `--`; exact OpenSSH parsing behavior needs proof.

2. Public `/metrics` exposure may be acceptable or unsafe depending deployment.
   - Files: `backend/server.js`, `backend/src/controllers/userController.js`
   - Evidence: endpoint is unauthenticated when admin enables DB setting.

3. Dropbox/OneDrive OAuth callback state validation was not fully traced.
   - Files: `backend/src/routes/dropboxRoutes.js`, `backend/src/routes/oneDriveRoutes.js`, related controllers.

4. `cursor_mode=body` response may not match frontend loaders.
   - Files: `backend/src/controllers/sheetController.js`, frontend sheet data loaders.

5. DB memory fallback can hide persistence failure.
   - Files: conversation analysis memory services; verify current implementation before classifying.

Priority fix order:

1. SEC/AI data exposure and view authorization: issues 1-2.
2. Storage SSRF and response reflection: issues 3-4.
3. Remove backend hardcoded AI/NLP plan mutation and legacy planner schema: issues 12-13.
4. Fix explanation coverage for all deterministic multi-step results: issue 14.
5. Implement frontend MFA and normalize platform-admin checks: issues 8-9.
6. Fix clarification persistence/scope and locale preservation: issues 10-11.
7. Fix cursor SQL pagination: issue 15.
8. Harden Compose defaults and chat audio gatekeeping: issues 5, 7, 17-18.
9. Lock down email ingest secret behavior: issue 6.
10. Replace weak tests with boundary tests for every confirmed issue: issue 20.
11. Address export behavior/root scripts/supply-chain hygiene: issues 16, 21-22.
