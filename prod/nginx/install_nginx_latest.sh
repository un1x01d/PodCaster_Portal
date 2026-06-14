#!/usr/bin/env bash
set -euo pipefail

if [[ "${EUID}" -ne 0 ]]; then
  echo "Run as root: sudo bash $0"
  exit 1
fi

export DEBIAN_FRONTEND=noninteractive

apt-get update
apt-get install -y --no-install-recommends \
  ca-certificates \
  curl \
  gnupg2 \
  lsb-release \
  debian-archive-keyring \
  apt-transport-https

mkdir -p /etc/apt/keyrings

curl -fsSL https://nginx.org/keys/nginx_signing.key \
  | gpg --dearmor -o /etc/apt/keyrings/nginx-archive-keyring.gpg

chmod 0644 /etc/apt/keyrings/nginx-archive-keyring.gpg

DISTRO_ID="$(. /etc/os-release && echo "${ID}")"
DISTRO_CODENAME="$(. /etc/os-release && echo "${VERSION_CODENAME:-}")"

if [[ -z "${DISTRO_CODENAME}" ]]; then
  echo "Could not detect VERSION_CODENAME from /etc/os-release."
  echo "Set it manually and rerun."
  exit 1
fi

if [[ "${DISTRO_ID}" != "ubuntu" && "${DISTRO_ID}" != "debian" ]]; then
  echo "This installer currently supports Ubuntu/Debian only."
  exit 1
fi

# nginx.org /packages/<distro> publishes the stable channel for the distro.
cat > /etc/apt/sources.list.d/nginx.list <<NGINX_REPO
deb [signed-by=/etc/apt/keyrings/nginx-archive-keyring.gpg] https://nginx.org/packages/${DISTRO_ID} ${DISTRO_CODENAME} nginx
deb-src [signed-by=/etc/apt/keyrings/nginx-archive-keyring.gpg] https://nginx.org/packages/${DISTRO_ID} ${DISTRO_CODENAME} nginx
NGINX_REPO

cat > /etc/apt/preferences.d/99nginx <<'APT_PREF'
Package: *
Pin: origin nginx.org
Pin: release o=nginx
Pin-Priority: 900
APT_PREF

apt-get update
apt-get install -y nginx

systemctl enable nginx
systemctl restart nginx

echo "Installed nginx version:"
nginx -v
apt-cache policy nginx | sed -n '1,20p'

echo
echo "Next steps:"
echo "1) Copy prod/nginx/nginx_site.conf to /etc/nginx/conf.d/podcaster_portal.conf"
echo "2) Replace SSL placeholders (cert and key paths)."
echo "3) Test and reload:"
echo "   nginx -t && systemctl reload nginx"
