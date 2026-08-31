# TFORN Insights: Production Deployment on GCP

This guide deploys the app to Google Cloud with production-grade managed services.

## 1. Recommended Architecture

- Runtime: Cloud Run (backend + frontend containers)
- Database: Cloud SQL for PostgreSQL
- Secrets: Secret Manager
- Container registry: Artifact Registry
- TLS + domain: Cloud Run managed certificate (or HTTPS LB if needed)
- Optional static frontend: Cloud Storage + Cloud CDN

## 2. Prerequisites

- GCP project with billing enabled
- `gcloud` CLI installed and authenticated
- Docker installed
- Domain (optional)

Set variables:

```bash
export PROJECT_ID="your-project-id"
export REGION="us-central1"
export REPO="tforn-insights"
export BACKEND_SERVICE="data-insights-backend"
export FRONTEND_SERVICE="data-insights-frontend"
export DB_INSTANCE="data-insights-pg"
export DB_NAME="tforn_insights_db"
export DB_USER="tforn_insights"
export TENANT_DB_PREFIX="tenant"
```

```bash
gcloud config set project "$PROJECT_ID"
gcloud services enable run.googleapis.com sqladmin.googleapis.com secretmanager.googleapis.com artifactregistry.googleapis.com cloudbuild.googleapis.com
```

## 3. Create Artifact Registry

```bash
gcloud artifacts repositories create "$REPO" \
  --repository-format=docker \
  --location="$REGION" \
  --description="TFORN Insights images"

gcloud auth configure-docker "${REGION}-docker.pkg.dev"
```

## 4. Create Cloud SQL (PostgreSQL)

```bash
gcloud sql instances create "$DB_INSTANCE" \
  --database-version=POSTGRES_18 \
  --cpu=2 \
  --memory=8GB \
  --region="$REGION"

gcloud sql databases create "$DB_NAME" --instance="$DB_INSTANCE"
```

`$DB_NAME` is the control database. The app creates one additional database per customer by default, using names like `tenant_g123`.

Create DB password and user:

```bash
export DB_PASSWORD="$(openssl rand -base64 32 | tr -d '\n')"
gcloud sql users create "$DB_USER" --instance="$DB_INSTANCE" --password="$DB_PASSWORD"
```

The runtime/provisioning DB user must be able to create customer databases. If your production policy does not allow runtime `CREATE DATABASE`, use a separate migration/admin user for customer provisioning and tenant migrations.

## 5. Create Secrets

Store required app secrets:

```bash
printf "%s" "$DB_PASSWORD" | gcloud secrets create DB_PASSWORD --data-file=-
printf "%s" "your-openai-api-key" | gcloud secrets create OPENAI_API_KEY --data-file=-
printf "%s" "your-jwt-secret" | gcloud secrets create JWT_SECRET --data-file=-
printf "%s" "your-jwt-issuer" | gcloud secrets create JWT_ISSUER --data-file=-
printf "%s" "your-jwt-audience" | gcloud secrets create JWT_AUDIENCE --data-file=-
printf "%s" "your-settings-crypto-key" | gcloud secrets create SETTINGS_CRYPTO_KEY --data-file=-
```

If secret exists already, add new version:

```bash
printf "%s" "new-value" | gcloud secrets versions add SECRET_NAME --data-file=-
```

Grant Cloud Run service account access:

```bash
PROJECT_NUMBER="$(gcloud projects describe "$PROJECT_ID" --format='value(projectNumber)')"
RUNTIME_SA="${PROJECT_NUMBER}-compute@developer.gserviceaccount.com"
for s in DB_PASSWORD OPENAI_API_KEY JWT_SECRET JWT_ISSUER JWT_AUDIENCE SETTINGS_CRYPTO_KEY; do
  gcloud secrets add-iam-policy-binding "$s" \
    --member="serviceAccount:${RUNTIME_SA}" \
    --role="roles/secretmanager.secretAccessor"
done
```

## 6. Build and Push Images

Backend:

```bash
docker build -f backend/Dockerfile -t "${REGION}-docker.pkg.dev/${PROJECT_ID}/${REPO}/backend:latest" .
docker push "${REGION}-docker.pkg.dev/${PROJECT_ID}/${REPO}/backend:latest"
```

Build the frontend after the backend is deployed, because Vite bakes `VITE_API_URL` into the static assets at build time.

## 7. Deploy Backend to Cloud Run

Get Cloud SQL connection name:

