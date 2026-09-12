import * as THREE from "three";

/** Grip is the pivot. The metal tip — not the mesh centroid — is the strike point. */
export const PICKAXE_REST = {
  x: 0.86,
  y: -1.27,
  z: -1.59,
  rx: 2.38,
  ry: 1.04,
  rz: -Math.PI,
  scale: 1.68,
};

const UNIT = 0.04;
const GRIP_Y = 2;
const ATLAS = 32;
const TILE = 16;

const WOOD = 0;
const METAL = 1;
const ACCENT = 2;

type Kind = 0 | 1 | 2;
type Cell = { x: number; y: number; z: number; kind: Kind };

const BASE: [number, number, number][] = [
  [0.72, 0.5, 0.28],
  [0.78, 0.76, 0.74],
  [0.74, 0.38, 0.24],
];

/** Handle + terracotta collar + T-head with a pointed pick. ~19 voxels. */
const CELLS: Cell[] = [
  ...[0, 1, 2, 3, 4, 5, 6].map((y) => ({ x: 0, y, z: 0, kind: WOOD as Kind })),
  { x: 0, y: 7, z: 0, kind: ACCENT },
  { x: -2, y: 8, z: 0, kind: METAL },
  { x: -1, y: 8, z: 0, kind: METAL },
  { x: 0, y: 8, z: 0, kind: METAL },
  { x: 1, y: 8, z: 0, kind: METAL },
  { x: 2, y: 8, z: 0, kind: METAL },
  { x: -1, y: 9, z: 0, kind: METAL },
  { x: 0, y: 9, z: 0, kind: METAL },
  { x: 1, y: 9, z: 0, kind: METAL },
  { x: -2, y: 8, z: -1, kind: METAL },
  { x: -3, y: 8, z: -1, kind: METAL },
  { x: -3, y: 8, z: -2, kind: METAL },
  { x: 2, y: 8, z: 1, kind: METAL },
];

/** Outer face of the pointed head — break contact, not the group center. */
export const PICKAXE_TIP = {
  x: (-3 - 0) * UNIT,
  y: (8 - GRIP_Y + 0.5) * UNIT,
  z: -2 * UNIT,
};

function cellKey(x: number, y: number, z: number): string {
  return `${x},${y},${z}`;
}

function hash2(x: number, y: number, salt: number): number {
  let n = Math.imul(x + 1, 1597334677) ^ Math.imul(y + 3, 3812015801) ^ Math.imul(salt, 2246822519);
  n = Math.imul(n ^ (n >>> 16), 2246822519);
  return ((n ^ (n >>> 13)) >>> 0) / 4294967296;
}

