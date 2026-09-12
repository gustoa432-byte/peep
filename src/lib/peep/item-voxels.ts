import * as THREE from "three";
import { PICKAXE_REST } from "./pickaxe";

export const FORGE_STORAGE_KEY = "peep.forge.item";

/** One editor cell is this many overlay units in the hand. */
export const ITEM_UNIT = 0.1;

export type ItemVoxel = {
  x: number;
  y: number;
  z: number;
  color: string;
};

export type ItemTransform = {
  position: [number, number, number];
  rotation: [number, number, number];
  scale: number;
};

export type ItemDocument = {
  voxels: ItemVoxel[];
  transform: ItemTransform;
};

/** Game-style swatches. Terracotta sits as the accent. */
export const FORGE_SWATCHES = [
  "#1a1612",
  "#3a332c",
  "#8a7e72",
  "#c4b8ac",
  "#f3eee6",
  "#e8c4a8",
  "#8b5a2b",
  "#8a5a38",
  "#b85c38",
  "#a33b2a",
  "#5f7a53",
  "#3fa83c",
  "#d2b27a",
  "#7a7670",
  "#808080",
  "#ffd700",
  "#8eb8d4",
  "#1b5368",
] as const;

export const DEFAULT_PAINT: string = FORGE_SWATCHES[6];

