#!/usr/bin/env bash
set -euo pipefail

if [[ "${EUID}" -ne 0 ]]; then
  echo "Run as root: sudo bash $0"
  exit 1
fi

PG_MAJOR="${PG_MAJOR:-18}"
PG_CONF_DIR="/etc/postgresql/${PG_MAJOR}/main"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
POSTGRES_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
APPEND_CONF="${POSTGRES_DIR}/config/postgresql.conf.append"
APPEND_HBA="${POSTGRES_DIR}/config/pg_hba.conf.append"

if [[ ! -d "${PG_CONF_DIR}" ]]; then
  echo "PostgreSQL config dir not found: ${PG_CONF_DIR}"
  exit 1
fi

cp "${PG_CONF_DIR}/postgresql.conf" "${PG_CONF_DIR}/postgresql.conf.bak.$(date +%s)"
cp "${PG_CONF_DIR}/pg_hba.conf" "${PG_CONF_DIR}/pg_hba.conf.bak.$(date +%s)"

if ! grep -q "TFORN Insights baseline tuning" "${PG_CONF_DIR}/postgresql.conf"; then
  echo >> "${PG_CONF_DIR}/postgresql.conf"
  cat "${APPEND_CONF}" >> "${PG_CONF_DIR}/postgresql.conf"
fi

if ! grep -q "TFORN Insights host-local access only" "${PG_CONF_DIR}/pg_hba.conf"; then
  echo >> "${PG_CONF_DIR}/pg_hba.conf"
  cat "${APPEND_HBA}" >> "${PG_CONF_DIR}/pg_hba.conf"
fi

# Containers reach the host PostgreSQL instance through Docker's host-gateway
# address. Bind only to that gateway in addition to loopback, and allow only
# Docker's private address space in pg_hba.conf (never the public interface).
if ! grep -q "TFORN Insights Docker bridge access" "${PG_CONF_DIR}/postgresql.conf"; then
  DOCKER_GATEWAY="$(docker network inspect bridge --format '{{(index .IPAM.Config 0).Gateway}}' 2>/dev/null || true)"
  if [[ -z "${DOCKER_GATEWAY}" ]]; then
    echo "Could not determine Docker bridge gateway; Docker must be running." >&2
    exit 1
  fi
  {
    echo
    echo "# TFORN Insights Docker bridge access"
    echo "listen_addresses = '127.0.0.1,${DOCKER_GATEWAY}'"
  } >> "${PG_CONF_DIR}/postgresql.conf"
fi

if ! grep -q "TFORN Insights Docker private networks" "${PG_CONF_DIR}/pg_hba.conf"; then
  {
    echo
    echo "# TFORN Insights Docker private networks"
    echo "host all all 172.16.0.0/12 scram-sha-256"
  } >> "${PG_CONF_DIR}/pg_hba.conf"
fi

systemctl restart postgresql
systemctl status postgresql --no-pager -l | sed -n '1,40p'
