import * as THREE from "three";
import { CHEST, DIRT, GOLD, GRASS, LEAVES, NEON, SAND, STONE, WOOD } from "./constants";

type RGB = [number, number, number];

function hex(n: number): RGB {
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

/** Matte white island volumes — slight top/side/bottom bias for Lambert. */
const WHITE_TOP = hex(0xf5f6f8);
const WHITE_SIDE = hex(0xe8eaee);
const WHITE_BOT = hex(0xd8dbe2);

const TOP: Record<number, RGB> = {
  [GRASS]: WHITE_TOP,
  [DIRT]: hex(0xeff1f4),
  [STONE]: hex(0xe4e6eb),
  [WOOD]: WHITE_TOP,
  [SAND]: hex(0xf2f3f6),
  [LEAVES]: hex(0xeef0f4),
  [CHEST]: hex(0xd0d3da),
  [GOLD]: hex(0xfff8e0),
  [NEON]: hex(0x00f0ff),
};

const SIDE: Record<number, RGB> = {
  [GRASS]: WHITE_SIDE,
  [DIRT]: hex(0xe2e4e9),
  [STONE]: hex(0xd5d8df),
  [WOOD]: WHITE_SIDE,
  [SAND]: hex(0xe6e8ed),
  [LEAVES]: hex(0xdde0e7),
  [CHEST]: hex(0xb8bcc6),
  [GOLD]: hex(0xf0d89a),
  [NEON]: hex(0xff2bd6),
};

const BOTTOM: Record<number, RGB> = {
  [GRASS]: WHITE_BOT,
  [DIRT]: hex(0xced1d8),
  [STONE]: hex(0xc4c7cf),
  [WOOD]: WHITE_BOT,
  [SAND]: hex(0xd2d5dc),
  [LEAVES]: hex(0xc8ccd5),
  [CHEST]: hex(0x9aa0ac),
  [GOLD]: hex(0xd4b060),
  [NEON]: hex(0x9b00ff),
};

function hash3(x: number, y: number, z: number, salt: number): number {
  let n = Math.imul(x + 1, 1597334677) ^ Math.imul(y + 3, 3812015801) ^ Math.imul(z + 7, salt);
  n = Math.imul(n ^ (n >>> 16), 2246822519);
  return ((n ^ (n >>> 13)) >>> 0) / 4294967296;
}

/** Soft grain — keep low so white cubes stay clean on mobile. */
export function vertexGrain(x: number, y: number, z: number, block: number): number {
  if (block === NEON) return 1;
  return 0.97 + hash3(Math.floor(x), Math.floor(y), Math.floor(z), block + 11) * 0.04;
}

/**
 * Soft base color for a block face.
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
  if (block === NEON) {
    return [base[0], base[1], base[2]];
  }
  const n = hash3(x, y, z, block * 17 + 3);
  const k = 0.985 + n * 0.02;
  const slope = ny === 0 ? 0.92 + (nx === 0 ? 0.02 : 0) : 1;
  return [base[0] * k * slope, base[1] * k * slope, base[2] * k * slope];
}

function pixHash(x: number, y: number, salt: number): number {
  return hash3(x, y, salt, salt * 13 + 7);
}

function pixelMod(kind: number, x: number, y: number, _frame = 0): number {
  const a = pixHash(x, y, kind);
  if (kind === NEON) {
    const edge = x < 2 || x > 13 || y < 2 || y > 13;
    return edge ? 1.35 : 0.55;
  }
  return 0.96 + a * 0.06;
}

/**
 * Compact nearest atlas (8×3). Neon skips atlas in shader.
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
      for (let y = 0; y < tw; y++) {
        for (let x = 0; x < tw; x++) {
          const m = Math.min(1.2, Math.max(0.5, pixelMod(kind, x, y, row)));
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

/** 9×1 nearest atlas for кузница voxels: 8 world grains + a generic paint tile. */
export const ITEM_ATLAS_COLS = 9;
export const ITEM_ATLAS_TILE = 16;

let itemAtlas: THREE.DataTexture | null = null;

export function getItemAtlas(): THREE.DataTexture {
  if (!itemAtlas) itemAtlas = createItemAtlas();
  return itemAtlas;
}

function createItemAtlas(): THREE.DataTexture {
  const tw = ITEM_ATLAS_TILE;
  const types = ITEM_ATLAS_COLS;
  const w = tw * types;
  const h = tw;
  const data = new Uint8Array(w * h * 4);
  const kinds = [GRASS, DIRT, STONE, WOOD, SAND, LEAVES, CHEST, GOLD, 99];
  for (let t = 0; t < types; t++) {
    const kind = kinds[t]!;
    for (let y = 0; y < tw; y++) {
      for (let x = 0; x < tw; x++) {
        const m = Math.min(1.28, Math.max(0.38, pixelMod(kind, x, y, 0)));
        const v = Math.round(Math.min(255, Math.max(0, m * 255)));
        const i = (y * w + t * tw + x) * 4;
        data[i] = v;
        data[i + 1] = v;
        data[i + 2] = v;
        data[i + 3] = 255;
      }
    }
  }
  const tex = new THREE.DataTexture(data, w, h, THREE.RGBAFormat);
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;
  tex.colorSpace = THREE.NoColorSpace;
  tex.name = "peep-item-atlas";
  return tex;
}

export function mapItemCubeUVs(geo: THREE.BufferGeometry, col: number) {
  const uv = geo.getAttribute("uv");
  if (!uv) return;
  const inset = 0.5 / ITEM_ATLAS_TILE;
  const u0 = (col + inset) / ITEM_ATLAS_COLS;
  const u1 = (col + 1 - inset) / ITEM_ATLAS_COLS;
  const v0 = inset;
  const v1 = 1 - inset;
  for (let i = 0; i < uv.count; i++) {
    const x = uv.getX(i);
    const y = uv.getY(i);
    uv.setXY(i, u0 + x * (u1 - u0), v0 + y * (v1 - v0));
  }
  uv.needsUpdate = true;
}

/**
 * Mobile-cheap fragment: soft atlas multiply for white blocks,
 * neon face rim glow without BloomPass / EffectComposer.
 */
export const BLOCK_TEXEL_GLSL = /* glsl */ `
float kind = floor(vKind + 0.1);
float neon = step(9.5, kind) * (1.0 - step(10.5, kind));
vec3 pn = abs(normalize(vPeepN));
vec2 faceUV = mix(mix(vPeepW.xy, vPeepW.zy, step(pn.z, pn.x)), vPeepW.xz, step(max(pn.x, pn.z), pn.y));
vec2 uv = fract(faceUV);
if (neon > 0.5) {
  float edge = max(abs(uv.x - 0.5), abs(uv.y - 0.5));
  float rim = smoothstep(0.28, 0.48, edge);
  vec3 neonCore = diffuseColor.rgb * 0.28;
  vec3 neonRim = diffuseColor.rgb * 2.4 + vec3(0.15, 0.35, 0.55) * rim;
  diffuseColor.rgb = mix(neonCore, neonRim, rim);
  diffuseColor.rgb += neonRim * 0.35 * rim;
} else {
  float tile = clamp(kind - 1.0, 0.0, 7.0);
  vec2 aUv = vec2(
    (tile + (uv.x * 15.0 + 0.5) / 16.0) / 8.0,
    ((uv.y * 15.0 + 0.5) / 16.0) / 3.0
  );
  float m = texture2D(uAtlas, aUv).r * 2.0;
  diffuseColor.rgb *= mix(1.0, m, 0.22);
}
`;

/** Tiny shade micro-contrast only — keep mobile GPU light. */
export const BLOCK_SHADE_GRAIN_GLSL = /* glsl */ `
{
  float kind = floor(vKind + 0.1);
  float neon = step(9.5, kind) * (1.0 - step(10.5, kind));
  if (neon > 0.5) {
    outgoingLight += diffuseColor.rgb * 0.55;
  } else {
    float lum = dot(outgoingLight, vec3(0.2126, 0.7152, 0.0722));
    float shade = 1.0 - smoothstep(0.1, 0.65, lum);
    outgoingLight *= 1.0 - shade * 0.08;
  }
}
`;
