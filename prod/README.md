# Production Deployment Runbook

This file is the production source of truth for taking Data Insights Portal from local/dev into a real customer-facing deployment.

Current status: **No-Go until the launch gates below are closed.**

The older `prod/README_GCP_PROD.md` is Cloud Run-oriented reference material. This runbook reflects the current preferred production direction: redundant VM/app deployment, private networking, managed PostgreSQL, Cloudflare edge controls, internal Prometheus scraping, and explicit operational checks.

## 1. Production Launch Gates

Do not expose this app to real users until these are complete.

1. Rotate all secrets that have ever existed in local `.env` files, especially provider/API keys.
2. Move production secrets to a secret manager or equivalent. Do not bake secrets into images or commit them.
3. Use production-grade `JWT_SECRET` and `SETTINGS_CRYPTO_KEY`; both must be strong, random, and at least 32 characters.
4. Set `NODE_ENV=production` and ensure backend startup config validation passes.
5. Set `ALLOWED_ORIGINS` to the real frontend origins only. No localhost, wildcard, or broad development origins in production.
6. Put all public traffic behind Cloudflare or another edge gateway with WAF, TLS, bot controls, and distributed rate limits.
7. Restrict direct backend access so only the load balancer, internal network, and Prometheus can reach it.
8. Configure managed PostgreSQL backups, point-in-time recovery, and a tested restore path.
9. Decide and document the migration process. The app currently has runtime DB initialization behavior; production should use reviewed migration rollout.
10. Verify frontend build-time API URL configuration for each environment. Runtime frontend URL injection was intentionally not adopted because it risks breaking current behavior.
11. Keep `/metrics` private/internal only.
12. Add or confirm audit logging for login, upload, export, share, permission changes, and admin actions before regulated or high-trust use.
13. Accept or fix the remaining frontend moderate Vite/esbuild audit advisory. High-severity audit currently passes, but a full fix may require a breaking Vite major upgrade.

## 2. Target Production Architecture

Recommended baseline for redundancy and performance:

- Cloudflare in front of the public application.
- GCP HTTPS Load Balancer or equivalent in front of app VMs.
- Two backend/frontend app VMs or a managed instance group across zones.
- Private VPC network for app-to-database and Prometheus traffic.
- Managed PostgreSQL, preferably Cloud SQL with private IP, automated backups, PITR, and maintenance windows.
- Artifact Registry or equivalent private image registry.
- Secret Manager or equivalent for runtime secrets.
- Internal Prometheus scraping backend `/metrics` over private IP.
- Centralized logs and alerts.

Minimum practical VM shape for the app tier:

- 2 app instances.
- 4 vCPU / 8 GB RAM each if users import or process XLSX files.
- Larger instances or a worker queue if imports approach multiple concurrent 50k-row spreadsheets.

Database baseline:

- Managed PostgreSQL 15+ or compatible.
- Private IP only.
- 4 vCPU / 8-16 GB RAM for production-like imports and dashboard workloads.
- SSD storage with autoscaling enabled if available.
- Automated daily backups and point-in-time recovery.

## 3. Components

Backend:

- Node/Express API.
- PostgreSQL access through `pg`.
- Auth, session/JWT, CSRF, upload/import/export, AI, dashboards, and metrics.
- Dockerfile: `backend/Dockerfile`.
- Entry point: `backend/server.js`.

Frontend:

- React/Vite application.
- Build-time API URL via `VITE_API_URL`.
- Dockerfile: `frontend/Dockerfile`.

Database:

- PostgreSQL.
- One control database plus one dedicated customer database per customer.
- The control database stores super-admin/global state and the `customers` registry.
- Customer databases store customer-owned users, report sources, sheets, rows, views, permissions, integrations, audit logs, import jobs, and AI usage.
- Runtime schema initialization exists in backend DB setup. Treat this as development-friendly behavior, not a substitute for reviewed production migrations.

External providers:

- OpenAI or compatible AI provider if enabled.
- Google/Dropbox/OneDrive integrations if enabled.
- SMTP or notification providers if later added.

Stateful paths:

- PostgreSQL database.
- Uploaded files/import temp data.
- Secrets and OAuth tokens.
- Logs and metrics.

Sensitive data paths:

