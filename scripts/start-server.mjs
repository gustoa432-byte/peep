#!/usr/bin/env node
/**
 * Production entry for a long-lived Node host (Render).
 * Nitro's node-server listens on HOST + PORT; Render injects PORT only.
 */
import { existsSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

process.env.HOST ??= "0.0.0.0";
if (!process.env.PORT && !process.env.NITRO_PORT) {
  process.env.PORT = "8080";
}

if (process.env.RENDER && !process.env.DATABASE_URL?.trim()) {
  console.error(
    "[peep] DATABASE_URL is required on Render. Add a Postgres URL (Neon) so two players share worlds and signaling.",
  );
  process.exit(1);
}

const entry = join(process.cwd(), ".output", "server", "index.mjs");
if (!existsSync(entry)) {
  console.error(
    "[peep] Missing .output/server/index.mjs. Build with NITRO_PRESET=render-com (Render sets this).",
  );
  process.exit(1);
}

await import(pathToFileURL(entry).href);
