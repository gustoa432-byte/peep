import * as THREE from "three";
import { P2PRoom, type PeerInfo } from "@/lib/multiplayer";
import {
  createAvatar,
  createHeartMesh,
  createLocalArm,
  createPickaxe,
  PICKAXE_REST,
  paletteFor,
  poseLocalArm,
  setAvatarFace,
  swingAvatar,
} from "./avatar";
import { PeepAudio } from "./audio";
import {
  AIR,
  BLOCK_COLORS,
  BLOCK_PALETTE,
  CHUNK_S,
  EYE_HEIGHT,
  FOG_COLOR,
  FOG_FAR,
  FOG_NEAR,
  GRAVITY,
  HOTBAR_SLOTS,
  JUMP_SPEED,
  PLAYER_HEIGHT,
  PLAYER_RADIUS,
  WALK_SPEED,
  WATER_LEVEL,
  WORLD_SX,
  WORLD_SY,
  WORLD_SZ,
} from "./constants";
import {
  createAtmosphere,
  disposeAtmosphere,
  setUnderwater,
  tickAtmosphere,
  SUN_DIR,
  type Atmosphere,
} from "./atmosphere";
import { buildChunkGeometry, chunkCountX, chunkCountZ } from "./mesh";
import { voxelRaycast, type VoxelHit } from "./raycast";
import type { BlockEdit, EmoteKind, HudState, NetMsg, PresencePlayer } from "./types";
import { EMOTE_DURATION } from "./types";
import { VoxelWorld } from "./world";
import { applyEdit, heartbeat, listEdits, listPresence, resetWorld } from "./world.functions";

export type ControlsProbe = {
  getYaw: () => number;
  getSpeed: () => number;
  setKeys: (codes: string[]) => void;
  /** Same contract as the touch stick: +x strafes right, +z walks forward. */
  setAxis: (x: number, z: number) => void;
  getPosition: () => { x: number; y: number; z: number };
  /** Block currently under the crosshair, or null when nothing is in reach. */
  getTarget: () => { x: number; y: number; z: number } | null;
  getBlock: (x: number, y: number, z: number) => number;
  setLook: (yaw: number, pitch: number) => void;
  nudgeMesh: () => void;
  getPerf: () => {
    fps: number;
    meshMs: number;
    meshMsMax: number;
    drawCalls: number;
    triangles: number;
    /** Intended P2P payload over the last 10s (pos at 20 Hz), whether a peer is connected. */
    p2pBytes10s: number;
    firstFrameMs: number;
  };
};

declare global {
  interface Window {
    __controlsTest?: ControlsProbe;
    __peepReady?: boolean;
  }
}

type Remote = {
  id: string;
  group: THREE.Group;
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
  tx: number;
  ty: number;
  tz: number;
  tyaw: number;
  fromP2p: boolean;
  last: number;
  appear: number;
  emote: { kind: EmoteKind; age: number } | null;
};

type Particle = {
  mesh: THREE.Mesh;
  vx: number;
  vy: number;
  vz: number;
  life: number;
  maxLife: number;
  grav: number;
};

export type PeepGameOptions = {
  canvas: HTMLCanvasElement;
  worldId: string;
  seed: number;
  edits: BlockEdit[];
  /** World version at join — later polls ask for edits after this cursor. */
  cursor: number;
  generation: number;
  isCreator: boolean;
  playerId: string;
  onHud: (hud: HudState) => void;
  onLost: () => void;
};

const LOOK_SENS = 0.0022;
const PITCH_LIM = Math.PI / 2 - 0.04;