- Login credentials and password hashes.
- JWT/session data.
- Uploaded spreadsheets and imported rows.
- Dashboard/chart/saved view data.
- AI prompts/responses and derived summaries.
- OAuth tokens for connected providers.

## 4. Required Environment Variables

Backend required for production:

```bash
NODE_ENV=production
PORT=4000
DATABASE_URL=postgres://USER:PASSWORD@HOST:5432/DBNAME
JWT_SECRET=<strong random secret, 32+ chars>
SETTINGS_CRYPTO_KEY=<strong random key, 32+ chars>
ALLOWED_ORIGINS=https://app.example.com
TENANT_DB_ISOLATION_ENABLED=true
TENANT_DB_PREFIX=tenant
TENANT_DB_POOL_MAX=3
TENANT_DB_POOL_IDLE_TIMEOUT_MS=30000
```

Security and auth controls:

```bash
CSRF_STRICT_MODE=true
CSRF_BYPASS_BEARER=false
ALLOW_LEGACY_PLAINTEXT_PASSWORDS=false
```

Resource and performance controls:

```bash
MAX_UPLOAD_MB=25
MAX_IMPORT_ROWS=50000
MAX_IMPORT_COLUMNS=200
MAX_EXPORT_ROWS=50000
MAX_QUERY_LIMIT=1000
DEFAULT_QUERY_LIMIT=100
XLSX_WORKER_DEFAULT_MEMORY_MB=512
XLSX_WORKER_MIN_MEMORY_MB=64
XLSX_WORKER_MAX_MEMORY_MB=4096
AI_MAX_ROWS=500
AI_MAX_COLUMNS=50
AI_TIMEOUT_MS=30000
EXTERNAL_HTTP_TIMEOUT_MS=15000
SHUTDOWN_TIMEOUT_MS=10000
```

Rate limit controls:

```bash
LOGIN_RATE_LIMIT_WINDOW_MS=900000
LOGIN_RATE_LIMIT_MAX=10
AI_RATE_LIMIT_WINDOW_MS=900000
AI_RATE_LIMIT_MAX=30
UPLOAD_RATE_LIMIT_WINDOW_MS=900000
UPLOAD_RATE_LIMIT_MAX=20
EXPORT_RATE_LIMIT_WINDOW_MS=900000
EXPORT_RATE_LIMIT_MAX=30
```

Cloudflare is expected to provide distributed rate limiting. The application-level limiter is still useful as a local safety net, but it is not sufficient by itself across multiple app instances.

Frontend build-time variables:

```bash
VITE_API_URL=https://api.example.com
```

Do not depend on changing `VITE_API_URL` after the frontend is built. Build one frontend artifact per environment.

Optional provider secrets:

```bash
OPENAI_API_KEY=<from secret manager>
GOOGLE_CLIENT_ID=<from secret manager>
GOOGLE_CLIENT_SECRET=<from secret manager>
DROPBOX_CLIENT_ID=<from secret manager>
DROPBOX_CLIENT_SECRET=<from secret manager>
ONEDRIVE_CLIENT_ID=<from secret manager>
ONEDRIVE_CLIENT_SECRET=<from secret manager>
```

## 5. Secret Handling

Production rules:

- No production secrets in `.env`, Git, images, CI logs, shell history, or issue trackers.
- Use Secret Manager, CI/CD protected variables, or an equivalent secret store.
- Rotate any secret that has been present in a local `.env` file or shared terminal output.
- Separate dev, staging, and production secrets.
- Never expose provider keys to the frontend.
- Confirm logs do not include tokens, prompts with sensitive rows, uploaded file contents, or raw provider responses.

## 6. Network and Access Controls

Public ingress:

- Internet -> Cloudflare -> HTTPS Load Balancer -> app instances.

Private traffic:

- App instances -> PostgreSQL over private IP.
- Prometheus -> backend `/metrics` over internal IP.
- Admin SSH/IAP/VPN only. No public SSH if avoidable.

Firewall rules:

- Allow public HTTPS only at Cloudflare/LB.
- Allow app port only from LB health checks/proxies.
- Allow `/metrics` only from Prometheus internal IPs.
- Allow PostgreSQL only from app service accounts/subnets.
- Deny direct database access from the public internet.

Cloudflare controls:

- TLS full strict mode.
- WAF managed rules enabled.
- Login, AI, upload, and export rate limits.
- Bot/fraud controls as appropriate.
- Cache static frontend assets only. Do not cache authenticated API responses unless explicitly safe.

