import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { getSql } from "@/lib/db";
import {
  ISLAND_SLUG_RE,
  MAX_GUEST_SLOTS,
  MAX_WORLDS_PER_ACCOUNT,
  MAX_PLAYERS,
  PRESENCE_TTL_SECONDS,
  RATE_MAX_EDITS,
  RATE_WINDOW_SECONDS,
  WORLD_ID_RE,
  WORLD_EDIT_LIM,
  WORLD_SY,
} from "./constants";
import {
  DEFAULT_GUEST_PERMISSIONS,
  parseGuestPermissions,
  stringifyGuestPermissions,
  type GuestPermissions,
} from "./guest-permissions";
import type {
  ApplyEditResult,
  BlockDelta,
  BlockEdit,
  EditPoll,
  JoinResult,
  MetricName,
  PresencePlayer,
} from "./types";

const worldId = z.string().regex(WORLD_ID_RE);
const playerId = z.string().regex(/^[a-zA-Z0-9_-]{4,48}$/);
const blockCoord = z.object({
  worldId,
  x: z.number().int().min(-WORLD_EDIT_LIM).max(WORLD_EDIT_LIM),
  y: z.number().int().min(0).max(WORLD_SY - 1),
  z: z.number().int().min(-WORLD_EDIT_LIM).max(WORLD_EDIT_LIM),
  block: z.number().int().min(0).max(11),
});

const optionalName = z.string().max(48).optional();
const optionalSlug = z.string().max(24).optional();

const ALPH = "abcdefghjkmnpqrstuvwxyz23456789";

/** peep_worlds columns that hold claimed Friday guest player ids. */
const GUEST_SLOT_COLS = ["guest_id", "guest_id_2", "guest_id_3", "guest_id_4"] as const;

function nowMs(): number {
  return Date.now();
}

/** All player ids that count as the same account (browser ↔ Telegram link). */
async function playerIdAliases(
  sql: Awaited<ReturnType<typeof getSql>>,
  playerId: string,
): Promise<string[]> {
  const ids = new Set<string>([playerId]);
  try {
    if (playerId.startsWith("tg_")) {
      const browsers = await sql.query<{ browser_player_id: string }>(
        `select browser_player_id from peep_account_links where tg_player_id = $1`,
        [playerId],
      );
      for (const r of browsers) ids.add(r.browser_player_id);
    } else {
      const link = await sql.query<{ tg_player_id: string }>(
        `select tg_player_id from peep_account_links where browser_player_id = $1 limit 1`,
        [playerId],
      );
      const tg = link[0]?.tg_player_id;
      if (tg) {
        ids.add(tg);
        const browsers = await sql.query<{ browser_player_id: string }>(
          `select browser_player_id from peep_account_links where tg_player_id = $1`,
          [tg],
        );
        for (const r of browsers) ids.add(r.browser_player_id);
      }
    }
  } catch {
    /* table may be missing on old deploys — ignore */
  }
  return [...ids];
}

function placeholders(n: number, start = 1): string {
  return Array.from({ length: n }, (_, i) => `$${start + i}`).join(", ");
}

function isUniqueError(err: unknown): boolean {
  const e = err as { code?: string; message?: string };
  return (
    e.code === "SQLITE_CONSTRAINT_PRIMARYKEY" ||
    e.code === "SQLITE_CONSTRAINT_UNIQUE" ||
    e.code === "23505" ||
    Boolean(e.message?.includes("UNIQUE"))
  );
}

function newWorldId(): string {
  const bytes = new Uint32Array(6);
  crypto.getRandomValues(bytes);
  let s = "";
  for (const b of bytes) s += ALPH[b % ALPH.length];
  return s;
}

async function prunePresence(sql: Awaited<ReturnType<typeof getSql>>, id: string) {
  const cutoff = nowMs() - PRESENCE_TTL_SECONDS * 1000;
  await sql.query(`delete from peep_presence where world_id = $1 and last_seen < $2`, [id, cutoff]);
  // Free Friday slots if claimed guests timed out.
  for (const col of GUEST_SLOT_COLS.slice(0, MAX_GUEST_SLOTS)) {
    await sql.query(
      `update peep_worlds
       set ${col} = null
       where id = $1
         and ${col} is not null
         and not exists (
           select 1 from peep_presence p
           where p.world_id = peep_worlds.id
             and p.player_id = peep_worlds.${col}
             and p.last_seen > $2
         )`,
      [id, cutoff],
    );
  }
}

