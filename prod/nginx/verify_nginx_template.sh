#!/usr/bin/env bash
set -euo pipefail

if [[ "${EUID}" -ne 0 ]]; then
  echo "Run as root: sudo bash $0"
  exit 1
fi

TEMPLATE="/home/zed/git/tforn/PodCaster_Portal/prod/nginx/nginx_site.conf"
if [[ ! -f "${TEMPLATE}" ]]; then
  echo "Template not found: ${TEMPLATE}"
  exit 1
fi

TMP_DIR="$(mktemp -d /tmp/nginx-verify.XXXXXX)"
cleanup() {
  rm -rf "${TMP_DIR}" || true
}
trap cleanup EXIT

CERT_PATH="${TMP_DIR}/tls.crt"
KEY_PATH="${TMP_DIR}/tls.key"
CONF_PATH="${TMP_DIR}/podcaster_portal.conf"

openssl req -x509 -nodes -newkey rsa:2048 -days 1 \
  -subj "/CN=localhost" \
  -keyout "${KEY_PATH}" \
  -out "${CERT_PATH}" >/dev/null 2>&1

sed \
  -e "s|__SERVER_NAME__|localhost|g" \
  -e "s|__SSL_CERT_PATH__|${CERT_PATH}|g" \
  -e "s|__SSL_KEY_PATH__|${KEY_PATH}|g" \
  "${TEMPLATE}" > "${CONF_PATH}"

cp "${CONF_PATH}" /etc/nginx/conf.d/podcaster_portal.verify.conf

if nginx -t; then
  echo "nginx template is valid with installed nginx."
fi

rm -f /etc/nginx/conf.d/podcaster_portal.verify.conf
