import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { getSql } from "@/lib/db";
import {
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
  block: z.number().int().min(0).max(9),
});

const ALPH = "abcdefghjkmnpqrstuvwxyz23456789";

function nowMs(): number {
  return Date.now();
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
}

type WorldRow = {
  seed: number;
  cursor: number;
  generation: number;
  creatorId: string | null;
};

async function readWorld(
  sql: Awaited<ReturnType<typeof getSql>>,
  id: string,
): Promise<WorldRow | null> {
  const rows = await sql.query<{
    seed: number;
    edit_cursor: number | null;
    generation: number | null;
    creator_id: string | null;
  }>(`select seed, edit_cursor, generation, creator_id from peep_worlds where id = $1`, [id]);
  const row = rows[0];
  if (!row) return null;
  return {
    seed: row.seed,
    cursor: Number(row.edit_cursor ?? 0),
    generation: Number(row.generation ?? 0),
    creatorId: row.creator_id,
  };
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
  const rows = await sql.query<{ window_start: number; count: number }>(
    `select window_start, count from peep_rate where player_id = $1`,
    [id],
  );
  const now = nowMs();
  const row = rows[0];
  if (!row) {
    await sql.query(`insert into peep_rate (player_id, window_start, count) values ($1, $2, 1)`, [
      id,
      now,
    ]);
    return true;
  }
  if (now - Number(row.window_start) > RATE_WINDOW_SECONDS * 1000) {
    await sql.query(`update peep_rate set window_start = $2, count = 1 where player_id = $1`, [
      id,
      now,
    ]);
    return true;
  }
  if (row.count >= RATE_MAX_EDITS) return false;
  await sql.query(`update peep_rate set count = count + 1 where player_id = $1`, [id]);
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
  .validator(z.object({ playerId }))
  .handler(async ({ data }): Promise<{ id: string; seed: number }> => {
    const sql = await getSql();
    const seed = (crypto.getRandomValues(new Uint32Array(1))[0] ?? 1) % 1_000_000_000;
    for (let i = 0; i < 6; i++) {
      const id = newWorldId();
      try {
        await sql.query(`insert into peep_worlds (id, seed, creator_id) values ($1, $2, $3)`, [
          id,
          seed,
          data.playerId,
        ]);
        await recordEvent(sql, "create", id, data.playerId);
        return { id, seed };
      } catch (err) {
        if (isUniqueError(err)) continue;
        throw err;
      }
    }
    throw new Error("Could not create world");
  });

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

    const isCreator = creatorId === data.playerId;
    const perms = await loadHostPerms(sql, creatorId);
    if (!isCreator) {
      if (perms.locked) return { ok: false, error: "locked" };
      if (perms.banned.includes(data.playerId)) return { ok: false, error: "banned" };
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
    if (world.creatorId && world.creatorId !== data.playerId) {
      return { ok: false, error: "forbidden" };
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
    return { ok: true as const };
  });

export const deleteWorld = createServerFn({ method: "POST" })
  .validator(z.object({ worldId, playerId }))
  .handler(async ({ data }): Promise<{ ok: true } | { ok: false }> => {
    const sql = await getSql();
    const world = await readWorld(sql, data.worldId);
    if (!world || world.creatorId !== data.playerId) return { ok: false };
    try {
      await sql.query(`delete from peep_events where world_id = $1`, [data.worldId]);
    } catch {
      /* ignore */
    }
    await sql.query(`delete from peep_worlds where id = $1`, [data.worldId]);
    return { ok: true };
  });

export const resetWorld = createServerFn({ method: "POST" })
  .validator(z.object({ worldId, playerId }))
  .handler(async ({ data }): Promise<{ ok: true; generation: number } | { ok: false }> => {
    const sql = await getSql();
    const world = await readWorld(sql, data.worldId);
    if (!world || world.creatorId !== data.playerId) return { ok: false };
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
