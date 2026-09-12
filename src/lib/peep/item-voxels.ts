import * as THREE from "three";
import { PICKAXE_REST } from "./pickaxe";

export const FORGE_STORAGE_KEY = "peep.forge.item";

/** One editor cell is this many overlay units in the hand. */
export const ITEM_UNIT = 0.1;

export const ITEM_KINDS = ["wood", "metal", "accent", "gold", "cloth"] as const;
export type ItemKind = (typeof ITEM_KINDS)[number];

export type ItemVoxel = {
  x: number;
  y: number;
  z: number;
  color: string;
};

export const ITEM_HEX: Record<ItemKind, string> = {
  wood: "#8b5a2b",
  metal: "#808080",
  accent: "#b85c38",
  gold: "#ffd700",
  cloth: "#1a1612",
};

export const ITEM_COLORS: Record<ItemKind, number> = {
  wood: 0x8b5a2b,
  metal: 0x808080,
  accent: 0xb85c38,
  gold: 0xffd700,
  cloth: 0x1a1612,
};

export const ITEM_LABELS: Record<ItemKind, string> = {
  wood: "дерево",
  metal: "металл",
  accent: "терракота",
  gold: "золото",
  cloth: "ткань",
};

/** Old кузница `kind` values → flat palette hex. */
const KIND_HEX: Record<string, string> = {
  wood: ITEM_HEX.wood,
  metal: ITEM_HEX.metal,
  accent: ITEM_HEX.accent,
  gold: ITEM_HEX.gold,
  cloth: ITEM_HEX.cloth,
  dirt: ITEM_HEX.wood,
  stone: ITEM_HEX.metal,
  grass: ITEM_HEX.accent,
  sand: ITEM_HEX.gold,
};

export type ItemDebugTransform = {
  x: number;
  y: number;
  z: number;
  rx: number;
  ry: number;
  rz: number;
  scale: number;
};

/** Live rest pose for the overlay item. Leva writes here; the game reads it. */
export const ITEM_DEBUG: ItemDebugTransform = {
  x: PICKAXE_REST.x,
  y: PICKAXE_REST.y,
  z: PICKAXE_REST.z,
  rx: PICKAXE_REST.rx,
  ry: PICKAXE_REST.ry,
  rz: PICKAXE_REST.rz,
  scale: 0.88,
};

export function kindFromHex(color: string): ItemKind {
  const hex = normalizeHex(color);
  if (!hex) return "wood";
  for (const kind of ITEM_KINDS) {
    if (ITEM_HEX[kind] === hex) return kind;
  }
  return "wood";
}

export function hexToInt(color: string): number {
  const hex = normalizeHex(color) ?? ITEM_HEX.wood;
  return Number.parseInt(hex.slice(1), 16);
}

export function normalizeHex(value: unknown): string | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return `#${(value & 0xffffff).toString(16).padStart(6, "0")}`;
  }
  if (typeof value !== "string") return null;
  const raw = value.trim();
  const six = raw.match(/^#?([0-9a-fA-F]{6})$/);
  if (six) return `#${six[1]!.toLowerCase()}`;
  const three = raw.match(/^#?([0-9a-fA-F]{3})$/);
  if (three) {
    const [r, g, b] = three[1]!;
    return `#${r}${r}${g}${g}${b}${b}`.toLowerCase();
  }
  return null;
}

function colorFromRow(rec: Record<string, unknown>): string {
  return normalizeHex(rec.color) ?? KIND_HEX[String(rec.kind ?? "")] ?? ITEM_HEX.wood;
}

export function parseItemVoxels(jsonString: string): ItemVoxel[] {
  const data: unknown = JSON.parse(jsonString);
  if (!Array.isArray(data)) throw new Error("item json must be an array");
  const out: ItemVoxel[] = [];
  const seen = new Set<string>();
  for (const row of data) {
    if (!row || typeof row !== "object") continue;
    const rec = row as Record<string, unknown>;
    const x = Number(rec.x);
    const y = Number(rec.y);
    const z = Number(rec.z);
    if (![x, y, z].every(Number.isFinite)) continue;
    const vx = Math.round(x);
    const vy = Math.round(y);
    const vz = Math.round(z);
    const key = `${vx},${vy},${vz}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ x: vx, y: vy, z: vz, color: colorFromRow(rec) });
  }
  return out;
}

export function serializeItemVoxels(voxels: ItemVoxel[]): string {
  return JSON.stringify(
    voxels.map((v) => ({
      x: v.x,
      y: v.y,
      z: v.z,
      color: normalizeHex(v.color) ?? ITEM_HEX.wood,
    })),
  );
}

export function readStoredItem(): ItemVoxel[] | null {
  if (typeof localStorage === "undefined") return null;
  const raw = localStorage.getItem(FORGE_STORAGE_KEY);
  if (!raw) return null;
  try {
    const voxels = parseItemVoxels(raw);
    return voxels.length ? voxels : null;
  } catch {
    return null;
  }
}

export function writeStoredItem(voxels: ItemVoxel[]) {
  if (typeof localStorage === "undefined") return;
  localStorage.setItem(FORGE_STORAGE_KEY, serializeItemVoxels(voxels));
}

/**
 * Merge a кузница export into one overlay group (InstancedMesh).
 * Coordinates are editor cells around (0,0,0). Flat hex, no terrain atlas.
 */
export function buildItemFromJSON(jsonString: string): THREE.Group {
  const voxels = parseItemVoxels(jsonString);
  const g = new THREE.Group();
  g.name = "forgeItem";
  if (!voxels.length) return g;

  const byColor = new Map<string, ItemVoxel[]>();
  for (const v of voxels) {
    const color = normalizeHex(v.color) ?? ITEM_HEX.wood;
    const list = byColor.get(color) ?? [];
    list.push(v);
    byColor.set(color, list);
  }

  const dummy = new THREE.Object3D();
  for (const [color, list] of byColor) {
    const geo = new THREE.BoxGeometry(ITEM_UNIT, ITEM_UNIT, ITEM_UNIT);
    const mat = new THREE.MeshBasicMaterial({ color: hexToInt(color) });
    const inst = new THREE.InstancedMesh(geo, mat, list.length);
    inst.frustumCulled = false;
    list.forEach((v, i) => {
      dummy.position.set(v.x * ITEM_UNIT, v.y * ITEM_UNIT, v.z * ITEM_UNIT);
      dummy.updateMatrix();
      inst.setMatrixAt(i, dummy.matrix);
    });
    inst.instanceMatrix.needsUpdate = true;
    g.add(inst);
  }
  return g;
}
