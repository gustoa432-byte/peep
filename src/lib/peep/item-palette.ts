import { FORGE_SWATCHES, GOLD_HEXES, normalizeHex } from "./item-voxels";

export const FORGE_PALETTE_KEY = "peep.forge.palette";
export const FORGE_PALETTE_MAX = 128;

const BLOCK_SEEDS = [
  ...GOLD_HEXES,
  "#ccaaee",
  "#68a85a",
  "#8a5a38",
  "#7a7670",
  "#b07a45",
  "#e0c48a",
  "#4db84a",
  "#8a5a24",
];

export function seedForgePalette(): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of [...BLOCK_SEEDS, ...FORGE_SWATCHES]) {
    const hex = normalizeHex(raw);
    if (!hex || seen.has(hex)) continue;
    seen.add(hex);
    out.push(hex);
  }
  return out;
}

function dedupeHexes(values: unknown[], max = FORGE_PALETTE_MAX): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const row of values) {
    const hex = normalizeHex(row);
    if (!hex || seen.has(hex)) continue;
    seen.add(hex);
    out.push(hex);
    if (out.length >= max) break;
  }
  return out;
}

export function readForgePalette(): string[] {
  const seed = seedForgePalette();
  if (typeof localStorage === "undefined") return seed;
  const raw = localStorage.getItem(FORGE_PALETTE_KEY);
  if (!raw) return seed;
  try {
    const data: unknown = JSON.parse(raw);
    if (!Array.isArray(data)) return seed;
    const stored = dedupeHexes(data);
    return stored.length ? stored : seed;
  } catch {
    return seed;
  }
}

export function writeForgePalette(colors: string[]) {
  if (typeof localStorage === "undefined") return;
  localStorage.setItem(FORGE_PALETTE_KEY, JSON.stringify(dedupeHexes(colors)));
}

export function rememberForgeColor(hex: string): string[] {
  const n = normalizeHex(hex);
  const cur = readForgePalette();
  if (!n) return cur;
  const next = [n, ...cur.filter((c) => c !== n)].slice(0, FORGE_PALETTE_MAX);
  writeForgePalette(next);
  return next;
}
