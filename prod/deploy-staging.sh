#!/usr/bin/env bash
set -euo pipefail

# Required
: "${PROJECT_ID:?Set PROJECT_ID}"

# Staging defaults (override as needed)
REGION="${REGION:-us-central1}"
REPO="${REPO:-podcaster-portal}"
BACKEND_SERVICE="${BACKEND_SERVICE:-podcaster-backend-staging}"
FRONTEND_SERVICE="${FRONTEND_SERVICE:-podcaster-frontend-staging}"
DB_INSTANCE="${DB_INSTANCE:-podcaster-pg-staging}"
DB_NAME="${DB_NAME:-portaldb}"
DB_USER="${DB_USER:-portal}"
TAG="${TAG:-staging}"

gcloud config set project "$PROJECT_ID" >/dev/null

BACKEND_IMAGE="${REGION}-docker.pkg.dev/${PROJECT_ID}/${REPO}/backend:${TAG}"
FRONTEND_IMAGE="${REGION}-docker.pkg.dev/${PROJECT_ID}/${REPO}/frontend:${TAG}"

echo "Building backend image: ${BACKEND_IMAGE}"
docker build -f backend/Dockerfile -t "${BACKEND_IMAGE}" .
docker push "${BACKEND_IMAGE}"

echo "Building frontend image: ${FRONTEND_IMAGE}"
docker build -f frontend/Dockerfile -t "${FRONTEND_IMAGE}" .
docker push "${FRONTEND_IMAGE}"

CLOUDSQL_CONN="$(gcloud sql instances describe "$DB_INSTANCE" --format='value(connectionName)')"
DB_PASSWORD="$(gcloud secrets versions access latest --secret=DB_PASSWORD)"
DATABASE_URL="postgresql://${DB_USER}:${DB_PASSWORD}@/${DB_NAME}?host=/cloudsql/${CLOUDSQL_CONN}"

echo "Deploying backend service: ${BACKEND_SERVICE}"
gcloud run deploy "${BACKEND_SERVICE}" \
  --image "${BACKEND_IMAGE}" \
  --region "${REGION}" \
  --platform managed \
  --allow-unauthenticated \
  --add-cloudsql-instances "${CLOUDSQL_CONN}" \
  --set-env-vars "NODE_ENV=production,PORT=8080,OPENAI_MODEL=gpt-4o-mini,OPENAI_BASE_URL=https://api.openai.com/v1,OPENAI_TIMEOUT_MS=60000,CHAT_AUDIO_MAX_CHARS=8000,POSTGRES_USER=${DB_USER},POSTGRES_DB=${DB_NAME},DATABASE_URL=${DATABASE_URL}" \
  --set-secrets "POSTGRES_PASSWORD=DB_PASSWORD:latest,OPENAI_API_KEY=OPENAI_API_KEY:latest,JWT_SECRET=JWT_SECRET:latest,JWT_ISSUER=JWT_ISSUER:latest,JWT_AUDIENCE=JWT_AUDIENCE:latest,SETTINGS_CRYPTO_KEY=SETTINGS_CRYPTO_KEY:latest"

BACKEND_URL="$(gcloud run services describe "${BACKEND_SERVICE}" --region "${REGION}" --format='value(status.url)')"

echo "Deploying frontend service: ${FRONTEND_SERVICE}"
gcloud run deploy "${FRONTEND_SERVICE}" \
  --image "${FRONTEND_IMAGE}" \
  --region "${REGION}" \
  --platform managed \
  --allow-unauthenticated \
  --set-env-vars "VITE_API_URL=${BACKEND_URL}"

FRONTEND_URL="$(gcloud run services describe "${FRONTEND_SERVICE}" --region "${REGION}" --format='value(status.url)')"
gcloud run services update "${BACKEND_SERVICE}" \
  --region "${REGION}" \
  --set-env-vars "ALLOWED_ORIGINS=${FRONTEND_URL}"

echo "Staging deploy complete"
echo "Backend:  ${BACKEND_URL}"
echo "Frontend: ${FRONTEND_URL}"
