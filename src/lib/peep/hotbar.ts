import {
  BLOCK_PALETTE,
  DEFAULT_HOTBAR,
  DYNAMITE,
  FRIDAY_HOTBAR,
  GOLD,
  HOTBAR_SLOTS,
  WORLD_ID_RE,
} from "./constants";

const KEY = "peep.hotbar";

function slot(worldId: string, playerId: string): string {
  return `${KEY}.${worldId}.${playerId}`;
}

function isKnownBlock(id: number): boolean {
  return (BLOCK_PALETTE as readonly number[]).includes(id) || id === GOLD;
}

export function defaultHotbar(isCreator: boolean): number[] {
  return [...(isCreator ? DEFAULT_HOTBAR : FRIDAY_HOTBAR)];
}

/** Load five hotbar block ids; falls back to Pip / Friday starter (TNT first). */
export function loadHotbar(worldId: string, playerId: string, isCreator = true): number[] {
  const fallback = defaultHotbar(isCreator);
  if (typeof localStorage === "undefined" || !WORLD_ID_RE.test(worldId)) return fallback;
  try {
    const raw = localStorage.getItem(slot(worldId, playerId));
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed) || parsed.length < HOTBAR_SLOTS) return fallback;
    const out: number[] = [];
    for (let i = 0; i < HOTBAR_SLOTS; i++) {
      const n = Number(parsed[i]);
      out.push(Number.isFinite(n) && isKnownBlock(n) ? Math.floor(n) : fallback[i]!);
    }
    // Prefer TNT in slot 0 when the belt never had it (legacy saves).
    if (!out.includes(DYNAMITE)) out[0] = DYNAMITE;
    return out;
  } catch {
    return fallback;
  }
}

export function saveHotbar(worldId: string, playerId: string, slots: readonly number[]) {
  if (typeof localStorage === "undefined" || !WORLD_ID_RE.test(worldId)) return;
  try {
    localStorage.setItem(slot(worldId, playerId), JSON.stringify(slots.slice(0, HOTBAR_SLOTS)));
  } catch {
    /* quota */
  }
}
