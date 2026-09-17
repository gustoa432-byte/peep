import * as THREE from "three";

const FACE = 0.512;

function seg(out: number[], a: number[], b: number[]) {
  out.push(a[0]!, a[1]!, a[2]!, b[0]!, b[1]!, b[2]!);
}

const CRACK_UV: [number, number, number, number][] = [
  [-0.4, -0.38, 0.05, -0.08],
  [0.05, -0.08, -0.16, 0.34],
  [-0.16, 0.34, 0.36, 0.18],
  [0.2, -0.36, 0.42, 0.02],
  [-0.38, 0.08, 0.04, 0.42],
  [-0.1, -0.4, 0.28, -0.14],
];

function faceCracks(out: number[], map: (u: number, v: number) => [number, number, number]) {
  for (const [u0, v0, u1, v1] of CRACK_UV) {
    seg(out, map(u0, v0), map(u1, v1));
  }
}

/** Jagged cracks on all six faces, ordered so drawRange can reveal them over time. */
function crackPositions(): Float32Array {
  const o: number[] = [];
  faceCracks(o, (u, v) => [u, v, FACE]);
  faceCracks(o, (u, v) => [u, v, -FACE]);
  faceCracks(o, (u, v) => [u, FACE, v]);
  faceCracks(o, (u, v) => [u, -FACE, v]);
  faceCracks(o, (u, v) => [FACE, u, v]);
  faceCracks(o, (u, v) => [-FACE, u, v]);
  return new Float32Array(o);
}

export type PlaceGhost = {
  mesh: THREE.Mesh;
  mat: THREE.MeshLambertMaterial;
};

export function createPlaceGhost(): PlaceGhost {
  const mat = new THREE.MeshLambertMaterial({
    color: 0xffffff,
    transparent: true,
    opacity: 0.28,
    depthWrite: false,
    depthTest: true,
    polygonOffset: true,
    polygonOffsetFactor: -4,
    polygonOffsetUnits: -4,
  });
  // Well under 1.0 so it never coplanar-fights the chunk mesh after place.
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(0.88, 0.88, 0.88), mat);
  mesh.visible = false;
  mesh.renderOrder = 6;
  mesh.frustumCulled = false;
  return { mesh, mat };
}

export type BreakCracks = {
  group: THREE.Group;
  veil: THREE.Mesh;
  lines: THREE.LineSegments;
  segmentCount: number;
};

export function createBreakCracks(): BreakCracks {
  const group = new THREE.Group();
  group.visible = false;
  const veilMat = new THREE.MeshBasicMaterial({
    color: 0x1a1612,
    transparent: true,
    opacity: 0,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -4,
    polygonOffsetUnits: -4,
  });
  const veil = new THREE.Mesh(new THREE.BoxGeometry(1.02, 1.02, 1.02), veilMat);
  const pos = crackPositions();
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  const lines = new THREE.LineSegments(
    geo,
    new THREE.LineBasicMaterial({
      color: 0x2a221c,
      transparent: true,
      opacity: 0.95,
    }),
  );
  const segmentCount = pos.length / 6;
  geo.setDrawRange(0, 0);
  group.add(veil, lines);
  return { group, veil, lines, segmentCount };
}

export function disposePlaceGhost(ghost: PlaceGhost) {
  ghost.mesh.geometry.dispose();
  ghost.mat.dispose();
}

export function disposeBreakCracks(cracks: BreakCracks) {
  cracks.veil.geometry.dispose();
  (cracks.veil.material as THREE.Material).dispose();
  cracks.lines.geometry.dispose();
  (cracks.lines.material as THREE.Material).dispose();
}
