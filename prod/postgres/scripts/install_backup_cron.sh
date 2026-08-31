#!/usr/bin/env bash
set -euo pipefail

if [[ "${EUID}" -ne 0 ]]; then
  echo "Run as root: sudo bash $0"
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKUP_SCRIPT="${SCRIPT_DIR}/backup_db.sh"
LOG_FILE="/var/log/tforn-insights-db-backup.log"
CRON_FILE="/etc/cron.d/tforn-insights-db-backup"
CRON_SCHEDULE="${CRON_SCHEDULE:-30 2 * * *}"
RUN_AS_USER="${RUN_AS_USER:-postgres}"

if [[ ! -x "${BACKUP_SCRIPT}" ]]; then
  echo "Backup script not executable: ${BACKUP_SCRIPT}"
  exit 1
fi

touch "${LOG_FILE}"
chmod 640 "${LOG_FILE}"

cat > "${CRON_FILE}" <<CRON
${CRON_SCHEDULE} ${RUN_AS_USER} ${BACKUP_SCRIPT} >> ${LOG_FILE} 2>&1
CRON
chmod 644 "${CRON_FILE}"

echo "Installed cron: ${CRON_FILE}"
cat "${CRON_FILE}"