```bash
export CLOUDSQL_CONN="$(gcloud sql instances describe "$DB_INSTANCE" --format='value(connectionName)')"
```

Deploy backend:

```bash
gcloud run deploy "$BACKEND_SERVICE" \
  --image "${REGION}-docker.pkg.dev/${PROJECT_ID}/${REPO}/backend:latest" \
  --region "$REGION" \
  --platform managed \
  --allow-unauthenticated \
  --add-cloudsql-instances "$CLOUDSQL_CONN" \
  --set-env-vars "NODE_ENV=production,PORT=8080,TENANT_DB_ISOLATION_ENABLED=true,TENANT_DB_PREFIX=${TENANT_DB_PREFIX},TENANT_DB_POOL_MAX=3,XLSX_WORKER_DEFAULT_MEMORY_MB=512,XLSX_WORKER_MIN_MEMORY_MB=64,XLSX_WORKER_MAX_MEMORY_MB=4096,OPENAI_MODEL=gpt-4o-mini,OPENAI_BASE_URL=https://api.openai.com/v1,OPENAI_TIMEOUT_MS=60000,CHAT_AUDIO_MAX_CHARS=8000,POSTGRES_HOST=/cloudsql/${CLOUDSQL_CONN},POSTGRES_PORT=5432,POSTGRES_USER=${DB_USER},POSTGRES_DB=${DB_NAME}" \
  --set-secrets "POSTGRES_PASSWORD=DB_PASSWORD:latest,OPENAI_API_KEY=OPENAI_API_KEY:latest,JWT_SECRET=JWT_SECRET:latest,JWT_ISSUER=JWT_ISSUER:latest,JWT_AUDIENCE=JWT_AUDIENCE:latest,SETTINGS_CRYPTO_KEY=SETTINGS_CRYPTO_KEY:latest"
```

The backend now supports database connection via discrete variables (`POSTGRES_HOST`, `POSTGRES_PORT`, `POSTGRES_USER`, `POSTGRES_DB`, `POSTGRES_PASSWORD`) so DB credentials do not need to be embedded in a single `DATABASE_URL` value.
`TENANT_DB_ISOLATION_ENABLED=true` is the intended production default. New customers receive dedicated databases automatically.

## 8. Deploy Frontend to Cloud Run

Set backend URL:

```bash
export BACKEND_URL="$(gcloud run services describe "$BACKEND_SERVICE" --region "$REGION" --format='value(status.url)')"
```

Build and push frontend with the backend URL baked into the artifact:

```bash
docker build \
  --build-arg "VITE_API_URL=${BACKEND_URL}" \
  -f frontend/Dockerfile \
  -t "${REGION}-docker.pkg.dev/${PROJECT_ID}/${REPO}/frontend:latest" \
  .
docker push "${REGION}-docker.pkg.dev/${PROJECT_ID}/${REPO}/frontend:latest"
```

Deploy frontend:

```bash
gcloud run deploy "$FRONTEND_SERVICE" \
  --image "${REGION}-docker.pkg.dev/${PROJECT_ID}/${REPO}/frontend:latest" \
  --region "$REGION" \
  --platform managed \
  --allow-unauthenticated
```

## 9. CORS and Allowed Origins

Backend uses explicit allowlist via `ALLOWED_ORIGINS`. Set it to frontend URL(s):

```bash
FRONTEND_URL="$(gcloud run services describe "$FRONTEND_SERVICE" --region "$REGION" --format='value(status.url)')"
gcloud run services update "$BACKEND_SERVICE" \
  --region "$REGION" \
  --set-env-vars "ALLOWED_ORIGINS=${FRONTEND_URL}"
```

If using custom domains, include both production and admin domains in comma-separated form.

## 10. DB Initialization and Tenant Databases

- This app runs DB init automatically on backend startup (`initDb()`).
- On fresh environments (new Cloud SQL instance), tables/settings are created automatically.
- The control DB gets the `customers` registry.
- Each customer DB gets the same application schema and a customer shell record.
- Existing customers can be provisioned with `POST /groups/:id/provision-database`.
- Tenant migrations can be run with `cd backend && npm run migrate:tenants` from a trusted environment with DB access.
- No Docker volume persistence is needed on Cloud Run + Cloud SQL.

## 11. Export and Restore Databases

Create a private export bucket and grant Cloud SQL access:

