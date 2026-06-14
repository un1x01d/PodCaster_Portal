#!/usr/bin/env bash
set -euo pipefail

if [[ "${EUID}" -ne 0 ]]; then
  echo "Run as root: sudo bash $0"
  exit 1
fi

PG_MAJOR="${PG_MAJOR:-16}"
export DEBIAN_FRONTEND=noninteractive

apt-get update
apt-get install -y --no-install-recommends ca-certificates curl gnupg lsb-release

install -d -m 0755 /etc/apt/keyrings
curl -fsSL https://www.postgresql.org/media/keys/ACCC4CF8.asc | gpg --dearmor -o /etc/apt/keyrings/postgresql.gpg
chmod 0644 /etc/apt/keyrings/postgresql.gpg

. /etc/os-release
if [[ "${ID}" != "ubuntu" && "${ID}" != "debian" ]]; then
  echo "Unsupported distro for this installer: ${ID}"
  exit 1
fi

if [[ -z "${VERSION_CODENAME:-}" ]]; then
  echo "Missing VERSION_CODENAME in /etc/os-release"
  exit 1
fi

echo "deb [signed-by=/etc/apt/keyrings/postgresql.gpg] http://apt.postgresql.org/pub/repos/apt ${VERSION_CODENAME}-pgdg main" > /etc/apt/sources.list.d/pgdg.list

apt-get update
apt-get install -y --no-install-recommends \
  postgresql-${PG_MAJOR} \
  postgresql-client-${PG_MAJOR} \
  postgresql-contrib-${PG_MAJOR}

systemctl enable postgresql
systemctl restart postgresql

echo "Installed PostgreSQL:"
psql --version
