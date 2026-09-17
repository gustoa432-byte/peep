import * as THREE from "three";
import { Sky } from "three/addons/objects/Sky.js";
import { FOG_COLOR, FOG_FAR, FOG_NEAR, WATER_LEVEL, WORLD_SX, WORLD_SZ } from "./constants";
import { hash2, heightAt } from "./world";

export type Atmosphere = {
  group: THREE.Group;
  sky: Sky;
  water: THREE.Mesh;
  time: { value: number };
  fogColor: { value: THREE.Color };
  fogNear: { value: number };
  fogFar: { value: number };
};

/** Afternoon sun — long readable shadows (not zenith). */
const SUN_ELEVATION_DEG = 48;
const SUN_AZIMUTH_DEG = -35;

function sunDirectionFromAngles(elevationDeg: number, azimuthDeg: number): THREE.Vector3 {
  const phi = THREE.MathUtils.degToRad(90 - elevationDeg);
  const theta = THREE.MathUtils.degToRad(azimuthDeg);
  return new THREE.Vector3().setFromSphericalCoords(1, phi, theta);
}

export const SUN_DIR = sunDirectionFromAngles(SUN_ELEVATION_DEG, SUN_AZIMUTH_DEG);

function color(hex: number): THREE.Color {
  return new THREE.Color(hex);
}

const WATER_PLANE = 520;

function createShoreMask(seed: number): THREE.DataTexture {
  const n = 128;
  const data = new Uint8Array(n * n * 4);
  const cx = WORLD_SX * 0.5;
  const cz = WORLD_SZ * 0.5;
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const wx = cx + (i / (n - 1) - 0.5) * WATER_PLANE;
      const wz = cz + (j / (n - 1) - 0.5) * WATER_PLANE;
      let a = 255;
      if (wx >= 0 && wx < WORLD_SX && wz >= 0 && wz < WORLD_SZ) {
        const h = heightAt(Math.floor(wx), Math.floor(wz), seed);
        if (h >= WATER_LEVEL) a = 0;
      }
      const o = (j * n + i) * 4;
      data[o] = a;
      data[o + 1] = a;
      data[o + 2] = a;
      data[o + 3] = 255;
    }
  }
  const tex = new THREE.DataTexture(data, n, n, THREE.RGBAFormat);
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearFilter;
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.needsUpdate = true;
  tex.colorSpace = THREE.NoColorSpace;
  return tex;
}

function createWaterMat(mask: THREE.DataTexture): THREE.MeshStandardMaterial {
  // Matte midday lagoon — soft wide sheen, no plastic pillar.
  return new THREE.MeshStandardMaterial({
    color: 0x1ca3ec,
    roughness: 0.7,
    metalness: 0.1,
    transparent: true,
    opacity: 0.85,
    // Transparent water must not write depth — otherwise shore blocks shimmer (z-fight).
    depthWrite: false,
    alphaMap: mask,
    fog: true,
  });
}

function addSilhouettes(group: THREE.Group, seed: number) {
  const mat = new THREE.MeshLambertMaterial({
    color: 0x4a3848,
    fog: true,
  });
  const cx = WORLD_SX * 0.5;
  const cz = WORLD_SZ * 0.5;
  for (let i = 0; i < 5; i++) {
    const ang = (i / 5) * Math.PI * 2 + hash2(i, 3, seed) * 0.4;
    const dist = 88 + hash2(i, 9, seed) * 22;
    const ox = cx + Math.sin(ang) * dist;
    const oz = cz + Math.cos(ang) * dist;
    const peaks = 3 + Math.floor(hash2(i, 1, seed) * 3);
    for (let p = 0; p < peaks; p++) {
      const w = 4.2 + hash2(i, p + 20, seed) * 7;
      const h = 1.6 + hash2(i, p + 40, seed) * 4.4;
      const d = 3.4 + hash2(i, p + 60, seed) * 6;
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
      mesh.position.set(
        ox + (hash2(i, p + 80, seed) - 0.5) * 8,
        WATER_LEVEL + h * 0.45,
        oz + (hash2(i, p + 100, seed) - 0.5) * 8,
      );
      mesh.rotation.y = hash2(i, p + 120, seed) * 0.6;
      group.add(mesh);
    }
  }
}

function createDaySky(): Sky {
  const sky = new Sky();
  sky.scale.setScalar(450);
  sky.frustumCulled = false;
  const u = sky.material.uniforms;
  // Piercing midday blue — low haze.
  u["turbidity"]!.value = 2;
  u["rayleigh"]!.value = 1;
  u["mieCoefficient"]!.value = 0.004;
  u["mieDirectionalG"]!.value = 0.8;
  u["sunPosition"]!.value.copy(SUN_DIR);
  if (u["showSunDisc"]) u["showSunDisc"]!.value = 1;
  if (u["cloudCoverage"]) u["cloudCoverage"]!.value = 0.08;
  if (u["cloudDensity"]) u["cloudDensity"]!.value = 0.1;
  return sky;
}

export function createAtmosphere(seed: number): Atmosphere {
  const group = new THREE.Group();
  const time = { value: 0 };
  const fogColor = { value: color(FOG_COLOR) };
  const fogNear = { value: FOG_NEAR };
  const fogFar = { value: FOG_FAR };

  const sky = createDaySky();
  group.add(sky);

  const mask = createShoreMask(seed);
  const water = new THREE.Mesh(
    new THREE.PlaneGeometry(WATER_PLANE, WATER_PLANE, 1, 1),
    createWaterMat(mask),
  );
  water.rotation.x = -Math.PI / 2;
  water.position.set(WORLD_SX * 0.5, WATER_LEVEL + 0.02, WORLD_SZ * 0.5);
  water.renderOrder = 1;
  water.receiveShadow = true;
  const waterMat = water.material as THREE.MeshStandardMaterial;
  waterMat.polygonOffset = true;
  waterMat.polygonOffsetFactor = -2;
  waterMat.polygonOffsetUnits = -2;
  group.add(water);

  addSilhouettes(group, seed);

  return { group, sky, water, time, fogColor, fogNear, fogFar };
}

export function tickAtmosphere(atmo: Atmosphere, camera: THREE.Camera, dt: number) {
  atmo.time.value += dt;
  atmo.sky.position.copy(camera.position);
  const uTime = (atmo.sky.material as THREE.ShaderMaterial).uniforms["time"];
  if (uTime) uTime.value = atmo.time.value;
}

export function disposeAtmosphere(atmo: Atmosphere) {
  const seen = new Set<THREE.Material>();
  atmo.group.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (!mesh.isMesh) return;
    mesh.geometry.dispose();
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const mat of mats) {
      if (seen.has(mat)) continue;
      seen.add(mat);
      const std = mat as THREE.MeshStandardMaterial;
      std.alphaMap?.dispose();
      mat.dispose();
    }
  });
}
