#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
RELEASE_ENV="${ROOT_DIR}/prod/docker/config/release.env"
KEEP_TAGS="${KEEP_TAGS:-5}"

fail() {
  echo "[cleanup] FAIL: $1" >&2
  exit 1
}

[[ -f "${RELEASE_ENV}" ]] || fail "missing release env: ${RELEASE_ENV}"
# shellcheck disable=SC1090
source "${RELEASE_ENV}"
[[ -n "${BACKEND_IMAGE_REPO:-}" ]] || fail "BACKEND_IMAGE_REPO missing"
[[ -n "${FRONTEND_IMAGE_REPO:-}" ]] || fail "FRONTEND_IMAGE_REPO missing"

echo "[cleanup] pruning dangling images"
docker image prune -f >/dev/null

cleanup_repo_tags() {
  local repo="$1"
  local keep="$2"
  mapfile -t tags < <(docker image ls --format '{{.Repository}}:{{.Tag}}' "$repo" | grep -v ':<none>$' | sort -u)
  local count="${#tags[@]}"
  if (( count <= keep )); then
    echo "[cleanup] ${repo}: ${count} tags <= keep ${keep}, skipping"
    return 0
  fi
  local remove_count=$((count - keep))
  echo "[cleanup] ${repo}: removing ${remove_count} old tags"
  for ((i=0; i<remove_count; i++)); do
    docker image rm "${tags[$i]}" >/dev/null 2>&1 || true
  done
}

cleanup_repo_tags "${BACKEND_IMAGE_REPO}" "${KEEP_TAGS}"
cleanup_repo_tags "${FRONTEND_IMAGE_REPO}" "${KEEP_TAGS}"

echo "[cleanup] done"