function createFilmGrain(): { mesh: THREE.Mesh; time: { value: number } } {
  const time = { value: 0 };
  const geo = new THREE.BufferGeometry();
  geo.setAttribute(
    "position",
    new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3),
  );
  const mat = new THREE.ShaderMaterial({
    depthTest: false,
    depthWrite: false,
    transparent: true,
    blending: THREE.NormalBlending,
    uniforms: { uTime: time },
    vertexShader: "void main() { gl_Position = vec4(position.xy, 0.0, 1.0); }",
    fragmentShader: `
      uniform float uTime;
      void main() {
        vec2 uv = gl_FragCoord.xy;
        float t = fract(uTime * 19.13);
        float n = fract(sin(dot(uv + t * 113.0, vec2(12.9898, 78.233))) * 43758.5453);
        float n2 = fract(sin(dot(uv * 0.27 - t * 47.0, vec2(39.346, 11.135))) * 23421.63);
        float g = (n * 0.7 + n2 * 0.3) - 0.5;
        gl_FragColor = vec4(vec3(0.62 + g * 0.9), 0.078);
      }
    `,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = 40;
  return { mesh, time };
}

export class PeepGame {
  private readonly opts: PeepGameOptions;
  private readonly world: VoxelWorld;
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly overlayScene = new THREE.Scene();
  private readonly camera: THREE.PerspectiveCamera;
  private readonly overlayCam: THREE.PerspectiveCamera;
  private readonly terrain = new THREE.Group();
  private readonly chunkMeshes = new Map<string, THREE.Mesh>();
  private readonly material: THREE.MeshLambertMaterial;
  private readonly atmo: Atmosphere;
  private readonly fog: THREE.Fog;
  private readonly highlight: THREE.LineSegments;
  private readonly pickaxe: THREE.Group;
  private readonly localArm: THREE.Group;
  private readonly grainMesh: THREE.Mesh;
  private readonly grainTime: { value: number };
  private readonly audio = new PeepAudio();
  private readonly p2p: P2PRoom;
  private readonly remotes = new Map<string, Remote>();
  private readonly particles: Particle[] = [];
  private readonly dirtyChunks = new Set<string>();
  private readonly keys = new Set<string>();
  private keyOverride: Set<string> | null = null;
  private disposed = false;
  private playing = false;
  private pointerLocked = false;
  private dragging = false;
  private ptrStartX = 0;
  private ptrStartY = 0;
  private ptrMoved = false;
  private tapSlop = 6;
  private lastPtrX = 0;
  private lastPtrY = 0;
  private ptrButton = 0;
  private last = performance.now();
  private acc = 0;
  private yaw = 0;
  private pitch = 0;
  private pos = new THREE.Vector3();
  private vel = new THREE.Vector3();
  private onGround = false;
  /** Touch stick axis: +x strafes right, +z walks forward. Additive with WASD. */
  private moveX = 0;
  private moveZ = 0;
  private selected = 0;
  private hit: VoxelHit | null = null;
  private swing = 0;
  private bob = 0;
  private peerConnected = false;
  private peerCount = 1;
  private lastBroadcast = 0;
  private lastHeartbeat = 0;
  private lastPoll = 0;
  private bornAt = performance.now();
  private fpsEma = 0;
  private lastMeshMs = 0;
  private maxMeshMs = 0;
  private firstFrameMs = 0;
  private drawCalls = 0;
  private triangles = 0;
  private p2pOut: { t: number; n: number }[] = [];
  private editCursor = 0;
  private generation = 0;
  private failStreak = 0;
  private hudDirty = true;
  private emote: { kind: EmoteKind; age: number } | null = null;
  private camRoll = 0;
  private camPitchOff = 0;
  private camYawOff = 0;
  private stepAcc = 0;
  private resizeObs: ResizeObserver | null = null;
  private lookX = 0;
  private lookY = 0;
  private lookZ = -1;
  private anim = 0;
  private tmpFwd = new THREE.Vector3();

  constructor(opts: PeepGameOptions) {
    this.opts = opts;
    this.editCursor = opts.cursor;
    this.generation = opts.generation;
    this.world = new VoxelWorld(opts.seed, opts.edits);
    const spawn = this.world.spawn();
    this.pos.set(spawn.x, spawn.y, spawn.z);
    this.yaw = Math.atan2(-SUN_DIR.x, -SUN_DIR.z);
    this.pitch = -0.28;

    this.material = new THREE.MeshLambertMaterial({
      vertexColors: true,
      color: 0xffffff,
    });
    this.material.customProgramCacheKey = () => "peep-clay-v9";
    this.material.onBeforeCompile = (shader) => {
      shader.uniforms.uPeepTime = this.grainTime;
      shader.vertexShader = `attribute float peepKind;\nvarying float vKind;\nvarying vec3 vPeepW;\nvarying vec3 vPeepN;\n${shader.vertexShader}`
        .replace(
          "#include <beginnormal_vertex>",
          `#include <beginnormal_vertex>
vPeepN = objectNormal;
vKind = peepKind;`,
        )
        .replace(
          "#include <worldpos_vertex>",
          `#include <worldpos_vertex>
vPeepW = (modelMatrix * vec4(transformed, 1.0)).xyz;`,
        );
      const clay = `
float kind = floor(vKind + 0.1);
float grass = step(0.5, kind) * (1.0 - step(1.5, kind));
float dirt = step(1.5, kind) * (1.0 - step(2.5, kind));
float stone = step(2.5, kind) * (1.0 - step(3.5, kind));
float wood = step(3.5, kind) * (1.0 - step(4.5, kind));
float sand = step(4.5, kind) * (1.0 - step(5.5, kind));
float leaf = step(5.5, kind) * (1.0 - step(6.5, kind));
float nSoft = fract(sin(dot(vPeepW * 0.37, vec3(12.9898, 78.233, 37.719))) * 43758.5453);
float nFine = fract(sin(dot(vPeepW * 1.05, vec3(91.13, 17.42, 53.1))) * 9123.12);
float top = smoothstep(0.55, 0.95, vPeepN.y);
float bot = smoothstep(0.55, 0.95, -vPeepN.y);
float side = 1.0 - top - bot;
float fy = fract(vPeepW.y);
diffuseColor.rgb += grass * top * (nSoft - 0.5) * vec3(0.035, 0.055, 0.018);
float rim = smoothstep(0.64, 0.88, fy);
vec3 soil = vec3(0.46, 0.29, 0.16);
vec3 sod = vec3(0.30, 0.64, 0.23);
diffuseColor.rgb = mix(diffuseColor.rgb, mix(soil, sod, rim), grass * side);
diffuseColor.rgb = mix(diffuseColor.rgb, soil * (0.94 + nSoft * 0.06), grass * bot);
diffuseColor.rgb += dirt * (nSoft - 0.5) * vec3(0.05, 0.025, 0.012);
float stoneHard = (nFine - 0.5) * 0.06;
diffuseColor.rgb += stone * stoneHard * vec3(0.05, 0.06, 0.08);
diffuseColor.rgb *= 1.0 - stone * 0.04;
vec2 mid = fract(vPeepW.xz) - 0.5;
float rings = sin(length(mid) * 34.0 + nSoft * 2.0);
float fiberAxis = abs(vPeepN.x) > 0.5 ? vPeepW.z : vPeepW.x;
float fiber = sin(fiberAxis * 22.0 + vPeepW.y * 0.35);
diffuseColor.rgb *= 1.0 - wood * (top + bot) * rings * 0.18;
diffuseColor.rgb *= 1.0 - wood * side * fiber * 0.12;
diffuseColor.rgb += wood * (top + bot) * vec3(0.05, 0.025, 0.008);
diffuseColor.rgb += sand * (nSoft - 0.5) * vec3(0.04, 0.032, 0.012);
diffuseColor.rgb += leaf * (nSoft - 0.5) * vec3(0.04, 0.08, 0.02);
float film = fract(sin(dot(gl_FragCoord.xy + fract(uPeepTime * 19.13) * 97.0, vec2(12.9898, 78.233))) * 43758.5453);
diffuseColor.rgb += (film - 0.5) * 0.02;
`;
      shader.fragmentShader = `uniform float uPeepTime;\nvarying float vKind;\nvarying vec3 vPeepW;\nvarying vec3 vPeepN;\n${shader.fragmentShader}`
        .replace(
          "#include <color_fragment>",
          `#include <color_fragment>
${clay}`,
        )
        .replace(
          "diffuseColor *= vColor;",
          `diffuseColor *= vColor;
${clay}`,
        );
    };

    this.camera = new THREE.PerspectiveCamera(75, 1, 0.08, 220);
    this.camera.rotation.order = "YXZ";
    this.overlayCam = new THREE.PerspectiveCamera(60, 1, 0.05, 10);
    this.overlayCam.position.set(0, 0, 0);

    this.renderer = new THREE.WebGLRenderer({
      canvas: opts.canvas,
      antialias: false,
      alpha: false,
      powerPreference: "high-performance",
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.autoClear = false;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.NeutralToneMapping;
    this.renderer.toneMappingExposure = 1.12;

    this.fog = new THREE.Fog(FOG_COLOR, FOG_NEAR, FOG_FAR);
    this.scene.background = new THREE.Color(FOG_COLOR);
    this.scene.fog = this.fog;
    this.scene.add(this.terrain);

    this.scene.add(new THREE.AmbientLight(0xffead2, 0.42));
    const hemi = new THREE.HemisphereLight(0xfff1dc, 0x7a8478, 0.95);
    const sun = new THREE.DirectionalLight(0xffd09a, 0.95);
    sun.position.copy(SUN_DIR).multiplyScalar(40);
    this.scene.add(hemi, sun);

    this.atmo = createAtmosphere(opts.seed);
    this.scene.add(this.atmo.group);

    this.rebuildAllChunks();

    const hiGeo = new THREE.EdgesGeometry(new THREE.BoxGeometry(1.02, 1.02, 1.02));
    this.highlight = new THREE.LineSegments(
      hiGeo,
      new THREE.LineBasicMaterial({ color: 0x1a1612, transparent: true, opacity: 0.7 }),
    );
    this.highlight.visible = false;
    this.scene.add(this.highlight);

    this.pickaxe = createPickaxe();
    this.localArm = createLocalArm();
    const grain = createFilmGrain();
    this.grainMesh = grain.mesh;
    this.grainTime = grain.time;
    this.overlayScene.add(this.pickaxe);
    this.overlayScene.add(this.localArm);
    this.overlayScene.add(this.grainMesh);
    this.overlayScene.add(new THREE.AmbientLight(0xffffff, 0.9));
    const vl = new THREE.DirectionalLight(0xfff4e5, 0.6);
    vl.position.set(1, 2, 1);
    this.overlayScene.add(vl);

    this.p2p = new P2PRoom({
      room: opts.worldId,
      selfId: opts.playerId,
      name: "peep",
      onPeersChanged: (peers) => this.onPeers(peers),
      onMessage: (from, data, channel) => this.onNet(from, data, channel),
      onConnected: () => {
        this.hudDirty = true;
      },
    });
    void this.p2p.join();

    this.bind();
    this.resize();
    this.emitHud();
    this.renderer.setAnimationLoop(() => this.frame());

    if (import.meta.env.DEV || new URLSearchParams(location.search).has("qa")) {
      window.__controlsTest = {
        getYaw: () => this.yaw,
        getSpeed: () => Math.hypot(this.vel.x, this.vel.z),
        setKeys: (codes) => {
          this.keyOverride = new Set(codes);
        },
        setAxis: (x, z) => this.setMoveAxis(x, z),
        getPosition: () => ({ x: this.pos.x, y: this.pos.y, z: this.pos.z }),
        getTarget: () => (this.hit ? { x: this.hit.x, y: this.hit.y, z: this.hit.z } : null),
        getBlock: (x, y, z) => this.world.get(x, y, z),
        setLook: (yaw, pitch) => {
          this.yaw = yaw;
          this.pitch = Math.max(-PITCH_LIM, Math.min(PITCH_LIM, pitch));
        },
        nudgeMesh: () => {
          this.rebuildAround(Math.floor(this.pos.x), Math.floor(this.pos.z));
        },
        getPerf: () => ({
          fps: Math.round(this.fpsEma),
          meshMs: this.lastMeshMs,
          meshMsMax: this.maxMeshMs,
          drawCalls: this.drawCalls,
          triangles: this.triangles,
          p2pBytes10s: this.p2pBytes10s(),
          firstFrameMs: this.firstFrameMs,
        }),
      };
    }
    window.__peepReady = true;
  }

  startPlaying() {
    this.playing = true;
    this.audio.unlock();
    this.audio.startAmbient();
    this.tryLock();
    this.hudDirty = true;
  }

  breakTarget() {
    if (!this.playing) return;
    this.breakBlock();
  }

  placeTarget() {
    if (!this.playing) return;
    this.placeBlock();
  }

  jump() {
    if (!this.playing) return;
    if (this.onGround) {
      this.vel.y = JUMP_SPEED;
      this.onGround = false;
      this.audio.jump();
    }
  }

  playEmote(kind: EmoteKind) {
    if (!this.playing) return;
    this.emote = { kind, age: 0 };
    this.audio.emote(kind);
    this.p2p.send({ t: "emote", kind } satisfies NetMsg);
    if (kind === "hearts") this.spawnOverlayHearts();
  }

  /**
   * Touch stick input, in the same frame of reference as WASD: +x strafes
   * right, +z walks forward. Values outside the unit circle are clamped, so a
   * stick pinned to its rim can never outrun the keyboard.
   */
  setMoveAxis(x: number, z: number) {
    const len = Math.hypot(x, z);
    if (len > 1) {
      x /= len;
      z /= len;
    }
    this.moveX = x;
    this.moveZ = z;
  }

  setSelected(i: number) {
    if (i < 0 || i >= HOTBAR_SLOTS) return;
    this.selected = i;
    this.hudDirty = true;
  }

  dispose() {
    this.disposed = true;
    this.renderer.setAnimationLoop(null);
    this.unbind();
    this.p2p.close();
    for (const mesh of this.chunkMeshes.values()) {
      mesh.geometry.dispose();
    }
    this.material.dispose();
    this.grainMesh.geometry.dispose();
    (this.grainMesh.material as THREE.Material).dispose();
    this.audio.dispose();
    disposeAtmosphere(this.atmo);
    this.highlight.geometry.dispose();
    (this.highlight.material as THREE.Material).dispose();
    this.renderer.dispose();
    this.resizeObs?.disconnect();
    if (window.__controlsTest) delete window.__controlsTest;
    window.__peepReady = false;
  }

  private bind() {
    const c = this.opts.canvas;
    this.onKeyDown = this.onKeyDown.bind(this);
    this.onKeyUp = this.onKeyUp.bind(this);
    this.onMouseMove = this.onMouseMove.bind(this);
    this.onPointerDown = this.onPointerDown.bind(this);
    this.onPointerUp = this.onPointerUp.bind(this);
    this.onPointerMove = this.onPointerMove.bind(this);
    this.onContext = this.onContext.bind(this);
    this.onWheel = this.onWheel.bind(this);
    this.onBlur = this.onBlur.bind(this);
    this.onLock = this.onLock.bind(this);
    window.addEventListener("keydown", this.onKeyDown);
    window.addEventListener("keyup", this.onKeyUp);
    window.addEventListener("blur", this.onBlur);
    document.addEventListener("pointerlockchange", this.onLock);
    c.addEventListener("mousemove", this.onMouseMove);
    c.addEventListener("pointerdown", this.onPointerDown);
    window.addEventListener("pointerup", this.onPointerUp);
    c.addEventListener("pointermove", this.onPointerMove);
    c.addEventListener("contextmenu", this.onContext);
    c.addEventListener("wheel", this.onWheel, { passive: true });
    this.resizeObs = new ResizeObserver(() => this.resize());
    this.resizeObs.observe(c.parentElement ?? c);
  }

  private unbind() {
    const c = this.opts.canvas;
    window.removeEventListener("keydown", this.onKeyDown);
    window.removeEventListener("keyup", this.onKeyUp);
    window.removeEventListener("blur", this.onBlur);
    document.removeEventListener("pointerlockchange", this.onLock);
    c.removeEventListener("mousemove", this.onMouseMove);
    c.removeEventListener("pointerdown", this.onPointerDown);
    window.removeEventListener("pointerup", this.onPointerUp);
    c.removeEventListener("pointermove", this.onPointerMove);
    c.removeEventListener("contextmenu", this.onContext);
    c.removeEventListener("wheel", this.onWheel);
  }

  private onKeyDown(e: KeyboardEvent) {
    if (e.repeat && e.code.startsWith("Digit")) return;
    if (e.code >= "Digit1" && e.code <= "Digit9") {
      this.setSelected(Number(e.code.slice(5)) - 1);
      return;
    }
    if (e.code === "KeyE") {
      this.playEmote("wave");
      return;
    }
    if (e.code === "KeyR") {
      this.playEmote("hearts");
      return;
    }
    if (e.code === "KeyT") {
      this.playEmote("laugh");
      return;
    }
    this.keys.add(e.code);
    if (["KeyW", "KeyA", "KeyS", "KeyD", "Space"].includes(e.code)) e.preventDefault();
  }

  private onKeyUp(e: KeyboardEvent) {
    this.keys.delete(e.code);
  }

  private onBlur() {
    this.keys.clear();
    this.dragging = false;
    // A backgrounded tab never delivers pointerup for the stick: releasing the
    // axis here stops the player walking into the sea while the phone is away.
    this.moveX = 0;
    this.moveZ = 0;
  }

  private onLock() {
    this.pointerLocked = document.pointerLockElement === this.opts.canvas;
    this.hudDirty = true;
  }

  private onMouseMove(e: MouseEvent) {
    if (!this.playing || !this.pointerLocked) return;
    this.yaw -= e.movementX * LOOK_SENS;
    this.pitch -= e.movementY * LOOK_SENS;
    this.pitch = Math.max(-PITCH_LIM, Math.min(PITCH_LIM, this.pitch));
  }

  private lookDelta(dx: number, dy: number) {
    this.yaw -= dx * LOOK_SENS;
    this.pitch -= dy * LOOK_SENS;
    this.pitch = Math.max(-PITCH_LIM, Math.min(PITCH_LIM, this.pitch));
  }

  private onPointerDown(e: PointerEvent) {
    if (!this.playing) return;
    if (e.button > 2) return;
    this.ptrButton = e.button;
    this.ptrStartX = e.clientX;
    this.ptrStartY = e.clientY;
    this.lastPtrX = e.clientX;
    this.lastPtrY = e.clientY;
    this.ptrMoved = false;
    // A finger wobbles far more than a mouse: 6px would turn most taps into
    // camera drags and swallow the tap-to-break.
    this.tapSlop = e.pointerType === "touch" ? 14 : 6;
    if (this.pointerLocked) {
      if (e.button === 0) this.breakBlock();
      if (e.button === 2) this.placeBlock();
      return;
    }
    this.dragging = true;
    try {
      this.opts.canvas.setPointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
  }

  private onPointerMove(e: PointerEvent) {
    if (!this.playing || this.pointerLocked || !this.dragging) return;
    const dx = e.clientX - this.lastPtrX;
    const dy = e.clientY - this.lastPtrY;
    this.lastPtrX = e.clientX;
    this.lastPtrY = e.clientY;
    if (Math.hypot(e.clientX - this.ptrStartX, e.clientY - this.ptrStartY) > this.tapSlop) {
      this.ptrMoved = true;
    }
    this.lookDelta(dx, dy);
  }

  private onPointerUp(e: PointerEvent) {
    if (!this.dragging) {
      this.dragging = false;
      return;
    }
    this.dragging = false;
    if (this.pointerLocked || !this.playing) return;
    if (this.ptrMoved) return;
    if (this.ptrButton === 0) this.breakBlock();
    if (this.ptrButton === 2) this.placeBlock();
    void e;
  }

  private onContext(e: Event) {
    e.preventDefault();
  }

  private onWheel(e: WheelEvent) {
    if (!this.playing) return;
    const dir = e.deltaY > 0 ? 1 : -1;
    this.setSelected((this.selected + dir + HOTBAR_SLOTS) % HOTBAR_SLOTS);
  }

  /**
   * Pointer lock is a bonus, never a requirement: drag-to-look is the fallback
   * and it is the only path on touch. Every attempt therefore has to swallow
   * both a synchronous throw and a rejected promise — inside an iframe (the
   * Grok preview) the request raises WrongDocumentError, and without a real
   * user gesture it rejects with NotAllowedError. An unhandled one of those is
   * a console error on every single session.
   */
  private tryLock() {
    const el = this.opts.canvas;
    const attempt = (opts?: { unadjustedMovement?: boolean }): boolean => {
      const req = el.requestPointerLock as (
        o?: { unadjustedMovement?: boolean },
      ) => Promise<void> | void;
      try {
        const p = opts ? req.call(el, opts) : req.call(el);
        if (p && typeof (p as Promise<void>).catch === "function") {
          void (p as Promise<void>).catch(() => {
            if (opts) attempt();
          });
        }
        return true;
      } catch {
        return false;
      }
    };
    if (!attempt({ unadjustedMovement: true })) attempt();
  }

  private held(code: string): boolean {
    return (this.keyOverride ?? this.keys).has(code);
  }

  private resize() {
    const parent = this.opts.canvas.parentElement ?? this.opts.canvas;
    const w = Math.max(1, parent.clientWidth);
    const h = Math.max(1, parent.clientHeight);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.overlayCam.aspect = Math.max(w / h, 1.2);
    this.overlayCam.fov = 50;
    this.overlayCam.updateProjectionMatrix();
    this.renderer.setSize(w, h, false);
  }

  private rebuildAllChunks() {
    for (let cz = 0; cz < chunkCountZ(); cz++) {
      for (let cx = 0; cx < chunkCountX(); cx++) this.rebuildChunk(cx, cz);
    }
  }

  private rebuildChunk(cx: number, cz: number) {
    const key = `${cx},${cz}`;
    const old = this.chunkMeshes.get(key);
    if (old) {
      this.terrain.remove(old);
      old.geometry.dispose();
    }
    const geo = buildChunkGeometry(this.world, cx, cz);
    const mesh = new THREE.Mesh(geo, this.material);
    this.terrain.add(mesh);
    this.chunkMeshes.set(key, mesh);
  }

  private markDirty(cx: number, cz: number) {
    if (cx < 0 || cz < 0 || cx >= chunkCountX() || cz >= chunkCountZ()) return;
    this.dirtyChunks.add(`${cx},${cz}`);
  }

  private rebuildAround(x: number, z: number) {
    const cx = Math.floor(x / CHUNK_S);
    const cz = Math.floor(z / CHUNK_S);
    this.markDirty(cx, cz);
    const lx = ((x % CHUNK_S) + CHUNK_S) % CHUNK_S;
    const lz = ((z % CHUNK_S) + CHUNK_S) % CHUNK_S;
    if (lx === 0) this.markDirty(cx - 1, cz);
    if (lx === CHUNK_S - 1) this.markDirty(cx + 1, cz);
    if (lz === 0) this.markDirty(cx, cz - 1);
    if (lz === CHUNK_S - 1) this.markDirty(cx, cz + 1);
  }

  /** At most one rebuild per dirty chunk per frame — mid-Android freeze otherwise. */
  private flushDirty() {
    if (this.dirtyChunks.size === 0) return;
    const t0 = performance.now();
    for (const key of this.dirtyChunks) {
      const comma = key.indexOf(",");
      const cx = Number(key.slice(0, comma));
      const cz = Number(key.slice(comma + 1));
      this.rebuildChunk(cx, cz);
    }
    this.dirtyChunks.clear();
    this.lastMeshMs = performance.now() - t0;
    if (this.lastMeshMs > this.maxMeshMs) this.maxMeshMs = this.lastMeshMs;
  }

  private frame() {
    if (this.disposed) return;
    const now = performance.now();
    const dt = Math.min((now - this.last) / 1000, 0.1);
    this.last = now;
    if (!this.firstFrameMs) this.firstFrameMs = now - this.bornAt;
    if (dt > 0.0001) this.fpsEma = this.fpsEma ? this.fpsEma * 0.9 + (1 / dt) * 0.1 : 1 / dt;
    this.acc += dt;
    const step = 1 / 60;
    while (this.acc >= step) {
      this.fixed(step);
      this.acc -= step;
    }
    this.anim += dt;
    this.updateCamera(dt);
    tickAtmosphere(this.atmo, this.camera, dt);
    setUnderwater(
      this.atmo,
      this.fog,
      this.scene,
      this.camera.position.y < WATER_LEVEL - 0.05,
    );
    this.updateRemotes(dt);
    this.updateEmote(dt);
    this.updateParticles(dt);
    this.updatePickaxe(dt);
    this.grainTime.value = this.anim;
    this.audio.tickAmbient(dt);
    this.updateHighlight();
    this.netTick(now);
    this.flushDirty();
    if (this.hudDirty) this.emitHud();

    this.renderer.clear();
    this.renderer.render(this.scene, this.camera);
    this.renderer.clearDepth();
    this.renderer.render(this.overlayScene, this.overlayCam);
    const info = this.renderer.info.render;
    this.drawCalls = info.calls;
    this.triangles = info.triangles;
  }

  private fixed(dt: number) {
    if (!this.playing) {
      this.vel.x *= 0.7;
      this.vel.z *= 0.7;
      this.vel.y -= GRAVITY * dt;
      this.collide(dt);
      return;
    }

    // Yaw 0 looks down -Z, so forward is (-sin, -cos) and right is (cos, -sin).
    // Keep the pair in this order: swapping it is what inverts A/D.
    const fwdX = -Math.sin(this.yaw);
    const fwdZ = -Math.cos(this.yaw);
    const rightX = Math.cos(this.yaw);
    const rightZ = -Math.sin(this.yaw);

    // Keyboard is digital, the stick is analog; both write the same two
    // scalars so movement has exactly one code path.
    let fwd = 0;
    let strafe = 0;
    if (this.held("KeyW") || this.held("ArrowUp")) fwd += 1;
    if (this.held("KeyS") || this.held("ArrowDown")) fwd -= 1;
    if (this.held("KeyD") || this.held("ArrowRight")) strafe += 1;
    if (this.held("KeyA") || this.held("ArrowLeft")) strafe -= 1;
    fwd += this.moveZ;
    strafe += this.moveX;

    const mag = Math.hypot(fwd, strafe);
    if (mag > 1) {
      fwd /= mag;
      strafe /= mag;
    }

    this.vel.x = (fwdX * fwd + rightX * strafe) * WALK_SPEED;
    this.vel.z = (fwdZ * fwd + rightZ * strafe) * WALK_SPEED;
    this.vel.y -= GRAVITY * dt;
    const wasGround = this.onGround;
    const fallSpeed = this.vel.y;
    if (this.onGround && this.held("Space")) this.jump();
    this.collide(dt);
    if (!wasGround && this.onGround && fallSpeed < -3) this.audio.land(this.groundBlock());
    if (this.pos.y < -6) {
      const s = this.world.spawn();
      this.pos.set(s.x, s.y, s.z);
      this.vel.set(0, 0, 0);
    }
    const moving = mag > 0.05 && this.onGround;
    this.bob += moving ? dt * 8 : -this.bob * dt * 6;
    if (moving) {
      this.stepAcc += Math.hypot(this.vel.x, this.vel.z) * dt;
      if (this.stepAcc >= 1.35) {
        this.stepAcc = 0;
        this.audio.footstep(this.groundBlock());
      }
    } else {
      this.stepAcc = 0.7;
    }
  }

  private groundBlock(): number {
    const x = Math.floor(this.pos.x);
    const y = Math.floor(this.pos.y - 0.05);
    const z = Math.floor(this.pos.z);
    const b = this.world.get(x, y, z);
    return b === 0 ? this.world.get(x, y - 1, z) : b;
  }

  private collide(dt: number) {
    this.onGround = false;
    this.pos.x += this.vel.x * dt;
    this.resolveAxis("x");
    this.pos.z += this.vel.z * dt;
    this.resolveAxis("z");
    this.pos.y += this.vel.y * dt;
    this.resolveAxis("y");
  }

  private resolveAxis(axis: "x" | "y" | "z") {
    const r = PLAYER_RADIUS;
    const h = PLAYER_HEIGHT;
    const minX = Math.floor(this.pos.x - r);
    const maxX = Math.floor(this.pos.x + r);
    const minY = Math.floor(this.pos.y);
    const maxY = Math.floor(this.pos.y + h - 0.01);
    const minZ = Math.floor(this.pos.z - r);
    const maxZ = Math.floor(this.pos.z + r);
    for (let y = minY; y <= maxY; y++) {
      for (let z = minZ; z <= maxZ; z++) {
        for (let x = minX; x <= maxX; x++) {
          if (!this.world.isSolid(x, y, z)) continue;
          const nx0 = x;
          const nx1 = x + 1;
          const ny0 = y;
          const ny1 = y + 1;
          const nz0 = z;
          const nz1 = z + 1;
          const px0 = this.pos.x - r;
          const px1 = this.pos.x + r;
          const py0 = this.pos.y;
          const py1 = this.pos.y + h;
          const pz0 = this.pos.z - r;
          const pz1 = this.pos.z + r;
          if (px1 <= nx0 || px0 >= nx1 || py1 <= ny0 || py0 >= ny1 || pz1 <= nz0 || pz0 >= nz1) continue;
          if (axis === "x") {
            if (this.vel.x > 0) this.pos.x = nx0 - r;
            else this.pos.x = nx1 + r;
            this.vel.x = 0;
          } else if (axis === "z") {
            if (this.vel.z > 0) this.pos.z = nz0 - r;
            else this.pos.z = nz1 + r;
            this.vel.z = 0;
          } else {
            if (this.vel.y > 0) {
              this.pos.y = ny0 - h;
              this.vel.y = 0;
            } else {
              this.pos.y = ny1;
              this.vel.y = 0;
              this.onGround = true;
            }
          }
        }
      }
    }
    this.pos.x = Math.max(r, Math.min(WORLD_SX - r, this.pos.x));
    this.pos.z = Math.max(r, Math.min(WORLD_SZ - r, this.pos.z));
    this.pos.y = Math.max(1, Math.min(WORLD_SY + 8, this.pos.y));
  }

  private updateCamera(dt: number) {
    this.camRoll *= Math.pow(0.08, dt);
    this.camPitchOff *= Math.pow(0.08, dt);
    this.camYawOff *= Math.pow(0.08, dt);
    if (this.emote) {
      const u = this.emote.age / EMOTE_DURATION;
      const fade = u < 0.12 ? u / 0.12 : u > 0.8 ? (1 - u) / 0.2 : 1;
      if (this.emote.kind === "hearts") {
        this.camYawOff = Math.sin(this.emote.age * 3.2) * 0.045 * fade;
        this.camPitchOff = Math.cos(this.emote.age * 2.4) * 0.03 * fade;
      } else if (this.emote.kind === "laugh") {
        this.camRoll = Math.sin(this.emote.age * 18) * 0.05 * fade;
        this.camPitchOff = Math.sin(this.emote.age * 22) * 0.028 * fade;
      }
    }
    const bobY = Math.sin(this.bob) * 0.04;
    this.camera.position.set(this.pos.x, this.pos.y + EYE_HEIGHT + bobY, this.pos.z);
    this.camera.rotation.set(this.pitch + this.camPitchOff, this.yaw + this.camYawOff, this.camRoll);
    this.camera.getWorldDirection(this.tmpFwd);
    this.lookX = this.tmpFwd.x;
    this.lookY = this.tmpFwd.y;
    this.lookZ = this.tmpFwd.z;
  }

  private updateHighlight() {
    const hit = this.playing
      ? voxelRaycast(
          this.world,
          this.camera.position.x,
          this.camera.position.y,
          this.camera.position.z,
          this.lookX,
          this.lookY,
          this.lookZ,
        )
      : null;
    this.hit = hit;
    if (!hit) {
      this.highlight.visible = false;
      return;
    }
    this.highlight.visible = true;
    this.highlight.position.set(hit.x + 0.5, hit.y + 0.5, hit.z + 0.5);
  }

  private updatePickaxe(dt: number) {
    if (this.swing > 0) this.swing = Math.max(0, this.swing - dt * 6);
    const waving = this.emote?.kind === "wave";
    this.pickaxe.visible = !waving;
    if (waving) return;
    const s = Math.sin(this.swing * Math.PI);
    const bob = Math.sin(this.bob) * 0.018;
    this.pickaxe.rotation.x = PICKAXE_REST.rx - s * 0.9;
    this.pickaxe.rotation.y = PICKAXE_REST.ry + s * 0.1;
    this.pickaxe.rotation.z = PICKAXE_REST.rz - s * 0.42;
    this.pickaxe.position.set(
      PICKAXE_REST.x - s * 0.05,
      PICKAXE_REST.y - s * 0.1 + bob,
      PICKAXE_REST.z - s * 0.04,
    );
  }

  private currentBlock(): number {
    return BLOCK_PALETTE[this.selected] ?? AIR;
  }

  private overlapsPlayer(x: number, y: number, z: number): boolean {
    const r = PLAYER_RADIUS + 0.05;
    const px0 = this.pos.x - r;
    const px1 = this.pos.x + r;
    const py0 = this.pos.y;
    const py1 = this.pos.y + PLAYER_HEIGHT;
    const pz0 = this.pos.z - r;
    const pz1 = this.pos.z + r;
    return px1 > x && px0 < x + 1 && py1 > y && py0 < y + 1 && pz1 > z && pz0 < z + 1;
  }

  private applyLocal(x: number, y: number, z: number, block: number, sync: boolean) {
    const prev = this.world.get(x, y, z);
    if (prev === block) return;
    if (!this.world.set(x, y, z, block)) return;
    this.rebuildAround(x, z);
    if (block === AIR) this.burst(x, y, z, prev);
    if (sync) {
      this.p2p.send({ t: "block", x, y, z, block } satisfies NetMsg);
      void applyEdit({
        data: {
          worldId: this.opts.worldId,
          playerId: this.opts.playerId,
          x,
          y,
          z,
          block,
        },
      })
        .then((r) => {
          if (!r.ok) {
            this.world.set(x, y, z, prev);
            this.rebuildAround(x, z);
            this.p2p.send({ t: "block", x, y, z, block: prev } satisfies NetMsg);
            return;
          }
          this.failStreak = 0;
          if (r.cursor > this.editCursor) this.editCursor = r.cursor;
        })
        .catch(() => {
          this.failStreak += 1;
          if (this.failStreak > 8) this.opts.onLost();
        });
    }
  }

  private breakBlock() {
    if (!this.hit) return;
    const { x, y, z } = this.hit;
    const prev = this.world.get(x, y, z);
    if (prev === AIR) return;
    this.applyLocal(x, y, z, AIR, true);
    this.audio.break(prev);
    this.audio.pickup();
    this.swing = 1;
  }

  private placeBlock() {
    if (!this.hit) return;
    const block = this.currentBlock();
    if (block === AIR) return;
    const x = this.hit.x + this.hit.nx;
    const y = this.hit.y + this.hit.ny;
    const z = this.hit.z + this.hit.nz;
    if (this.world.get(x, y, z) !== AIR) return;
    if (this.overlapsPlayer(x, y, z)) return;
    this.applyLocal(x, y, z, block, true);
    this.audio.place(block);
    this.swing = 0.6;
  }

  private burst(x: number, y: number, z: number, block: number) {
    const color = BLOCK_COLORS[block] ?? 0x888888;
    for (let i = 0; i < 8; i++) {
      const mat = new THREE.MeshLambertMaterial({ color });
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.12, 0.12), mat);
      mesh.position.set(x + 0.5, y + 0.5, z + 0.5);
      this.scene.add(mesh);
      this.particles.push({
        mesh,
        vx: (Math.random() - 0.5) * 3,
        vy: Math.random() * 3 + 1,
        vz: (Math.random() - 0.5) * 3,
        life: 0.5 + Math.random() * 0.3,
        maxLife: 0.8,
        grav: GRAVITY,
      });
    }
  }

  private updateParticles(dt: number) {
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i]!;
      p.life -= dt;
      p.vy -= p.grav * dt;
      p.mesh.position.x += p.vx * dt;
      p.mesh.position.y += p.vy * dt;
      p.mesh.position.z += p.vz * dt;
      p.mesh.rotation.x += dt * 4;
      const mat = p.mesh.material as THREE.Material;
      if ("opacity" in mat && p.maxLife > 0) {
        (mat as THREE.Material & { opacity: number }).opacity = Math.max(0, p.life / p.maxLife);
      }
      if (p.life <= 0) {
        this.scene.remove(p.mesh);
        p.mesh.geometry.dispose();
        (p.mesh.material as THREE.Material).dispose();
        this.particles.splice(i, 1);
      }
    }
  }

  private onPeers(peers: PeerInfo[]) {
    this.peerCount = 1 + peers.length;
    this.peerConnected = peers.some((p) => p.connectionState === "connected");
    this.hudDirty = true;
    const alive = new Set(peers.map((p) => p.id));
    for (const [id, remote] of this.remotes) {
      if (!alive.has(id) && remote.fromP2p) {
        this.scene.remove(remote.group);
        this.remotes.delete(id);
      }
    }
    for (const p of peers) {
      if (p.connectionState === "connected") this.ensureRemote(p.id, true);
    }
    const smallest =
      [this.opts.playerId, ...peers.map((p) => p.id)].sort()[0] === this.opts.playerId;
    if (smallest) {
      for (const p of peers) {
        if (p.connectionState === "connected") this.p2p.send({ t: "hello" } satisfies NetMsg, p.id);
      }
    }
  }

  private ensureRemote(id: string, fromP2p: boolean): Remote {
    let r = this.remotes.get(id);
    if (r) {
      r.fromP2p = r.fromP2p || fromP2p;
      return r;
    }
    const pal = paletteFor(id, this.opts.playerId);
    const group = createAvatar(pal);
    const s = this.world.spawn();
    group.position.set(s.x, s.y, s.z);
    this.scene.add(group);
    r = {
      id,
      group,
      x: s.x,
      y: s.y,
      z: s.z,
      yaw: 0,
      pitch: 0,
      tx: s.x,
      ty: s.y,
      tz: s.z,
      tyaw: 0,
      fromP2p,
      last: performance.now(),
      appear: 0,
      emote: null,
    };
    this.remotes.set(id, r);
    this.hudDirty = true;
    this.celebrateJoin(r);
    return r;
  }

  private celebrateJoin(r: Remote) {
    r.group.scale.setScalar(0.12);
    this.burst(r.x, r.y + 0.8, r.z, 4);
    this.spawnHearts(r.x, r.y + 1.2, r.z, 5);
    if (this.playing) this.audio.join();
  }

  private onNet(from: string, data: unknown, channel: "state" | "reliable") {
    if (!data || typeof data !== "object") return;
    const msg = data as NetMsg;
    if (msg.t === "pos" && channel === "state") {
      const r = this.ensureRemote(from, true);
      r.tx = msg.x;
      r.ty = msg.y;
      r.tz = msg.z;
      r.tyaw = msg.yaw;
      r.pitch = msg.pitch;
      r.last = performance.now();
    } else if (msg.t === "block" && channel === "reliable") {
      this.applyLocal(msg.x, msg.y, msg.z, msg.block, false);
    } else if (msg.t === "emote" && channel === "reliable") {
      const kind = msg.kind;
      if (kind !== "wave" && kind !== "hearts" && kind !== "laugh") return;
      const r = this.ensureRemote(from, true);
      r.emote = { kind, age: 0 };
      setAvatarFace(r.group, kind);
      this.audio.emote(kind);
      if (kind === "hearts") this.spawnHearts(r.x, r.y + 1.35, r.z, 6);
    }
  }

  private updateRemotes(dt: number) {
    const k = 1 - Math.pow(0.001, dt);
    for (const r of this.remotes.values()) {
      r.x += (r.tx - r.x) * k;
      r.y += (r.ty - r.y) * k;
      r.z += (r.tz - r.z) * k;
      r.yaw += Math.atan2(Math.sin(r.tyaw - r.yaw), Math.cos(r.tyaw - r.yaw)) * k;
      r.group.position.set(r.x, r.y, r.z);
      r.group.rotation.y = r.yaw;
      if (r.appear < 1) {
        r.appear = Math.min(1, r.appear + dt * 2.2);
        const s = 1 - Math.pow(1 - r.appear, 3);
        r.group.scale.setScalar(s);
      }
      if (r.emote) {
        r.emote.age += dt;
        if (r.emote.age >= EMOTE_DURATION) {
          r.emote = null;
          setAvatarFace(r.group, "idle");
        }
      }
      const moving = Math.hypot(r.tx - r.x, r.tz - r.z) > 0.02;
      swingAvatar(r.group, this.anim, moving, r.emote);
      if (performance.now() - r.last > 8000) {
        this.scene.remove(r.group);
        this.remotes.delete(r.id);
        this.hudDirty = true;
      }
    }
  }

  private netTick(now: number) {
    if (now - this.lastBroadcast > 50) {
      this.lastBroadcast = now;
      const pos = {
        t: "pos",
        x: this.pos.x,
        y: this.pos.y,
        z: this.pos.z,
        yaw: this.yaw,
        pitch: this.pitch,
      } satisfies NetMsg;
      this.noteP2pBytes(JSON.stringify({ t: "d", d: pos }).length);
      this.p2p.broadcast(pos);
    }
    if (now - this.lastHeartbeat > 2000) {
      this.lastHeartbeat = now;
      void heartbeat({
        data: {
          worldId: this.opts.worldId,
          playerId: this.opts.playerId,
          x: this.pos.x,
          y: this.pos.y,
          z: this.pos.z,
          yaw: this.yaw,
          pitch: this.pitch,
        },
      })
        .then(() => {
          this.failStreak = 0;
        })
        .catch(() => {
          this.failStreak += 1;
          if (this.failStreak > 6) this.opts.onLost();
        });
    }
    if (now - this.lastPoll > 2000) {
      this.lastPoll = now;
      void this.pollFallback();
    }
  }

  private async pollFallback() {
    try {
      const [edits, presence] = await Promise.all([
        listEdits({
          data: {
            worldId: this.opts.worldId,
            after: this.editCursor,
            generation: this.generation,
          },
        }),
        listPresence({ data: { worldId: this.opts.worldId, playerId: this.opts.playerId } }),
      ]);
      this.failStreak = 0;
      if (edits.reset) {
        this.applyReset(edits.generation, edits.edits);
      } else {
        for (const e of edits.edits) {
          if (e.cursor > this.editCursor) this.editCursor = e.cursor;
          if (this.world.get(e.x, e.y, e.z) !== e.block) this.applyLocal(e.x, e.y, e.z, e.block, false);
        }
      }
      this.mergePresence(presence);
    } catch {
      this.failStreak += 1;
      if (this.failStreak > 6) this.opts.onLost();
    }
  }

  private mergePresence(presence: PresencePlayer[]) {
    const seen = new Set(presence.map((p) => p.playerId));
    for (const p of presence) {
      const r = this.ensureRemote(p.playerId, false);
      if (!r.fromP2p || performance.now() - r.last > 400) {
        r.tx = p.x;
        r.ty = p.y;
        r.tz = p.z;
        r.tyaw = p.yaw;
        r.pitch = p.pitch;
        r.last = performance.now();
      }
    }
    for (const [id, r] of this.remotes) {
      if (!r.fromP2p && !seen.has(id) && performance.now() - r.last > 4000) {
        this.scene.remove(r.group);
        this.remotes.delete(id);
        this.hudDirty = true;
      }
    }
    const n = 1 + this.remotes.size;
    if (n !== this.peerCount) {
      this.peerCount = n;
      this.hudDirty = true;
    }
  }

  private updateEmote(dt: number) {
    if (!this.emote) {
      this.localArm.visible = false;
      return;
    }
    this.emote.age += dt;
    if (this.emote.kind === "wave") poseLocalArm(this.localArm, this.emote.age);
    else this.localArm.visible = false;
    if (this.emote.age >= EMOTE_DURATION) {
      this.emote = null;
      this.localArm.visible = false;
      this.pickaxe.visible = true;
    }
  }

  private spawnHearts(x: number, y: number, z: number, n: number) {
    for (let i = 0; i < n; i++) {
      const mesh = createHeartMesh();
      mesh.position.set(x + (Math.random() - 0.5) * 0.35, y, z + (Math.random() - 0.5) * 0.35);
      this.scene.add(mesh);
      const life = 0.7 + Math.random() * 0.4;
      this.particles.push({
        mesh,
        vx: (Math.random() - 0.5) * 0.6,
        vy: 0.9 + Math.random() * 0.7,
        vz: (Math.random() - 0.5) * 0.6,
        life,
        maxLife: life,
        grav: 1.6,
      });
    }
  }

  private spawnOverlayHearts() {
    const x = this.camera.position.x + this.lookX * 0.8;
    const y = this.camera.position.y + this.lookY * 0.8 - 0.05;
    const z = this.camera.position.z + this.lookZ * 0.8;
    this.spawnHearts(x, y, z, 5);
  }

  private noteP2pBytes(n: number) {
    const now = performance.now();
    this.p2pOut.push({ t: now, n });
    while (this.p2pOut[0] && now - this.p2pOut[0].t > 10000) this.p2pOut.shift();
  }

  private p2pBytes10s(): number {
    const now = performance.now();
    let sum = 0;
    for (const e of this.p2pOut) {
      if (now - e.t <= 10000) sum += e.n;
    }
    return sum;
  }

  private emitHud() {
    this.hudDirty = false;
    this.opts.onHud({
      palette: BLOCK_PALETTE,
      selected: this.selected,
      peerCount: this.peerCount,
      peerConnected: this.peerConnected || this.remotes.size > 0,
      playing: this.playing,
      worldId: this.opts.worldId,
      isCreator: this.opts.isCreator,
    });
  }

  async resetIsland(): Promise<boolean> {
    if (!this.opts.isCreator) return false;
    const r = await resetWorld({
      data: { worldId: this.opts.worldId, playerId: this.opts.playerId },
    });
    if (!r.ok) return false;
    this.applyReset(r.generation, []);
    return true;
  }

  private applyReset(generation: number, edits: { x: number; y: number; z: number; block: number; cursor?: number }[]) {
    this.generation = generation;
    this.editCursor = 0;
    for (const e of edits) {
      if (e.cursor && e.cursor > this.editCursor) this.editCursor = e.cursor;
    }
    this.world.resetTo(edits);
    this.rebuildAllChunks();
    const spawn = this.world.spawn();
    this.pos.set(spawn.x, spawn.y, spawn.z);
    this.vel.set(0, 0, 0);
  }
}
