#!/usr/bin/env bash
set -euo pipefail

cat >/etc/nginx/sites-available/peepland.ru <<'NGINX'
server {
    listen 80;
    listen [::]:80;
    server_name peepland.ru www.peepland.ru;

    client_max_body_size 20m;

    location / {
        proxy_pass http://127.0.0.1:8080;
        proxy_http_version 1.1;

        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";

        proxy_read_timeout 60s;
    }
}
NGINX

ln -sf /etc/nginx/sites-available/peepland.ru /etc/nginx/sites-enabled/peepland.ru
rm -f /etc/nginx/sites-enabled/default
nginx -t
systemctl reload nginx
echo NGINX_OK