function srgbToLinear(c: number): number {
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

function paint(kind: Kind, x: number, y: number): number {
  const a = hash2(x, y, kind + 1);
  const b = hash2(x * 3 + 1, y * 2, kind + 5);
  if (kind === WOOD) {
    const stripe = ((x + Math.floor(a * 2)) % 4 === 0 ? -0.28 : 0.08) + (y % 7 === 0 ? -0.12 : 0);
    return 0.7 + a * 0.22 + stripe;
  }
  if (kind === METAL) return 0.72 + a * 0.28 + (b > 0.84 ? -0.32 : 0) + (b < 0.12 ? 0.16 : 0);
  return 0.7 + a * 0.22 + (b > 0.82 ? 0.14 : 0);
}

/** 32×32 nearest atlas: wood, metal, terracotta, metal scratch. */
export function createPickaxeAtlas(): THREE.DataTexture {
  const data = new Uint8Array(ATLAS * ATLAS * 4);
  for (let ty = 0; ty < 2; ty++) {
    for (let tx = 0; tx < 2; tx++) {
      const kind = (tx + ty * 2 === 2 ? ACCENT : tx === 1 ? METAL : WOOD) as Kind;
      for (let y = 0; y < TILE; y++) {
        for (let x = 0; x < TILE; x++) {
          const m = Math.min(1.22, Math.max(0.52, paint(kind, x, y)));
          const v = Math.round(Math.min(255, Math.max(0, m * 235)));
          const i = ((ty * TILE + y) * ATLAS + tx * TILE + x) * 4;
          data[i] = v;
          data[i + 1] = v;
          data[i + 2] = v;
          data[i + 3] = 255;
        }
      }
    }
  }
  const tex = new THREE.DataTexture(data, ATLAS, ATLAS, THREE.RGBAFormat);
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;
  tex.colorSpace = THREE.NoColorSpace;
  return tex;
}

const FACES: { n: [number, number, number]; corners: [number, number, number][] }[] = [
  { n: [1, 0, 0], corners: [[1, 0, 1], [1, 1, 1], [1, 1, 0], [1, 0, 0]] },
  { n: [-1, 0, 0], corners: [[0, 0, 0], [0, 1, 0], [0, 1, 1], [0, 0, 1]] },
  { n: [0, 1, 0], corners: [[0, 1, 1], [0, 1, 0], [1, 1, 0], [1, 1, 1]] },
  { n: [0, -1, 0], corners: [[0, 0, 0], [0, 0, 1], [1, 0, 1], [1, 0, 0]] },
  { n: [0, 0, 1], corners: [[0, 0, 1], [0, 1, 1], [1, 1, 1], [1, 0, 1]] },
  { n: [0, 0, -1], corners: [[1, 0, 0], [1, 1, 0], [0, 1, 0], [0, 0, 0]] },
];

function cornerAO(
  filled: Set<string>,
  x: number,
  y: number,
  z: number,
  nx: number,
  ny: number,
  nz: number,
  cx: number,
  cy: number,
  cz: number,
): number {
  const sx = cx === 1 ? 1 : -1;
  const sy = cy === 1 ? 1 : -1;
  const sz = cz === 1 ? 1 : -1;
  let s1: boolean;
  let s2: boolean;
  let cr: boolean;
  if (ny !== 0) {
    s1 = filled.has(cellKey(x + sx, y + ny, z));
    s2 = filled.has(cellKey(x, y + ny, z + sz));
    cr = filled.has(cellKey(x + sx, y + ny, z + sz));
  } else if (nx !== 0) {
    s1 = filled.has(cellKey(x + nx, y + sy, z));
    s2 = filled.has(cellKey(x + nx, y, z + sz));
    cr = filled.has(cellKey(x + nx, y + sy, z + sz));
  } else {
    s1 = filled.has(cellKey(x + sx, y, z + nz));
    s2 = filled.has(cellKey(x, y + sy, z + nz));
    cr = filled.has(cellKey(x + sx, y + sy, z + nz));
  }
  const occ = Number(s1) + Number(s2) + Number(cr);
  const ao = s1 && s2 ? 0 : 3 - occ;
  return 0.72 + (ao / 3) * 0.28;
}

function buildGeometry(): THREE.BufferGeometry {
  const filled = new Set(CELLS.map((c) => cellKey(c.x, c.y, c.z)));
  const positions: number[] = [];
  const normals: number[] = [];
  const colors: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  let vert = 0;

  for (const cell of CELLS) {
    const [br, bg, bb] = BASE[cell.kind]!;
    const tileX = cell.kind === METAL ? 1 : 0;
    const tileY = cell.kind === ACCENT ? 1 : 0;
    const u0 = (tileX + 0.5 / TILE) / 2;
    const u1 = (tileX + (TILE - 0.5) / TILE) / 2;
    const v0 = (tileY + 0.5 / TILE) / 2;
    const v1 = (tileY + (TILE - 0.5) / TILE) / 2;
    const faceUV: [number, number][] = [
      [u0, v0],
      [u0, v1],
      [u1, v1],
      [u1, v0],
    ];

    for (const face of FACES) {
      const [nx, ny, nz] = face.n;
      if (filled.has(cellKey(cell.x + nx, cell.y + ny, cell.z + nz))) continue;
      const shade = ny > 0 ? 1 : ny < 0 ? 0.72 : 0.86;
      const ox = cell.x;
      const oy = cell.y - GRIP_Y;
      const oz = cell.z;
      for (let i = 0; i < 4; i++) {
        const [cx, cy, cz] = face.corners[i]!;
        positions.push((ox + cx) * UNIT, (oy + cy) * UNIT, (oz + cz) * UNIT);
        normals.push(nx, ny, nz);
        const ao = cornerAO(filled, cell.x, cell.y, cell.z, nx, ny, nz, cx, cy, cz);
        const k = shade * ao;
        colors.push(srgbToLinear(br * k), srgbToLinear(bg * k), srgbToLinear(bb * k));
        uvs.push(faceUV[i]![0], faceUV[i]![1]);
      }
      indices.push(vert, vert + 1, vert + 2, vert, vert + 2, vert + 3);
      vert += 4;
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute("normal", new THREE.Float32BufferAttribute(normals, 3));
  geo.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
  geo.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  return geo;
}

export function createPickaxe(): THREE.Group {
  const g = new THREE.Group();
  g.name = "pickaxe";
  const atlas = createPickaxeAtlas();
  const mat = new THREE.MeshLambertMaterial({
    map: atlas,
    vertexColors: true,
    color: 0xffffff,
  });
  const mesh = new THREE.Mesh(buildGeometry(), mat);
  mesh.name = "pickaxeMesh";
  mesh.frustumCulled = false;
  const tip = new THREE.Object3D();
  tip.name = "tip";
  tip.position.set(PICKAXE_TIP.x, PICKAXE_TIP.y, PICKAXE_TIP.z);
  g.add(mesh, tip);
  g.scale.setScalar(PICKAXE_REST.scale);
  g.position.set(PICKAXE_REST.x, PICKAXE_REST.y, PICKAXE_REST.z);
  g.rotation.set(PICKAXE_REST.rx, PICKAXE_REST.ry, PICKAXE_REST.rz);
  return g;
}

export function pickaxeTip(group: THREE.Group): THREE.Object3D | undefined {
  return group.getObjectByName("tip");
}

export function disposePickaxe(group: THREE.Group) {
  group.traverse((obj) => {
    if (!(obj instanceof THREE.Mesh)) return;
    obj.geometry.dispose();
    const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
    for (const m of mats) {
      if ("map" in m && m.map) m.map.dispose();
      m.dispose();
    }
  });
}
