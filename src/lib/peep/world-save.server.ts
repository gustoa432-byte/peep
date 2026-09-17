import { getSql } from "@/lib/db";
import {
  DEFAULT_GUEST_PERMISSIONS,
  parseGuestPermissions,
  stringifyGuestPermissions,
  type GuestPermissions,
} from "./guest-permissions";
import { normalizeStory, type Story } from "./progress";
import {
  clampSavePayload,
  type WorldEditDelta,
  type WorldLoadResult,
  type WorldSavePayload,
} from "./world-serialize";

function parseEdits(raw: unknown): WorldEditDelta[] {
  if (typeof raw === "string") {
    try {
      raw = JSON.parse(raw);
    } catch {
      return [];
    }
  }
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
  if (typeof raw === "string") {
    try {
      raw = JSON.parse(raw);
    } catch {
      raw = {};
    }
  }
  return normalizeStory((raw && typeof raw === "object" ? raw : {}) as Partial<Story>);
}

export async function saveWorldSnapshot(
  body: unknown,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const payload = clampSavePayload(body);
  if (!payload) return { ok: false, error: "invalid_payload" };

  const sql = await getSql();
  const existing = await sql.query<{ guest_permissions: string | null }>(
    `select guest_permissions from peep_tg_saves where tg_user_id = $1`,
    [payload.tg_user_id],
  );
  const guest_permissions =
    existing[0]?.guest_permissions ??
    stringifyGuestPermissions({ ...DEFAULT_GUEST_PERMISSIONS, banned: [] });

  const t = Date.now();
  await sql.query(
    `insert into peep_tg_saves (tg_user_id, world_id, seed, edits, inventory, guest_permissions, updated_at)
     values ($1, $2, $3, $4, $5, $6, $7)
     on conflict (tg_user_id) do update set
       world_id = excluded.world_id,
       seed = excluded.seed,
       edits = excluded.edits,
       inventory = excluded.inventory,
       updated_at = excluded.updated_at`,
    [
      payload.tg_user_id,
      payload.world_id,
      payload.seed,
      JSON.stringify(payload.edits),
      JSON.stringify(payload.inventory),
      guest_permissions,
      t,
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
    guest_permissions: string | null;
  }>(
    `select world_id, seed, edits, inventory, guest_permissions from peep_tg_saves where tg_user_id = $1`,
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
    edits: parseEdits(row.edits),
    inventory: parseInventory(row.inventory),
    guest_permissions: parseGuestPermissions(row.guest_permissions),
  };
}

export type { WorldSavePayload, GuestPermissions };
