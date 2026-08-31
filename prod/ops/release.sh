#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
RELEASE_ENV="${ROOT_DIR}/prod/docker/config/release.env"
DEPLOY_SCRIPT="${ROOT_DIR}/prod/ops/deploy.sh"
VERSION_FILE="${ROOT_DIR}/VERSION"

usage() {
  cat <<'HELP'
Usage:
  bash prod/ops/release.sh <patch|minor|major> [options]

Bump types:
  patch  Backward-compatible bug, security, documentation, or performance fix
  minor  Backward-compatible user-facing feature
  major  Breaking API, data, auth, or deployment change

Options:
  --message TEXT  Release commit/tag message (required)
  --push          Push the release commit and tag to origin
  --deploy        Build app images and deploy this release locally
  --dry-run       Show the calculated version without changing anything
  -h, --help      Show this help

Examples:
  bash prod/ops/release.sh patch --message "Fix password reset click handling"
  VITE_API_URL=https://app.example.com/api bash prod/ops/release.sh patch --message "Fix password reset" --deploy
HELP
}

fail() {
  echo "[release] FAIL: $1" >&2
  exit 1
}

BUMP_TYPE="${1:-}"
if [[ "${BUMP_TYPE}" == "-h" || "${BUMP_TYPE}" == "--help" ]]; then
  usage
  exit 0
fi
[[ "${BUMP_TYPE}" =~ ^(patch|minor|major)$ ]] || fail "the bump type must be explicitly patch, minor, or major"
shift

MESSAGE=""
PUSH=false
DEPLOY=false
DRY_RUN=false
while [[ $# -gt 0 ]]; do
  case "$1" in
    --message)
      [[ $# -ge 2 ]] || fail "--message requires text"
      MESSAGE="$2"
      shift 2
      ;;
    --push)
      PUSH=true
      shift
      ;;
    --deploy)
      DEPLOY=true
      shift
      ;;
    --dry-run)
      DRY_RUN=true
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      fail "unknown option: $1"
      ;;
  esac
done

[[ -n "${MESSAGE}" ]] || fail "--message is required"
command -v git >/dev/null 2>&1 || fail "git is required"

[[ -f "${VERSION_FILE}" ]] || fail "missing VERSION file: ${VERSION_FILE}"
CURRENT_VERSION="$(tr -d '[:space:]' < "${VERSION_FILE}")"
[[ "${CURRENT_VERSION}" =~ ^([0-9]+)\.([0-9]+)\.([0-9]+)$ ]] || fail "VERSION must contain SemVer like 1.2.3"
MAJOR="${BASH_REMATCH[1]}"
MINOR="${BASH_REMATCH[2]}"
PATCH="${BASH_REMATCH[3]}"

case "${BUMP_TYPE}" in
  patch) PATCH=$((PATCH + 1)) ;;
  minor) MINOR=$((MINOR + 1)); PATCH=0 ;;
  major) MAJOR=$((MAJOR + 1)); MINOR=0; PATCH=0 ;;
esac
NEXT_VERSION="${MAJOR}.${MINOR}.${PATCH}"
TAG="v${NEXT_VERSION}"

echo "[release] ${CURRENT_VERSION} -> ${NEXT_VERSION} (${BUMP_TYPE})"
case "${BUMP_TYPE}" in
  patch) echo "[release] meaning: backward-compatible fix" ;;
  minor) echo "[release] meaning: backward-compatible feature" ;;
  major) echo "[release] meaning: breaking change" ;;
esac

if [[ "${DRY_RUN}" == "true" ]]; then
  exit 0
fi

cd "${ROOT_DIR}"
[[ -z "$(git status --porcelain)" ]] || fail "working tree is dirty; commit or stash changes before releasing"
git show-ref --tags --verify --quiet "refs/tags/${TAG}" && fail "tag already exists: ${TAG}"

printf '%s\n' "${NEXT_VERSION}" > "${VERSION_FILE}"
git add VERSION
git commit -m "chore(release): ${TAG} - ${MESSAGE}"
git tag -a "${TAG}" -m "${TAG}: ${MESSAGE}"

if [[ "${PUSH}" == "true" ]]; then
  git push origin HEAD "${TAG}"
fi

if [[ "${DEPLOY}" == "true" ]]; then
  [[ -f "${RELEASE_ENV}" ]] || fail "missing production release env: ${RELEASE_ENV}"
  # The API URL is baked into the frontend image. Require it explicitly so a
  # release cannot accidentally ship a localhost API endpoint.
  [[ -n "${VITE_API_URL:-}" ]] || fail "VITE_API_URL is required with --deploy"
  # shellcheck disable=SC1090
  source "${RELEASE_ENV}"
  [[ -n "${BACKEND_IMAGE_REPO:-}" ]] || fail "BACKEND_IMAGE_REPO missing in release.env"
  [[ -n "${FRONTEND_IMAGE_REPO:-}" ]] || fail "FRONTEND_IMAGE_REPO missing in release.env"

  docker build -t "${BACKEND_IMAGE_REPO}:${TAG}" -f backend/Dockerfile .
  docker build --build-arg "VITE_API_URL=${VITE_API_URL}" -t "${FRONTEND_IMAGE_REPO}:${TAG}" -f frontend/Dockerfile .
  SKIP_PULL=true RUN_MIGRATIONS=false bash "${DEPLOY_SCRIPT}" "${TAG}"
fi

echo "[release] success: ${TAG}"
if [[ "${PUSH}" != "true" ]]; then
  echo "[release] release commit/tag remain local; use --push when ready"
fi
