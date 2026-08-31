#!/usr/bin/env bash
set -euo pipefail

BACKUP_DIR="${BACKUP_DIR:-/var/backups/tforn-insights-postgres}"
DB_NAME="${DB_NAME:-tforn_insights_db}"
DB_USER="${DB_USER:-tforn_insights}"
RETENTION_DAYS="${RETENTION_DAYS:-14}"

mkdir -p "${BACKUP_DIR}"
chmod 700 "${BACKUP_DIR}"

TS="$(date -u +%Y%m%dT%H%M%SZ)"
OUT_FILE="${BACKUP_DIR}/${DB_NAME}_${TS}.dump"

pg_dump -U "${DB_USER}" -d "${DB_NAME}" -F c -Z 9 -f "${OUT_FILE}"

echo "Backup written: ${OUT_FILE}"
find "${BACKUP_DIR}" -type f -name "${DB_NAME}_*.dump" -mtime +"${RETENTION_DAYS}" -delete
