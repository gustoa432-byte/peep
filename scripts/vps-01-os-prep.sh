#!/usr/bin/env bash
set -euo pipefail
export DEBIAN_FRONTEND=noninteractive

apt-get update
apt-get install -y build-essential python3 git curl ufw nginx certbot python3-certbot-nginx rsync

if ! command -v node >/dev/null 2>&1 || ! node -v | grep -qE '^v22\.'; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y nodejs
fi

npm install -g pm2

systemctl enable --now nginx

ufw allow OpenSSH
ufw allow 'Nginx Full'
ufw --force enable

echo "=== versions ==="
node -v
npm -v
pm2 -v
nginx -v
ufw status
echo OS_PREP_OK
