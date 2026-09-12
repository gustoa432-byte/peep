import {
  AIR,
  CHEST,
  CHEST_X,
  CHEST_Y,
  CHEST_Z,
  CHUNK_S,
  DIRT,
  GRASS,
  ISLAND_CORE,
  ISLAND_SHORE,
  LEAVES,
  NEON,
  SAND,
  STONE,
  WATER_LEVEL,
  WOOD,
  WORLD_SX,
  WORLD_SY,
  WORLD_SZ,
} from "./constants";
import type { BlockEdit } from "./types";

const CHUNK_LEN = CHUNK_S * WORLD_SY * CHUNK_S;

export function chunkOf(x: number, z: number): { cx: number; cz: number } {
  return { cx: Math.floor(x / CHUNK_S), cz: Math.floor(z / CHUNK_S) };
}

export function chunkKey(cx: number, cz: number): string {
  return `${cx},${cz}`;
}

export function localIdx(lx: number, y: number, lz: number): number {
  return lx + y * CHUNK_S + lz * CHUNK_S * WORLD_SY;
}

export function inBounds(x: number, y: number, z: number): boolean {
  void x;
  void z;
  return y >= 0 && y < WORLD_SY;
}

export function onIsland(x: number, z: number): boolean {
  return x >= 0 && x < WORLD_SX && z >= 0 && z < WORLD_SZ;
}

export function hash2(x: number, z: number, seed: number): number {
  let n = Math.imul(x + seed * 13, 374761393) ^ Math.imul(z + seed * 7, 668265263);
  n = Math.imul(n ^ (n >>> 13), 1274126177);
  return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
}

function smooth(t: number): number {
  return t * t * (3 - 2 * t);
}

function valueNoise(x: number, z: number, seed: number): number {
  const x0 = Math.floor(x);
  const z0 = Math.floor(z);
  const fx = smooth(x - x0);
  const fz = smooth(z - z0);
  const a = hash2(x0, z0, seed);
  const b = hash2(x0 + 1, z0, seed);
  const c = hash2(x0, z0 + 1, seed);
  const d = hash2(x0 + 1, z0 + 1, seed);
  return a + (b - a) * fx + (c - a) * fz + (a - b - c + d) * fx * fz;
}

function radial(x: number, z: number, seed: number): number {
  const cx = (WORLD_SX - 1) * 0.5;
  const cz = (WORLD_SZ - 1) * 0.5;
  const nx = (x - cx) / (WORLD_SX * 0.5);
  const nz = (z - cz) / (WORLD_SZ * 0.5);
  const wobble = (valueNoise(x * 0.13, z * 0.13, seed ^ 99) - 0.5) * 0.12;
  const r = Math.hypot(nx, nz) + wobble;
  if (r <= ISLAND_CORE) return 1;
  if (r >= ISLAND_SHORE) return 0;
  return smooth(1 - (r - ISLAND_CORE) / (ISLAND_SHORE - ISLAND_CORE));
}

/**
 * Highest solid block Y at (x,z). Island uses the radial falloff; past the
 * shore the seafloor keeps going, with rare distant islets.
 */
export function heightAt(x: number, z: number, seed: number): number {
  const n = valueNoise(x * 0.07, z * 0.07, seed);
  const n2 = valueNoise(x * 0.18 + 40, z * 0.18, seed ^ 7919);
  if (onIsland(x, z)) {
    const hills = 3.2 + (n - 0.42) * 4.8 + (n2 - 0.5) * 1.5;
    const fall = radial(x, z, seed);
    const h = WATER_LEVEL + hills * fall - (1 - fall) * 5;
    return Math.max(0, Math.min(WORLD_SY - 4, Math.floor(h)));
  }
  const cx = (WORLD_SX - 1) * 0.5;
  const cz = (WORLD_SZ - 1) * 0.5;
  const dist = Math.hypot(x - cx, z - cz);
  const floor = 1 + (n - 0.5) * 1.4;
  let h = Math.max(1, Math.min(WATER_LEVEL - 2, Math.floor(floor)));
  if (dist > 56 && hash2(Math.floor(x / 9), Math.floor(z / 9), seed ^ 44) > 0.986) {
    const peak = WATER_LEVEL + 1 + Math.floor(n * 3);
    h = Math.max(h, Math.min(WORLD_SY - 4, peak));
  }
  return h;
}

function inChamber(x: number, z: number): boolean {
  return Math.abs(x - CHEST_X) <= 2 && Math.abs(z - CHEST_Z) <= 2;
}

export function hatSpot(seed: number): { x: number; y: number; z: number } {
  const x = CHEST_X + 1;
  const z = CHEST_Z + 1;
  return { x: x + 0.5, y: heightAt(x, z, seed) + 1, z: z + 0.5 };
}

function editKey(x: number, y: number, z: number): string {
  return `${x},${y},${z}`;
}

export class VoxelWorld {
  readonly seed: number;
  private readonly chunks = new Map<string, Uint8Array>();
  private readonly edits = new Map<string, number>();

  constructor(seed: number, edits: BlockEdit[] = []) {
    this.seed = seed;
    for (const e of edits) this.edits.set(editKey(e.x, e.y, e.z), e.block);
  }

