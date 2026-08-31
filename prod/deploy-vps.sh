#!/usr/bin/env bash
set -euo pipefail

# Bootstrap and deploy TFORN Insights on a single Ubuntu/Debian VPS.
# Required: DOMAIN, SSL_CERT_PATH, SSL_KEY_PATH. Secrets are generated when omitted.

if [[ "${EUID}" -ne 0 ]]; then
  echo "Run as root: sudo DOMAIN=app.example.com SSL_CERT_PATH=/path/cert.pem SSL_KEY_PATH=/path/key.pem bash $0" >&2
  exit 1
fi

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DOMAIN="${DOMAIN:-}"
SSL_CERT_PATH="${SSL_CERT_PATH:-}"
SSL_KEY_PATH="${SSL_KEY_PATH:-}"
TAG="${TAG:-local-$(date -u +%Y%m%d%H%M%S)}"
BACKEND_ENV_FILE="${ROOT_DIR}/prod/docker/config/backend.env"
DB_PASSWORD="${POSTGRES_PASSWORD:-}"
if [[ -z "${DB_PASSWORD}" && -f "${BACKEND_ENV_FILE}" ]]; then
  DB_PASSWORD="$(grep -E '^POSTGRES_PASSWORD=' "${BACKEND_ENV_FILE}" | tail -n1 | cut -d= -f2- || true)"
fi
DB_PASSWORD="${DB_PASSWORD:-$(openssl rand -hex 24)}"
JWT_SECRET="${JWT_SECRET:-$(openssl rand -hex 32)}"
SETTINGS_CRYPTO_KEY="${SETTINGS_CRYPTO_KEY:-$(openssl rand -hex 32)}"

fail() { echo "[vps-deploy] FAIL: $1" >&2; exit 1; }
[[ -n "${DOMAIN}" ]] || fail "DOMAIN is required"
[[ -n "${SSL_CERT_PATH}" ]] || fail "SSL_CERT_PATH is required"
[[ -f "${SSL_CERT_PATH}" ]] || fail "certificate file does not exist: ${SSL_CERT_PATH}"
[[ -n "${SSL_KEY_PATH}" ]] || fail "SSL_KEY_PATH is required"
[[ -f "${SSL_KEY_PATH}" ]] || fail "key file does not exist: ${SSL_KEY_PATH}"

export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get install -y ca-certificates curl git openssl nginx

if ! command -v docker >/dev/null 2>&1; then
  apt-get install -y docker.io docker-compose-plugin
  systemctl enable --now docker
fi

PG_MAJOR=18 bash "${ROOT_DIR}/prod/postgres/scripts/install_postgres.sh"
PG_MAJOR=18 bash "${ROOT_DIR}/prod/postgres/scripts/apply_config.sh"

install -d -m 0750 "${ROOT_DIR}/prod/docker/config"
if [[ ! -f "${ROOT_DIR}/prod/docker/config/backend.env" ]]; then
  awk -v db_password="${DB_PASSWORD}" -v jwt_secret="${JWT_SECRET}" '
    /^POSTGRES_PASSWORD=/ { print "POSTGRES_PASSWORD=" db_password; next }
    /^JWT_SECRET=/ { print "JWT_SECRET=" jwt_secret; next }
    { print }
  ' "${ROOT_DIR}/prod/docker/config/backend.env.example" > "${ROOT_DIR}/prod/docker/config/backend.env"
fi
if ! grep -q '^SETTINGS_CRYPTO_KEY=' "${ROOT_DIR}/prod/docker/config/backend.env"; then
  printf '\nSETTINGS_CRYPTO_KEY=%s\n' "${SETTINGS_CRYPTO_KEY}" >> "${ROOT_DIR}/prod/docker/config/backend.env"
fi
if ! grep -q '^ALLOWED_ORIGINS=' "${ROOT_DIR}/prod/docker/config/backend.env"; then
  printf 'ALLOWED_ORIGINS=https://%s\n' "${DOMAIN}" >> "${ROOT_DIR}/prod/docker/config/backend.env"