type WorldRow = {
  seed: number;
  cursor: number;
  generation: number;
  creatorId: string | null;
  guestIds: (string | null)[];
};

async function readWorld(
  sql: Awaited<ReturnType<typeof getSql>>,
  id: string,
): Promise<WorldRow | null> {
  const rows = await sql.query<Record<string, unknown>>(
    `select seed, edit_cursor, generation, creator_id,
            guest_id, guest_id_2, guest_id_3, guest_id_4
     from peep_worlds where id = $1`,
    [id],
  );
  const row = rows[0];
  if (!row) return null;
  return {
    seed: Number(row.seed),
    cursor: Number(row.edit_cursor ?? 0),
    generation: Number(row.generation ?? 0),
    creatorId: (row.creator_id as string | null) ?? null,
    guestIds: GUEST_SLOT_COLS.map((col) => (row[col] as string | null) ?? null),
  };
}

/** Claim one of MAX_GUEST_SLOTS Friday seats atomically. */
async function claimGuestSlot(
  sql: Awaited<ReturnType<typeof getSql>>,
  worldId: string,
  playerId: string,
): Promise<boolean> {
  for (const col of GUEST_SLOT_COLS.slice(0, MAX_GUEST_SLOTS)) {
    const claimed = await sql.query<Record<string, string>>(
      `update peep_worlds
       set ${col} = $2
       where id = $1 and (${col} is null or ${col} = $2)
       returning ${col}`,
      [worldId, playerId],
    );
    if (claimed[0]?.[col] === playerId) return true;
  }
  return false;
}

async function clearGuestSlotsForPlayer(
  sql: Awaited<ReturnType<typeof getSql>>,
  playerId: string,
  opts: { worldId?: string; creatorId?: string },
) {
  for (const col of GUEST_SLOT_COLS.slice(0, MAX_GUEST_SLOTS)) {
    if (opts.worldId) {
      await sql.query(`update peep_worlds set ${col} = null where id = $1 and ${col} = $2`, [
        opts.worldId,
        playerId,
      ]);
    } else if (opts.creatorId) {
      await sql.query(`update peep_worlds set ${col} = null where creator_id = $1 and ${col} = $2`, [
        opts.creatorId,
        playerId,
      ]);
    }
  }
}

async function recordEvent(
  sql: Awaited<ReturnType<typeof getSql>>,
  name: MetricName,
  worldId: string | null,
  playerId: string | null,
) {
  try {
    await sql.query(`insert into peep_events (at, name, world_id, player_id) values ($1, $2, $3, $4)`, [
      nowMs(),
      name,
      worldId,
      playerId,
    ]);
  } catch {
    /* ignore */
  }
}

async function takeRateSlot(
  sql: Awaited<ReturnType<typeof getSql>>,
  id: string,
): Promise<boolean> {
  return takeRateSlots(sql, id, 1);
}

/** Reserve `n` edit slots in the rate window (one TNT blast ≈ many cells). */
async function takeRateSlots(
  sql: Awaited<ReturnType<typeof getSql>>,
  id: string,
  n: number,
): Promise<boolean> {
  const need = Math.max(1, Math.floor(n));
  const rows = await sql.query<{ window_start: number; count: number }>(
    `select window_start, count from peep_rate where player_id = $1`,
    [id],
  );
  const now = nowMs();
  const row = rows[0];
  if (!row) {
    await sql.query(`insert into peep_rate (player_id, window_start, count) values ($1, $2, $3)`, [
      id,
      now,
      need,
    ]);
    return true;
  }
  if (now - Number(row.window_start) > RATE_WINDOW_SECONDS * 1000) {
    await sql.query(`update peep_rate set window_start = $2, count = $3 where player_id = $1`, [
      id,
      now,
      need,
    ]);
    return true;
  }
  if (row.count + need > RATE_MAX_EDITS) return false;
  await sql.query(`update peep_rate set count = count + $2 where player_id = $1`, [id, need]);
  return true;
}

async function loadHostPerms(
  sql: Awaited<ReturnType<typeof getSql>>,
  creatorId: string | null,
): Promise<GuestPermissions> {
  if (!creatorId) return { ...DEFAULT_GUEST_PERMISSIONS, banned: [] };
  const rows = await sql.query<{ guest_permissions: string | null }>(
    `select guest_permissions from peep_tg_saves where tg_user_id = $1`,
    [creatorId],
  );
  if (!rows[0]?.guest_permissions) return { ...DEFAULT_GUEST_PERMISSIONS, banned: [] };
  return parseGuestPermissions(rows[0].guest_permissions);
}

