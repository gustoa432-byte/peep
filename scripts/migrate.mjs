#!/usr/bin/env node
/**
 * Apply migrations/*.sql to the local SQLite file (SQLITE_PATH or data/local.db).
 */
import { readdir, readFile, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join, isAbsolute } from "node:path";
import Database from "better-sqlite3";
import { pendingMigrations } from "./migration-plan.mjs";

const raw = process.env.SQLITE_PATH?.trim() || "data/local.db";
const dbPath = isAbsolute(raw) ? raw : join(process.cwd(), raw);
const migrationsDir = join(dirname(fileURLToPath(import.meta.url)), "..", "migrations");

async function main() {
  let entries;
  try {
    entries = await readdir(migrationsDir);
  } catch {
    console.log("[migrate] no migrations/ directory — nothing to do.");
    return;
  }
  if (pendingMigrations(entries, []).length === 0) {
    console.log("[migrate] no migrations — nothing to do.");
    return;
  }

  await mkdir(dirname(dbPath), { recursive: true });
  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  try {
    db.exec(
      "CREATE TABLE IF NOT EXISTS _migrations (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL DEFAULT (datetime('now')))",
    );
    const applied = db
      .prepare("SELECT name FROM _migrations")
      .all()
      .map((r) => /** @type {{ name: string }} */ (r).name);

    let count = 0;
    for (const { name } of pendingMigrations(entries, applied)) {
      const text = await readFile(join(migrationsDir, name), "utf8");
      try {
        const tx = db.transaction(() => {
          db.exec(text);
          db.prepare("INSERT INTO _migrations (name) VALUES (?)").run(name);
        });
        tx();
        console.log(`[migrate] applied ${name}`);
        count += 1;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        // Idempotent: column/index already present (fresh schema / re-deploy).
        if (/duplicate column|already exists/i.test(msg)) {
          db.prepare("INSERT OR IGNORE INTO _migrations (name) VALUES (?)").run(name);
          console.log(`[migrate] skipped ${name} (already in schema)`);
          continue;
        }
        throw err;
      }
    }
    console.log(count ? `[migrate] done — ${count} migration(s) applied.` : "[migrate] up to date.");
    console.log(`[migrate] sqlite: ${dbPath}`);
  } finally {
    db.close();
  }
}

main().catch((err) => {
  console.error("[migrate] failed:", err);
  process.exit(1);
});
