#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
COMPOSE_FILE="${ROOT_DIR}/prod/docker/docker-compose.prod.yml"

fail() {
  echo "[healthcheck] FAIL: $1" >&2
  exit 1
}

ok() {
  echo "[healthcheck] OK: $1"
}

cd "${ROOT_DIR}"

docker compose -f "${COMPOSE_FILE}" ps >/tmp/podcaster_compose_ps.txt || fail "compose ps failed"

if ! docker compose -f "${COMPOSE_FILE}" ps | grep -q "podcaster_backend"; then
  fail "backend container missing"
fi
if ! docker compose -f "${COMPOSE_FILE}" ps | grep -q "podcaster_frontend"; then
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