export const createWorld = createServerFn({ method: "POST" })
  .validator(
    z.object({
      playerId,
      name: optionalName,
      slug: optionalSlug,
    }),
  )
  .handler(
    async ({
      data,
    }): Promise<{ id: string; seed: number; name: string | null; slug: string | null }> => {
      const sql = await getSql();
      const probe = await sql.query<{ n: number }>(
        `select count(*) as n from sqlite_master where type = 'table' and name = 'peep_worlds'`,
      );
      if (!probe[0] || Number(probe[0].n) < 1) {
        throw new Error("SQLite schema missing peep_worlds — migration did not apply");
      }

      const aliases = await playerIdAliases(sql, data.playerId);
      if (data.playerId === "p-tgpending" || data.playerId === "p-ssr") {
        throw new Error("Telegram ещё загружается — подожди секунду");
      }
      const owned = await sql.query<{ n: number }>(
        `select count(*) as n from peep_worlds where creator_id in (${placeholders(aliases.length)})`,
        aliases,
      );
      if (Number(owned[0]?.n ?? 0) >= MAX_WORLDS_PER_ACCOUNT) {
        throw new Error(`Лимит: максимум ${MAX_WORLDS_PER_ACCOUNT} мира на аккаунт`);
      }

      const nameRaw = data.name?.trim() ?? "";
      const slugRaw = data.slug?.trim().toLowerCase() ?? "";
      const name = nameRaw.length > 0 ? nameRaw.slice(0, 48) : null;
      const slug = slugRaw.length > 0 ? slugRaw : null;
      if (slug && !ISLAND_SLUG_RE.test(slug)) {
        throw new Error("ID острова: латиница, 3–24 символа (a-z, 0-9, _-)");
      }
      if (slug) {
        const clash = await sql.query<{ id: string }>(
          `select id from peep_worlds where lower(slug) = $1 limit 1`,
          [slug],
        );
        if (clash[0]) throw new Error("Такой ID острова уже занят");
      }

      const seed = (crypto.getRandomValues(new Uint32Array(1))[0] ?? 1) % 1_000_000_000;
      let lastErr: unknown;
      for (let i = 0; i < 6; i++) {
        const id = newWorldId();
        try {
          await sql.query(
            `insert into peep_worlds (id, seed, creator_id, name, slug) values ($1, $2, $3, $4, $5)`,
            [id, seed, data.playerId, name, slug],
          );
          await recordEvent(sql, "create", id, data.playerId);
          return { id, seed, name, slug };
        } catch (err) {
          lastErr = err;
          if (isUniqueError(err)) continue;
          console.error("[peep] createWorld insert failed:", err);
          throw err;
        }
      }
      console.error("[peep] createWorld exhausted ids:", lastErr);
      throw new Error("Could not create world");
    },
  );

/** Resolve system id or vanity slug → canonical world id. */
export const resolveWorldId = createServerFn({ method: "GET" })
  .validator(z.object({ code: z.string().trim().min(1).max(64) }))
  .handler(async ({ data }): Promise<{ id: string } | { error: "not_found" }> => {
    const sql = await getSql();
    const code = data.code.trim().toLowerCase();
    if (WORLD_ID_RE.test(code)) {
      const rows = await sql.query<{ id: string }>(`select id from peep_worlds where id = $1`, [code]);
      if (rows[0]) return { id: rows[0].id };
    }
    const bySlug = await sql.query<{ id: string }>(
      `select id from peep_worlds where lower(slug) = $1 limit 1`,
      [code],
    );
    if (bySlug[0]) return { id: bySlug[0].id };
    return { error: "not_found" };
  });

