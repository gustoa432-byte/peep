import { DIRT, GRASS, LEAVES, SAND, STONE, WOOD } from "./constants";

type RGB = [number, number, number];

function hex(n: number): RGB {
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

/** Saturated sod on top — not a flat fill, shader adds blotches. */
const TOP: Record<number, RGB> = {
  [GRASS]: hex(0x4fbe45),
  [DIRT]: hex(0x8d5c36),
  [STONE]: hex(0x7d8286),
  [WOOD]: hex(0xd2a05c),
  [SAND]: hex(0xedcf96),
  [LEAVES]: hex(0x4ec94c),
};

/** Grass sides start as soil; the shader paints a green band at the top. */
const SIDE: Record<number, RGB> = {
  [GRASS]: hex(0x7a4e30),
  [DIRT]: hex(0x8d5c36),
  [STONE]: hex(0x6a6e72),
  [WOOD]: hex(0x8f5a30),
  [SAND]: hex(0xe0c086),
  [LEAVES]: hex(0x38a83c),
};

const BOTTOM: Record<number, RGB> = {
  [GRASS]: hex(0x6e4324),
  [DIRT]: hex(0x7d522e),
  [STONE]: hex(0x585c60),
  [WOOD]: hex(0xc49254),
  [SAND]: hex(0xd4b478),
  [LEAVES]: hex(0x2f8f34),
};

function hash3(x: number, y: number, z: number, salt: number): number {
  let n = Math.imul(x + 1, 1597334677) ^ Math.imul(y + 3, 3812015801) ^ Math.imul(z + 7, salt);
  n = Math.imul(n ^ (n >>> 16), 2246822519);
  return ((n ^ (n >>> 13)) >>> 0) / 4294967296;
}

/** 0.86–1.14 mottling so greedy quads aren't a flat fill. */
export function vertexGrain(x: number, y: number, z: number, block: number): number {
  return 0.94 + hash3(Math.floor(x), Math.floor(y), Math.floor(z), block + 11) * 0.1;
}

/**
 * Soft base color for a block face. Pixel atlases are the Minecraft idiom
 * GDD §13 forbids; variation here is a slow gradient plus a per-block tint.
 */
export function faceTint(
  block: number,
  nx: number,
  ny: number,
  nz: number,
  x: number,
  y: number,
  z: number,
): RGB {
  void nz;
  const table = ny > 0 ? TOP : ny < 0 ? BOTTOM : SIDE;
  const base = table[block] ?? SIDE[STONE]!;
  const n = hash3(x, y, z, block * 17 + 3);
  const k = 0.97 + n * 0.04;
  const slope = ny === 0 ? 0.9 + (nx === 0 ? 0.03 : 0) : 1;
  return [base[0] * k * slope, base[1] * k * slope, base[2] * k * slope];
}
