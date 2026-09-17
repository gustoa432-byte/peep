#!/usr/bin/env bash
set -euo pipefail

# Keep existing SSL server blocks if certbot already rewrote the site.
# Inject/refresh cache-busting proxy headers on the active peepland config.

CONF=/etc/nginx/sites-available/peepland.ru
if [[ ! -f "$CONF" ]]; then
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

        # TMA: never cache HTML/document responses at the edge.
        add_header Cache-Control "no-cache, no-store, must-revalidate" always;
        add_header Pragma "no-cache" always;
        add_header Expires "0" always;

        proxy_read_timeout 60s;
    }
}
NGINX
  ln -sf /etc/nginx/sites-available/peepland.ru /etc/nginx/sites-enabled/peepland.ru
  rm -f /etc/nginx/sites-enabled/default
else
  # Ensure Cache-Control is present on location / blocks (idempotent-ish).
  if ! grep -q 'Cache-Control "no-cache, no-store, must-revalidate"' "$CONF"; then
    python3 - <<'PY'
from pathlib import Path
p = Path("/etc/nginx/sites-available/peepland.ru")
text = p.read_text()
needle = "proxy_read_timeout"
inject = """        add_header Cache-Control "no-cache, no-store, must-revalidate" always;
        add_header Pragma "no-cache" always;
        add_header Expires "0" always;

"""
if inject.strip().splitlines()[0] not in text:
    text = text.replace(
        "        proxy_read_timeout",
        inject + "        proxy_read_timeout",
        1,
    )
    # Also try without leading spaces variant
    if "Cache-Control" not in text:
        text = text.replace(
            "proxy_read_timeout",
            inject + "proxy_read_timeout",
            1,
        )
    p.write_text(text)
print("nginx cache headers patched")
PY
  fi
fi

nginx -t
systemctl reload nginx
echo NGINX_OK