/** Worlds this player created — source of truth after server restart. */
export const listOwnedWorlds = createServerFn({ method: "GET" })
  .validator(z.object({ playerId }))
  .handler(
    async ({
      data,
    }): Promise<Array<{ id: string; name: string | null; slug: string | null; createdAt: number }>> => {
      const sql = await getSql();
      const aliases = await playerIdAliases(sql, data.playerId);
      // Self-heal: after TG link, fold browser-owned worlds onto tg_* creator.
      const tgCanon = aliases.find((a) => a.startsWith("tg_"));
      if (tgCanon) {
        for (const a of aliases) {
          if (a === tgCanon) continue;
          await sql.query(`update peep_worlds set creator_id = $1 where creator_id = $2`, [
            tgCanon,
            a,
          ]);
        }
      }
      const rows = await sql.query<{
        id: string;
        name: string | null;
        slug: string | null;
        created_at: number;
      }>(
        `select id, name, slug, created_at from peep_worlds
         where creator_id in (${placeholders(aliases.length)})
         order by created_at desc`,
        aliases,
      );
      return rows.map((r) => ({
        id: r.id,
        name: r.name,
        slug: r.slug,
        createdAt: Number(r.created_at) || 0,
      }));
    },
  );

export const updateWorldMeta = createServerFn({ method: "POST" })
  .validator(
    z.object({
      worldId,
      playerId,
      name: optionalName,
      slug: optionalSlug,
    }),
  )
  .handler(
    async ({
      data,
    }): Promise<{ ok: true; name: string | null; slug: string | null } | { ok: false; error: string }> => {
      const sql = await getSql();
      const world = await readWorld(sql, data.worldId);
      if (!world) return { ok: false, error: "not_found" };
      const aliases = await playerIdAliases(sql, data.playerId);
      if (!world.creatorId || !aliases.includes(world.creatorId)) {
        return { ok: false, error: "forbidden" };
      }

      const nameRaw = data.name?.trim() ?? "";
      const slugRaw = data.slug?.trim().toLowerCase() ?? "";
      const name = nameRaw.length > 0 ? nameRaw.slice(0, 48) : null;
      const slug = slugRaw.length > 0 ? slugRaw : null;
      if (slug && !ISLAND_SLUG_RE.test(slug)) return { ok: false, error: "slug_invalid" };
      if (slug) {
        const clash = await sql.query<{ id: string }>(
          `select id from peep_worlds where lower(slug) = $1 and id != $2 limit 1`,
          [slug, data.worldId],
        );
        if (clash[0]) return { ok: false, error: "slug_taken" };
      }

      try {
        await sql.query(`update peep_worlds set name = $1, slug = $2 where id = $3`, [
          name,
          slug,
          data.worldId,
        ]);
      } catch (err) {
        if (isUniqueError(err)) return { ok: false, error: "slug_taken" };
        throw err;
      }
      return { ok: true, name, slug };
    },
  );

export const getWorldMeta = createServerFn({ method: "GET" })
  .validator(z.object({ worldId }))
  .handler(
    async ({
      data,
    }): Promise<{ name: string | null; slug: string | null } | { error: "not_found" }> => {
      const sql = await getSql();
      const rows = await sql.query<{ name: string | null; slug: string | null }>(
        `select name, slug from peep_worlds where id = $1`,
        [data.worldId],
      );
      const row = rows[0];
      if (!row) return { error: "not_found" };
      return { name: row.name ?? null, slug: row.slug ?? null };
    },
  );