```bash
export BACKUP_BUCKET="${PROJECT_ID}-prod-db-exports"
gcloud storage buckets create "gs://${BACKUP_BUCKET}" --location="$REGION"

CLOUDSQL_SA="$(gcloud sql instances describe "$DB_INSTANCE" --format='value(serviceAccountEmailAddress)')"
gcloud storage buckets add-iam-policy-binding "gs://${BACKUP_BUCKET}" \
  --member="serviceAccount:${CLOUDSQL_SA}" \
  --role="roles/storage.objectAdmin"
```

Export the control DB and every active customer DB separately:

```bash
export STAMP="$(date -u +%Y%m%dT%H%M%SZ)"

gcloud sql export sql "$DB_INSTANCE" \
  "gs://${BACKUP_BUCKET}/${STAMP}/control-${DB_NAME}.sql.gz" \
  --database="$DB_NAME"

# Get active tenant DBs from the control DB:
# SELECT db_name FROM customers WHERE status = 'active' ORDER BY id;

for TENANT_DB in tenant_g123 tenant_g456; do
  gcloud sql export sql "$DB_INSTANCE" \
    "gs://${BACKUP_BUCKET}/${STAMP}/${TENANT_DB}.sql.gz" \
    --database="$TENANT_DB"
done
```

Full restore:

1. Prefer Cloud SQL point-in-time restore to a new instance for full-environment recovery.
2. If restoring exports manually, create/import the control DB first.
3. Create/import every customer DB using the exact names stored in `customers.db_name`.
4. Point staging to the restored instance and verify login, customer routing, sheet data, exports, and AI permissions before production cutover.

Manual import pattern:

```bash
export RESTORE_INSTANCE="data-insights-pg-restore"

gcloud sql databases create "$DB_NAME" --instance="$RESTORE_INSTANCE"
gcloud sql import sql "$RESTORE_INSTANCE" \
  "gs://${BACKUP_BUCKET}/${STAMP}/control-${DB_NAME}.sql.gz" \
  --database="$DB_NAME"

for TENANT_DB in tenant_g123 tenant_g456; do
  gcloud sql databases create "$TENANT_DB" --instance="$RESTORE_INSTANCE"
  gcloud sql import sql "$RESTORE_INSTANCE" \
    "gs://${BACKUP_BUCKET}/${STAMP}/${TENANT_DB}.sql.gz" \
    --database="$TENANT_DB"
done
```

Single-customer restore:

1. Restore that tenant dump to a new DB name such as `tenant_g123_restore_20260430`.
2. Validate row counts, report sources, permissions, views, and imports.
3. Update the control DB row: `UPDATE customers SET db_name = 'tenant_g123_restore_20260430', updated_at = CURRENT_TIMESTAMP WHERE group_id = 123;`.
4. Force affected users to log in again so JWTs carry the new tenant DB.
5. Keep the old tenant DB read-only through the rollback window.

## 12. Post-Deploy Checks

Health checks:

```bash
curl -fsS "${BACKEND_URL}/healthz"
curl -fsS "${BACKEND_URL}/readyz"
```

Smoke tests:

- Login/auth
- Sheet upload
- Chat query and chat audio
- Dashboard KPI + AI actions
- Translation locale switch

## 13. Operations and Hardening

- Set Cloud Run min instances for lower cold starts.
- Configure request timeout and concurrency per service.
- Enable Cloud Run CPU always allocated only if needed.
- Watch Cloud SQL connection count. One DB per customer means tenant pool limits matter.
- Add Cloud Monitoring alerts:
  - 5xx rate
  - latency p95
  - Cloud SQL CPU/storage
  - Cloud SQL connection saturation
  - error logs with `internal_server_error`
- Rotate secrets regularly (Secret Manager versions).
- Restrict ingress if app is private (IAP or internal LB).
- Use least-privilege service accounts (do not use default SA in strict environments).

## 14. Rollback

Cloud Run revisions make rollback easy:

```bash
gcloud run revisions list --service "$BACKEND_SERVICE" --region "$REGION"
gcloud run services update-traffic "$BACKEND_SERVICE" --region "$REGION" --to-revisions REVISION_NAME=100
```

Repeat for frontend service if needed.

## 15. Optional: CI/CD

Use Cloud Build triggers on `main`:
- Build backend/frontend images
- Push to Artifact Registry
- Deploy Cloud Run
- Run basic smoke tests

---

If you want, next step is adding a ready-to-use `cloudbuild.yaml` and env-specific deployment scripts (`deploy-prod.sh`, `deploy-staging.sh`).
