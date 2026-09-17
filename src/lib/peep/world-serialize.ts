import { normalizeStory, type Story } from "./progress";

/** One placed/broken voxel relative to the procedural landscape. */
export type WorldEditDelta = {
  x: number;
  y: number;
  z: number;
  block: number;
};

/** Compact personal-world snapshot for Telegram lazy-save. */
export type WorldSavePayload = {
  tg_user_id: string;
  world_id: string;
  seed: number;
  edits: WorldEditDelta[];
  inventory: Story;
};

export type WorldLoadResult =
  | { ok: true; empty: true }
  | {
      ok: true;
      empty: false;
      world_id: string;
      seed: number;
      edits: WorldEditDelta[];
      inventory: Story;
      guest_permissions?: import("./guest-permissions").GuestPermissions;
    }
  | { ok: false; error: string };

const MAX_EDITS = 20_000;

export function clampSavePayload(raw: unknown): WorldSavePayload | null {
  if (!raw || typeof raw !== "object") return null;
  const p = raw as Record<string, unknown>;
  const tg = String(p.tg_user_id ?? "").trim();
  const worldId = String(p.world_id ?? "").trim().toLowerCase();
  const seed = Number(p.seed);
  if (!/^tg_\d{1,16}$/.test(tg)) return null;
  if (!/^[a-hjkmnp-z2-9]{6}$/.test(worldId)) return null;
  if (!Number.isFinite(seed)) return null;

  const editsIn = Array.isArray(p.edits) ? p.edits : [];
  if (editsIn.length > MAX_EDITS) return null;
  const edits: WorldEditDelta[] = [];
  for (const e of editsIn) {
    if (!e || typeof e !== "object") continue;
    const row = e as Record<string, unknown>;
    const x = Number(row.x);
    const y = Number(row.y);
    const z = Number(row.z);
    const block = Number(row.block);
    if (![x, y, z, block].every((n) => Number.isFinite(n))) continue;
    edits.push({
      x: Math.trunc(x),
      y: Math.trunc(y),
      z: Math.trunc(z),
      block: Math.trunc(block),
    });
  }

  const inv = (p.inventory && typeof p.inventory === "object" ? p.inventory : {}) as Partial<Story>;
  const inventory = normalizeStory(inv);

  return {
    tg_user_id: tg,
    world_id: worldId,
    seed: Math.trunc(seed),
    edits,
    inventory,
  };
}
