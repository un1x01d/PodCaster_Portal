#!/usr/bin/env bash
set -euo pipefail

ROOT_URL="${ROOT_URL:-http://127.0.0.1:5173}"
API_URL="${API_URL:-http://127.0.0.1:4000}"

fail() {
  echo "[smoke] FAIL: $1" >&2
  exit 1
}

ok() {
  echo "[smoke] OK: $1"
}

curl -fsS --max-time 10 "${ROOT_URL}/" >/dev/null || fail "frontend root unreachable"
ok "frontend root reachable"

# Accept either 200/401/403 for protected API routes as long as server responds.
status_api="$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 "${API_URL}/api/sheets/active" || true)"
case "${status_api}" in
  200|401|403) ok "api route responds with ${status_api}" ;;
  *) fail "unexpected API status for /api/sheets/active: ${status_api}" ;;
esac

status_upload="$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 -X OPTIONS "${API_URL}/api/upload" || true)"
case "${status_upload}" in
  200|204|401|403|404) ok "upload route reachable (${status_upload})" ;;
  *) fail "unexpected upload route status: ${status_upload}" ;;
esac

echo "[smoke] all checks passed"
