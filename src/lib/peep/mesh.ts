import * as THREE from "three";
import { AIR, CHUNK_S, WORLD_SY } from "./constants";
import { faceTint, vertexGrain } from "./textures";
import type { VoxelWorld } from "./world";

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
  return world.get(x, y, z) !== AIR;
}

function cornerAO(
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
  const ao = s1 && s2 ? 0 : 3 - (Number(s1) + Number(s2) + Number(cr));
  return 0.74 + (ao / 3) * 0.26;
}

type Axis = 0 | 1 | 2;

/**
 * Greedy-mesh a chunk so coplanar faces of the same block become one quad.
 * Independent per-block quads leave 1px sky cracks, especially on chunk seams.
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
  const indices: number[] = [];
  let vert = 0;

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

    for (let slice = 0; slice <= dd; slice++) {
      for (let vv = 0; vv < dv; vv++) {
        for (let uu = 0; uu < du; uu++) {
          const { x, y, z } = blockOnFace(axis, sign, x0, z0, slice, uu, vv);
          const nx = axis === 0 ? sign : 0;
          const ny = axis === 1 ? sign : 0;
          const nz = axis === 2 ? sign : 0;
          const block = world.get(x, y, z);
          const neighbor = world.get(x + nx, y + ny, z + nz);
          mask[uu + vv * du] = block !== AIR && neighbor === AIR ? block : 0;
        }
      }

      for (let vv = 0; vv < dv; vv++) {
        for (let uu = 0; uu < du; ) {
          const type = mask[uu + vv * du]!;
          if (!type) {
            uu++;
            continue;
          }
          let width = 1;
          while (uu + width < du && mask[uu + width + vv * du] === type) width++;
          let height = 1;
          grow: while (vv + height < dv) {
            for (let k = 0; k < width; k++) {
              if (mask[uu + k + (vv + height) * du] !== type) break grow;
            }
            height++;
          }

          const owner = blockOnFace(axis, sign, x0, z0, slice, uu, vv);
          emitQuad(
            world,
            positions,
            normals,
            colors,
            uvs,
            kinds,
            indices,
            vert,
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
          );
          vert += 4;

          for (let h = 0; h < height; h++) {
            for (let w = 0; w < width; w++) mask[uu + w + (vv + h) * du] = 0;
          }
          uu += width;
        }
      }
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute("normal", new THREE.Float32BufferAttribute(normals, 3));
  geo.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
  geo.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  geo.setAttribute("peepKind", new THREE.Float32BufferAttribute(kinds, 1));
  geo.setIndex(indices);
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

function emitQuad(
  world: VoxelWorld,
  positions: number[],
  normals: number[],
  colors: number[],
  uvs: number[],
  kinds: number[],
  indices: number[],
  vert: number,
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
  const p2: [number, number, number] = [p0[0] + du[0] + dv[0], p0[1] + du[1] + dv[1], p0[2] + du[2] + dv[2]];
  const p3: [number, number, number] = [p0[0] + dv[0], p0[1] + dv[1], p0[2] + dv[2]];

  const cx = du[1] * dv[2] - du[2] * dv[1];
  const cy = du[2] * dv[0] - du[0] * dv[2];
  const cz = du[0] * dv[1] - du[1] * dv[0];
  const flip = cx * nx + cy * ny + cz * nz < 0;
  const corners = flip ? [p0, p3, p2, p1] : [p0, p1, p2, p3];

  for (let i = 0; i < 4; i++) {
    const p = corners[i]!;
    const ox = nx !== 0 ? (sign > 0 ? 1 : 0) : p[0] > p0[0] ? 1 : 0;
    const oy = ny !== 0 ? (sign > 0 ? 1 : 0) : p[1] > p0[1] ? 1 : 0;
    const oz = nz !== 0 ? (sign > 0 ? 1 : 0) : p[2] > p0[2] ? 1 : 0;
    const ao = cornerAO(world, owner.x, owner.y, owner.z, nx, ny, nz, ox, oy, oz);
    const slope = ny === 0 ? 0.9 + (p[1] > p0[1] ? 0.1 : 0) : 1;
    const [tr, tg, tb] = faceTint(block, nx, ny, nz, owner.x, owner.y, owner.z);
    const grain = vertexGrain(owner.x, owner.y, owner.z, block);
    const s = ao * slope * grain;
    positions.push(p[0], p[1], p[2]);
    normals.push(nx, ny, nz);
    colors.push(srgbToLinear(tr * s), srgbToLinear(tg * s), srgbToLinear(tb * s));
    kinds.push(block);
    if (ny !== 0) uvs.push(p[0], p[2]);
    else if (nx !== 0) uvs.push(p[2], p[1]);
    else uvs.push(p[0], p[1]);
  }
  indices.push(vert, vert + 1, vert + 2, vert, vert + 2, vert + 3);
}
