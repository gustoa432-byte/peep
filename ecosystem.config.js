/**
 * PM2 process file for Ubuntu VPS.
 * Usage: pm2 start ecosystem.config.js
 */
module.exports = {
  apps: [
    {
      name: "peep",
      script: "scripts/start-server.mjs",
      cwd: __dirname,
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
        // Optional: enables HMAC verify on Telegram Login Widget payloads.
        // TELEGRAM_BOT_TOKEN: "",
      },
    },
  ],
};
