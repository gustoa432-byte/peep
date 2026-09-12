import * as THREE from "three";
import { PICKAXE_REST } from "./pickaxe";

export const FORGE_STORAGE_KEY = "peep.forge.item";

/** One editor cell is this many overlay units in the hand. */
export const ITEM_UNIT = 0.1;

export const ITEM_KINDS = ["wood", "metal", "accent", "dirt", "stone", "grass", "sand", "gold"] as const;
export type ItemKind = (typeof ITEM_KINDS)[number];

export type ItemVoxel = {
  x: number;
  y: number;
  z: number;
  kind: ItemKind;
};

export const ITEM_COLORS: Record<ItemKind, number> = {
  wood: 0xb07a45,
  metal: 0x8a8680,
  accent: 0xb85c38,
  dirt: 0x8a5a38,
  stone: 0x7a7670,
  grass: 0x68a85a,
  sand: 0xe0c48a,
  gold: 0xe2b84a,
};

export const ITEM_LABELS: Record<ItemKind, string> = {
  wood: "дерево",
  metal: "металл",
  accent: "терракота",
  dirt: "земля",
  stone: "камень",
  grass: "трава",
  sand: "песок",
  gold: "золото",
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

function isKind(value: unknown): value is ItemKind {
  return typeof value === "string" && (ITEM_KINDS as readonly string[]).includes(value);
}

function kindFromColor(value: unknown): ItemKind | null {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const hex = typeof value === "number" ? value : Number.parseInt(value.replace("#", ""), 16);
  if (!Number.isFinite(hex)) return null;
  for (const kind of ITEM_KINDS) {
    if (ITEM_COLORS[kind] === hex) return kind;
  }
  return null;
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
    const kind = isKind(rec.kind) ? rec.kind : kindFromColor(rec.color) ?? "wood";
    const vx = Math.round(x);
    const vy = Math.round(y);
    const vz = Math.round(z);
    const key = `${vx},${vy},${vz}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ x: vx, y: vy, z: vz, kind });
  }
  return out;
}

export function serializeItemVoxels(voxels: ItemVoxel[]): string {
  return JSON.stringify(
    voxels.map((v) => ({
      x: v.x,
      y: v.y,
      z: v.z,
      kind: v.kind,
      color: `#${ITEM_COLORS[v.kind].toString(16).padStart(6, "0")}`,
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
 * Coordinates are editor cells around (0,0,0).
 */
export function buildItemFromJSON(jsonString: string): THREE.Group {
  const voxels = parseItemVoxels(jsonString);
  const g = new THREE.Group();
  g.name = "forgeItem";
  if (!voxels.length) return g;

  const byKind = new Map<ItemKind, ItemVoxel[]>();
  for (const v of voxels) {
    const list = byKind.get(v.kind) ?? [];
    list.push(v);
    byKind.set(v.kind, list);
  }

  const dummy = new THREE.Object3D();
  for (const [kind, list] of byKind) {
    const geo = new THREE.BoxGeometry(ITEM_UNIT, ITEM_UNIT, ITEM_UNIT);
    const mat = new THREE.MeshLambertMaterial({ color: ITEM_COLORS[kind] });
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