export const joinWorld = createServerFn({ method: "POST" })
  .validator(z.object({ worldId, playerId }))
  .handler(async ({ data }): Promise<JoinResult> => {
    const sql = await getSql();
    const world = await readWorld(sql, data.worldId);
    if (!world) return { ok: false, error: "not_found" };

    await prunePresence(sql, data.worldId);
    const cutoff = nowMs() - PRESENCE_TTL_SECONDS * 1000;
    const others = await sql.query<{ player_id: string }>(
      `select player_id from peep_presence where world_id = $1 and last_seen > $2`,
      [data.worldId, cutoff],
    );
    const already = others.some((p) => p.player_id === data.playerId);
    if (!already && others.length >= MAX_PLAYERS) return { ok: false, error: "full" };

    let creatorId = world.creatorId;
    if (!creatorId) {
      await sql.query(`update peep_worlds set creator_id = $2 where id = $1 and creator_id is null`, [
        data.worldId,
        data.playerId,
      ]);
      creatorId = data.playerId;
    }

    const aliases = await playerIdAliases(sql, data.playerId);
    const isCreator = Boolean(creatorId && aliases.includes(creatorId));
    const perms = await loadHostPerms(sql, creatorId);
    if (!isCreator) {
      if (perms.locked) return { ok: false, error: "locked" };
      if (perms.banned.includes(data.playerId)) return { ok: false, error: "banned" };
      // Atomic Friday claim — up to MAX_GUEST_SLOTS guest seats.
      if (!(await claimGuestSlot(sql, data.worldId, data.playerId))) {
        return { ok: false, error: "occupied" };
      }
    }

    await sql.query(
      `insert into peep_presence (world_id, player_id, last_seen)
       values ($1, $2, $3)
       on conflict (world_id, player_id)
       do update set last_seen = excluded.last_seen`,
      [data.worldId, data.playerId, nowMs()],
    );

    const priorOpen = await sql.query<{ at: number }>(
      `select at from peep_events
       where name = 'open' and world_id = $1 and player_id = $2
       order by at desc limit 1`,
      [data.worldId, data.playerId],
    );
    await recordEvent(sql, "open", data.worldId, data.playerId);
    if (creatorId && creatorId !== data.playerId) {
      await recordEvent(sql, "invite_open", data.worldId, data.playerId);
    }
    const lastOpen = priorOpen[0]?.at;
    if (lastOpen && nowMs() - Number(lastOpen) > 20 * 60 * 60 * 1000) {
      await recordEvent(sql, "return", data.worldId, data.playerId);
    }

    const edits = await sql.query<BlockEdit>(
      `select x, y, z, block from peep_edits where world_id = $1`,
      [data.worldId],
    );
    return {
      ok: true,
      seed: world.seed,
      edits,
      cursor: world.cursor,
      generation: world.generation,
      isCreator,
      guestPermissions: perms,
    };
  });

/** Host-only: persist block edits to SQLite. */
export const applyEdit = createServerFn({ method: "POST" })
  .validator(blockCoord.extend({ playerId }))
  .handler(async ({ data }): Promise<ApplyEditResult> => {
    const sql = await getSql();
    const world = await readWorld(sql, data.worldId);
    if (!world) return { ok: false, error: "not_found" };
    if (world.creatorId) {
      const aliases = await playerIdAliases(sql, data.playerId);
      if (!aliases.includes(world.creatorId)) return { ok: false, error: "forbidden" };
    }
    if (!(await takeRateSlot(sql, data.playerId))) return { ok: false, error: "rate" };

    const bumped = await sql.query<{ edit_cursor: number }>(
      `update peep_worlds set edit_cursor = edit_cursor + 1 where id = $1 returning edit_cursor`,
      [data.worldId],
    );
    const cursor = bumped[0]?.edit_cursor ?? 0;
    await sql.query(
      `insert into peep_edits (world_id, x, y, z, block, cursor, author_id)
       values ($1, $2, $3, $4, $5, $6, $7)
       on conflict (world_id, x, y, z)
       do update set block = excluded.block, cursor = excluded.cursor, author_id = excluded.author_id`,
      [data.worldId, data.x, data.y, data.z, data.block, cursor, data.playerId],
    );
    if (data.block === 0) {
      const seen = await sql.query(
        `select 1 as ok from peep_events where name = 'first_break' and world_id = $1 and player_id = $2 limit 1`,
        [data.worldId, data.playerId],
      );
      if (!seen[0]) await recordEvent(sql, "first_break", data.worldId, data.playerId);
    }
    return { ok: true, cursor };
  });

