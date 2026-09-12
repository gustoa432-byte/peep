import { getSql } from "@/lib/db";
import type { Story } from "./progress";
import {
  clampSavePayload,
  type WorldEditDelta,
  type WorldLoadResult,
  type WorldSavePayload,
} from "./world-serialize";

function parseEdits(raw: unknown): WorldEditDelta[] {
  if (!Array.isArray(raw)) return [];
  const out: WorldEditDelta[] = [];
  for (const e of raw) {
    if (!e || typeof e !== "object") continue;
    const row = e as Record<string, unknown>;
    const x = Number(row.x);
    const y = Number(row.y);
    const z = Number(row.z);
    const block = Number(row.block);
    if (![x, y, z, block].every((n) => Number.isFinite(n))) continue;
    out.push({ x: Math.trunc(x), y: Math.trunc(y), z: Math.trunc(z), block: Math.trunc(block) });
  }
  return out;
}

function parseInventory(raw: unknown): Story {
  const inv = (raw && typeof raw === "object" ? raw : {}) as Partial<Story>;
  const counts: Record<number, number> = {};
  if (inv.counts && typeof inv.counts === "object") {
    for (const [k, v] of Object.entries(inv.counts)) {
      const id = Number(k);
      const n = Number(v);
      if (Number.isFinite(id) && Number.isFinite(n) && n > 0) counts[id] = Math.floor(n);
    }
  }
  return {
    counts,
    friday: Boolean(inv.friday || inv.chest),
    hat: Boolean(inv.hat),
    chest: Boolean(inv.chest),
    chestCraft: Math.min(1, Math.max(0, Number(inv.chestCraft) || 0)),
  };
}

export async function saveWorldSnapshot(
  body: unknown,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const payload = clampSavePayload(body);
  if (!payload) return { ok: false, error: "invalid_payload" };

  const sql = await getSql();
  await sql.query(
    `insert into peep_tg_saves (tg_user_id, world_id, seed, edits, inventory, updated_at)
     values ($1, $2, $3, $4::jsonb, $5::jsonb, now())
     on conflict (tg_user_id) do update set
       world_id = excluded.world_id,
       seed = excluded.seed,
       edits = excluded.edits,
       inventory = excluded.inventory,
       updated_at = now()`,
    [
      payload.tg_user_id,
      payload.world_id,
      payload.seed,
      JSON.stringify(payload.edits),
      JSON.stringify(payload.inventory),
    ],
  );
  return { ok: true };
}

export async function loadWorldSnapshot(tgUserId: string): Promise<WorldLoadResult> {
  if (!/^tg_\d{1,16}$/.test(tgUserId)) {
    return { ok: false, error: "invalid_tg_user_id" };
  }

  const sql = await getSql();
  const rows = await sql.query<{
    world_id: string | null;
    seed: number | null;
    edits: unknown;
    inventory: unknown;
  }>(
    `select world_id, seed, edits, inventory from peep_tg_saves where tg_user_id = $1`,
    [tgUserId],
  );
  const row = rows[0];
  if (!row || !row.world_id || row.seed == null) {
    return { ok: true, empty: true };
  }

  return {
    ok: true,
    empty: false,
    world_id: row.world_id,
    seed: Number(row.seed),
    edits: parseEdits(typeof row.edits === "string" ? JSON.parse(row.edits) : row.edits),
    inventory: parseInventory(
      typeof row.inventory === "string" ? JSON.parse(row.inventory) : row.inventory,
    ),
  };
}

export type { WorldSavePayload };