  ensureChunk(cx: number, cz: number): Uint8Array {
    const key = chunkKey(cx, cz);
    let data = this.chunks.get(key);
    if (data) return data;
    data = new Uint8Array(CHUNK_LEN);
    this.generateChunk(cx, cz, data);
    const x0 = cx * CHUNK_S;
    const z0 = cz * CHUNK_S;
    for (const [k, block] of this.edits) {
      const [xs, ys, zs] = k.split(",");
      const x = Number(xs);
      const y = Number(ys);
      const z = Number(zs);
      if (x < x0 || x >= x0 + CHUNK_S || z < z0 || z >= z0 + CHUNK_S) continue;
      if (y < 0 || y >= WORLD_SY) continue;
      data[localIdx(x - x0, y, z - z0)] = block;
    }
    this.chunks.set(key, data);
    return data;
  }

  evictFar(pcx: number, pcz: number, keep: number) {
    for (const key of this.chunks.keys()) {
      const comma = key.indexOf(",");
      const cx = Number(key.slice(0, comma));
      const cz = Number(key.slice(comma + 1));
      if (Math.abs(cx - pcx) > keep || Math.abs(cz - pcz) > keep) this.chunks.delete(key);
    }
  }

  private generateChunk(cx: number, cz: number, data: Uint8Array) {
    const x0 = cx * CHUNK_S;
    const z0 = cz * CHUNK_S;
    for (let lz = 0; lz < CHUNK_S; lz++) {
      for (let lx = 0; lx < CHUNK_S; lx++) {
        const x = x0 + lx;
        const z = z0 + lz;
        const h = heightAt(x, z, this.seed);
        const beach = h <= WATER_LEVEL + 1;
        const chamber = inChamber(x, z);
        for (let y = 0; y <= h; y++) {
          let b = STONE;
          if (y === 0) b = STONE;
          else if (y === h) b = beach ? SAND : GRASS;
          else if (y >= h - 2) b = beach ? SAND : DIRT;
          if (chamber && y >= 1 && y <= 2) {
            const wall = Math.abs(x - CHEST_X) === 2 || Math.abs(z - CHEST_Z) === 2;
            b = wall ? STONE : AIR;
          }
          data[localIdx(lx, y, lz)] = b;
        }
        if (x === CHEST_X && z === CHEST_Z) data[localIdx(lx, CHEST_Y, lz)] = CHEST;
        // Test neon accent near spawn for Voxel Minimalist look.
        const midX = Math.floor(WORLD_SX / 2);
        const midZ = Math.floor(WORLD_SZ / 2);
        if (x === midX + 2 && z === midZ && h + 1 < WORLD_SY) {
          data[localIdx(lx, h + 1, lz)] = NEON;
        }
        if (
          onIsland(x, z) &&
          !beach &&
          !chamber &&
          h > WATER_LEVEL + 1 &&
          h + 2 < WORLD_SY &&
          hash2(x, z, this.seed ^ 11) > 0.988
        ) {
          data[localIdx(lx, h + 1, lz)] = WOOD;
          data[localIdx(lx, h + 2, lz)] = LEAVES;
          const crown: [number, number][] = [
            [1, 0],
            [-1, 0],
            [0, 1],
            [0, -1],
          ];
          for (const [dx, dz] of crown) {
            const nx = x + dx;
            const nz = z + dz;
            if (Math.floor(nx / CHUNK_S) !== cx || Math.floor(nz / CHUNK_S) !== cz) continue;
            const i = localIdx(nx - x0, h + 2, nz - z0);
            if (data[i] === AIR) data[i] = LEAVES;
          }
        }
      }
    }
  }

  get(x: number, y: number, z: number): number {
    if (!inBounds(x, y, z)) return AIR;
    const { cx, cz } = chunkOf(x, z);
    const data = this.ensureChunk(cx, cz);
    const lx = x - cx * CHUNK_S;
    const lz = z - cz * CHUNK_S;
    return data[localIdx(lx, y, lz)] ?? AIR;
  }

  set(x: number, y: number, z: number, block: number): boolean {
    if (!inBounds(x, y, z)) return false;
    if (y === 0 && block === AIR) return false;
    const { cx, cz } = chunkOf(x, z);
    const data = this.ensureChunk(cx, cz);
    const lx = x - cx * CHUNK_S;
    const lz = z - cz * CHUNK_S;
    data[localIdx(lx, y, lz)] = block;
    this.edits.set(editKey(x, y, z), block);
    return true;
  }

  isSolid(x: number, y: number, z: number): boolean {
    return this.get(x, y, z) !== AIR;
  }

  resetTo(edits: BlockEdit[] = []) {
    this.chunks.clear();
    this.edits.clear();
    for (const e of edits) this.edits.set(editKey(e.x, e.y, e.z), e.block);
  }

  hideChest() {
    this.set(CHEST_X, CHEST_Y, CHEST_Z, AIR);
  }

  /** Diff vs procedural landscape — only voxels touched by players. */
  listEdits(): BlockEdit[] {
    const out: BlockEdit[] = [];
    for (const [k, block] of this.edits) {
      const [xs, ys, zs] = k.split(",");
      out.push({ x: Number(xs), y: Number(ys), z: Number(zs), block });
    }
    return out;
  }

  spawn(): { x: number; y: number; z: number } {
    const x = Math.floor(WORLD_SX / 2);
    const z = Math.floor(WORLD_SZ / 2);
    let y = heightAt(x, z, this.seed) + 1;
    while (y < WORLD_SY - 2 && this.get(x, y, z) !== AIR) y += 1;
    return { x: x + 0.5, y, z: z + 0.5 };
  }
}
