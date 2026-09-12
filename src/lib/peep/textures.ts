import * as THREE from "three";
import { CHEST, DIRT, GOLD, GRASS, LEAVES, SAND, STONE, WOOD } from "./constants";

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
  [CHEST]: hex(0xb8732a),
  [GOLD]: hex(0xf0c85a),
};

/** Grass sides start as soil; the shader paints a green band at the top. */
const SIDE: Record<number, RGB> = {
  [GRASS]: hex(0x7a4e30),
  [DIRT]: hex(0x8d5c36),
  [STONE]: hex(0x6a6e72),
  [WOOD]: hex(0x8f5a30),
  [SAND]: hex(0xe0c086),
  [LEAVES]: hex(0x38a83c),
  [CHEST]: hex(0x8a5a24),
  [GOLD]: hex(0xd4a43a),
};

const BOTTOM: Record<number, RGB> = {
  [GRASS]: hex(0x6e4324),
  [DIRT]: hex(0x7d522e),
  [STONE]: hex(0x585c60),
  [WOOD]: hex(0xc49254),
  [SAND]: hex(0xd4b478),
  [LEAVES]: hex(0x2f8f34),
  [CHEST]: hex(0x6a4018),
  [GOLD]: hex(0xb8862a),
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
 * Soft base color for a block face. Pixel grain is a nearest 16×16 atlas.
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

function pixHash(x: number, y: number, salt: number): number {
  return hash3(x, y, salt, salt * 13 + 7);
}

function pixelMod(kind: number, x: number, y: number, frame = 0): number {
  const a = pixHash(x, y, kind);
  const b = pixHash(x * 3 + 1, y * 2, kind + 4);
  if (kind === GRASS) {
    const clump = pixHash(Math.floor(x / 3), Math.floor(y / 3), 21);
    return 0.78 + a * 0.22 + (clump > 0.55 ? 0.1 : -0.08) + (b > 0.85 ? 0.12 : 0);
  }
  if (kind === DIRT) return 0.7 + a * 0.38 + (b > 0.8 ? -0.16 : 0);
  if (kind === STONE) return 0.82 + a * 0.22 + (b > 0.9 ? -0.28 : 0) + (b < 0.08 ? 0.1 : 0);
  if (kind === WOOD) {
    const stripe = ((x + Math.floor(a * 2)) % 4 === 0 ? -0.18 : 0.06) + (y % 8 === 0 ? -0.08 : 0);
    return 0.78 + a * 0.16 + stripe;
  }
  if (kind === SAND) return 0.76 + a * 0.32 + (b > 0.88 ? 0.12 : 0);
  if (kind === LEAVES) {
    const ox = (x + frame * 5) & 15;
    const oy = (y + frame * 3) & 15;
    const rustle = pixHash(ox, oy, kind + frame * 9);
    const clump = pixHash(Math.floor(ox / 4), Math.floor(oy / 4), 31 + frame);
    return 0.58 + rustle * 0.46 + (clump > 0.5 ? 0.16 : -0.12);
  }
  if (kind === CHEST) {
    const band = y > 6 && y < 10 ? 0.22 : 0;
    const frameEdge = x < 2 || x > 13 || y < 2 || y > 13 ? -0.18 : 0;
    return 0.72 + a * 0.18 + band + frameEdge;
  }
  if (kind === GOLD) return 0.88 + a * 0.22 + (b > 0.82 ? 0.14 : 0);
  return b > 0.72 ? 0.45 : 0.78 + a * 0.28;
}

/**
 * 8×3 nearest atlas. Row 0 is stills; rows 1–2 are leaf rustle frames.
 * 128 ≈ multiply 1.0.
 */
export function createBlockAtlas(): THREE.DataTexture {
  const tw = 16;
  const types = 8;
  const frames = 3;
  const w = tw * types;
  const h = tw * frames;
  const data = new Uint8Array(w * h * 4);
  const kinds = [GRASS, DIRT, STONE, WOOD, SAND, LEAVES, CHEST, GOLD];
  for (let row = 0; row < frames; row++) {
    for (let t = 0; t < types; t++) {
      const kind = kinds[t]!;
      const frame = kind === LEAVES ? row : 0;
      for (let y = 0; y < tw; y++) {
        for (let x = 0; x < tw; x++) {
          const m = Math.min(1.35, Math.max(0.4, pixelMod(kind, x, y, frame)));
          const v = Math.round(Math.min(255, Math.max(0, m * 128)));
          const i = ((row * tw + y) * w + t * tw + x) * 4;
          data[i] = v;
          data[i + 1] = v;
          data[i + 2] = v;
          data[i + 3] = 255;
        }
      }
    }
  }
  const tex = new THREE.DataTexture(data, w, h, THREE.RGBAFormat);
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;
  tex.colorSpace = THREE.NoColorSpace;
  return tex;
}

/** Sample the 16px atlas onto world-space faces; grass sides use the dirt tile. */
export const BLOCK_TEXEL_GLSL = /* glsl */ `
float kind = floor(vKind + 0.1);
float grass = step(0.5, kind) * (1.0 - step(1.5, kind));
float leaf = step(5.5, kind) * (1.0 - step(6.5, kind));
vec3 pn = abs(normalize(vPeepN));
vec2 faceUV = mix(mix(vPeepW.xy, vPeepW.zy, step(pn.z, pn.x)), vPeepW.xz, step(max(pn.x, pn.z), pn.y));
vec2 uv = fract(faceUV);
float side = 1.0 - smoothstep(0.55, 0.95, abs(vPeepN.y));
float bot = smoothstep(0.55, 0.95, -vPeepN.y);
float tile = clamp(kind - 1.0, 0.0, 7.0);
tile = mix(tile, 1.0, grass * max(side, bot));
float frame = leaf * mod(floor(uTime * 2.0), 3.0);
vec2 aUv = vec2(
  (tile + (uv.x * 15.0 + 0.5) / 16.0) / 8.0,
  (frame + (uv.y * 15.0 + 0.5) / 16.0) / 3.0
);
float m = texture2D(uAtlas, aUv).r * 2.0;
diffuseColor.rgb *= m;
float lip = grass * side * step(0.8, uv.y);
diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.31, 0.62, 0.24) * m, lip);
`;

/** Extra texel contrast in shade; sunlight keeps the atlas readable. */
export const BLOCK_SHADE_GRAIN_GLSL = /* glsl */ `
{
  float lum = dot(outgoingLight, vec3(0.2126, 0.7152, 0.0722));
  float shade = 1.0 - smoothstep(0.08, 0.7, lum);
  float mid = smoothstep(0.14, 0.4, lum) * (1.0 - smoothstep(0.4, 0.68, lum));
  float amt = shade * shade * 0.18 + mid * 0.07;
  vec3 pn = abs(normalize(vPeepN));
  vec2 faceUV = mix(mix(vPeepW.xy, vPeepW.zy, step(pn.z, pn.x)), vPeepW.xz, step(max(pn.x, pn.z), pn.y));
  vec2 texel = floor(fract(faceUV) * 16.0);
  vec3 p3 = fract(vec3(texel.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  float g = floor(fract((p3.x + p3.y) * p3.z) * 5.0) / 4.0;
  outgoingLight *= 1.0 + (g - 0.5) * amt;
}
`;

