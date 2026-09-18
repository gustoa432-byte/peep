/**
 * SQLite implementation — server-only (.server.ts). Never import from client.
 */
import Database from "better-sqlite3";
import { existsSync, mkdirSync, readdirSync, readFileSync } from "node:fs";
import { dirname, isAbsolute, join } from "node:path";
import { fileURLToPath } from "node:url";
import { pendingMigrations } from "../../scripts/migration-plan.mjs";
import type { Sql } from "./db";

/** Inlined fallback when deploy bundle has no migrations/ on disk. */
const FALLBACK_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS peep_worlds (
  id TEXT PRIMARY KEY,
  seed INTEGER NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (CAST(strftime('%s','now') AS INTEGER) * 1000),
  creator_id TEXT,
  generation INTEGER NOT NULL DEFAULT 0,
  edit_cursor INTEGER NOT NULL DEFAULT 0,
  name TEXT,
  slug TEXT,
  guest_id TEXT,
  guest_id_2 TEXT,
  guest_id_3 TEXT,
  guest_id_4 TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS peep_worlds_slug_uidx
  ON peep_worlds (slug)
  WHERE slug IS NOT NULL AND slug != '';
CREATE TABLE IF NOT EXISTS peep_edits (
  world_id TEXT NOT NULL REFERENCES peep_worlds(id) ON DELETE CASCADE,
  x INTEGER NOT NULL,
  y INTEGER NOT NULL,
  z INTEGER NOT NULL,
  block INTEGER NOT NULL,
  cursor INTEGER NOT NULL DEFAULT 0,
  author_id TEXT,
  PRIMARY KEY (world_id, x, y, z)
);
CREATE INDEX IF NOT EXISTS peep_edits_cursor_idx ON peep_edits (world_id, cursor);
CREATE TABLE IF NOT EXISTS peep_presence (
  world_id TEXT NOT NULL REFERENCES peep_worlds(id) ON DELETE CASCADE,
  player_id TEXT NOT NULL,
  x REAL NOT NULL DEFAULT 0,
  y REAL NOT NULL DEFAULT 0,
  z REAL NOT NULL DEFAULT 0,
  yaw REAL NOT NULL DEFAULT 0,
  pitch REAL NOT NULL DEFAULT 0,
  last_seen INTEGER NOT NULL,
  PRIMARY KEY (world_id, player_id)
);
CREATE INDEX IF NOT EXISTS peep_presence_seen_idx ON peep_presence (world_id, last_seen);
CREATE TABLE IF NOT EXISTS peep_rate (
  player_id TEXT PRIMARY KEY,
  window_start INTEGER NOT NULL,
  count INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS peep_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at INTEGER NOT NULL,
  name TEXT NOT NULL,
  world_id TEXT,
  player_id TEXT
);
CREATE INDEX IF NOT EXISTS peep_events_name_at_idx ON peep_events (name, at);
CREATE INDEX IF NOT EXISTS peep_events_world_player_idx ON peep_events (world_id, player_id, name);
CREATE TABLE IF NOT EXISTS peep_tg_saves (
  tg_user_id TEXT PRIMARY KEY,
  world_id TEXT,
  seed INTEGER,
  edits TEXT NOT NULL DEFAULT '[]',
  inventory TEXT NOT NULL DEFAULT '{}',
  guest_permissions TEXT NOT NULL DEFAULT '{"locked":false,"buildAllowed":false,"banned":[]}',
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS peep_tg_saves_world_id_idx ON peep_tg_saves (world_id);
CREATE TABLE IF NOT EXISTS webrtc_peers (
  room TEXT NOT NULL,
  peer_id TEXT NOT NULL,
  name TEXT NOT NULL DEFAULT '',
  last_seen INTEGER NOT NULL,
  PRIMARY KEY (room, peer_id)
);
CREATE TABLE IF NOT EXISTS webrtc_signals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  room TEXT NOT NULL,
  to_peer TEXT NOT NULL,
  from_peer TEXT NOT NULL,
  kind TEXT NOT NULL,
  payload TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS webrtc_signals_inbox ON webrtc_signals (room, to_peer, id);
CREATE TABLE IF NOT EXISTS peep_user_settings (
  player_id TEXT PRIMARY KEY,
  settings TEXT NOT NULL DEFAULT '{}',
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS peep_account_links (
  browser_player_id TEXT PRIMARY KEY,
  tg_player_id TEXT NOT NULL UNIQUE,
  linked_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS peep_link_challenges (
  token TEXT PRIMARY KEY,
  browser_player_id TEXT NOT NULL,
  tg_player_id TEXT,
  created_at INTEGER NOT NULL,
  claimed_at INTEGER
);
CREATE INDEX IF NOT EXISTS peep_link_challenges_browser_idx
  ON peep_link_challenges (browser_player_id);
`;

const globalRef = globalThis as typeof globalThis & {
  __peepSqlite__?: Database.Database;
  __peepSqliteSql__?: Sql;
  __peepSqlitePathLogged__?: boolean;
};

export function resolveDbPath(): string {
  const raw =
    (typeof process !== "undefined" && process.env.SQLITE_PATH?.trim()) ||
    "data/local.db";
  return isAbsolute(raw) ? raw : join(process.cwd(), raw);
}

function openDatabase(): Database.Database {
  if (globalRef.__peepSqlite__) return globalRef.__peepSqlite__;
  const path = resolveDbPath();
  mkdirSync(dirname(path), { recursive: true });
  const db = new Database(path);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  globalRef.__peepSqlite__ = db;
  if (!globalRef.__peepSqlitePathLogged__) {
    globalRef.__peepSqlitePathLogged__ = true;
    console.log(`[peep] SQLite open → ${path}`);
  }
  return db;
}

/**
 * Convert `$1`/`$2` placeholders to `?` and reorder params to match
 * appearance order (SQLite is strictly positional).
 */
function bindSql(
  text: string,
  params: unknown[] = [],
): { sql: string; params: unknown[] } {
  const bound: unknown[] = [];
  const sql = text.replace(/\$(\d+)/g, (_, n: string) => {
    bound.push(params[Number(n) - 1]);
    return "?";
  });
  return { sql, params: bound };
}

function toSql(db: Database.Database): Sql {
  const run = <T>(text: string, params: unknown[] = []): T[] => {
    const { sql, params: bound } = bindSql(text.trim(), params);
    const upper = sql.toUpperCase();
    const stmt = db.prepare(sql);
    if (
      upper.startsWith("SELECT") ||
      upper.startsWith("WITH") ||
      /\bRETURNING\b/i.test(sql)
    ) {
      return stmt.all(...bound) as T[];
    }
    stmt.run(...bound);
    return [] as T[];
  };

  const sql = (async <T = Record<string, unknown>>(
    strings: TemplateStringsArray,
    ...values: unknown[]
  ): Promise<T[]> => {
    let text = strings[0];
    for (let i = 0; i < values.length; i += 1) text += `$${i + 1}${strings[i + 1]}`;
    return run<T>(text, values);
  }) as unknown as Sql;

  sql.query = async <T = Record<string, unknown>>(text: string, params: unknown[] = []) =>
    run<T>(text, params);
  return sql;
}

function migrationDirs(): string[] {
  const here = dirname(fileURLToPath(import.meta.url));
  return [
    join(process.cwd(), "migrations"),
    join(here, "..", "..", "migrations"),
    join(here, "../../../migrations"),
  ];
}

/** Load .sql files from disk (preferred) and/or Vite glob. */
function loadMigrationFiles(): Array<{ name: string; text: string }> {
  const byName = new Map<string, string>();

  for (const dir of migrationDirs()) {
    if (!existsSync(dir)) continue;
    try {
      for (const file of readdirSync(dir)) {
        if (!file.endsWith(".sql")) continue;
        const text = readFileSync(join(dir, file), "utf8");
        byName.set(file, text);
      }
    } catch (err) {
      console.warn(`[peep] could not read migrations from ${dir}:`, err);
    }
  }

  try {
    const globbed = import.meta.glob("/migrations/*.sql", {
      query: "?raw",
      import: "default",
      eager: true,
    }) as Record<string, string>;
    for (const [path, text] of Object.entries(globbed)) {
      const name = path.split("/").pop() ?? path;
      if (!byName.has(name)) byName.set(name, text);
    }
  } catch {
    /* glob unavailable outside Vite */
  }

  if (byName.size === 0) {
    byName.set("0001_sqlite.sql", FALLBACK_SCHEMA_SQL);
  }

  return [...byName.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, text]) => ({ name, text }));
}

function migrateSync(db: Database.Database): void {
  db.exec(
    "CREATE TABLE IF NOT EXISTS _migrations (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL DEFAULT (datetime('now')))",
  );
  const done = (
    db.prepare("SELECT name FROM _migrations").all() as { name: string }[]
  ).map((r) => r.name);

  const files = loadMigrationFiles();
  const pending = pendingMigrations(
    files.map((f) => f.name),
    done,
  );

  for (const { name } of pending) {
    const file = files.find((f) => f.name === name);
    if (!file?.text) {
      console.warn(`[peep] migration ${name} missing body — skipped`);
      continue;
    }
    const tx = db.transaction(() => {
      db.exec(file.text);
      db.prepare("INSERT INTO _migrations (name) VALUES (?)").run(name);
    });
    tx();
    console.log(`[peep] applied migration ${name}`);
  }

  // Safety net: ensure core tables exist even if migration bookkeeping drifted.
  try {
    db.exec(`ALTER TABLE peep_worlds ADD COLUMN name TEXT`);
  } catch {
    /* already exists */
  }
  try {
    db.exec(`ALTER TABLE peep_worlds ADD COLUMN slug TEXT`);
  } catch {
    /* already exists */
  }
  try {
    db.exec(`ALTER TABLE peep_worlds ADD COLUMN guest_id TEXT`);
  } catch {
    /* already exists */
  }
  try {
    db.exec(`ALTER TABLE peep_worlds ADD COLUMN guest_id_2 TEXT`);
  } catch {
    /* already exists */
  }
  try {
    db.exec(`ALTER TABLE peep_worlds ADD COLUMN guest_id_3 TEXT`);
  } catch {
    /* already exists */
  }
  try {
    db.exec(`ALTER TABLE peep_worlds ADD COLUMN guest_id_4 TEXT`);
  } catch {
    /* already exists */
  }
  const worlds = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='peep_worlds'")
    .get();
  if (!worlds) {
    console.warn("[peep] peep_worlds missing — applying fallback schema");
    db.exec(FALLBACK_SCHEMA_SQL);
  }
}

export function getSqliteDbImpl(): Database.Database {
  const db = openDatabase();
  migrateSync(db);
  return db;
}

export function getSqlImpl(): Sql {
  if (!globalRef.__peepSqliteSql__) {
    const db = openDatabase();
    migrateSync(db);
    globalRef.__peepSqliteSql__ = toSql(db);
  }
  return globalRef.__peepSqliteSql__;
}
