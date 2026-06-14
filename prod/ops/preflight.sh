#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
COMPOSE_FILE="${ROOT_DIR}/prod/docker/docker-compose.prod.yml"
BACKEND_ENV="${ROOT_DIR}/prod/docker/config/backend.env"
FRONTEND_ENV="${ROOT_DIR}/prod/docker/config/frontend.env"
RELEASE_ENV="${ROOT_DIR}/prod/docker/config/release.env"

fail() {
  echo "[preflight] FAIL: $1" >&2
  exit 1
}

ok() {
  echo "[preflight] OK: $1"
}

command -v docker >/dev/null 2>&1 || fail "docker is not installed"
command -v curl >/dev/null 2>&1 || fail "curl is not installed"
command -v nginx >/dev/null 2>&1 || fail "nginx is not installed"
command -v psql >/dev/null 2>&1 || fail "psql client is not installed"

[[ -f "${COMPOSE_FILE}" ]] || fail "compose file missing: ${COMPOSE_FILE}"
[[ -f "${BACKEND_ENV}" ]] || fail "backend env missing: ${BACKEND_ENV}"
[[ -f "${FRONTEND_ENV}" ]] || fail "frontend env missing: ${FRONTEND_ENV}"
[[ -f "${RELEASE_ENV}" ]] || fail "release env missing: ${RELEASE_ENV}"

ok "required binaries and files are present"

# shellcheck disable=SC1090
source "${RELEASE_ENV}"
[[ -n "${BACKEND_IMAGE_REPO:-}" ]] || fail "BACKEND_IMAGE_REPO missing in release.env"
[[ -n "${FRONTEND_IMAGE_REPO:-}" ]] || fail "FRONTEND_IMAGE_REPO missing in release.env"
ok "release image repos are configured"

grep -q '^DB_HOST=' "${BACKEND_ENV}" || fail "DB_HOST is missing in backend.env"
grep -q '^DB_PORT=' "${BACKEND_ENV}" || fail "DB_PORT is missing in backend.env"
grep -q '^DB_NAME=' "${BACKEND_ENV}" || fail "DB_NAME is missing in backend.env"
grep -q '^DB_USER=' "${BACKEND_ENV}" || fail "DB_USER is missing in backend.env"
grep -q '^DB_PASSWORD=' "${BACKEND_ENV}" || fail "DB_PASSWORD is missing in backend.env"
ok "backend DB env keys present"

if ! nginx -t >/dev/null 2>&1; then
  fail "nginx config test failed"
fi
ok "nginx config test passed"

if ! systemctl is-active --quiet postgresql; then
  fail "postgresql service is not active"
fi
ok "postgresql service is active"

if ! docker compose -f "${COMPOSE_FILE}" --env-file "${RELEASE_ENV}" config >/dev/null; then
  fail "docker compose config validation failed"
fi
ok "docker compose config is valid"

echo "[preflight] all checks passed"