fi
if [[ ! -f "${ROOT_DIR}/prod/docker/config/frontend.env" ]]; then
  cp "${ROOT_DIR}/prod/docker/config/frontend.env.example" "${ROOT_DIR}/prod/docker/config/frontend.env"
fi
if [[ ! -f "${ROOT_DIR}/prod/docker/config/release.env" ]]; then
  cat > "${ROOT_DIR}/prod/docker/config/release.env" <<EOF
BACKEND_IMAGE_REPO=tforn-insights-backend
FRONTEND_IMAGE_REPO=tforn-insights-frontend
EOF
fi
DEPLOY_USER="${SUDO_USER:-$(stat -c '%U' "${ROOT_DIR}")}"
DEPLOY_GROUP="$(id -gn "${DEPLOY_USER}" 2>/dev/null || stat -c '%G' "${ROOT_DIR}")"
chown "${DEPLOY_USER}:${DEPLOY_GROUP}" "${ROOT_DIR}/prod/docker/config"/*.env
chmod 640 "${ROOT_DIR}/prod/docker/config"/*.env

# Bootstrap the local control database with the generated password without
# putting credentials into the repository's static SQL file. psql variables
# cannot be used as PL/pgSQL expressions inside a DO block, so branch in the
# shell and quote the password for plain SQL.
DB_PASSWORD_SQL="${DB_PASSWORD//\'/\'\'}"
if runuser -u postgres -- psql postgres -Atqc "SELECT 1 FROM pg_roles WHERE rolname='tforn_insights'" | grep -q '^1$'; then
  runuser -u postgres -- psql postgres -v ON_ERROR_STOP=1 \
    -c "ALTER ROLE tforn_insights PASSWORD '${DB_PASSWORD_SQL}';"
else
  runuser -u postgres -- psql postgres -v ON_ERROR_STOP=1 \
    -c "CREATE ROLE tforn_insights LOGIN PASSWORD '${DB_PASSWORD_SQL}';"
fi
if ! runuser -u postgres -- psql postgres -Atqc "SELECT 1 FROM pg_database WHERE datname='tforn_insights_db'" | grep -q '^1$'; then
  runuser -u postgres -- createdb -O tforn_insights tforn_insights_db
fi
runuser -u postgres -- psql -d tforn_insights_db -v ON_ERROR_STOP=1 \
  -c 'REVOKE ALL ON SCHEMA public FROM PUBLIC; GRANT USAGE, CREATE ON SCHEMA public TO tforn_insights;'

# Install and validate the SSL reverse-proxy configuration before migrations
# or application startup, so failures cannot leave the VPS without its site.
sed \
  -e "s/__SERVER_NAME__/${DOMAIN}/g" \
  -e "s#__SSL_CERT_PATH__#${SSL_CERT_PATH}#g" \
  -e "s#__SSL_KEY_PATH__#${SSL_KEY_PATH}#g" \
  "${ROOT_DIR}/prod/nginx/nginx_site.conf" > /etc/nginx/conf.d/tforn-insights.conf
nginx -t
if systemctl is-active --quiet nginx; then
  systemctl reload nginx
else
  systemctl enable --now nginx
fi

docker build -t "tforn-insights-backend:${TAG}" -f "${ROOT_DIR}/backend/Dockerfile" "${ROOT_DIR}"
docker build --build-arg "VITE_API_URL=https://${DOMAIN}/api" \
  -t "tforn-insights-frontend:${TAG}" -f "${ROOT_DIR}/frontend/Dockerfile" "${ROOT_DIR}"
# Keep a convenient local alias for direct operational Compose commands. The
# deployment itself still runs the immutable timestamped tag above.
docker tag "tforn-insights-backend:${TAG}" tforn-insights-backend:latest
docker tag "tforn-insights-frontend:${TAG}" tforn-insights-frontend:latest

cd "${ROOT_DIR}"
SKIP_PULL=true RUN_MIGRATIONS=true RUN_SMOKE_TEST=true \
  bash prod/ops/deploy.sh "${TAG}"

echo "[vps-deploy] success: https://${DOMAIN} (tag ${TAG})"
