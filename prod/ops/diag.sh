#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
COMPOSE_FILE="${ROOT_DIR}/prod/docker/docker-compose.prod.yml"

cd "${ROOT_DIR}"

echo "=== docker compose ps ==="
docker compose -f "${COMPOSE_FILE}" ps || true

echo
echo "=== backend logs (last 120 lines) ==="
docker compose -f "${COMPOSE_FILE}" logs --tail=120 backend || true

echo
echo "=== frontend logs (last 120 lines) ==="
docker compose -f "${COMPOSE_FILE}" logs --tail=120 frontend || true

echo
echo "=== nginx status ==="
systemctl status nginx --no-pager -l | sed -n '1,80p' || true

echo
echo "=== postgres status ==="
systemctl status postgresql --no-pager -l | sed -n '1,80p' || true
