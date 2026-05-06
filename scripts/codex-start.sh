#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

CONFIG_FILE="${CODER_MEMORY_CONFIG:-$SCRIPT_DIR/codex-memory.conf}"
if [ -f "$CONFIG_FILE" ]; then
  # shellcheck source=/dev/null
  source "$CONFIG_FILE"
else
  echo "Codex memory config not found: $CONFIG_FILE"
  exit 1
fi

CODX_CMD="${CODX_CMD:-codex}"

if ! declare -p MEMORY_FILES >/dev/null 2>&1; then
  if [ -z "${CODER_MEMORY_DIR:-}" ]; then
    echo "CODER_MEMORY_DIR is not defined in config: $CONFIG_FILE"
    echo "Set CODER_MEMORY_DIR or define MEMORY_FILES explicitly."
    exit 1
  fi

  if [ ! -d "$CODER_MEMORY_DIR" ]; then
    echo "Memory directory not found: $CODER_MEMORY_DIR"
    exit 1
  fi

  MEMORY_FILES=()
  shopt -s nullglob
  for file in "$CODER_MEMORY_DIR"/*.md; do
    MEMORY_FILES+=("$file")
  done
  shopt -u nullglob

  if [ "${#MEMORY_FILES[@]}" -eq 0 ]; then
    echo "No .md memory files found in: $CODER_MEMORY_DIR"
    exit 1
  fi
else
  if [ "${#MEMORY_FILES[@]}" -eq 0 ]; then
    echo "MEMORY_FILES is defined but empty in $CONFIG_FILE"
    exit 1
  fi
fi

for file in "${MEMORY_FILES[@]}"; do
  if [ -f "$file" ]; then
    echo "Loaded: $file"
  else
    echo "Missing memory file: $file"
  fi
done

if ! command -v "$CODX_CMD" >/dev/null 2>&1; then
  echo "codex command not found: $CODX_CMD"
  echo "Set CODEX_CMD with full path if needed."
  exit 1
fi

exec "$CODX_CMD" "$@"
