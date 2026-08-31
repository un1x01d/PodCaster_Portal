#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
COMPOSE_FILE="${ROOT_DIR}/prod/docker/docker-compose.prod.yml"
RELEASE_ENV="${ROOT_DIR}/prod/docker/config/release.env"
PRECHECK="${ROOT_DIR}/prod/ops/preflight.sh"
HEALTHCHECK="${ROOT_DIR}/prod/ops/healthcheck.sh"
SMOKE_TEST="${ROOT_DIR}/prod/ops/smoke_test.sh"
RELEASE_INFO_DIR="${ROOT_DIR}/prod/releases"
RELEASE_INFO_FILE="${RELEASE_INFO_DIR}/current_release.env"

TAG="${1:-}"
SKIP_PULL="${SKIP_PULL:-false}"
RUN_MIGRATIONS="${RUN_MIGRATIONS:-true}"
RUN_SMOKE_TEST="${RUN_SMOKE_TEST:-true}"
MIGRATION_COMMAND="${MIGRATION_COMMAND:-node scripts/migrateTenantDatabases.js}"

fail() {
  echo "[deploy] FAIL: $1" >&2
  exit 1
}

if [[ -z "${TAG}" ]]; then
  fail "usage: bash prod/ops/deploy.sh <release-tag>"
fi

cd "${ROOT_DIR}"

[[ -f "${RELEASE_ENV}" ]] || fail "missing release env: ${RELEASE_ENV}"
# shellcheck disable=SC1090
source "${RELEASE_ENV}"
[[ -n "${BACKEND_IMAGE_REPO:-}" ]] || fail "BACKEND_IMAGE_REPO missing"
[[ -n "${FRONTEND_IMAGE_REPO:-}" ]] || fail "FRONTEND_IMAGE_REPO missing"

RELEASE_TAG="${TAG}" "${PRECHECK}"

if [[ "${SKIP_PULL}" != "true" ]]; then
  echo "[deploy] pulling images for tag ${TAG}"
  RELEASE_TAG="${TAG}" docker compose -f "${COMPOSE_FILE}" --env-file "${RELEASE_ENV}" pull
else
  echo "[deploy] SKIP_PULL=true, using locally available images for tag ${TAG}"
fi

if [[ "${RUN_MIGRATIONS}" == "true" ]]; then
  echo "[deploy] running migration command in backend container image"
  RELEASE_TAG="${TAG}" docker compose -f "${COMPOSE_FILE}" --env-file "${RELEASE_ENV}" run --rm backend sh -lc "${MIGRATION_COMMAND}" || fail "migration command failed"
else
  echo "[deploy] RUN_MIGRATIONS=false, skipping migration step"
fi

echo "[deploy] starting services"
RELEASE_TAG="${TAG}" docker compose -f "${COMPOSE_FILE}" --env-file "${RELEASE_ENV}" up -d --remove-orphans

echo "[deploy] waiting for services to settle"
sleep 3

RELEASE_TAG="${TAG}" "${HEALTHCHECK}"

if [[ "${RUN_SMOKE_TEST}" == "true" ]]; then
  "${SMOKE_TEST}" || fail "smoke test failed"
else
  echo "[deploy] RUN_SMOKE_TEST=false, skipping smoke tests"
fi

mkdir -p "${RELEASE_INFO_DIR}"
DEPLOYED_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
BACKEND_REF="${BACKEND_IMAGE_REPO}:${TAG}"
FRONTEND_REF="${FRONTEND_IMAGE_REPO}:${TAG}"
BACKEND_DIGEST="$(docker image inspect --format='{{index .RepoDigests 0}}' "${BACKEND_REF}" 2>/dev/null || echo '')"
FRONTEND_DIGEST="$(docker image inspect --format='{{index .RepoDigests 0}}' "${FRONTEND_REF}" 2>/dev/null || echo '')"

cat > "${RELEASE_INFO_FILE}" <<META
DEPLOY_TAG=${TAG}
DEPLOYED_AT_UTC=${DEPLOYED_AT}
BACKEND_IMAGE=${BACKEND_REF}
FRONTEND_IMAGE=${FRONTEND_REF}
BACKEND_DIGEST=${BACKEND_DIGEST}
FRONTEND_DIGEST=${FRONTEND_DIGEST}
RUN_MIGRATIONS=${RUN_MIGRATIONS}
MIGRATION_COMMAND=${MIGRATION_COMMAND}
RUN_SMOKE_TEST=${RUN_SMOKE_TEST}
META

echo "[deploy] success: ${TAG}"
