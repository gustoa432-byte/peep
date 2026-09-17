import * as THREE from "three";
import { CHEST, DIRT, DYNAMITE, GOLD, GRASS, LEAVES, NEON, SAND, STONE, WOOD } from "./constants";

type RGB = [number, number, number];

function hex(n: number): RGB {
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

function rgbBytes(n: number): [number, number, number] {
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** Face base colors for the soft 8×8 atlas (top / side / bottom). */
const DIRT_LIGHT = 0x9b7653;
const DIRT_MID = 0x8e6540;

const TOP_HEX: Record<number, number> = {
  [GRASS]: 0x60b347,
  [DIRT]: DIRT_LIGHT,
  [STONE]: 0x8b8f96,
  [WOOD]: 0xa05a2c,
  [SAND]: 0xf0d060,
  [LEAVES]: 0x5fd64a,
  [CHEST]: 0xc47828,
  [GOLD]: 0xffd24a,
};

const SIDE_HEX: Record<number, number> = {
  [GRASS]: DIRT_LIGHT,
  [DIRT]: DIRT_LIGHT,
  [STONE]: 0x757980,
  [WOOD]: 0x8a4a24,
  [SAND]: 0xe0c050,
  [LEAVES]: 0x48c238,
  [CHEST]: 0xa86220,
  [GOLD]: 0xe0b030,
};

const BOTTOM_HEX: Record<number, number> = {
  [GRASS]: DIRT_MID,
  [DIRT]: DIRT_MID,
  [STONE]: 0x5c6068,
  [WOOD]: 0xb86a38,
  [SAND]: 0xd4b048,
  [LEAVES]: 0x3a9a30,
  [CHEST]: 0x8a4a18,
  [GOLD]: 0xc99820,
};

/** Kept for mesh AO path / hotbar-compatible face tint lookups. */
const TOP: Record<number, RGB> = {
  [GRASS]: hex(TOP_HEX[GRASS]!),
  [DIRT]: hex(TOP_HEX[DIRT]!),
  [STONE]: hex(TOP_HEX[STONE]!),
  [WOOD]: hex(TOP_HEX[WOOD]!),
  [SAND]: hex(TOP_HEX[SAND]!),
  [LEAVES]: hex(TOP_HEX[LEAVES]!),
  [CHEST]: hex(TOP_HEX[CHEST]!),
  [GOLD]: hex(TOP_HEX[GOLD]!),
  [NEON]: hex(0x00f0ff),
  [DYNAMITE]: hex(0xe8b86a),
};

const SIDE: Record<number, RGB> = {
  [GRASS]: hex(SIDE_HEX[GRASS]!),
  [DIRT]: hex(SIDE_HEX[DIRT]!),
  [STONE]: hex(SIDE_HEX[STONE]!),
  [WOOD]: hex(SIDE_HEX[WOOD]!),
  [SAND]: hex(SIDE_HEX[SAND]!),
  [LEAVES]: hex(SIDE_HEX[LEAVES]!),
  [CHEST]: hex(SIDE_HEX[CHEST]!),
  [GOLD]: hex(SIDE_HEX[GOLD]!),
  [NEON]: hex(0xff2bd6),
  [DYNAMITE]: hex(0xff3b2f),
};

const BOTTOM: Record<number, RGB> = {
  [GRASS]: hex(BOTTOM_HEX[GRASS]!),
  [DIRT]: hex(BOTTOM_HEX[DIRT]!),
  [STONE]: hex(BOTTOM_HEX[STONE]!),
  [WOOD]: hex(BOTTOM_HEX[WOOD]!),
  [SAND]: hex(BOTTOM_HEX[SAND]!),
  [LEAVES]: hex(BOTTOM_HEX[LEAVES]!),
  [CHEST]: hex(BOTTOM_HEX[CHEST]!),
  [GOLD]: hex(BOTTOM_HEX[GOLD]!),
  [NEON]: hex(0x9b00ff),
  [DYNAMITE]: hex(0xb02820),
};

function hash3(x: number, y: number, z: number, salt: number): number {
  let n = Math.imul(x + 1, 1597334677) ^ Math.imul(y + 3, 3812015801) ^ Math.imul(z + 7, salt);
  n = Math.imul(n ^ (n >>> 16), 2246822519);
  return ((n ^ (n >>> 13)) >>> 0) / 4294967296;
}

/** Soft grain for AO — neon stays flat. */
export function vertexGrain(x: number, y: number, z: number, block: number): number {
  if (block === NEON) return 1;
  return 0.96 + hash3(Math.floor(x), Math.floor(y), Math.floor(z), block + 11) * 0.05;
}

/**
 * Vertex colors are AO only — diffuse color comes from the 8×8 atlas.
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
  void x;
  void y;
  void z;
  if (block === NEON || block === DYNAMITE) {
    const table = ny > 0 ? TOP : ny < 0 ? BOTTOM : SIDE;
    return table[block] ?? SIDE[STONE]!;
  }
  return [1, 1, 1];
}

function pixHash(x: number, y: number, salt: number): number {
  return hash3(x, y, salt, salt * 13 + 7);
}

export const BLOCK_ATLAS_TILE = 8;
export const BLOCK_ATLAS_PIXEL = 8;
/** cols 0–3 grass variants, 4–7 dirt variants, 8–13 other kinds. */
export const BLOCK_ATLAS_COLS = 14;
/** 3 faces × 3 anim frames (leaves/gold). Static kinds only use frame 0. */
export const BLOCK_ATLAS_FACE_ROWS = 3;
export const BLOCK_ATLAS_FRAMES = 3;
export const BLOCK_ATLAS_ROWS = BLOCK_ATLAS_FACE_ROWS * BLOCK_ATLAS_FRAMES;
export const BLOCK_ATLAS_VARIANTS = 4;

const SOLID_KINDS = [STONE, WOOD, SAND, LEAVES, CHEST, GOLD] as const;

function logicalTexel(
  kind: number,
  face: "top" | "side" | "bottom",
  lx: number,
  ly: number,
  variant: number,
  frame: number,
): [number, number, number, number] {
  const tile = BLOCK_ATLAS_TILE;
  const baseHex =
    face === "top" ? TOP_HEX[kind]! : face === "bottom" ? BOTTOM_HEX[kind]! : SIDE_HEX[kind]!;
  let [r, g, b] = rgbBytes(baseHex);
  let a = 255;
  const grassLip = rgbBytes(TOP_HEX[GRASS]!);

  const n = pixHash(lx, ly, kind * 19 + variant * 47 + frame * 13);
  const shade = 0.94 + n * 0.12;
  r = Math.round(Math.min(255, Math.max(0, r * shade)));
  g = Math.round(Math.min(255, Math.max(0, g * shade)));
  b = Math.round(Math.min(255, Math.max(0, b * shade)));

  if (pixHash(lx, ly, kind + 101 + variant + frame * 3) > 0.94) {
    r = Math.round(r * 0.96);
    g = Math.round(g * 0.96);
    b = Math.round(b * 0.96);
  } else if (pixHash(lx, ly, kind + 202 + variant + frame * 5) > 0.96) {
    r = Math.min(255, Math.round(r * 1.04));
    g = Math.min(255, Math.round(g * 1.04));
    b = Math.min(255, Math.round(b * 1.04));
  }

  if (kind === GRASS && face === "side") {
    // Notch jagged: per-column drip depth 2–4, contiguous — never salt-pepper in rows 3–4.
    const fromTop = tile - 1 - ly;
    const drip = 2 + Math.floor(pixHash(lx, variant, 77) * 3);
    if (fromTop < drip) {
      const lipN = 0.97 + pixHash(lx, 0, 91 + variant) * 0.05;
      r = Math.round(grassLip[0] * lipN);
      g = Math.round(grassLip[1] * lipN);
      b = Math.round(grassLip[2] * lipN);
    }
  }

  if (kind === WOOD && lx === 2) {
    r = Math.round(r * 0.9);
    g = Math.round(g * 0.9);
    b = Math.round(b * 0.9);
  }

  if (kind === STONE && pixHash(lx, ly, 55 + variant) > 0.96) {
    r = Math.round(r * 0.88);
    g = Math.round(g * 0.88);
    b = Math.round(b * 0.88);
  }

  if (kind === LEAVES) {
    const ox = (lx + frame * 5) & 7;
    const oy = (ly + frame * 3) & 7;
    const hole = pixHash(ox, oy, 61 + frame * 7);
    const iso = pixHash(ox + 2, oy + 5, 23 + frame);
    if (hole > 0.88 && iso > 0.4) a = 0;
    else {
      const rustle = 0.9 + pixHash(ox, oy, kind + frame * 9) * 0.16;
      r = Math.round(r * rustle);
      g = Math.round(g * rustle);
      b = Math.round(b * rustle);
    }
  }

  if (kind === CHEST) {
    if (face === "side" && ly === 5) {
      r = Math.round(r * 0.85);
      g = Math.round(g * 0.85);
      b = Math.round(b * 0.85);
    }
    if (face === "side" && lx >= 3 && lx <= 4 && ly >= 2 && ly <= 4) {
      r = 110;
      g = 110;
      b = 115;
    }
  }

  if (kind === GOLD) {
    const ox = (lx + frame * 7) & 7;
    const oy = (ly + frame * 4) & 7;
    const spark = pixHash(ox, oy, kind + frame * 11);
    const fleck = pixHash(ox * 2, oy * 3, 41 + frame);
    if (spark > 0.86) {
      r = 255;
      g = 245;
      b = 180;
    } else if (fleck > 0.9) {
      r = Math.min(255, r + 40);
      g = Math.min(255, g + 30);
      b = Math.min(255, b + 12);
    }
  }

  return [r, g, b, a];
}

function paintTile(
  ctx: CanvasRenderingContext2D,
  col: number,
  atlasRow: number,
  kind: number,
  face: "top" | "side" | "bottom",
  variant: number,
  frame: number,
) {
  const tile = BLOCK_ATLAS_TILE;
  const pix = BLOCK_ATLAS_PIXEL;

  for (let ly = 0; ly < tile; ly++) {
    for (let lx = 0; lx < tile; lx++) {
      const [r, g, b, a] = logicalTexel(kind, face, lx, ly, variant, frame);
      ctx.fillStyle = a < 255 ? `rgba(${r},${g},${b},${a / 255})` : `rgb(${r},${g},${b})`;
      const ox = col * tile * pix + lx * pix;
      const oy = atlasRow * tile * pix + (tile - 1 - ly) * pix;
      ctx.fillRect(ox, oy, pix, pix);
    }
  }
}

/**
 * Crisp 8×8 logical atlas (64 px/tile): 4 grass + 4 dirt variants, solids, leaves/gold with 3 anim frames.
 * NearestFilter — sharp pixels, no mip blur.
 */
export function createBlockAtlas(): THREE.CanvasTexture {
  const tile = BLOCK_ATLAS_TILE;
  const pix = BLOCK_ATLAS_PIXEL;
  const cols = BLOCK_ATLAS_COLS;
  const rows = BLOCK_ATLAS_ROWS;
  const w = tile * pix * cols;
  const h = tile * pix * rows;

  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d")!;
  ctx.imageSmoothingEnabled = false;
  const faces: Array<"top" | "side" | "bottom"> = ["top", "side", "bottom"];

  for (let v = 0; v < BLOCK_ATLAS_VARIANTS; v++) {
    for (let face = 0; face < BLOCK_ATLAS_FACE_ROWS; face++) {
      paintTile(ctx, v, face, GRASS, faces[face]!, v, 0);
      paintTile(ctx, 4 + v, face, DIRT, faces[face]!, v, 0);
    }
  }
  for (let i = 0; i < SOLID_KINDS.length; i++) {
    const kind = SOLID_KINDS[i]!;
    const animated = kind === LEAVES || kind === GOLD;
    const frames = animated ? BLOCK_ATLAS_FRAMES : 1;
    for (let frame = 0; frame < frames; frame++) {
      for (let face = 0; face < BLOCK_ATLAS_FACE_ROWS; face++) {
        paintTile(ctx, 8 + i, frame * 3 + face, kind, faces[face]!, 0, frame);
      }
    }
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  tex.flipY = true;
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  tex.name = "peep-block-atlas-8-anim";
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

function pixelMod(kind: number, x: number, y: number, frame = 0): number {
  const a = pixHash(x, y, kind);
  const b = pixHash(x * 3 + 1, y * 2, kind + 4);
  if (kind === NEON) {
    const edge = x < 2 || x > 13 || y < 2 || y > 13;
    return edge ? 1.35 : 0.55;
  }
  if (kind === GRASS) {
    const clump = pixHash(Math.floor(x / 3), Math.floor(y / 3), 21);
    return 0.88 + a * 0.14 + (clump > 0.55 ? 0.06 : -0.04);
  }
  if (kind === DIRT) return 0.86 + a * 0.18 + (b > 0.85 ? -0.08 : 0);
  if (kind === STONE) return 0.9 + a * 0.12 + (b > 0.92 ? -0.14 : 0);
  if (kind === WOOD) {
    const stripe = ((x + Math.floor(a * 2)) % 4 === 0 ? -0.1 : 0.04) + (y % 8 === 0 ? -0.05 : 0);
    return 0.88 + a * 0.1 + stripe;
  }
  if (kind === SAND) return 0.9 + a * 0.14 + (b > 0.9 ? 0.06 : 0);
  if (kind === LEAVES) {
    const ox = (x + frame * 5) & 15;
    const oy = (y + frame * 3) & 15;
    const rustle = pixHash(ox, oy, kind + frame * 9);
    const clump = pixHash(Math.floor(ox / 4), Math.floor(oy / 4), 31 + frame);
    return 0.58 + rustle * 0.46 + (clump > 0.5 ? 0.16 : -0.12);
  }
  if (kind === CHEST) return 0.9 + a * 0.08;
  if (kind === GOLD) {
    const spark = pixHash(x, y, kind + frame * 11);
    return 0.78 + a * 0.18 + (spark > 0.86 ? 0.46 : 0);
  }
  return 0.9 + a * 0.12;
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
 * Sample soft 8×8 atlas. Grass/dirt pick 1 of 4 variants per world cell (anti-tile).
 * Neon / dynamite stay procedural. Vertex color = AO only.
 */
export const BLOCK_TEXEL_GLSL = /* glsl */ `
float kind = floor(vKind + 0.1);
float neon = step(9.5, kind) * (1.0 - step(10.5, kind));
float dynamite = step(10.5, kind) * (1.0 - step(11.5, kind));
float tuft = step(98.5, kind) * (1.0 - step(99.5, kind));
float grass = step(0.5, kind) * (1.0 - step(1.5, kind));
float dirt = step(1.5, kind) * (1.0 - step(2.5, kind));
float leaf = step(5.5, kind) * (1.0 - step(6.5, kind));
float gold = step(7.5, kind) * (1.0 - step(8.5, kind));
vec3 nRaw = normalize(vPeepN);
vec3 pn = abs(nRaw);
// CRITICAL: use signed normal — abs() made top/bottom identical (grass on ceiling).
float isTop = step(0.5, nRaw.y);
float bot = step(0.5, -nRaw.y);
float side = 1.0 - max(isTop, bot);
float faceRow = mix(mix(1.0, 2.0, bot), 0.0, isTop);
vec2 faceUV = mix(mix(vPeepW.xy, vPeepW.zy, step(pn.z, pn.x)), vPeepW.xz, step(max(pn.x, pn.z), pn.y));
vec2 uv = fract(faceUV);
// Stable per-block variant 0..3 (breaks tiling without remesh flicker).
vec3 cell = floor(vPeepW);
float cellH = fract(sin(dot(cell, vec3(12.9898, 78.233, 45.164))) * 43758.5453);
float variant = floor(cellH * 4.0);
if (tuft > 0.5) {
  vec2 tuv = vPeepUv;
  float gVar = floor(fract(sin(dot(floor(vPeepW.xz), vec2(12.9898, 78.233))) * 43758.5453) * 4.0);
  vec2 aUv = vec2(
    (gVar + tuv.x) / 14.0,
    (8.0 + tuv.y) / 9.0
  );
  vec3 tex = texture2D(uAtlas, aUv).rgb;
  float edge = abs(tuv.x - 0.5) * 2.0;
  float taper = mix(0.95, 0.28, tuv.y);
  if (edge > taper || tuv.y > 0.98) discard;
  diffuseColor.rgb = tex * diffuseColor.rgb;
} else if (neon > 0.5) {
  float edge = max(abs(uv.x - 0.5), abs(uv.y - 0.5));
  float rim = smoothstep(0.28, 0.48, edge);
  vec3 neonCore = diffuseColor.rgb * 0.28;
  vec3 neonRim = diffuseColor.rgb * 2.4 + vec3(0.15, 0.35, 0.55) * rim;
  diffuseColor.rgb = mix(neonCore, neonRim, rim);
  diffuseColor.rgb += neonRim * 0.35 * rim;
} else if (dynamite > 0.5) {
  vec3 wood = vec3(0.78, 0.62, 0.38);
  vec3 red = vec3(0.82, 0.2, 0.14);
  vec3 white = vec3(0.96, 0.96, 0.94);
  vec3 ink = vec3(0.08, 0.06, 0.05);
  float isCap = step(0.55, abs(pn.y));
  vec3 base = mix(red, wood, isCap);
  float band = side * (step(0.78, uv.y) + step(uv.y, 0.22));
  base = mix(base, ink, band * 0.55);
  float mid = side * step(0.32, uv.y) * step(uv.y, 0.68);
  float px = uv.x;
  float py = (uv.y - 0.32) / 0.36;
  float tStem = step(0.08, px) * step(px, 0.14) * step(0.15, py) * step(py, 0.85);
  float tBar = step(0.04, px) * step(px, 0.18) * step(0.72, py) * step(py, 0.9);
  float nLeft = step(0.28, px) * step(px, 0.34) * step(0.15, py) * step(py, 0.85);
  float nRight = step(0.44, px) * step(px, 0.5) * step(0.15, py) * step(py, 0.85);
  float nDiag = step(0.32, px) * step(px, 0.46) * step(abs(py - (px - 0.28) / 0.22) , 0.12);
  float t2Stem = step(0.6, px) * step(px, 0.66) * step(0.15, py) * step(py, 0.85);
  float t2Bar = step(0.56, px) * step(px, 0.7) * step(0.72, py) * step(py, 0.9);
  float glyph = clamp(tStem + tBar + nLeft + nRight + nDiag + t2Stem + t2Bar, 0.0, 1.0) * mid;
  base = mix(base, white, glyph);
  float fuseHole = isCap * (1.0 - bot) * step(length(uv - vec2(0.5)), 0.12);
  base = mix(base, ink, fuseHole);
  float blink = step(0.5, fract(uTime * 5.0));
  diffuseColor.rgb = mix(base * 0.55, base * 1.25 + vec3(0.35, 0.08, 0.02) * blink, 0.85 + 0.15 * blink);
} else {
  // Grass: TOP = green, SIDE = GRASS_SIDE (cap), BOTTOM = light dirt.
  float grassTile = mix(4.0 + variant, variant, max(isTop, side));
  float tile = mix(
    mix(8.0 + clamp(kind - 3.0, 0.0, 5.0), 4.0 + variant, dirt),
    grassTile,
    grass
  );
  // Leaves + gold: 3 atlas frames, swap 3× per second.
  float live = max(leaf, gold);
  float frame = live * mod(floor(uTime * 3.0), 3.0);
  float atlasRow = faceRow + frame * 3.0;
  float vRow = 8.0 - atlasRow;
  vec2 aUv = vec2(
    (tile + uv.x) / 14.0,
    (vRow + uv.y) / 9.0
  );
  vec4 tex = texture2D(uAtlas, aUv);
  if (leaf > 0.5 && tex.a < 0.5) discard;
  diffuseColor.rgb = tex.rgb * diffuseColor.rgb;
}
`;

/** Tiny shade micro-contrast only — keep mobile GPU light. */
export const BLOCK_SHADE_GRAIN_GLSL = /* glsl */ `
{
  float kind = floor(vKind + 0.1);
  float neon = step(9.5, kind) * (1.0 - step(10.5, kind));
  float dynamite = step(10.5, kind) * (1.0 - step(11.5, kind));
  float tuft = step(98.5, kind) * (1.0 - step(99.5, kind));
  if (neon > 0.5) {
    outgoingLight += diffuseColor.rgb * 0.55;
  } else if (dynamite > 0.5) {
    outgoingLight += diffuseColor.rgb * (0.25 + 0.55 * step(0.5, fract(uPeepTime * 5.0)));
  } else if (tuft > 0.5) {
    outgoingLight = max(outgoingLight, diffuseColor.rgb * 0.65);
  } else {
    float lum = dot(outgoingLight, vec3(0.2126, 0.7152, 0.0722));
    float shade = 1.0 - smoothstep(0.1, 0.65, lum);
    outgoingLight *= 1.0 - shade * 0.08;
  }
}
`;
