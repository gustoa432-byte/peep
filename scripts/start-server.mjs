#!/usr/bin/env node
/**
 * Production entry for a long-lived Node host (Render).
 * Nitro's node-server listens on HOST + PORT; Render injects PORT only.
 */
import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = process.cwd();

// Render's proxy only reaches the process on all interfaces. Always overwrite
// HOST — some images set it to a hostname that binds loopback-only.
process.env.HOST = "0.0.0.0";
process.env.NITRO_HOST = "0.0.0.0";
if (!process.env.PORT && !process.env.NITRO_PORT) {
  process.env.PORT = "8080";
}

function stagePgliteAssets() {
  const dist = join(root, "node_modules", "@electric-sql", "pglite", "dist");
  const destDir = join(root, ".output", "server", "_libs");
  mkdirSync(destDir, { recursive: true });
  for (const name of ["pglite.data", "pglite.wasm", "initdb.wasm"]) {
    const from = join(dist, name);
    const to = join(destDir, name);
    if (existsSync(from) && !existsSync(to)) copyFileSync(from, to);
  }
}

if (process.env.DATABASE_URL?.trim()) {
  const migrated = spawnSync(process.execPath, [join(here, "migrate.mjs")], {
    stdio: "inherit",
    env: process.env,
  });
  if (migrated.status !== 0) process.exit(migrated.status ?? 1);
} else {
  stagePgliteAssets();
  console.log(
    "[peep] No DATABASE_URL — in-memory world. Fine for a two-player test; gone after sleep or redeploy.",
  );
}

const entry = join(root, ".output", "server", "index.mjs");
if (!existsSync(entry)) {
  console.error(
    "[peep] Missing .output/server/index.mjs. Build with NITRO_PRESET=render-com (Render sets this).",
  );
  process.exit(1);
}

await import(pathToFileURL(entry).href);
