import {
  AIR,
  DIRT,
  GRASS,
  ISLAND_CORE,
  ISLAND_SHORE,
  LEAVES,
  SAND,
  STONE,
  WATER_LEVEL,
  WOOD,
  WORLD_SX,
  WORLD_SY,
  WORLD_SZ,
} from "./constants";
import type { BlockEdit } from "./types";

export function idx(x: number, y: number, z: number): number {
  return x + y * WORLD_SX + z * WORLD_SX * WORLD_SY;
}

export function inBounds(x: number, y: number, z: number): boolean {
  return x >= 0 && y >= 0 && z >= 0 && x < WORLD_SX && y < WORLD_SY && z < WORLD_SZ;
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
 * Highest solid block Y at (x,z). Falloff drives the coast under WATER_LEVEL
 * so the shore is a beach, not a cliff (TZ §3.4).
 */
export function heightAt(x: number, z: number, seed: number): number {
  const n = valueNoise(x * 0.07, z * 0.07, seed);
  const n2 = valueNoise(x * 0.18 + 40, z * 0.18, seed ^ 7919);
  // Center of the island sits a few blocks above water on typical seeds;
  // falloff still pulls the rim under WATER_LEVEL for a beach, not a cliff.
  const hills = 3.2 + (n - 0.42) * 4.8 + (n2 - 0.5) * 1.5;
  const fall = radial(x, z, seed);
  const h = WATER_LEVEL + hills * fall - (1 - fall) * 5;
  return Math.max(0, Math.min(WORLD_SY - 4, Math.floor(h)));
}

export class VoxelWorld {
  readonly blocks: Uint8Array;
  readonly seed: number;

  constructor(seed: number, edits: BlockEdit[] = []) {
    this.seed = seed;
    this.blocks = new Uint8Array(WORLD_SX * WORLD_SY * WORLD_SZ);
    this.generate();
    for (const e of edits) this.set(e.x, e.y, e.z, e.block);
  }

  private generate() {
    for (let z = 0; z < WORLD_SZ; z++) {
      for (let x = 0; x < WORLD_SX; x++) {
        const h = heightAt(x, z, this.seed);
        const beach = h <= WATER_LEVEL + 1;
        for (let y = 0; y <= h; y++) {
          let b = STONE;
          if (y === 0) b = STONE;
          else if (y === h) b = beach ? SAND : GRASS;
          else if (y >= h - 2) b = beach ? SAND : DIRT;
          this.blocks[idx(x, y, z)] = b;
        }
        if (
          !beach &&
          h > WATER_LEVEL + 1 &&
          h + 2 < WORLD_SY &&
          hash2(x, z, this.seed ^ 11) > 0.988
        ) {
          this.blocks[idx(x, h + 1, z)] = WOOD;
          this.blocks[idx(x, h + 2, z)] = LEAVES;
          const crown: [number, number][] = [
            [1, 0],
            [-1, 0],
            [0, 1],
            [0, -1],
          ];
          for (const [dx, dz] of crown) {
            const lx = x + dx;
            const lz = z + dz;
            if (!inBounds(lx, h + 2, lz)) continue;
            if (this.blocks[idx(lx, h + 2, lz)] === AIR) this.blocks[idx(lx, h + 2, lz)] = LEAVES;
          }
        }
      }
    }
  }

  get(x: number, y: number, z: number): number {
    if (!inBounds(x, y, z)) return AIR;
    return this.blocks[idx(x, y, z)];
  }

  set(x: number, y: number, z: number, block: number): boolean {
    if (!inBounds(x, y, z)) return false;
    if (y === 0 && block === AIR) return false;
    this.blocks[idx(x, y, z)] = block;
    return true;
  }

  isSolid(x: number, y: number, z: number): boolean {
    return this.get(x, y, z) !== AIR;
  }

  resetTo(edits: BlockEdit[] = []) {
    this.blocks.fill(0);
    this.generate();
    for (const e of edits) this.set(e.x, e.y, e.z, e.block);
  }

  spawn(): { x: number; y: number; z: number } {
    const x = Math.floor(WORLD_SX / 2);
    const z = Math.floor(WORLD_SZ / 2);
    let y = heightAt(x, z, this.seed) + 1;
    while (y < WORLD_SY - 2 && this.get(x, y, z) !== AIR) y += 1;
    return { x: x + 0.5, y, z: z + 0.5 };
  }
}