/** Host-only: persist many block edits in one request (TNT blast). */
export const applyEdits = createServerFn({ method: "POST" })
  .validator(
    z.object({
      worldId,
      playerId,
      edits: z
        .array(
          z.object({
            x: z.number().int().min(-WORLD_EDIT_LIM).max(WORLD_EDIT_LIM),
            y: z.number().int().min(0).max(WORLD_SY - 1),
            z: z.number().int().min(-WORLD_EDIT_LIM).max(WORLD_EDIT_LIM),
            block: z.number().int().min(0).max(11),
          }),
        )
        .min(1)
        .max(128),
    }),
  )
  .handler(async ({ data }): Promise<ApplyEditResult> => {
    const sql = await getSql();
    const world = await readWorld(sql, data.worldId);
    if (!world) return { ok: false, error: "not_found" };
    if (world.creatorId) {
      const aliases = await playerIdAliases(sql, data.playerId);
      if (!aliases.includes(world.creatorId)) return { ok: false, error: "forbidden" };
    }
    if (!(await takeRateSlots(sql, data.playerId, data.edits.length))) {
      return { ok: false, error: "rate" };
    }

    let cursor = world.cursor;
    let sawBreak = false;
    for (const e of data.edits) {
      const bumped = await sql.query<{ edit_cursor: number }>(
        `update peep_worlds set edit_cursor = edit_cursor + 1 where id = $1 returning edit_cursor`,
        [data.worldId],
      );
      cursor = bumped[0]?.edit_cursor ?? cursor + 1;
      await sql.query(
        `insert into peep_edits (world_id, x, y, z, block, cursor, author_id)
         values ($1, $2, $3, $4, $5, $6, $7)
         on conflict (world_id, x, y, z)
         do update set block = excluded.block, cursor = excluded.cursor, author_id = excluded.author_id`,
        [data.worldId, e.x, e.y, e.z, e.block, cursor, data.playerId],
      );
      if (e.block === 0) sawBreak = true;
    }
    if (sawBreak) {
      const seen = await sql.query(
        `select 1 as ok from peep_events where name = 'first_break' and world_id = $1 and player_id = $2 limit 1`,
        [data.worldId, data.playerId],
      );
      if (!seen[0]) await recordEvent(sql, "first_break", data.worldId, data.playerId);
    }
    return { ok: true, cursor };
  });

export const listEdits = createServerFn({ method: "GET" })
  .validator(
    z.object({
      worldId,
      after: z.number().int().min(0),
      generation: z.number().int().min(0),
    }),
  )
  .handler(async ({ data }): Promise<EditPoll> => {
    const sql = await getSql();
    const world = await readWorld(sql, data.worldId);
    if (!world) return { generation: data.generation, reset: false, edits: [] };
    if (world.generation !== data.generation) {
      const edits = await sql.query<BlockDelta>(
        `select x, y, z, block, cursor from peep_edits where world_id = $1 order by cursor asc`,
        [data.worldId],
      );
      return { generation: world.generation, reset: true, edits };
    }
    const edits = await sql.query<BlockDelta>(
      `select x, y, z, block, cursor from peep_edits
       where world_id = $1 and cursor > $2
       order by cursor asc`,
      [data.worldId, data.after],
    );
    return { generation: world.generation, reset: false, edits };
  });

export const heartbeat = createServerFn({ method: "POST" })
  .validator(
    z.object({
      worldId,
      playerId,
      x: z.number(),
      y: z.number(),
      z: z.number(),
      yaw: z.number(),
      pitch: z.number(),
    }),
  )
  .handler(async ({ data }) => {
    const sql = await getSql();
    await sql.query(
      `insert into peep_presence (world_id, player_id, x, y, z, yaw, pitch, last_seen)
       values ($1, $2, $3, $4, $5, $6, $7, $8)
       on conflict (world_id, player_id)
       do update set x = excluded.x, y = excluded.y, z = excluded.z,
         yaw = excluded.yaw, pitch = excluded.pitch, last_seen = excluded.last_seen`,
      [data.worldId, data.playerId, data.x, data.y, data.z, data.yaw, data.pitch, nowMs()],
    );
    const cutoff = nowMs() - PRESENCE_TTL_SECONDS * 1000;
    const live = await sql.query<{ n: number }>(
      `select count(*) as n from peep_presence
       where world_id = $1 and last_seen > $2`,
      [data.worldId, cutoff],
    );
    if ((live[0]?.n ?? 0) >= 2) {
      const hourAgo = nowMs() - 60 * 60 * 1000;
      const recent = await sql.query(
        `select 1 as ok from peep_events
         where name = 'pair' and world_id = $1 and at > $2
         limit 1`,
        [data.worldId, hourAgo],
      );
      if (!recent[0]) await recordEvent(sql, "pair", data.worldId, data.playerId);
    }
    return { ok: true as const };
  });

export const listPresence = createServerFn({ method: "GET" })
  .validator(z.object({ worldId, playerId }))
  .handler(async ({ data }): Promise<PresencePlayer[]> => {
    const sql = await getSql();
    await prunePresence(sql, data.worldId);
    const cutoff = nowMs() - PRESENCE_TTL_SECONDS * 1000;
    const rows = await sql.query<{
      player_id: string;
      x: number;
      y: number;
      z: number;
      yaw: number;
      pitch: number;
    }>(
      `select player_id, x, y, z, yaw, pitch from peep_presence
       where world_id = $1 and player_id <> $2
         and last_seen > $3
         and y > 0`,
      [data.worldId, data.playerId, cutoff],
    );
    return rows.map((r) => ({
      playerId: r.player_id,
      x: r.x,
      y: r.y,
      z: r.z,
      yaw: r.yaw,
      pitch: r.pitch,
    }));
  });

