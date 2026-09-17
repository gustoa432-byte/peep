#!/usr/bin/env node
/**
 * Production entry for a long-lived Node host (VPS / PM2).
 * Nitro listens on HOST + PORT.
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { dirname, isAbsolute, join } from "node:path";
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

{
  const raw = process.env.SQLITE_PATH;
  const abs = isAbsolute(raw) ? raw : join(root, raw);
  mkdirSync(dirname(abs), { recursive: true });
}

const migrated = spawnSync(process.execPath, [join(here, "migrate.mjs")], {
  stdio: "inherit",
  env: process.env,
});
if (migrated.status !== 0) process.exit(migrated.status ?? 1);

const entry = join(root, ".output", "server", "index.mjs");
if (!existsSync(entry)) {
  const vercelEntry = join(
    root,
    ".vercel",
    "output",
    "functions",
    "__server.func",
    "index.mjs",
  );
  if (existsSync(vercelEntry)) {
    console.error(
      "[peep] FATAL: found .vercel/output but missing .output/server.",
    );
    console.error(
      "[peep] Build used the Vercel Nitro preset; PM2 serves .output only.",
    );
    console.error(
      "[peep] Rebuild with NITRO_PRESET=node-server (see npm run build:vps).",
    );
  } else {
    console.error(
      "[peep] Missing .output/server/index.mjs. Build first (npm run build).",
    );
  }
  process.exit(1);
}

{
  // Loud proof of which bundle is live.
  const { statSync } = await import("node:fs");
  const st = statSync(entry);
  console.log(
    `[peep] serving ${entry} mtime=${st.mtime.toISOString()}`,
  );
}

console.log(`[peep] SQLite → ${process.env.SQLITE_PATH}`);
await import(pathToFileURL(entry).href);
