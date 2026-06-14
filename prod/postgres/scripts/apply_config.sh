#!/usr/bin/env bash
set -euo pipefail

if [[ "${EUID}" -ne 0 ]]; then
  echo "Run as root: sudo bash $0"
  exit 1
fi

PG_MAJOR="${PG_MAJOR:-16}"
PG_CONF_DIR="/etc/postgresql/${PG_MAJOR}/main"
APPEND_CONF="/home/zed/git/tforn/PodCaster_Portal/prod/postgres/config/postgresql.conf.append"
APPEND_HBA="/home/zed/git/tforn/PodCaster_Portal/prod/postgres/config/pg_hba.conf.append"

if [[ ! -d "${PG_CONF_DIR}" ]]; then
  echo "PostgreSQL config dir not found: ${PG_CONF_DIR}"
  exit 1
fi

cp "${PG_CONF_DIR}/postgresql.conf" "${PG_CONF_DIR}/postgresql.conf.bak.$(date +%s)"
cp "${PG_CONF_DIR}/pg_hba.conf" "${PG_CONF_DIR}/pg_hba.conf.bak.$(date +%s)"

if ! grep -q "PodCaster Portal baseline tuning" "${PG_CONF_DIR}/postgresql.conf"; then
  echo >> "${PG_CONF_DIR}/postgresql.conf"
  cat "${APPEND_CONF}" >> "${PG_CONF_DIR}/postgresql.conf"
fi

if ! grep -q "PodCaster Portal host-local access only" "${PG_CONF_DIR}/pg_hba.conf"; then
  echo >> "${PG_CONF_DIR}/pg_hba.conf"
  cat "${APPEND_HBA}" >> "${PG_CONF_DIR}/pg_hba.conf"
fi

systemctl restart postgresql
systemctl status postgresql --no-pager -l | sed -n '1,40p'
