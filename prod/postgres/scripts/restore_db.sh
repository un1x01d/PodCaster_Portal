#!/usr/bin/env bash
set -euo pipefail

if [[ $# -lt 1 ]]; then
  echo "Usage: $0 /path/to/backup.dump [db_name] [db_user]"
  exit 1
fi

DUMP_FILE="$1"
DB_NAME="${2:-tforn_insights_db}"
DB_USER="${3:-tforn_insights}"

if [[ ! -f "${DUMP_FILE}" ]]; then
  echo "Dump file not found: ${DUMP_FILE}"
  exit 1
fi

pg_restore -U "${DB_USER}" -d "${DB_NAME}" --clean --if-exists --no-owner --no-privileges "${DUMP_FILE}"
echo "Restore complete: ${DUMP_FILE} -> ${DB_NAME}"
