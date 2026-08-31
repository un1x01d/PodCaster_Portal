#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
COMPOSE_FILE="${ROOT_DIR}/prod/docker/docker-compose.prod.yml"
RELEASE_ENV="${ROOT_DIR}/prod/docker/config/release.env"

fail() {
  echo "[healthcheck] FAIL: $1" >&2
  exit 1
}

ok() {
  echo "[healthcheck] OK: $1"
}

cd "${ROOT_DIR}"

[[ -f "${RELEASE_ENV}" ]] || fail "release env missing: ${RELEASE_ENV}"
[[ -n "${RELEASE_TAG:-}" ]] || fail "RELEASE_TAG is required"

docker compose -f "${COMPOSE_FILE}" --env-file "${RELEASE_ENV}" ps >/tmp/tforn_insights_compose_ps.txt || fail "compose ps failed"

if ! docker compose -f "${COMPOSE_FILE}" --env-file "${RELEASE_ENV}" ps | grep -q "tforn_insights_backend"; then
  fail "backend container missing"
fi
if ! docker compose -f "${COMPOSE_FILE}" --env-file "${RELEASE_ENV}" ps | grep -q "tforn_insights_frontend"; then
  fail "frontend container missing"
fi
ok "containers are present"

curl -fsS --max-time 10 http://127.0.0.1:5173/ >/dev/null || fail "frontend is not reachable on 127.0.0.1:5173"
ok "frontend reachable"

curl -fsS --max-time 10 http://127.0.0.1:4000/ >/dev/null || echo "[healthcheck] WARN: backend root path did not return 200"

if systemctl is-active --quiet postgresql; then
  ok "postgresql active"
else
  fail "postgresql service inactive"
fi

if systemctl is-active --quiet nginx; then
  ok "nginx active"
else
  fail "nginx service inactive"
fi

echo "[healthcheck] completed"