## 7. Build and Validation Commands

Run from repo root unless noted.

Install:

```bash
cd backend && npm ci
cd ../frontend && npm ci
```

Backend tests:

```bash
cd backend && npm test
```

Frontend build:

```bash
cd frontend && npm run build
```

Audit high-severity vulnerabilities:

```bash
cd backend && npm audit --audit-level=high
cd ../frontend && npm audit --audit-level=high
```

Full audit:

```bash
cd backend && npm audit
cd ../frontend && npm audit
```

Expected current caveat:

- Backend audit should be clean.
- Frontend high-severity audit should pass.
- Frontend full audit may still report moderate Vite/esbuild exposure that likely requires a Vite major upgrade. Do not force-upgrade immediately without regression testing.

Docker build:

```bash
docker build -f backend/Dockerfile -t data-insights-portal-backend:prod .
docker build --build-arg "VITE_API_URL=https://api.example.com" -f frontend/Dockerfile -t data-insights-portal-frontend:prod .
```

Container smoke checks:

```bash
docker run --rm data-insights-portal-backend:prod node --version
docker run --rm data-insights-portal-frontend:prod node --version
```

## 8. Container Registry

Example using Artifact Registry:

```bash
gcloud artifacts repositories create data-insights-portal \
  --repository-format=docker \
  --location=us-central1

gcloud auth configure-docker us-central1-docker.pkg.dev

docker tag data-insights-portal-backend:prod us-central1-docker.pkg.dev/PROJECT_ID/data-insights-portal/backend:COMMIT_SHA
docker tag data-insights-portal-frontend:prod us-central1-docker.pkg.dev/PROJECT_ID/data-insights-portal/frontend:COMMIT_SHA

docker push us-central1-docker.pkg.dev/PROJECT_ID/data-insights-portal/backend:COMMIT_SHA
docker push us-central1-docker.pkg.dev/PROJECT_ID/data-insights-portal/frontend:COMMIT_SHA
```

Use immutable tags based on commit SHA. Avoid deploying `latest` to production.

## 9. Database Preparation

Production database requirements:

- PostgreSQL reachable only on private IP.
- Create the control database, normally `portaldb`.
- Enable dedicated customer databases by default: `TENANT_DB_ISOLATION_ENABLED=true`.
- Customer databases are created in the same PostgreSQL instance using names like `tenant_g123`.
- The provisioning identity must be able to create databases, or a separate migration/admin identity must run customer DB provisioning.
- Dedicated application database user with least privilege.
- Separate migration/admin user if runtime app credentials should not have `CREATE DATABASE`.
- Daily backups enabled.
- Point-in-time recovery enabled.
- Restore tested before launch.

Before production:

1. Create the Cloud SQL/PostgreSQL instance.
2. Create the control database (`POSTGRES_DB`, normally `portaldb`).
3. Create the app user and decide whether it may create tenant databases.
4. If app user cannot create tenant databases, create a migration/admin user and run customer provisioning/migration with that identity.
5. Run reviewed migrations or controlled initialization for the control DB.
6. For existing customers, run `POST /groups/:id/provision-database` or `npm run migrate:tenants` from a trusted admin environment.
7. Seed only required production admin account through a controlled script.
8. Force admin password reset on first login if using generated bootstrap credentials.
9. Confirm `ALLOW_LEGACY_PLAINTEXT_PASSWORDS=false`.

Do not use development bootstrap passwords in production.

## 10. Deployment Flow

Recommended deploy sequence:

1. Merge reviewed code to the release branch.
2. Run backend tests, frontend build, audits, and Docker builds.
3. Build immutable backend image.
4. Push images to private registry.
5. Apply database migrations in a controlled step.
6. Deploy backend to one non-serving instance or staging environment.
7. Run smoke checks against backend health/readiness.
8. Build and push the immutable frontend image with the backend URL passed as `--build-arg VITE_API_URL=...`.
9. Deploy frontend.
10. Shift a small percentage of traffic or one instance first.
11. Monitor logs, metrics, and error rates.
12. Roll to all instances only after smoke checks pass.

Avoid deploying schema changes and app changes blindly at the same time unless the migration is backward-compatible.

## 11. VM Runtime Model

Recommended:

