#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
DEPLOY_SCRIPT="${ROOT_DIR}/prod/ops/deploy.sh"

TARGET_TAG="${1:-}"

fail() {
  echo "[rollback] FAIL: $1" >&2
  exit 1
}

if [[ -z "${TARGET_TAG}" ]]; then
  fail "usage: bash prod/ops/rollback.sh <previous-release-tag>"
fi

echo "[rollback] deploying previous tag ${TARGET_TAG}"
bash "${DEPLOY_SCRIPT}" "${TARGET_TAG}"

echo "[rollback] complete: now running tag ${TARGET_TAG}"
