/**
 * Public DB facade. Safe to appear in the createServerFn client graph: native
 * better-sqlite3 lives only in `./db-sqlite.server` (never statically imported here).
 */
export type DbSource = "sqlite";

export const dbSource: DbSource = "sqlite";

export interface Sql {
  <T = Record<string, unknown>>(
    strings: TemplateStringsArray,
    ...values: unknown[]
  ): Promise<T[]>;
  query<T = Record<string, unknown>>(
    text: string,
    params?: unknown[],
  ): Promise<T[]>;
}

function assertServer(): void {
  if (typeof window !== "undefined") {
    throw new Error(
      "@/lib/db is server-only — call getSql() from a createServerFn handler " +
        "or a server route, never from client code.",
    );
  }
}

export async function getSql(): Promise<Sql> {
  assertServer();
  const mod = await import("./db-sqlite.server");
  return mod.getSqlImpl();
}

/** Prefer `getSqliteDbImpl` from `./db-sqlite.server` in sync server modules. */
export async function getSqliteDb(): Promise<import("better-sqlite3").Database> {
  assertServer();
  const mod = await import("./db-sqlite.server");
  return mod.getSqliteDbImpl();
}

export function ensureDbReady(): Promise<void> {
  return getSql().then(() => undefined);
}

/** @deprecated PGLite removed — SQLite only. */
export async function getPglite(): Promise<never> {
  throw new Error("PGLite removed — use getSqliteDb() / getSql() (SQLite)");
}