- Use managed instance groups or equivalent to keep at least two app instances alive.
- Run containers with a service manager or managed container runtime.
- Configure automatic restart on failure.
- Use health checks from the load balancer.
- Keep application logs on stdout/stderr and ship them centrally.

Production container requirements:

- `NODE_ENV=production`.
- No nodemon.
- No frontend dev server.
- No mounted source tree.
- No shell history containing secrets.
- Non-root runtime user where practical.
- Explicit CPU/memory limits if running under an orchestrator.

## 12. Health and Readiness

Required checks:

- Backend process responds.
- Database connection works.
- App can perform a minimal authenticated or synthetic API path in staging.
- Frontend serves static assets.
- Load balancer health checks target a lightweight health endpoint, not expensive routes.

Expected endpoints:

- `/health` or equivalent liveness endpoint.
- `/ready` or equivalent readiness endpoint if present.
- `/metrics` for Prometheus, internal only.

If readiness does not currently verify database connectivity, add that before relying on automated rollout health.

## 13. Prometheus Metrics

Backend exposes Prometheus-compatible metrics at:

```text
GET /metrics
```

This endpoint must not be publicly reachable.

Example internal scrape config:

```yaml
scrape_configs:
  - job_name: data-insights-portal-backend
    scheme: http
    metrics_path: /metrics
    static_configs:
      - targets:
          - 10.10.1.10:4000
          - 10.10.1.11:4000
```

Recommended alerts:

- High 5xx rate.
- High 4xx rate on login/auth routes.
- P95/P99 latency regression.
- Backend process restarts.
- Database connection failures.
- Upload/import failures.
- Export failures.
- AI provider timeout/error rate.
- Disk usage on app and database nodes.
- Database CPU, memory, storage, lock waits, and connection saturation.

## 14. Logging and Observability

Required:

- Request ID on every API request and response.
- Safe structured logs for request method, path, status, duration, and request ID.
- Error logs with request ID and safe metadata.
- No raw passwords, tokens, provider secrets, uploaded files, prompt payloads, or full spreadsheet rows in logs.
- Centralized log retention with access controls.

Needed before high-trust production:

- Audit events for login, logout, upload, export, share, permission changes, admin actions, and destructive actions.
- Dashboard for auth failures, import/export volume, AI calls, latency, and errors.

## 15. File Import and Export Operations

Risks:

- XLSX parsing can consume significant memory.
- Concurrent 50k-row imports can pressure CPU, RAM, and database.
- Export routes can generate large payloads.

Controls:

- Enforce upload size limits.
- Enforce row and column limits.
- Restrict import concurrency at the edge or app layer.
- Keep app instances sized for expected import concurrency.
- Prefer queue-based background processing if imports become frequent or exceed 50k rows.
- Ensure exports apply the same authorization and row/column filtering as normal API views.

Operational guidance:

- 5 parallel imports of 50k rows each need substantially more headroom than normal dashboard browsing.
- For production, start with 2 app VMs at 4 vCPU / 8 GB RAM and watch memory, CPU, event loop lag, and DB write latency.
- Increase app RAM or move imports to workers if memory pressure or request timeouts appear.

## 16. AI/LLM Operations

Required controls:

- AI routes must enforce the same sheet/report-source/customer authorization as normal data access.
- Row filters and restricted columns must be applied before sending data to AI.
- AI prompts and responses must not be logged with sensitive data.
- AI calls must have timeouts and row/column/token bounds.
- AI output must be treated as untrusted. Do not execute model-generated SQL, shell, code, config, or destructive actions.

Cost and abuse controls:

- Cloudflare rate limits for AI endpoints.
- App-level per-user or per-IP limits as defense-in-depth.
- Provider timeout configured.
- Alert on AI error rate and cost spikes.

## 17. Backup and Restore

Database model:

- Back up the control database and every active customer database.
- The control DB alone is not enough. It points to customer DB names through `customers.db_name`.
- A customer DB alone is not enough for full auth/routing. Restore it with the matching control DB row.
- Enable automated backups for the Cloud SQL/PostgreSQL instance.
- Enable point-in-time recovery for the instance.
- Keep backups in the same region for recovery speed and consider cross-region copies for disaster recovery.
- Test restore into a staging database before launch.

What to create for exports:

