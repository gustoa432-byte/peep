import * as THREE from "three";
import { CHUNK_S, GRASS, WORLD_SY, isMeshEmpty } from "./constants";
import { faceTint, vertexGrain } from "./textures";
import type { VoxelWorld } from "./world";

/** Mesh-only kind for cross-grass tufts (not placeable). Shader samples grass top. */
export const GRASS_TUFT_KIND = 99;

/** ~25% of grass tops get a tuft (hash threshold). */
const GRASS_TUFT_CHANCE = 0.25;

function srgbToLinear(c: number): number {
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

export function chunkOrigin(cx: number, cz: number): { x0: number; z0: number } {
  return { x0: cx * CHUNK_S, z0: cz * CHUNK_S };
}

export function chunkCountX(): number {
  return 3;
}

export function chunkCountZ(): number {
  return 3;
}

function occluded(world: VoxelWorld, x: number, y: number, z: number): boolean {
  // world.get() loads neighbor chunks on demand — required for seamless AO at borders.
  return !isMeshEmpty(world.get(x, y, z));
}

/** Classic voxel AO level 0 (enclosed) … 3 (open). */
function cornerAoLevel(
  world: VoxelWorld,
  x: number,
  y: number,
  z: number,
  nx: number,
  ny: number,
  nz: number,
  ox: number,
  oy: number,
  oz: number,
): number {
  const dx = ox === 1 ? 1 : -1;
  const dy = oy === 1 ? 1 : -1;
  const dz = oz === 1 ? 1 : -1;
  let s1: boolean;
  let s2: boolean;
  let cr: boolean;
  if (ny !== 0) {
    s1 = occluded(world, x + dx, y + ny, z);
    s2 = occluded(world, x, y + ny, z + dz);
    cr = occluded(world, x + dx, y + ny, z + dz);
  } else if (nx !== 0) {
    s1 = occluded(world, x + nx, y + dy, z);
    s2 = occluded(world, x + nx, y, z + dz);
    cr = occluded(world, x + nx, y + dy, z + dz);
  } else {
    s1 = occluded(world, x + dx, y, z + nz);
    s2 = occluded(world, x, y + dy, z + nz);
    cr = occluded(world, x + dx, y + dy, z + nz);
  }
  return s1 && s2 ? 0 : 3 - (Number(s1) + Number(s2) + Number(cr));
}

/** Soft multiply — never crush a face to rgb(0,0,0); ambient finishes the lift. */
function aoMul(level: number): number {
  return 0.72 + (level / 3) * 0.28;
}

/** Map face-local (u,v) ∈ {0,1}² to voxel corner flags. */
function faceCornerOX(
  nx: number,
  ny: number,
  nz: number,
  u: number,
  v: number,
): [number, number, number] {
  if (ny !== 0) return [u, ny > 0 ? 1 : 0, v];
  if (nx !== 0) return [nx > 0 ? 1 : 0, u, v];
  return [u, v, nz > 0 ? 1 : 0];
}

/**
 * Pack 4 corner AO levels (2 bits each) so greedy only merges faces with
 * identical occlusion — stops AO gradients stretching across flat greedy quads.
 * Bit order high→low: (0,0), (1,0), (1,1), (0,1) in face u-v.
 */
function packFaceAo(
  world: VoxelWorld,
  x: number,
  y: number,
  z: number,
  nx: number,
  ny: number,
  nz: number,
): number {
  let pack = 0;
  for (const [u, v] of [
    [0, 0],
    [1, 0],
    [1, 1],
    [0, 1],
  ] as const) {
    const [ox, oy, oz] = faceCornerOX(nx, ny, nz, u, v);
    pack = (pack << 2) | cornerAoLevel(world, x, y, z, nx, ny, nz, ox, oy, oz);
  }
  return pack;
}

function unpackFaceAo(pack: number, u: number, v: number): number {
  const shift = u === 0 && v === 0 ? 6 : u === 1 && v === 0 ? 4 : u === 1 && v === 1 ? 2 : 0;
  return (pack >> shift) & 3;
}

type Axis = 0 | 1 | 2;

/**
 * Greedy-mesh a chunk. Same block + same AO pack only.
 * Non-indexed geometry + authored face normals (no computeVertexNormals).
 */
export function buildChunkGeometry(world: VoxelWorld, cx: number, cz: number): THREE.BufferGeometry {
  const { x0, z0 } = chunkOrigin(cx, cz);
  const sx = CHUNK_S;
  const sy = WORLD_SY;
  const sz = CHUNK_S;

  const positions: number[] = [];
  const normals: number[] = [];
  const colors: number[] = [];
  const uvs: number[] = [];
  const kinds: number[] = [];

  const axes: { axis: Axis; sign: 1 | -1; du: number; dv: number }[] = [
    { axis: 0, sign: 1, du: sy, dv: sz },
    { axis: 0, sign: -1, du: sy, dv: sz },
    { axis: 1, sign: 1, du: sx, dv: sz },
    { axis: 1, sign: -1, du: sx, dv: sz },
    { axis: 2, sign: 1, du: sx, dv: sy },
    { axis: 2, sign: -1, du: sx, dv: sy },
  ];

  for (const { axis, sign, du, dv } of axes) {
    const dd = axis === 0 ? sx : axis === 1 ? sy : sz;
    const mask = new Int16Array(du * dv);
    const aoMask = new Uint8Array(du * dv);

    for (let slice = 0; slice <= dd; slice++) {
      for (let vv = 0; vv < dv; vv++) {
        for (let uu = 0; uu < du; uu++) {
          const { x, y, z } = blockOnFace(axis, sign, x0, z0, slice, uu, vv);
          const nx = axis === 0 ? sign : 0;
          const ny = axis === 1 ? sign : 0;
          const nz = axis === 2 ? sign : 0;
          const block = world.get(x, y, z);
          const neighbor = world.get(x + nx, y + ny, z + nz);
          const i = uu + vv * du;
          if (!isMeshEmpty(block) && isMeshEmpty(neighbor)) {
            mask[i] = block;
            aoMask[i] = packFaceAo(world, x, y, z, nx, ny, nz);
          } else {
            mask[i] = 0;
            aoMask[i] = 0;
          }
        }
      }

      for (let vv = 0; vv < dv; vv++) {
        for (let uu = 0; uu < du; ) {
          const type = mask[uu + vv * du]!;
          if (!type) {
            uu++;
            continue;
          }
          const ao0 = aoMask[uu + vv * du]!;
          let width = 1;
          while (
            uu + width < du &&
            mask[uu + width + vv * du] === type &&
            aoMask[uu + width + vv * du] === ao0
          ) {
            width++;
          }
          let height = 1;
          grow: while (vv + height < dv) {
            for (let k = 0; k < width; k++) {
              const i = uu + k + (vv + height) * du;
              if (mask[i] !== type || aoMask[i] !== ao0) break grow;
            }
            height++;
          }

          const owner = blockOnFace(axis, sign, x0, z0, slice, uu, vv);
          emitQuadNonIndexed(
            positions,
            normals,
            colors,
            uvs,
            kinds,
            axis,
            sign,
            x0,
            z0,
            slice,
            uu,
            vv,
            width,
            height,
            type,
            owner,
            ao0,
          );

          for (let hy = 0; hy < height; hy++) {
            for (let wx = 0; wx < width; wx++) {
              const i = uu + wx + (vv + hy) * du;
              mask[i] = 0;
              aoMask[i] = 0;
            }
          }
          uu += width;
        }
      }
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(new Float32Array(positions), 3));
  geo.setAttribute("normal", new THREE.Float32BufferAttribute(new Float32Array(normals), 3));
  geo.setAttribute("color", new THREE.Float32BufferAttribute(new Float32Array(colors), 3));
  geo.setAttribute("uv", new THREE.Float32BufferAttribute(new Float32Array(uvs), 2));
  geo.setAttribute("peepKind", new THREE.Float32BufferAttribute(new Float32Array(kinds), 1));
  // Non-indexed: every attribute must share the same vertex count.
  const vCount = positions.length / 3;
  if (
    normals.length / 3 !== vCount ||
    colors.length / 3 !== vCount ||
    uvs.length / 2 !== vCount ||
    kinds.length !== vCount
  ) {
    throw new Error(
      `chunk attribute mismatch pos=${vCount} nor=${normals.length / 3} col=${colors.length / 3} uv=${uvs.length / 2} kind=${kinds.length}`,
    );
  }
  geo.computeBoundingSphere();
  return geo;
}

function blockOnFace(
  axis: Axis,
  sign: 1 | -1,
  x0: number,
  z0: number,
  slice: number,
  uu: number,
  vv: number,
): { x: number; y: number; z: number } {
  if (axis === 0) {
    return { x: sign > 0 ? x0 + slice - 1 : x0 + slice, y: uu, z: z0 + vv };
  }
  if (axis === 1) {
    return { x: x0 + uu, y: sign > 0 ? slice - 1 : slice, z: z0 + vv };
  }
  return { x: x0 + uu, y: vv, z: sign > 0 ? z0 + slice - 1 : z0 + slice };
}

/** Two triangles, 6 independent verts — flatShading-safe, no index buffer. */
function emitQuadNonIndexed(
  positions: number[],
  normals: number[],
  colors: number[],
  uvs: number[],
  kinds: number[],
  axis: Axis,
  sign: 1 | -1,
  x0: number,
  z0: number,
  slice: number,
  uu: number,
  vv: number,
  w: number,
  h: number,
  block: number,
  owner: { x: number; y: number; z: number },
  aoPack: number,
) {
  const nx = axis === 0 ? sign : 0;
  const ny = axis === 1 ? sign : 0;
  const nz = axis === 2 ? sign : 0;

  const p0: [number, number, number] = [0, 0, 0];
  const du: [number, number, number] = [0, 0, 0];
  const dv: [number, number, number] = [0, 0, 0];

  if (axis === 0) {
    p0[0] = x0 + slice;
    p0[1] = uu;
    p0[2] = z0 + vv;
    du[1] = w;
    dv[2] = h;
  } else if (axis === 1) {
    p0[0] = x0 + uu;
    p0[1] = slice;
    p0[2] = z0 + vv;
    du[0] = w;
    dv[2] = h;
  } else {
    p0[0] = x0 + uu;
    p0[1] = vv;
    p0[2] = z0 + slice;
    du[0] = w;
    dv[1] = h;
  }

  const p1: [number, number, number] = [p0[0] + du[0], p0[1] + du[1], p0[2] + du[2]];
  const p2: [number, number, number] = [
    p0[0] + du[0] + dv[0],
    p0[1] + du[1] + dv[1],
    p0[2] + du[2] + dv[2],
  ];
  const p3: [number, number, number] = [p0[0] + dv[0], p0[1] + dv[1], p0[2] + dv[2]];

  const uv00: [number, number] = [0, 0];
  const uv10: [number, number] = [1, 0];
  const uv11: [number, number] = [1, 1];
  const uv01: [number, number] = [0, 1];

  const crossX = du[1] * dv[2] - du[2] * dv[1];
  const crossY = du[2] * dv[0] - du[0] * dv[2];
  const crossZ = du[0] * dv[1] - du[1] * dv[0];
  const flip = crossX * nx + crossY * ny + crossZ * nz < 0;
  const corners = flip ? [p0, p3, p2, p1] : [p0, p1, p2, p3];
  const cornerUV = flip ? [uv00, uv01, uv11, uv10] : [uv00, uv10, uv11, uv01];

  const [tr, tg, tb] = faceTint(block, nx, ny, nz, owner.x, owner.y, owner.z);
  const grain = vertexGrain(owner.x, owner.y, owner.z, block);

  const pushVert = (p: [number, number, number], fu: number, fv: number) => {
    const level = unpackFaceAo(aoPack, fu, fv);
    const sideLift = ny === 0 ? 0.9 + (p[1] > p0[1] ? 0.1 : 0) : 1;
    const s = aoMul(level) * sideLift * grain;
    positions.push(p[0], p[1], p[2]);
    normals.push(nx, ny, nz);
    colors.push(srgbToLinear(tr * s), srgbToLinear(tg * s), srgbToLinear(tb * s));
    kinds.push(block);
    if (ny !== 0) uvs.push(p[0], p[2]);
    else if (nx !== 0) uvs.push(p[2], p[1]);
    else uvs.push(p[0], p[1]);
  };

  for (const vi of [0, 1, 2, 0, 2, 3]) {
    const p = corners[vi]!;
    const [fu, fv] = cornerUV[vi]!;
    pushVert(p, fu, fv);
  }

  // Decorative cross-tufts into the same chunk buffers (no extra Mesh).
  if (block === GRASS && ny > 0) {
    emitGrassTufts(positions, normals, colors, uvs, kinds, owner.y + 1, x0 + uu, z0 + vv, w, h);
  }
}

function tuftHash(x: number, z: number): number {
  let n = Math.imul(x + 11, 374761393) ^ Math.imul(z + 7, 668265263);
  n = Math.imul(n ^ (n >>> 13), 1274126177);
  return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
}

/**
 * Two crossed vertical cards per selected grass cell, baked into chunk geometry.
 * Base grass cubes stay strict 1×1×1 — tufts are extra verts only.
 */
function emitGrassTufts(
  positions: number[],
  normals: number[],
  colors: number[],
  uvs: number[],
  kinds: number[],
  yTop: number,
  x0: number,
  z0: number,
  w: number,
  h: number,
) {
  const half = 2 / 16;
  const tall = 4 / 16;
  // Sit slightly above the top face so shadow maps don't black out the grass.
  const y0 = yTop + 0.02;
  const y1 = y0 + tall;
  const [tr, tg, tb] = faceTint(GRASS, 0, 1, 0, x0, yTop - 1, z0);
  const grain = vertexGrain(x0, yTop - 1, z0, GRASS);
  const r = srgbToLinear(tr * grain);
  const g = srgbToLinear(tg * grain);
  const b = srgbToLinear(tb * grain);

  const pushPlane = (
    ax: number,
    az: number,
    bx: number,
    bz: number,
    nx: number,
    nz: number,
  ) => {
    // Both windings (FrontSide terrain material). 2 planes × 2 faces × 6 verts.
    const faces: [number, number, number][][] = [
      [
        [ax, y0, az],
        [bx, y0, bz],
        [bx, y1, bz],
        [ax, y1, az],
      ],
      [
        [ax, y0, az],
        [ax, y1, az],
        [bx, y1, bz],
        [bx, y0, bz],
      ],
    ];
    const norms: [number, number, number][] = [
      [nx, 0, nz],
      [-nx, 0, -nz],
    ];
    for (let f = 0; f < 2; f++) {
      const corners = faces[f]!;
      const [nnx, nny, nnz] = norms[f]!;
      const cornerUV: [number, number][] =
        f === 0
          ? [
              [0, 0],
              [1, 0],
              [1, 1],
              [0, 1],
            ]
          : [
              [0, 0],
              [0, 1],
              [1, 1],
              [1, 0],
            ];
      for (const vi of [0, 1, 2, 0, 2, 3]) {
        const p = corners[vi]!;
        const [fu, fv] = cornerUV[vi]!;
        positions.push(p[0], p[1], p[2]);
        normals.push(nnx, nny, nnz);
        colors.push(r, g, b);
        kinds.push(GRASS_TUFT_KIND);
        uvs.push(fu, fv);
      }
    }
  };

  for (let dz = 0; dz < h; dz++) {
    for (let dx = 0; dx < w; dx++) {
      const wx = x0 + dx;
      const wz = z0 + dz;
      if (tuftHash(wx, wz) >= GRASS_TUFT_CHANCE) continue;
      const ox = (tuftHash(wx + 3, wz) - 0.5) * 0.3;
      const oz = (tuftHash(wx, wz + 5) - 0.5) * 0.3;
      const cx = wx + 0.5 + ox;
      const cz = wz + 0.5 + oz;
      pushPlane(cx - half, cz, cx + half, cz, 0, 1);
      pushPlane(cx, cz - half, cx, cz + half, 1, 0);
    }
  }
}
