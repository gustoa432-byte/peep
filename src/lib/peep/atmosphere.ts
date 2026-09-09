import * as THREE from "three";
import {
  FOG_COLOR,
  FOG_FAR,
  FOG_NEAR,
  ISLAND_CORE,
  ISLAND_SHORE,
  SKY_HORIZON,
  SKY_ZENITH,
  SUN_COLOR,
  UNDERWATER_FOG,
  WATER_DEEP,
  WATER_FOAM,
  WATER_LEVEL,
  WATER_SHALLOW,
  WORLD_SX,
  WORLD_SZ,
} from "./constants";
import { hash2, heightAt } from "./world";

export type Atmosphere = {
  group: THREE.Group;
  water: THREE.Mesh;
  sky: THREE.Mesh;
  sun: THREE.Mesh;
  glow: THREE.Mesh;
  time: { value: number };
  fogColor: { value: THREE.Color };
  fogNear: { value: number };
  fogFar: { value: number };
  underwater: boolean;
};

export const SUN_DIR = new THREE.Vector3(0.58, 0.42, 0.34).normalize();

function color(hex: number): THREE.Color {
  return new THREE.Color(hex);
}

function createSkyMat(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    toneMapped: false,
    uniforms: {
      uZenith: { value: color(SKY_ZENITH) },
      uHorizon: { value: color(SKY_HORIZON) },
      uSunDir: { value: SUN_DIR.clone() },
      uSunColor: { value: color(SUN_COLOR) },
    },
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        vDir = normalize(position);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uZenith;
      uniform vec3 uHorizon;
      uniform vec3 uSunDir;
      uniform vec3 uSunColor;
      varying vec3 vDir;
      void main() {
        float h = clamp(vDir.y * 0.72 + 0.28, 0.0, 1.0);
        vec3 col = mix(uHorizon, uZenith, smoothstep(0.18, 0.78, h));
        float sun = pow(max(0.0, dot(normalize(vDir), normalize(uSunDir))), 48.0);
        col += uSunColor * sun * 0.45;
        float glow = pow(max(0.0, dot(normalize(vDir), normalize(uSunDir))), 4.0);
        col += uSunColor * glow * 0.08;
        gl_FragColor = vec4(col, 1.0);
      }
    `,
  });
}

function createShoreMask(seed: number): THREE.DataTexture {
  const n = 96;
  const data = new Uint8Array(n * n * 4);
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const x = Math.min(WORLD_SX - 1, Math.floor((i / (n - 1)) * WORLD_SX));
      const z = Math.min(WORLD_SZ - 1, Math.floor((j / (n - 1)) * WORLD_SZ));
      const h = heightAt(x, z, seed);
      const dry = h >= WATER_LEVEL;
      const foam = h >= WATER_LEVEL - 2 && h <= WATER_LEVEL + 1;
      const o = (j * n + i) * 4;
      data[o] = dry ? 255 : 0;
      data[o + 1] = foam ? 255 : 0;
      data[o + 2] = 0;
      data[o + 3] = 255;
    }
  }
  const tex = new THREE.DataTexture(data, n, n, THREE.RGBAFormat);
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.needsUpdate = true;
  tex.colorSpace = THREE.NoColorSpace;
  return tex;
}

function createWaterMat(
  time: { value: number },
  fogColor: { value: THREE.Color },
  fogNear: { value: number },
  fogFar: { value: number },
  mask: THREE.DataTexture,
): THREE.ShaderMaterial {
  const cx = WORLD_SX * 0.5;
  const cz = WORLD_SZ * 0.5;
  const half = WORLD_SX * 0.5;
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    toneMapped: false,
    uniforms: {
      uTime: time,
      uShallow: { value: color(WATER_SHALLOW) },
      uDeep: { value: color(WATER_DEEP) },
      uFoam: { value: color(WATER_FOAM) },
      uSunDir: { value: SUN_DIR.clone() },
      uSunColor: { value: color(SUN_COLOR) },
      uCenter: { value: new THREE.Vector2(cx, cz) },
      uInner: { value: ISLAND_CORE * half },
      uOuter: { value: ISLAND_SHORE * half },
      uFogColor: fogColor,
      uFogNear: fogNear,
      uFogFar: fogFar,
      uMask: { value: mask },
      uWorld: { value: new THREE.Vector2(WORLD_SX, WORLD_SZ) },
    },
    vertexShader: /* glsl */ `
      varying vec3 vWorld;
      void main() {
        vec4 w = modelMatrix * vec4(position, 1.0);
        vWorld = w.xyz;
        gl_Position = projectionMatrix * viewMatrix * w;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      uniform vec3 uShallow;
      uniform vec3 uDeep;
      uniform vec3 uFoam;
      uniform vec3 uSunDir;
      uniform vec3 uSunColor;
      uniform vec2 uCenter;
      uniform float uInner;
      uniform float uOuter;
      uniform vec3 uFogColor;
      uniform float uFogNear;
      uniform float uFogFar;
      uniform sampler2D uMask;
      uniform vec2 uWorld;
      varying vec3 vWorld;

      void main() {
        vec2 uv = vWorld.xz / uWorld;
        float inGrid = step(0.0, uv.x) * step(0.0, uv.y) * step(uv.x, 1.0) * step(uv.y, 1.0);
        vec4 mask = inGrid > 0.5 ? texture2D(uMask, uv) : vec4(0.0);
        if (mask.r > 0.15) discard;

        vec2 xz = vWorld.xz - uCenter;
        float dist = length(xz);
        float depth = mix(1.0 - mask.g, 1.0, 1.0 - inGrid);
        depth = max(depth, smoothstep(uInner * 0.9, uOuter * 2.4, dist));
        vec3 col = mix(uShallow, uDeep, clamp(depth, 0.0, 1.0));

        float w1 = sin(vWorld.x * 0.31 + uTime * 0.42);
        float w2 = sin(vWorld.z * 0.27 - uTime * 0.33);
        float w3 = sin((vWorld.x + vWorld.z) * 0.19 + uTime * 0.18);
        float waves = (w1 + w2) * 0.5 + w3 * 0.25;
        col += uSunColor * (0.05 + waves * 0.035);

        vec3 n = normalize(vec3(
          -cos(vWorld.x * 0.31 + uTime * 0.42) * 0.12,
          1.0,
          -cos(vWorld.z * 0.27 - uTime * 0.33) * 0.12
        ));
        vec3 view = normalize(cameraPosition - vWorld);
        vec3 halfV = normalize(normalize(uSunDir) + view);
        float spec = pow(max(0.0, dot(n, halfV)), 48.0);
        col += uSunColor * spec * 0.65;
        float fres = pow(1.0 - max(0.0, dot(n, view)), 3.0);
        col = mix(col, mix(uShallow, uSunColor, 0.35), fres * 0.28);

        float foam = mask.g * (0.55 + 0.45 * sin(vWorld.x * 1.7 + vWorld.z * 1.1 + uTime * 1.4));
        col = mix(col, uFoam, clamp(foam, 0.0, 1.0) * 0.85);

        float fogD = length(cameraPosition - vWorld);
        float fogF = smoothstep(uFogNear, uFogFar, fogD);
        col = mix(col, uFogColor, fogF);
        float alpha = mix(0.78, 0.92, clamp(depth, 0.0, 1.0));
        gl_FragColor = vec4(col, alpha);
      }
    `,
  });
}

function glowTexture(): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = 64;
  c.height = 64;
  const ctx = c.getContext("2d")!;
  const g = ctx.createRadialGradient(32, 32, 2, 32, 32, 32);
  g.addColorStop(0, "rgba(255, 236, 196, 0.7)");
  g.addColorStop(0.22, "rgba(255, 200, 120, 0.28)");
  g.addColorStop(1, "rgba(255, 180, 80, 0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function addSilhouettes(group: THREE.Group, seed: number) {
  const mat = new THREE.MeshLambertMaterial({
    color: 0x5c534c,
    fog: true,
  });
  const cx = WORLD_SX * 0.5;
  const cz = WORLD_SZ * 0.5;
  for (let i = 0; i < 5; i++) {
    const ang = (i / 5) * Math.PI * 2 + hash2(i, 3, seed) * 0.4;
    const dist = 78 + hash2(i, 9, seed) * 18;
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

export function createAtmosphere(seed: number): Atmosphere {
  const group = new THREE.Group();
  const time = { value: 0 };
  const fogColor = { value: color(FOG_COLOR) };
  const fogNear = { value: FOG_NEAR };
  const fogFar = { value: FOG_FAR };

  const sky = new THREE.Mesh(new THREE.SphereGeometry(160, 24, 16), createSkyMat());
  sky.frustumCulled = false;
  group.add(sky);

  const water = new THREE.Mesh(
    new THREE.PlaneGeometry(280, 280, 1, 1),
    createWaterMat(time, fogColor, fogNear, fogFar, createShoreMask(seed)),
  );
  water.rotation.x = -Math.PI / 2;
  water.position.set(WORLD_SX * 0.5, WATER_LEVEL + 0.14, WORLD_SZ * 0.5);
  water.renderOrder = 1;
  const waterMat = water.material as THREE.ShaderMaterial;
  waterMat.polygonOffset = true;
  waterMat.polygonOffsetFactor = -2;
  waterMat.polygonOffsetUnits = -2;
  group.add(water);

  const sunPos = SUN_DIR.clone().multiplyScalar(92);
  const sun = new THREE.Mesh(
    new THREE.SphereGeometry(3.2, 16, 16),
    new THREE.MeshBasicMaterial({ color: SUN_COLOR, fog: false, toneMapped: false }),
  );
  sun.position.copy(sunPos);
  group.add(sun);

  const glow = new THREE.Mesh(
    new THREE.PlaneGeometry(16, 16),
    new THREE.MeshBasicMaterial({
      map: glowTexture(),
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      fog: false,
      toneMapped: false,
    }),
  );
  glow.position.copy(sunPos);
  group.add(glow);

  addSilhouettes(group, seed);

  return { group, water, sky, sun, glow, time, fogColor, fogNear, fogFar, underwater: false };
}

export function tickAtmosphere(atmo: Atmosphere, camera: THREE.Camera, dt: number) {
  atmo.time.value += dt;
  atmo.sky.position.copy(camera.position);
  atmo.sun.position.copy(camera.position).addScaledVector(SUN_DIR, 92);
  atmo.glow.position.copy(atmo.sun.position);
  atmo.glow.quaternion.copy(camera.quaternion);
}

export function setUnderwater(atmo: Atmosphere, fog: THREE.Fog, scene: THREE.Scene, under: boolean) {
  if (atmo.underwater === under) return;
  atmo.underwater = under;
  if (under) {
    fog.color.set(UNDERWATER_FOG);
    fog.near = 2;
    fog.far = 16;
    atmo.fogColor.value.set(UNDERWATER_FOG);
    atmo.fogNear.value = 2;
    atmo.fogFar.value = 16;
    scene.background = new THREE.Color(UNDERWATER_FOG);
  } else {
    fog.color.set(FOG_COLOR);
    fog.near = FOG_NEAR;
    fog.far = FOG_FAR;
    atmo.fogColor.value.set(FOG_COLOR);
    atmo.fogNear.value = FOG_NEAR;
    atmo.fogFar.value = FOG_FAR;
    scene.background = new THREE.Color(FOG_COLOR);
  }
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
      disposeMat(mat);
    }
  });
}

function disposeMat(mat: THREE.Material) {
  const shader = mat as THREE.ShaderMaterial;
  const mask = shader.uniforms?.uMask?.value as THREE.Texture | undefined;
  mask?.dispose();
  const basic = mat as THREE.MeshBasicMaterial;
  basic.map?.dispose();
  mat.dispose();
}
