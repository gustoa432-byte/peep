/**
 * SQLite implementation — server-only (.server.ts). Never import from client.
 */
import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname, isAbsolute, join } from "node:path";
import { pendingMigrations } from "../../scripts/migration-plan.mjs";
import type { Sql } from "./db";

const globalRef = globalThis as typeof globalThis & {
  __peepSqlite__?: Database.Database;
  __peepSqliteSql__?: Sql;
};

function resolveDbPath(): string {
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
  return db;
}

function toSqliteParams(text: string): string {
  return text.replace(/\$(\d+)/g, "?");
}

function toSql(db: Database.Database): Sql {
  const run = <T>(text: string, params: unknown[] = []): T[] => {
    const sql = toSqliteParams(text).trim();
    const upper = sql.toUpperCase();
    const stmt = db.prepare(sql);
    if (
      upper.startsWith("SELECT") ||
      upper.startsWith("WITH") ||
      /\bRETURNING\b/i.test(sql)
    ) {
      return stmt.all(...params) as T[];
    }
    stmt.run(...params);
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

function migrateSync(db: Database.Database): void {
  db.exec(
    "CREATE TABLE IF NOT EXISTS _migrations (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL DEFAULT (datetime('now')))",
  );
  const done = (
    db.prepare("SELECT name FROM _migrations").all() as { name: string }[]
  ).map((r) => r.name);

  const migrations = import.meta.glob("/migrations/*.sql", {
    query: "?raw",
    import: "default",
    eager: true,
  }) as Record<string, string>;

  for (const { name, path } of pendingMigrations(Object.keys(migrations), done)) {
    const text = migrations[path];
    const tx = db.transaction(() => {
      db.exec(text);
      db.prepare("INSERT INTO _migrations (name) VALUES (?)").run(name);
    });
    tx();
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