/** Old кузница `kind` values → flat palette hex. */
const KIND_HEX: Record<string, string> = {
  wood: "#8b5a2b",
  metal: "#808080",
  accent: "#b85c38",
  gold: "#ffd700",
  cloth: "#1a1612",
  dirt: "#8a5a38",
  stone: "#7a7670",
  grass: "#5f7a53",
  sand: "#d2b27a",
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

/** Live rest pose for the overlay item. Leva / примерочная write here. */
export const ITEM_DEBUG: ItemDebugTransform = {
  x: PICKAXE_REST.x,
  y: PICKAXE_REST.y,
  z: PICKAXE_REST.z,
  rx: PICKAXE_REST.rx,
  ry: PICKAXE_REST.ry,
  rz: PICKAXE_REST.rz,
  scale: 0.88,
};

export function defaultTransform(): ItemTransform {
  return {
    position: [PICKAXE_REST.x, PICKAXE_REST.y, PICKAXE_REST.z],
    rotation: [PICKAXE_REST.rx, PICKAXE_REST.ry, PICKAXE_REST.rz],
    scale: 0.88,
  };
}

export function transformFromDebug(): ItemTransform {
  return {
    position: [ITEM_DEBUG.x, ITEM_DEBUG.y, ITEM_DEBUG.z],
    rotation: [ITEM_DEBUG.rx, ITEM_DEBUG.ry, ITEM_DEBUG.rz],
    scale: ITEM_DEBUG.scale,
  };
}

export function applyItemTransform(t: ItemTransform) {
  ITEM_DEBUG.x = t.position[0];
  ITEM_DEBUG.y = t.position[1];
  ITEM_DEBUG.z = t.position[2];
  ITEM_DEBUG.rx = t.rotation[0];
  ITEM_DEBUG.ry = t.rotation[1];
  ITEM_DEBUG.rz = t.rotation[2];
  ITEM_DEBUG.scale = t.scale;
}

export function hexToInt(color: string): number {
  const hex = normalizeHex(color) ?? DEFAULT_PAINT;
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
  return normalizeHex(rec.color) ?? KIND_HEX[String(rec.kind ?? "")] ?? DEFAULT_PAINT;
}

function parseVoxelArray(data: unknown[]): ItemVoxel[] {
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

function num(value: unknown, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

export function parseTransform(raw: unknown): ItemTransform {
  const fallback = defaultTransform();
  if (!raw || typeof raw !== "object") return fallback;
  const rec = raw as Record<string, unknown>;
  const pos = rec.position;
  const rot = rec.rotation;
  if (Array.isArray(pos) && Array.isArray(rot)) {
    return {
      position: [num(pos[0], fallback.position[0]), num(pos[1], fallback.position[1]), num(pos[2], fallback.position[2])],
      rotation: [num(rot[0], fallback.rotation[0]), num(rot[1], fallback.rotation[1]), num(rot[2], fallback.rotation[2])],
      scale: num(rec.scale, fallback.scale),
    };
  }
  return {
    position: [num(rec.x, fallback.position[0]), num(rec.y, fallback.position[1]), num(rec.z, fallback.position[2])],
    rotation: [num(rec.rx, fallback.rotation[0]), num(rec.ry, fallback.rotation[1]), num(rec.rz, fallback.rotation[2])],
    scale: num(rec.scale, fallback.scale),
  };
}

export function parseItemDocument(jsonString: string): ItemDocument {
  const data: unknown = JSON.parse(jsonString);
  if (Array.isArray(data)) {
    return { voxels: parseVoxelArray(data), transform: defaultTransform() };
  }
  if (!data || typeof data !== "object") throw new Error("item json must be an object or array");
  const rec = data as Record<string, unknown>;
  const list = Array.isArray(rec.voxels) ? rec.voxels : [];
  return { voxels: parseVoxelArray(list), transform: parseTransform(rec.transform) };
}

/** @deprecated prefer parseItemDocument — still accepts a bare voxel array. */
export function parseItemVoxels(jsonString: string): ItemVoxel[] {
  return parseItemDocument(jsonString).voxels;
}

export function serializeItemDocument(doc: ItemDocument): string {
  return JSON.stringify({
    voxels: doc.voxels.map((v) => ({
      x: v.x,
      y: v.y,
      z: v.z,
      color: normalizeHex(v.color) ?? DEFAULT_PAINT,
    })),
    transform: {
      position: [...doc.transform.position] as [number, number, number],
      rotation: [...doc.transform.rotation] as [number, number, number],
      scale: doc.transform.scale,
    },
  });
}

export function readStoredDocument(): ItemDocument | null {
  if (typeof localStorage === "undefined") return null;
  const raw = localStorage.getItem(FORGE_STORAGE_KEY);
  if (!raw) return null;
  try {
    const doc = parseItemDocument(raw);
    return doc.voxels.length ? doc : { ...doc, voxels: [] };
  } catch {
    return null;
  }
}

export function readStoredItem(): ItemVoxel[] | null {
  const doc = readStoredDocument();
  if (!doc || !doc.voxels.length) return null;
  return doc.voxels;
}

export function writeStoredDocument(doc: ItemDocument) {
  if (typeof localStorage === "undefined") return;
  localStorage.setItem(FORGE_STORAGE_KEY, serializeItemDocument(doc));
}

export function writeStoredItem(voxels: ItemVoxel[]) {
  writeStoredDocument({
    voxels,
    transform: transformFromDebug(),
  });
}

export function buildItemFromVoxels(voxels: ItemVoxel[]): THREE.Group {
  const g = new THREE.Group();
  g.name = "forgeItem";
  if (!voxels.length) return g;

  const byColor = new Map<string, ItemVoxel[]>();
  for (const v of voxels) {
    const color = normalizeHex(v.color) ?? DEFAULT_PAINT;
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

/**
 * Merge a кузница export into one overlay group (InstancedMesh).
 * Accepts a JSON string, a voxel array, or a full document.
 */
export function buildItemFromJSON(input: string | ItemVoxel[] | ItemDocument): THREE.Group {
  if (typeof input === "string") return buildItemFromVoxels(parseItemDocument(input).voxels);
  if (Array.isArray(input)) return buildItemFromVoxels(input);
  return buildItemFromVoxels(input.voxels);
}

export function poseHeldGroup(group: THREE.Group, t: ItemTransform = transformFromDebug()) {
  group.position.set(t.position[0], t.position[1], t.position[2]);
  group.rotation.set(t.rotation[0], t.rotation[1], t.rotation[2]);
  group.scale.setScalar(t.scale);
}
