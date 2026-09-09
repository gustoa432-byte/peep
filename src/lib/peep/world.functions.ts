import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { getSql } from "@/lib/db";
import {
  MAX_PLAYERS,
  PRESENCE_TTL_SECONDS,
  RATE_MAX_EDITS,
  RATE_WINDOW_SECONDS,
  WORLD_ID_RE,
  WORLD_SX,
  WORLD_SY,
  WORLD_SZ,
} from "./constants";
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
const playerId = z.string().regex(/^[a-zA-Z0-9_-]{4,32}$/);
const blockCoord = z.object({
  worldId,
  x: z.number().int().min(0).max(WORLD_SX - 1),
  y: z.number().int().min(0).max(WORLD_SY - 1),
  z: z.number().int().min(0).max(WORLD_SZ - 1),
  block: z.number().int().min(0).max(6),
});

const ALPH = "abcdefghjkmnpqrstuvwxyz23456789";

function newWorldId(): string {
  const bytes = new Uint32Array(6);
  crypto.getRandomValues(bytes);
  let s = "";
  for (const b of bytes) s += ALPH[b % ALPH.length];
  return s;
}

async function prunePresence(sql: Awaited<ReturnType<typeof getSql>>, id: string) {
  await sql.query(`delete from peep_presence where world_id = $1 and last_seen < now() - make_interval(secs => $2)`, [
    id,
    PRESENCE_TTL_SECONDS,
  ]);
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
  try {
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
  } catch {
    const rows = await sql.query<{ seed: number }>(`select seed from peep_worlds where id = $1`, [id]);
    const row = rows[0];
    if (!row) return null;
    return { seed: row.seed, cursor: 0, generation: 0, creatorId: null };
  }
}

async function recordEvent(
  sql: Awaited<ReturnType<typeof getSql>>,
  name: MetricName,
  worldId: string | null,
  playerId: string | null,
) {
  try {
    await sql.query(`insert into peep_events (name, world_id, player_id) values ($1, $2, $3)`, [
      name,
      worldId,
      playerId,
    ]);
  } catch {
    /* table may still be migrating */
  }
}

async function takeRateSlot(
  sql: Awaited<ReturnType<typeof getSql>>,
  id: string,
): Promise<boolean> {
  const rows = await sql.query<{ window_start: string | Date; count: number }>(
    `select window_start, count from peep_rate where player_id = $1`,
    [id],
  );
  const now = Date.now();
  const row = rows[0];
  if (!row) {
    await sql.query(`insert into peep_rate (player_id, window_start, count) values ($1, now(), 1)`, [id]);
    return true;
  }
  const start = new Date(row.window_start).getTime();
  if (now - start > RATE_WINDOW_SECONDS * 1000) {
    await sql.query(`update peep_rate set window_start = now(), count = 1 where player_id = $1`, [id]);
    return true;
  }
  if (row.count >= RATE_MAX_EDITS) return false;
  await sql.query(`update peep_rate set count = count + 1 where player_id = $1`, [id]);
  return true;
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
      } catch {
        /* unique collision — retry */
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
    const others = await sql.query<{ player_id: string }>(
      `select player_id from peep_presence where world_id = $1 and last_seen > now() - make_interval(secs => $2)`,
      [data.worldId, PRESENCE_TTL_SECONDS],
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

    await sql.query(
      `insert into peep_presence (world_id, player_id, last_seen)
       values ($1, $2, now())
       on conflict (world_id, player_id)
       do update set last_seen = now()`,
      [data.worldId, data.playerId],
    );

    const priorOpen = await sql.query<{ at: string | Date }>(
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
    if (lastOpen && Date.now() - new Date(lastOpen).getTime() > 20 * 60 * 60 * 1000) {
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
      isCreator: creatorId === data.playerId,
    };
  });

export const applyEdit = createServerFn({ method: "POST" })
  .validator(blockCoord.extend({ playerId }))
  .handler(async ({ data }): Promise<ApplyEditResult> => {
    const sql = await getSql();
    const worlds = await sql.query(`select 1 from peep_worlds where id = $1`, [data.worldId]);
    if (!worlds[0]) return { ok: false, error: "not_found" };
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
        `select 1 from peep_events where name = 'first_break' and world_id = $1 and player_id = $2 limit 1`,
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
       values ($1, $2, $3, $4, $5, $6, $7, now())
       on conflict (world_id, player_id)
       do update set x = excluded.x, y = excluded.y, z = excluded.z,
         yaw = excluded.yaw, pitch = excluded.pitch, last_seen = now()`,
      [data.worldId, data.playerId, data.x, data.y, data.z, data.yaw, data.pitch],
    );
    const live = await sql.query<{ n: number }>(
      `select count(*)::int as n from peep_presence
       where world_id = $1 and last_seen > now() - make_interval(secs => $2)`,
      [data.worldId, PRESENCE_TTL_SECONDS],
    );
    if ((live[0]?.n ?? 0) >= 2) {
      const recent = await sql.query(
        `select 1 from peep_events
         where name = 'pair' and world_id = $1 and at > now() - interval '1 hour'
         limit 1`,
        [data.worldId],
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
         and last_seen > now() - make_interval(secs => $3)
         and y > 0`,
      [data.worldId, data.playerId, PRESENCE_TTL_SECONDS],
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
      /* table may still be migrating */
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
