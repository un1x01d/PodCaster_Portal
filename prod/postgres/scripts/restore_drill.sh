#!/usr/bin/env bash
set -euo pipefail

BACKUP_DIR="${BACKUP_DIR:-/var/backups/tforn-insights-postgres}"
DB_USER="${DB_USER:-tforn_insights}"
DRILL_DB="${DRILL_DB:-tforn_insights_restore_drill}"

LATEST_DUMP="$(ls -1t "${BACKUP_DIR}"/*.dump 2>/dev/null | head -n1 || true)"
if [[ -z "${LATEST_DUMP}" ]]; then
  echo "No dump files found in ${BACKUP_DIR}"
  exit 1
fi

echo "[restore_drill] using dump: ${LATEST_DUMP}"

psql -U "${DB_USER}" -d postgres -c "DROP DATABASE IF EXISTS ${DRILL_DB};" >/dev/null
psql -U "${DB_USER}" -d postgres -c "CREATE DATABASE ${DRILL_DB};" >/dev/null

pg_restore -U "${DB_USER}" -d "${DRILL_DB}" --clean --if-exists --no-owner --no-privileges "${LATEST_DUMP}" >/dev/null

TABLE_COUNT="$(psql -U "${DB_USER}" -d "${DRILL_DB}" -tAc "SELECT count(*) FROM information_schema.tables WHERE table_schema='public';")"
if [[ "${TABLE_COUNT}" -eq 0 ]]; then
  echo "[restore_drill] FAIL: restored DB has zero public tables"
  exit 1
fi

echo "[restore_drill] OK: restore verified, public tables=${TABLE_COUNT}"