1. A private backup bucket with retention policy, for example `gs://PROJECT-prod-db-exports`.
2. IAM so the Cloud SQL service account can write/read export objects.
3. A scheduled export job or runbook execution account.
4. A secure way to query the control DB for active tenant DB names.

Cloud SQL service account:

```bash
export PROJECT_ID="your-project-id"
export DB_INSTANCE="data-insights-pg"
export BACKUP_BUCKET="PROJECT-prod-db-exports"

CLOUDSQL_SA="$(gcloud sql instances describe "$DB_INSTANCE" --format='value(serviceAccountEmailAddress)')"
gcloud storage buckets add-iam-policy-binding "gs://${BACKUP_BUCKET}" \
  --member="serviceAccount:${CLOUDSQL_SA}" \
  --role="roles/storage.objectAdmin"
```

Export the control DB and each customer DB separately:

```bash
export DB_INSTANCE="data-insights-pg"
export CONTROL_DB="portaldb"
export BACKUP_BUCKET="PROJECT-prod-db-exports"
export STAMP="$(date -u +%Y%m%dT%H%M%SZ)"

gcloud sql export sql "$DB_INSTANCE" \
  "gs://${BACKUP_BUCKET}/${STAMP}/control-${CONTROL_DB}.sql.gz" \
  --database="$CONTROL_DB"

# Run this query against the control DB and review the result before exporting:
# SELECT db_name FROM customers WHERE status = 'active' ORDER BY id;

for TENANT_DB in tenant_g123 tenant_g456; do
  gcloud sql export sql "$DB_INSTANCE" \
    "gs://${BACKUP_BUCKET}/${STAMP}/${TENANT_DB}.sql.gz" \
    --database="$TENANT_DB"
done
```

If using `pg_dump` instead of Cloud SQL native export, use custom-format dumps and export one file per database:

```bash
pg_dump --format=custom --no-owner --no-acl --dbname="$CONTROL_DATABASE_URL" --file="control.dump"
pg_dump --format=custom --no-owner --no-acl --dbname="$TENANT_DATABASE_URL" --file="tenant_g123.dump"
```

Full environment restore:

1. Prefer Cloud SQL point-in-time restore to a new instance when recovering the whole environment.
2. Do not overwrite production in place. Restore to a new instance/database set first.
3. Restore/import the control DB.
4. Restore/import every tenant DB using the exact `db_name` values stored in `customers.db_name`.
5. Point staging backend to the restored instance and run smoke/permission checks.
6. Cut production over only after validation.

Cloud SQL import pattern:

```bash
gcloud sql databases create "$CONTROL_DB" --instance="$RESTORE_INSTANCE"
gcloud sql import sql "$RESTORE_INSTANCE" \
  "gs://${BACKUP_BUCKET}/${STAMP}/control-${CONTROL_DB}.sql.gz" \
  --database="$CONTROL_DB"

for TENANT_DB in tenant_g123 tenant_g456; do
  gcloud sql databases create "$TENANT_DB" --instance="$RESTORE_INSTANCE"
  gcloud sql import sql "$RESTORE_INSTANCE" \
    "gs://${BACKUP_BUCKET}/${STAMP}/${TENANT_DB}.sql.gz" \
    --database="$TENANT_DB"
done
```

Single-customer restore:

1. Block or pause access for that customer before cutover.
2. Restore the customer DB dump into a new database name, for example `tenant_g123_restore_20260430`.
3. Run validation queries against the restored customer DB.
4. In the control DB, update only that customer row: `UPDATE customers SET db_name = 'tenant_g123_restore_20260430', updated_at = CURRENT_TIMESTAMP WHERE group_id = 123;`.
5. Force affected users to log in again so new JWTs carry the new tenant DB name.
6. Keep the old tenant DB read-only until the rollback window expires.

Files/uploads:

- If uploads are stored locally, this is not horizontally safe.
- For production, prefer object storage with private buckets and signed/authorized access through the backend.
- If local disk is used temporarily, ensure the path is persistent, backed up if needed, and not shared publicly.

Restore test:

1. Restore latest backup to staging.
2. Point staging backend to the restored control DB and restored customer DBs.
3. Verify login, customer routing, sheet listing, dashboards, export, and AI permission paths.
4. Verify a user from customer A cannot access customer B data after restore.
5. Verify no production users are accidentally emailed or notified from staging.

## 18. Rollback Plan

