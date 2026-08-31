#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
RELEASE_ENV="${ROOT_DIR}/prod/docker/config/release.env"
DEPLOY_SCRIPT="${ROOT_DIR}/prod/ops/deploy.sh"

REPO_URL="${1:-}"
TAG="${2:-}"

fail() {
  echo "[deploy_from_git] FAIL: $1" >&2
  exit 1
}

if [[ -z "${REPO_URL}" || -z "${TAG}" ]]; then
  fail "usage: bash prod/ops/deploy_from_git.sh <repo-url> <release-tag>"
fi

[[ -f "${RELEASE_ENV}" ]] || fail "missing release env: ${RELEASE_ENV}"
# shellcheck disable=SC1090
source "${RELEASE_ENV}"
[[ -n "${BACKEND_IMAGE_REPO:-}" ]] || fail "BACKEND_IMAGE_REPO missing in release.env"
[[ -n "${FRONTEND_IMAGE_REPO:-}" ]] || fail "FRONTEND_IMAGE_REPO missing in release.env"

command -v git >/dev/null 2>&1 || fail "git is not installed"
command -v docker >/dev/null 2>&1 || fail "docker is not installed"

TMP_DIR="$(mktemp -d /tmp/tforn-insights-release-XXXXXX)"
cleanup() {
  rm -rf "${TMP_DIR}" || true
}
trap cleanup EXIT

echo "[deploy_from_git] cloning ${REPO_URL} tag ${TAG}"
git clone --depth 1 --branch "${TAG}" "${REPO_URL}" "${TMP_DIR}/repo"

if [[ ! -f "${TMP_DIR}/repo/backend/Dockerfile" || ! -f "${TMP_DIR}/repo/frontend/Dockerfile" ]]; then
  fail "required Dockerfiles not found in cloned repo"
fi

echo "[deploy_from_git] building backend image ${BACKEND_IMAGE_REPO}:${TAG}"
docker build -t "${BACKEND_IMAGE_REPO}:${TAG}" -f "${TMP_DIR}/repo/backend/Dockerfile" "${TMP_DIR}/repo"

echo "[deploy_from_git] building frontend image ${FRONTEND_IMAGE_REPO}:${TAG}"
docker build -t "${FRONTEND_IMAGE_REPO}:${TAG}" -f "${TMP_DIR}/repo/frontend/Dockerfile" "${TMP_DIR}/repo"

echo "[deploy_from_git] deploying local images"
SKIP_PULL=true bash "${DEPLOY_SCRIPT}" "${TAG}"

echo "[deploy_from_git] success; temporary cloned repo removed"