export const leaveWorld = createServerFn({ method: "POST" })
  .validator(z.object({ worldId, playerId }))
  .handler(async ({ data }) => {
    const sql = await getSql();
    await sql.query(`delete from peep_presence where world_id = $1 and player_id = $2`, [
      data.worldId,
      data.playerId,
    ]);
    await clearGuestSlotsForPlayer(sql, data.playerId, { worldId: data.worldId });
    return { ok: true as const };
  });

export const deleteWorld = createServerFn({ method: "POST" })
  .validator(
    z.object({
      worldId,
      playerId,
      /** Mini App localStorage `p-*` minted before Telegram user id was ready. */
      legacyPlayerId: playerId.optional(),
    }),
  )
  .handler(
    async ({
      data,
    }): Promise<{ ok: true } | { ok: false; error: "not_found" | "forbidden" }> => {
      const sql = await getSql();
      const world = await readWorld(sql, data.worldId);
      if (!world) {
        // Drop stale TG snapshot pointers so the menu doesn't resurrect ghosts.
        if (data.playerId.startsWith("tg_")) {
          try {
            await sql.query(
              `update peep_tg_saves set world_id = null, updated_at = $2 where tg_user_id = $1 and world_id = $3`,
              [data.playerId, nowMs(), data.worldId],
            );
          } catch {
            /* ignore */
          }
        }
        return { ok: true };
      }

      // Fold WebView race id → tg_* before ownership check.
      const legacy = data.legacyPlayerId;
      if (
        legacy &&
        legacy.startsWith("p-") &&
        legacy !== "p-tgpending" &&
        legacy !== "p-ssr" &&
        data.playerId.startsWith("tg_")
      ) {
        try {
          const existing = await sql.query<{ tg_player_id: string }>(
            `select tg_player_id from peep_account_links where browser_player_id = $1 limit 1`,
            [legacy],
          );
          const linked = existing[0]?.tg_player_id;
          if (!linked || linked === data.playerId) {
            await sql.query(
              `insert into peep_account_links (browser_player_id, tg_player_id, linked_at)
               values ($1, $2, $3)
               on conflict(browser_player_id) do update set
                 tg_player_id = excluded.tg_player_id,
                 linked_at = excluded.linked_at`,
              [legacy, data.playerId, nowMs()],
            );
            await sql.query(`update peep_worlds set creator_id = $1 where creator_id = $2`, [
              data.playerId,
              legacy,
            ]);
            await sql.query(`update peep_worlds set guest_id = $1 where guest_id = $2`, [
              data.playerId,
              legacy,
            ]);
            await sql.query(`update peep_worlds set guest_id_2 = $1 where guest_id_2 = $2`, [
              data.playerId,
              legacy,
            ]);
            await sql.query(`update peep_worlds set guest_id_3 = $1 where guest_id_3 = $2`, [
              data.playerId,
              legacy,
            ]);
            await sql.query(`update peep_worlds set guest_id_4 = $1 where guest_id_4 = $2`, [
              data.playerId,
              legacy,
            ]);
          }
        } catch {
          /* links table may be missing on old deploys */
        }
      }

      let aliases = await playerIdAliases(sql, data.playerId);
      const tgCanon = aliases.find((a) => a.startsWith("tg_"));
      if (tgCanon) {
        for (const a of aliases) {
          if (a === tgCanon) continue;
          await sql.query(`update peep_worlds set creator_id = $1 where creator_id = $2`, [
            tgCanon,
            a,
          ]);
        }
        aliases = await playerIdAliases(sql, data.playerId);
      }

      const fresh = await readWorld(sql, data.worldId);
      const creatorId = fresh?.creatorId ?? world.creatorId;
      if (!creatorId || !aliases.includes(creatorId)) {
        // Not the owner — clear this player's TG save pointer if it pinned the card.
        if (data.playerId.startsWith("tg_")) {
          try {
            await sql.query(
              `update peep_tg_saves set world_id = null, updated_at = $2 where tg_user_id = $1 and world_id = $3`,
              [data.playerId, nowMs(), data.worldId],
            );
          } catch {
            /* ignore */
          }
        }
        return { ok: false, error: "forbidden" };
      }

      const purge = async (q: string, params: unknown[] = [data.worldId]) => {
        try {
          await sql.query(q, params);
        } catch {
          /* related table may be missing */
        }
      };
      await purge(`delete from peep_events where world_id = $1`);
      await purge(`delete from peep_edits where world_id = $1`);
      await purge(`delete from peep_presence where world_id = $1`);
      await purge(`delete from peep_tg_saves where world_id = $1`);
      await sql.query(`delete from peep_worlds where id = $1`, [data.worldId]);
      return { ok: true };
    },
  );