Application rollback:

1. Keep the previous backend and frontend image tags.
2. Roll backend back first if API errors spike.
3. Roll frontend back if UI build/config is the issue.
4. Confirm DB schema compatibility before rollback.
5. If a migration is not backward-compatible, rollback requires a specific data migration plan.

Database rollback:

- Prefer backward-compatible migrations.
- Do not rely on destructive down migrations in production.
- For serious data corruption, restore to a new database and cut over after validation.

Fast rollback command pattern:

```bash
docker pull REGISTRY/backend:PREVIOUS_COMMIT_SHA
docker pull REGISTRY/frontend:PREVIOUS_COMMIT_SHA
```

Then update the instance group/service definition to the previous immutable tags.

## 19. Smoke Test Checklist

Run after every production deployment:

1. Open frontend over HTTPS.
2. Log in as a non-admin test user.
3. Log in as an admin test user.
4. Confirm `/me` returns expected user identity.
5. Upload a small XLSX.
6. List sheets.
7. Open a sheet.
8. Create or load a dashboard/chart.
9. Export data as a permitted user.
10. Confirm unauthorized user cannot access the same sheet/export by changing IDs.
11. Trigger an AI query if AI is enabled and verify permissions are respected.
12. Confirm `/metrics` is reachable only from Prometheus/internal network.
13. Confirm direct backend access from the public internet is blocked.
14. Confirm Cloudflare rate limits fire on abusive login attempts.

## 20. Manual Security Checks Before Launch

Authorization:

- Normal user cannot access another user's sheet by changing `sheetId`.
- Normal user cannot access another report source/customer by changing IDs.
- Viewer cannot update, delete, share, or export beyond allowed permissions.
- Admin routes reject normal users.
- Export and AI routes enforce the same authorization as sheet viewing.

Auth/session:

- Login works with CSRF behavior expected by the frontend.
- Logout invalidates client session state as expected.
- Cookies/tokens are not exposed in URLs or logs.
- Production secrets are not defaults.

Browser:

- CORS only allows production frontend origins.
- No wildcard origins with credentials.
- Security headers are present through app or edge.

Files:

- Path traversal filenames are rejected.
- Oversized uploads are rejected.
- CSV/Excel formula injection is neutralized in exports if CSV/XLSX exports include user-controlled cell text.

## 21. CI/CD Requirements

Pipeline should run:

```bash
cd backend && npm ci && npm test && npm audit --audit-level=high
cd frontend && npm ci && npm run build && npm audit --audit-level=high
docker build -f backend/Dockerfile -t backend:$COMMIT_SHA .
docker build --build-arg "VITE_API_URL=$BACKEND_URL" -f frontend/Dockerfile -t frontend:$COMMIT_SHA .
```

Pipeline should also:

- Block production deploys on failed tests/build/audit-high.
- Produce immutable image tags.
- Store build metadata: commit SHA, branch, build timestamp.
- Never print secrets.
- Deploy through staging before production.

## 22. Known Deferred Work

These are not cosmetic; they are real production hardening items.

1. Replace runtime schema initialization with explicit migrations.
2. Add admin/security audit events.
3. Add readiness endpoint that verifies DB connectivity if not already present.
4. Move heavy imports to a worker queue if concurrent import load grows.
5. Add distributed app-side rate limiting only if Cloudflare is bypassed or internal endpoints become exposed.
6. Resolve the frontend moderate Vite/esbuild advisory with a planned major upgrade and regression test pass.
7. Add object storage for uploads if files must survive app instance replacement or scale horizontally.
8. Add dashboards and alerts for AI usage/cost, import latency, export latency, and DB saturation.

## 23. Go/No-Go Checklist

Go only if all are true:

- Production secrets are rotated and stored outside Git/images.
- Backend starts with `NODE_ENV=production`.
- Backend config validation passes.
- Frontend was built with the production `VITE_API_URL`.
- Cloudflare and LB TLS are configured.
- Backend direct public access is blocked.
- Database private IP, backups, and PITR are enabled.
- Smoke tests pass.
- Unauthorized object access tests pass.
- Backend tests pass.
- Frontend build passes.
- High-severity audits pass.
- Prometheus scrapes `/metrics` internally.
- Rollback image tags are available.
- Restore process has been tested at least once in staging.

If any item is false, the decision is **No-Go**.
