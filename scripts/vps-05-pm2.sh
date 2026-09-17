#!/usr/bin/env bash
set -euo pipefail

cat >/var/www/peepland/ecosystem.config.cjs <<'EOF'
module.exports = {
  apps: [
    {
      name: "peep",
      script: "scripts/start-server.mjs",
      cwd: "/var/www/peepland",
      instances: 1,
      exec_mode: "fork",
      autorestart: true,
      watch: false,
      max_memory_restart: "512M",
      env: {
        NODE_ENV: "production",
        HOST: "0.0.0.0",
        PORT: 8080,
        SQLITE_PATH: "data/local.db",
        NITRO_PRESET: "node-server",
      },
    },
  ],
};
EOF

cd /var/www/peepland
mkdir -p data
pm2 delete peep 2>/dev/null || true
pm2 start ecosystem.config.cjs
pm2 save

# Enable startup on boot (root)
STARTUP_CMD=$(pm2 startup systemd -u root --hp /root | tail -n 1)
echo "STARTUP_LINE=$STARTUP_CMD"
if echo "$STARTUP_CMD" | grep -q 'systemd'; then
  eval "$STARTUP_CMD" || true
fi
# Fallback explicit
pm2 startup systemd -u root --hp /root | grep -E 'sudo|systemctl|env' | tail -1 | bash || true
pm2 save

pm2 status
sleep 2
curl -sI http://127.0.0.1:8080 | head -5 || true
echo PM2_OK
