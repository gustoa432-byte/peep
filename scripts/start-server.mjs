#!/usr/bin/env node
/**
 * Production entry for a long-lived Node host (VPS / PM2).
 * Nitro listens on HOST + PORT.
 */
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = process.cwd();

process.env.HOST = "0.0.0.0";
process.env.NITRO_HOST = "0.0.0.0";
if (!process.env.PORT && !process.env.NITRO_PORT) {
  process.env.PORT = "8080";
}
if (!process.env.SQLITE_PATH?.trim()) {
  process.env.SQLITE_PATH = "data/local.db";
}

const migrated = spawnSync(process.execPath, [join(here, "migrate.mjs")], {
  stdio: "inherit",
  env: process.env,
});
if (migrated.status !== 0) process.exit(migrated.status ?? 1);

const entry = join(root, ".output", "server", "index.mjs");
if (!existsSync(entry)) {
  console.error(
    "[peep] Missing .output/server/index.mjs. Build first (npm run build).",
  );
  process.exit(1);
}

console.log(`[peep] SQLite → ${process.env.SQLITE_PATH}`);
await import(pathToFileURL(entry).href);