export const resetWorld = createServerFn({ method: "POST" })
  .validator(z.object({ worldId, playerId }))
  .handler(async ({ data }): Promise<{ ok: true; generation: number } | { ok: false }> => {
    const sql = await getSql();
    const world = await readWorld(sql, data.worldId);
    if (!world) return { ok: false };
    const aliases = await playerIdAliases(sql, data.playerId);
    if (!world.creatorId || !aliases.includes(world.creatorId)) return { ok: false };
    await sql.query(`delete from peep_edits where world_id = $1`, [data.worldId]);
    const bumped = await sql.query<{ generation: number }>(
      `update peep_worlds set generation = generation + 1, edit_cursor = 0 where id = $1 returning generation`,
      [data.worldId],
    );
    return { ok: true, generation: Number(bumped[0]?.generation ?? world.generation + 1) };
  });

export const trackEvent = createServerFn({ method: "POST" })
  .validator(
    z.object({
      name: z.enum(["invite"]),
      worldId,
      playerId,
    }),
  )
  .handler(async ({ data }) => {
    const sql = await getSql();
    await recordEvent(sql, data.name, data.worldId, data.playerId);
    return { ok: true as const };
  });

/** Host updates Friday permissions (lock / build / ban list). */
export const updateGuestPermissions = createServerFn({ method: "POST" })
  .validator(
    z.object({
      playerId,
      patch: z.object({
        locked: z.boolean().optional(),
        buildAllowed: z.boolean().optional(),
        banPlayerId: z.string().optional(),
        unbanPlayerId: z.string().optional(),
      }),
    }),
  )
  .handler(async ({ data }): Promise<{ ok: true; permissions: GuestPermissions } | { ok: false }> => {
    if (!/^tg_/.test(data.playerId) && !data.playerId.startsWith("p-") && !data.playerId.startsWith("tg_")) {
      /* allow any host id */
    }
    const sql = await getSql();
    const rows = await sql.query<{ guest_permissions: string | null; world_id: string | null }>(
      `select guest_permissions, world_id from peep_tg_saves where tg_user_id = $1`,
      [data.playerId],
    );
    let perms = rows[0]
      ? parseGuestPermissions(rows[0].guest_permissions)
      : { ...DEFAULT_GUEST_PERMISSIONS, banned: [] as string[] };

    if (data.patch.locked !== undefined) perms.locked = data.patch.locked;
    if (data.patch.buildAllowed !== undefined) perms.buildAllowed = data.patch.buildAllowed;
    if (data.patch.banPlayerId) {
      if (!perms.banned.includes(data.patch.banPlayerId)) perms.banned.push(data.patch.banPlayerId);
      // Free the Friday slot so a new guest can claim after kick.
      await clearGuestSlotsForPlayer(sql, data.patch.banPlayerId, { creatorId: data.playerId });
      await sql.query(`delete from peep_presence where player_id = $1 and world_id in (
        select id from peep_worlds where creator_id = $2
      )`, [data.patch.banPlayerId, data.playerId]);
    }
    if (data.patch.unbanPlayerId) {
      perms.banned = perms.banned.filter((id) => id !== data.patch.unbanPlayerId);
    }

    const json = stringifyGuestPermissions(perms);
    const t = nowMs();
    if (rows[0]) {
      await sql.query(
        `update peep_tg_saves set guest_permissions = $2, updated_at = $3 where tg_user_id = $1`,
        [data.playerId, json, t],
      );
    } else {
      await sql.query(
        `insert into peep_tg_saves (tg_user_id, world_id, seed, edits, inventory, guest_permissions, updated_at)
         values ($1, null, null, '[]', '{}', $2, $3)`,
        [data.playerId, json, t],
      );
    }
    return { ok: true, permissions: perms };
  });
