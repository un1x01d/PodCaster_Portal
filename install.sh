#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_DIR="${ROOT_DIR}/backend"
FRONTEND_DIR="${ROOT_DIR}/frontend"

WITH_DOCKER=0

usage() {
  cat <<'EOF'
Usage: ./install.sh [--with-docker] [--help]

Installs project dependencies for:
  - root
  - backend
  - frontend

Options:
  --with-docker   Also pull/build docker images via docker compose.
  --help          Show this help.
EOF
}

log() {
  printf '[install] %s\n' "$*"
}

fail() {
  printf '[install][error] %s\n' "$*" >&2
  exit 1
}

parse_args() {
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --with-docker)
        WITH_DOCKER=1
        shift
        ;;
      --help|-h)
        usage
        exit 0
        ;;
      *)
        fail "Unknown option: $1 (use --help)"
        ;;
    esac
  done
}

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || fail "Required command not found: $1"
}

check_node_version() {
  local node_version major minor
  node_version="$(node -v | sed 's/^v//')"
  major="${node_version%%.*}"
  minor="$(printf '%s' "$node_version" | cut -d. -f2)"

  if [[ "${major:-0}" -lt 18 ]] || { [[ "${major:-0}" -eq 18 ]] && [[ "${minor:-0}" -lt 18 ]]; }; then
    fail "Node.js >= 18.18 is required. Found: v${node_version}"
  fi
  log "Node.js version OK: v${node_version}"
}

install_node_project() {
  local dir="$1"
  local name="$2"
  local lock_file="${dir}/package-lock.json"
  local pkg_file="${dir}/package.json"

  [[ -f "${pkg_file}" ]] || {
    log "Skipping ${name}: no package.json"
    return 0
  }

  log "Installing ${name} dependencies..."
  if [[ -f "${lock_file}" ]]; then
    (cd "${dir}" && npm ci)
  else
    (cd "${dir}" && npm install)
  fi
}

install_docker_deps() {
  local compose_file="${ROOT_DIR}/docker-compose.yml"
  [[ -f "${compose_file}" ]] || {
    log "Skipping docker setup: docker-compose.yml not found"
    return 0
  }

  if docker compose version >/dev/null 2>&1; then
    log "Preparing Docker images (pull/build)..."
    (cd "${ROOT_DIR}" && docker compose pull && docker compose build)
  elif command -v docker-compose >/dev/null 2>&1; then
    log "Preparing Docker images (pull/build) with docker-compose..."
    (cd "${ROOT_DIR}" && docker-compose pull && docker-compose build)
  else
    fail "Docker Compose is not available (docker compose or docker-compose)."
  fi
}

main() {
  parse_args "$@"
  require_cmd node
  require_cmd npm
  check_node_version

  install_node_project "${ROOT_DIR}" "root"
  install_node_project "${BACKEND_DIR}" "backend"
  install_node_project "${FRONTEND_DIR}" "frontend"

  if [[ "${WITH_DOCKER}" -eq 1 ]]; then
    require_cmd docker
    install_docker_deps
  fi

  log "Install complete."
  log "Next: run backend with 'cd backend && npm run dev' and frontend with 'cd frontend && npm run dev'"
}

main "$@"
