#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
BACKEND_ENV="${ROOT_DIR}/prod/docker/config/backend.env"
FRONTEND_ENV="${ROOT_DIR}/prod/docker/config/frontend.env"
RELEASE_ENV="${ROOT_DIR}/prod/docker/config/release.env"

fail() {
  echo "[env] FAIL: $1" >&2
  exit 1
}

check_file() {
  local f="$1"
  [[ -f "$f" ]] || fail "missing file: $f"
}

check_kv() {
  local f="$1"
  local k="$2"
  grep -q "^${k}=" "$f" || fail "missing ${k} in ${f}"
}

check_not_placeholder() {
  local f="$1"
  local k="$2"
  local v
  v="$(grep -E "^${k}=" "$f" | tail -n1 | cut -d'=' -f2- || true)"
  [[ -n "$v" ]] || fail "empty ${k} in ${f}"
  [[ "$v" != *CHANGE_ME* ]] || fail "placeholder value for ${k} in ${f}"
}

check_file "$BACKEND_ENV"
check_file "$FRONTEND_ENV"
check_file "$RELEASE_ENV"

check_kv "$BACKEND_ENV" DB_HOST
check_kv "$BACKEND_ENV" DB_PORT
check_kv "$BACKEND_ENV" DB_NAME
check_kv "$BACKEND_ENV" DB_USER
check_kv "$BACKEND_ENV" DB_PASSWORD
check_kv "$BACKEND_ENV" JWT_SECRET
check_not_placeholder "$BACKEND_ENV" DB_PASSWORD
check_not_placeholder "$BACKEND_ENV" JWT_SECRET

check_kv "$RELEASE_ENV" BACKEND_IMAGE_REPO
check_kv "$RELEASE_ENV" FRONTEND_IMAGE_REPO
check_not_placeholder "$RELEASE_ENV" BACKEND_IMAGE_REPO
check_not_placeholder "$RELEASE_ENV" FRONTEND_IMAGE_REPO

echo "[env] OK: env files look production-ready"
