import * as THREE from "three";
import { P2PRoom, type PeerInfo } from "@/lib/multiplayer";
import {
  createAvatar,
  createHeartMesh,
  createLocalArm,
  createTopHat,
  disposePickaxe,
  lookFor,
  poseHatPickup,
  poseLocalArm,
  remoteLook,
  setAvatarFace,
  swingAvatar,
  wearHat,
} from "./avatar";
import { PeepAudio } from "./audio";
import {
  AIR,
  BHOP_AIR_CONTROL,
  BHOP_AIR_CROUCH_GRAVITY,
  BHOP_MAX,
  BHOP_STEP,
  BHOP_WALL_SPEED_FRAC,
  BHOP_WINDOW_S,
  BLOCK_COLORS,
  BLOCK_PALETTE,
  BREAK_HOLD_S,
  CHEST,
  CHUNK_S,
  CROUCH_EYE_HEIGHT,
  CROUCH_HEIGHT,
  CROUCH_SPEED_MUL,
  EYE_HEIGHT,
  FOG_COLOR,
  FOG_FAR,
  FOG_NEAR,
  GOLD,
  GRAVITY,
  JUMP_SPEED,
  MESH_PER_FRAME,
  PLACE_DOUBLE_MS,
  nextEditDelay,
  PLACE_HOLD_S,
  PLAYER_HEIGHT,
  PLAYER_RADIUS,
  VIEW_CHUNKS,
  WALK_SPEED,
  WATER_LEVEL,
  WORLD_SY,
} from "./constants";
import { createAtmosphere, disposeAtmosphere, setUnderwater, tickAtmosphere, SUN_DIR, type Atmosphere } from "./atmosphere";
import {
  createBreakCracks,
  createPlaceGhost,
  disposeBreakCracks,
  disposePlaceGhost,
  type BreakCracks,
  type PlaceGhost,
} from "./build-fx";
import { buildChunkGeometry } from "./mesh";
import { addBlock, countOf, loadStory, saveStory, takeBlock, type Story } from "./progress";
import { voxelRaycast, type VoxelHit } from "./raycast";
import { BLOCK_SHADE_GRAIN_GLSL, BLOCK_TEXEL_GLSL, createBlockAtlas } from "./textures";
import type { BlockEdit, EmoteKind, HudState, NetMsg, PresencePlayer } from "./types";
import { EMOTE_DURATION } from "./types";
import { createHeldItem } from "./held-item";
import { ITEM_DEBUG, tickGoldObject } from "./item-voxels";
import { hatSpot, VoxelWorld } from "./world";

export { buildItemFromJSON } from "./held-item";
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
  onPlaced?: () => void;
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
        gl_FragColor = vec4(vec3(0.62 + g * 0.9), 0.04);
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
  private readonly atlas: THREE.DataTexture;
  private readonly atmo: Atmosphere;
  private readonly fog: THREE.Fog;
  private readonly highlight: THREE.LineSegments;
  private readonly placeGhost: PlaceGhost;
  private readonly breakFx: BreakCracks;
  private readonly pickaxe: THREE.Group;
  private readonly localArm: THREE.Group;
  private readonly grainMesh: THREE.Mesh;
  private readonly grainTime: { value: number };
  private readonly audio = new PeepAudio();
  private readonly p2p: P2PRoom;
  private readonly remotes = new Map<string, Remote>();
  private readonly particles: Particle[] = [];
  private readonly dirtyChunks = new Set<string>();
  private readonly story: Story;
  private readonly localBody: THREE.Group;
  private readonly hatProp: THREE.Group;
  private readonly hatAnchor: { x: number; y: number; z: number };
  private cinematic: { t: number } | null = null;
  private hatPrompt = false;
  private chestOffer = false;
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
  private bhopMultiplier = 1;
  private jumpBuffer = 0;
  private landWindow = 0;
  private crouching = false;
  private crouchHeld = false;
  /** Touch stick axis: +x strafes right, +z walks forward. Additive with WASD. */
  private moveX = 0;
  private moveZ = 0;
  private selected = 1;
  private hit: VoxelHit | null = null;
  private swing = 0;
  private placing = false;
  private placeArmed = false;
  private placeArmedUntil = 0;
  private mining = false;
  private placeT = 0;
  private breakT = 0;
  private placeCharge = 0;
  private breakCharge = 0;
  private placeKey = "";
  private breakKey = "";
  private strikeT = 0;
  private placeTickT = 0;
  private placeWait = 0;
  private breakWait = 0;
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
    this.story = loadStory(opts.worldId, opts.playerId);
    this.world = new VoxelWorld(opts.seed, opts.edits);
    if (this.story.chest) this.world.hideChest();
    const spawn = this.world.spawn();
    this.pos.set(spawn.x, spawn.y, spawn.z);
    this.yaw = Math.atan2(-SUN_DIR.x, -SUN_DIR.z);
    this.pitch = -0.28;

    this.atlas = createBlockAtlas();
    this.material = new THREE.MeshLambertMaterial({
      vertexColors: true,
      color: 0xffffff,
    });
    this.material.customProgramCacheKey = () => "peep-atlas-v5";
    this.material.onBeforeCompile = (shader) => {
      shader.uniforms.uTime = this.grainTime;
      shader.uniforms.uPeepTime = this.grainTime;
      shader.uniforms.uAtlas = { value: this.atlas };
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
      shader.fragmentShader = `uniform float uTime;\nuniform float uPeepTime;\nuniform sampler2D uAtlas;\nvarying float vKind;\nvarying vec3 vPeepW;\nvarying vec3 vPeepN;\n${shader.fragmentShader}`;
      if (shader.fragmentShader.includes("#include <color_fragment>")) {
        shader.fragmentShader = shader.fragmentShader.replace(
          "#include <color_fragment>",
          `#include <color_fragment>
${BLOCK_TEXEL_GLSL}`,
        );
      } else {
        shader.fragmentShader = shader.fragmentShader.replace(
          "diffuseColor *= vColor;",
          `diffuseColor *= vColor;
${BLOCK_TEXEL_GLSL}`,
        );
      }
      if (shader.fragmentShader.includes("#include <opaque_fragment>")) {
        shader.fragmentShader = shader.fragmentShader.replace(
          "#include <opaque_fragment>",
          `${BLOCK_SHADE_GRAIN_GLSL}
#include <opaque_fragment>`,
        );
      } else if (shader.fragmentShader.includes("#include <output_fragment>")) {
        shader.fragmentShader = shader.fragmentShader.replace(
          "#include <output_fragment>",
          `${BLOCK_SHADE_GRAIN_GLSL}
#include <output_fragment>`,
        );
      } else {
        shader.fragmentShader = shader.fragmentShader.replace(
          "gl_FragColor = vec4( outgoingLight, diffuseColor.a );",
          `${BLOCK_SHADE_GRAIN_GLSL}
gl_FragColor = vec4( outgoingLight, diffuseColor.a );`,
        );
      }
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

    this.streamChunks(false);
    this.flushDirty(9);

    const hiGeo = new THREE.EdgesGeometry(new THREE.BoxGeometry(1.02, 1.02, 1.02));
    this.highlight = new THREE.LineSegments(
      hiGeo,
      new THREE.LineBasicMaterial({ color: 0x1a1612, transparent: true, opacity: 0.7 }),
    );
    this.highlight.visible = false;
    this.scene.add(this.highlight);

    this.placeGhost = createPlaceGhost();
    this.scene.add(this.placeGhost.mesh);
    this.breakFx = createBreakCracks();
    this.scene.add(this.breakFx.group);

    const selfLook = lookFor(opts.isCreator);
    this.pickaxe = createHeldItem();
    this.localArm = createLocalArm(selfLook);
    this.localBody = createAvatar(selfLook, { monocle: opts.isCreator, hat: this.story.hat });
    this.localBody.visible = false;
    this.scene.add(this.localBody);
    this.hatAnchor = hatSpot(opts.seed);
    this.hatProp = createTopHat();
    this.hatProp.position.set(this.hatAnchor.x, this.hatAnchor.y + 0.08, this.hatAnchor.z);
    this.hatProp.visible = opts.isCreator && !this.story.hat;
    this.scene.add(this.hatProp);
    const grain = createFilmGrain();
    this.grainMesh = grain.mesh;
    this.grainTime = grain.time;
    this.overlayScene.add(this.pickaxe);
    this.overlayScene.add(this.localArm);
    this.overlayScene.add(this.grainMesh);
    this.overlayScene.add(new THREE.AmbientLight(0xfff4e8, 1.05));
    const vl = new THREE.DirectionalLight(0xfff4e5, 0.85);
    vl.position.set(0.4, 1.2, 1.4);
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

  armPlace() {
    if (!this.playing) return;
    this.placeArmed = true;
    this.placeArmedUntil = performance.now() + PLACE_DOUBLE_MS;
    this.placing = false;
    this.placeT = 0;
    this.placeCharge = 0;
    this.hudDirty = true;
    this.audio.intent();
  }

  beginPlace() {
    if (!this.playing || this.cinematic) return;
    this.placeArmed = false;
    this.placing = true;
    this.placeT = 0;
    this.placeCharge = 0;
    this.placeKey = "";
    this.placeTickT = 0;
    this.placeWait = 0;
    this.hudDirty = true;
    this.audio.placeTick(this.currentBlock());
    this.swing = 0.45;
  }

  endPlace() {
    this.placing = false;
    this.placeArmed = false;
    this.placeT = 0;
    if (this.placeCharge !== 0) this.hudDirty = true;
    this.placeCharge = 0;
    this.placeWait = 0;
    this.placeGhost.mesh.visible = false;
    this.hudDirty = true;
  }

  clearPlaceIntent() {
    if (!this.placeArmed || this.placing) return;
    this.placeArmed = false;
    this.placeGhost.mesh.visible = false;
    this.hudDirty = true;
  }

  beginBreak() {
    if (!this.playing || this.cinematic) return;
    this.mining = true;
    this.breakT = 0;
    this.breakCharge = 0;
    this.breakKey = "";
    this.strikeT = 0;
    this.breakWait = 0;
    this.hudDirty = true;
    if (this.hit) {
      this.breakKey = `${this.hit.x},${this.hit.y},${this.hit.z}`;
      this.audio.strike(this.world.get(this.hit.x, this.hit.y, this.hit.z));
      this.swing = 1;
    }
  }

  endBreak() {
    this.mining = false;
    this.breakT = 0;
    if (this.breakCharge !== 0) this.hudDirty = true;
    this.breakCharge = 0;
    this.breakWait = 0;
    this.breakFx.group.visible = false;
  }

  breakTarget() {
    this.beginBreak();
  }

  placeTarget() {
    this.beginPlace();
    return false;
  }

  jump() {
    if (!this.playing || this.cinematic) return;
    this.jumpBuffer = BHOP_WINDOW_S;
    this.tryBunnyJump();
  }

  /** Mobile / overlay crouch hold. Desktop also uses Ctrl/Shift. */
  setCrouch(on: boolean) {
    this.crouchHeld = on;
  }

  private tryBunnyJump(): boolean {
    if (!this.playing || this.cinematic) return false;
    const canJump = this.onGround || this.landWindow > 0;
    if (!canJump || this.jumpBuffer <= 0) return false;

    const rhythmic = this.landWindow > 0 || (!this.onGround && this.jumpBuffer > 0);
    if (rhythmic && this.bhopMultiplier > 1 - 1e-6) {
      this.bhopMultiplier = Math.min(BHOP_MAX, this.bhopMultiplier + BHOP_STEP);
    } else if (rhythmic) {
      this.bhopMultiplier = Math.min(BHOP_MAX, 1 + BHOP_STEP);
    }

    const horiz = Math.hypot(this.vel.x, this.vel.z);
    const wish = Math.max(horiz, WALK_SPEED * this.bhopMultiplier);
    if (horiz > 0.05) {
      const s = wish / horiz;
      this.vel.x *= s;
      this.vel.z *= s;
    }

    this.vel.y = JUMP_SPEED;
    this.onGround = false;
    this.jumpBuffer = 0;
    this.landWindow = 0;
    this.audio.jump();
    return true;
  }

  private playerHeight(): number {
    return this.crouching ? CROUCH_HEIGHT : PLAYER_HEIGHT;
  }

  private eyeHeight(): number {
    return this.crouching ? CROUCH_EYE_HEIGHT : EYE_HEIGHT;
  }

  private updateCrouchState() {
    const keyCrouch =
      this.held("ControlLeft") ||
      this.held("ControlRight") ||
      this.held("ShiftLeft") ||
      this.held("ShiftRight");
    this.crouching = this.crouchHeld || keyCrouch;
  }

  playEmote(kind: EmoteKind) {
    if (!this.playing || this.cinematic) return;
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

  /** Touch look pad: same signs as mouse — drag right looks right, drag up looks up. */
  lookBy(dx: number, dy: number) {
    if (this.cinematic) return;
    this.lookDelta(dx, dy);
  }

  setSelected(i: number) {
    if (i < 0 || i >= this.palette().length) return;
    this.selected = i;
    this.hudDirty = true;
  }

  pickupHat() {
    if (this.cinematic || !this.opts.isCreator || this.story.hat || !this.hatPrompt) return;
    this.cinematic = { t: 0 };
    this.hatPrompt = false;
    this.playing = true;
    this.localBody.visible = true;
    this.localBody.position.copy(this.pos);
    this.localBody.rotation.y = this.yaw;
    this.pickaxe.visible = false;
    this.hudDirty = true;
  }

  dismissChest() {
    this.chestOffer = false;
    this.hudDirty = true;
  }

  private persist() {
    saveStory(this.opts.worldId, this.opts.playerId, this.story);
  }

  private palette(): readonly number[] {
    return this.story.chest || countOf(this.story, GOLD) > 0
      ? [...BLOCK_PALETTE, GOLD]
      : BLOCK_PALETTE;
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
    this.atlas.dispose();
    this.grainMesh.geometry.dispose();
    (this.grainMesh.material as THREE.Material).dispose();
    this.audio.dispose();
    disposeAtmosphere(this.atmo);
    this.highlight.geometry.dispose();
    (this.highlight.material as THREE.Material).dispose();
    disposePlaceGhost(this.placeGhost);
    disposeBreakCracks(this.breakFx);
    disposePickaxe(this.pickaxe);
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
    this.onContext = this.onContext.bind(this);
    this.onWheel = this.onWheel.bind(this);
    this.onBlur = this.onBlur.bind(this);
    this.onLock = this.onLock.bind(this);
    this.onCanvasClick = this.onCanvasClick.bind(this);
    window.addEventListener("keydown", this.onKeyDown);
    window.addEventListener("keyup", this.onKeyUp);
    window.addEventListener("blur", this.onBlur);
    document.addEventListener("pointerlockchange", this.onLock);
    document.addEventListener("mousemove", this.onMouseMove);
    c.addEventListener("click", this.onCanvasClick);
    c.addEventListener("pointerdown", this.onPointerDown);
    window.addEventListener("pointerup", this.onPointerUp);
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
    document.removeEventListener("mousemove", this.onMouseMove);
    c.removeEventListener("click", this.onCanvasClick);
    c.removeEventListener("pointerdown", this.onPointerDown);
    window.removeEventListener("pointerup", this.onPointerUp);
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
    if (["KeyW", "KeyA", "KeyS", "KeyD", "Space", "ControlLeft", "ControlRight", "ShiftLeft", "ShiftRight"].includes(e.code)) {
      e.preventDefault();
    }
  }

  private onKeyUp(e: KeyboardEvent) {
    this.keys.delete(e.code);
  }

  private onBlur() {
    this.keys.clear();
    this.dragging = false;
    this.moveX = 0;
    this.moveZ = 0;
    this.endPlace();
    this.endBreak();
  }

  private isLocked(): boolean {
    return document.pointerLockElement === this.opts.canvas;
  }

  private wantsDesktopLock(): boolean {
    return window.matchMedia("(pointer: fine)").matches;
  }

  private onLock() {
    this.pointerLocked = this.isLocked();
    this.opts.canvas.style.cursor = this.pointerLocked ? "none" : "default";
    if (!this.pointerLocked) {
      this.dragging = false;
      this.endPlace();
      this.endBreak();
    }
    this.hudDirty = true;
  }

  private onCanvasClick(e: MouseEvent) {
    if (!this.playing || this.cinematic) return;
    if (e.button !== 0) return;
    if (!this.wantsDesktopLock()) return;
    if (this.isLocked()) return;
    this.tryLock();
  }

  private onMouseMove(e: MouseEvent) {
    if (!this.playing || this.cinematic) return;
    if (document.pointerLockElement !== this.opts.canvas) return;
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
    // Phone/tablet: look and break/place live on the pads, not the canvas.
    if (e.pointerType === "touch") return;
    if (!this.isLocked()) {
      if (this.wantsDesktopLock()) this.tryLock();
      return;
    }
    this.ptrButton = e.button;
    this.ptrStartX = e.clientX;
    this.ptrStartY = e.clientY;
    this.lastPtrX = e.clientX;
    this.lastPtrY = e.clientY;
    this.ptrMoved = false;
    this.tapSlop = 6;
    if (e.button === 0) this.beginBreak();
    if (e.button === 2) this.beginPlace();
  }

  private onPointerUp(e: PointerEvent) {
    if (this.isLocked()) {
      if (e.button === 0) this.endBreak();
      if (e.button === 2) this.endPlace();
    }
    if (!this.dragging) {
      this.dragging = false;
      return;
    }
    this.dragging = false;
    if (!this.playing) return;
    this.endPlace();
    this.endBreak();
    void e;
  }

  private onContext(e: Event) {
    e.preventDefault();
  }

  private onWheel(e: WheelEvent) {
    if (!this.playing) return;
    const dir = e.deltaY > 0 ? 1 : -1;
    this.setSelected((this.selected + dir + this.palette().length) % this.palette().length);
  }

  /**
   * Pointer lock is a bonus, never a requirement: drag-to-look is the fallback
   * and it is the only path on touch. Every attempt therefore has to swallow
   * both a synchronous throw and a rejected promise — inside an iframe the
   * request raises WrongDocumentError, and without a real
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
    const w = Math.max(1, parent.clientWidth || window.innerWidth);
    const h = Math.max(1, parent.clientHeight || window.innerHeight);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.overlayCam.aspect = Math.max(w / h, 1.2);
    this.overlayCam.fov = 50;
    this.overlayCam.updateProjectionMatrix();
    this.renderer.setSize(w, h, false);
  }

  private streamChunks(immediate = false) {
    const pcx = Math.floor(this.pos.x / CHUNK_S);
    const pcz = Math.floor(this.pos.z / CHUNK_S);
    const keep = new Set<string>();
    for (let dz = -VIEW_CHUNKS; dz <= VIEW_CHUNKS; dz++) {
      for (let dx = -VIEW_CHUNKS; dx <= VIEW_CHUNKS; dx++) {
        const key = `${pcx + dx},${pcz + dz}`;
        keep.add(key);
        if (!this.chunkMeshes.has(key)) this.dirtyChunks.add(key);
      }
    }
    for (const [key, mesh] of this.chunkMeshes) {
      if (keep.has(key)) continue;
      this.terrain.remove(mesh);
      mesh.geometry.dispose();
      this.chunkMeshes.delete(key);
    }
    this.world.evictFar(pcx, pcz, VIEW_CHUNKS + 2);
    if (immediate) this.flushDirty(64);
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

  /** A few rebuilds per frame — mid-Android freeze otherwise. */
  private flushDirty(limit = MESH_PER_FRAME) {
    if (this.dirtyChunks.size === 0) return;
    const t0 = performance.now();
    const pcx = Math.floor(this.pos.x / CHUNK_S);
    const pcz = Math.floor(this.pos.z / CHUNK_S);
    const keys = [...this.dirtyChunks].sort((a, b) => {
      const da = this.chunkDist(a, pcx, pcz);
      const db = this.chunkDist(b, pcx, pcz);
      return da - db;
    });
    let n = 0;
    for (const key of keys) {
      if (n >= limit) break;
      this.dirtyChunks.delete(key);
      const comma = key.indexOf(",");
      this.rebuildChunk(Number(key.slice(0, comma)), Number(key.slice(comma + 1)));
      n += 1;
    }
    this.lastMeshMs = performance.now() - t0;
    if (this.lastMeshMs > this.maxMeshMs) this.maxMeshMs = this.lastMeshMs;
  }

  private chunkDist(key: string, pcx: number, pcz: number): number {
    const comma = key.indexOf(",");
    const cx = Number(key.slice(0, comma));
    const cz = Number(key.slice(comma + 1));
    return Math.abs(cx - pcx) + Math.abs(cz - pcz);
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
    this.streamChunks();
    this.updateHatPrompt();
    this.updateCinematic(dt);
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
    this.updateBuild(dt);
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
    if (!this.playing || this.cinematic) {
      this.vel.x *= 0.7;
      this.vel.z *= 0.7;
      this.vel.y -= GRAVITY * dt;
      this.collide(dt);
      return;
    }

    this.updateCrouchState();
    if (this.jumpBuffer > 0) this.jumpBuffer = Math.max(0, this.jumpBuffer - dt);
    if (this.landWindow > 0) this.landWindow = Math.max(0, this.landWindow - dt);

    // Yaw 0 looks down -Z, so forward is (-sin, -cos) and right is (cos, -sin).
    // Keep the pair in this order: swapping it is what inverts A/D.
    const fwdX = -Math.sin(this.yaw);
    const fwdZ = -Math.cos(this.yaw);
    const rightX = Math.cos(this.yaw);
    const rightZ = -Math.sin(this.yaw);

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

    const wishX = fwdX * fwd + rightX * strafe;
    const wishZ = fwdZ * fwd + rightZ * strafe;
    const groundSpeed =
      WALK_SPEED * this.bhopMultiplier * (this.crouching ? CROUCH_SPEED_MUL : 1);

    if (this.held("Space")) this.jumpBuffer = Math.max(this.jumpBuffer, BHOP_WINDOW_S * 0.5);

    const wasGround = this.onGround;
    const fallSpeed = this.vel.y;
    const speedBefore = Math.hypot(this.vel.x, this.vel.z);

    if (this.onGround) {
      this.vel.y -= GRAVITY * dt;
      if (!this.tryBunnyJump()) {
        this.vel.x = wishX * groundSpeed;
        this.vel.z = wishZ * groundSpeed;
      }
    } else {
      // Air: keep momentum, steer gently; crouch softens gravity for long jumps.
      if (mag > 0.05) {
        const airSpeed = WALK_SPEED * this.bhopMultiplier;
        this.vel.x += wishX * airSpeed * BHOP_AIR_CONTROL * dt;
        this.vel.z += wishZ * airSpeed * BHOP_AIR_CONTROL * dt;
        const cap = airSpeed * 1.35;
        const hz = Math.hypot(this.vel.x, this.vel.z);
        if (hz > cap) {
          this.vel.x = (this.vel.x / hz) * cap;
          this.vel.z = (this.vel.z / hz) * cap;
        }
      }
      const gMul = this.crouching ? BHOP_AIR_CROUCH_GRAVITY : 1;
      this.vel.y -= GRAVITY * gMul * dt;
      this.tryBunnyJump();
    }

    this.collide(dt);

    const speedAfter = Math.hypot(this.vel.x, this.vel.z);
    if (speedBefore > WALK_SPEED * 0.85 && speedAfter < speedBefore * BHOP_WALL_SPEED_FRAC) {
      this.bhopMultiplier = 1;
    }

    if (!wasGround && this.onGround) {
      this.landWindow = BHOP_WINDOW_S;
      if (fallSpeed < -3) this.audio.land(this.groundBlock());
      if (this.jumpBuffer > 0 || this.held("Space")) {
        this.tryBunnyJump();
      } else {
        // Missed the window → dump speed stack next frame after timer expires.
      }
    }

    if (this.onGround && this.landWindow <= 0 && this.jumpBuffer <= 0 && !this.held("Space")) {
      this.bhopMultiplier = 1;
    }

    if (this.pos.y < -6) {
      const s = this.world.spawn();
      this.pos.set(s.x, s.y, s.z);
      this.vel.set(0, 0, 0);
      this.bhopMultiplier = 1;
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
    const h = this.playerHeight();
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
    const eye = this.pos.y + this.eyeHeight() + bobY;
    if (this.cinematic) {
      const u = Math.min(1, this.cinematic.t / 4.2);
      const pull = u < 0.18 ? u / 0.18 : u > 0.82 ? 1 - (u - 0.82) / 0.18 : 1;
      const fx = -Math.sin(this.yaw);
      const fz = -Math.cos(this.yaw);
      const dist = 0.12 + pull * 3.15;
      const height = eye + pull * 0.55;
      this.camera.position.set(this.pos.x - fx * dist, height, this.pos.z - fz * dist);
      this.camera.lookAt(this.pos.x, this.pos.y + 1.25, this.pos.z);
    } else {
      this.camera.position.set(this.pos.x, eye, this.pos.z);
      this.camera.rotation.set(this.pitch + this.camPitchOff, this.yaw + this.camYawOff, this.camRoll);
    }
    this.camera.getWorldDirection(this.tmpFwd);
    this.lookX = this.tmpFwd.x;
    this.lookY = this.tmpFwd.y;
    this.lookZ = this.tmpFwd.z;
  }

  private updateHatPrompt() {
    if (!this.opts.isCreator || this.story.hat || this.cinematic || !this.playing) {
      if (this.hatPrompt) {
        this.hatPrompt = false;
        this.hudDirty = true;
      }
      return;
    }
    const near =
      Math.hypot(this.pos.x - this.hatAnchor.x, this.pos.z - this.hatAnchor.z) < 1.7 &&
      Math.abs(this.pos.y - this.hatAnchor.y) < 2.2;
    if (near !== this.hatPrompt) {
      this.hatPrompt = near;
      this.hudDirty = true;
    }
    if (this.hatProp.visible) {
      this.hatProp.rotation.y = this.anim * 0.6;
      this.hatProp.position.y = this.hatAnchor.y + 0.08 + Math.sin(this.anim * 2.2) * 0.04;
    }
  }

  private updateCinematic(dt: number) {
    if (!this.cinematic) return;
    this.cinematic.t += dt;
    const u = Math.min(1, this.cinematic.t / 4.2);
    this.localBody.position.copy(this.pos);
    this.localBody.rotation.y = this.yaw;
    poseHatPickup(this.localBody, u);
    if (u >= 0.48 && this.hatProp.visible) {
      this.hatProp.visible = false;
      wearHat(this.localBody, true);
    }
    if (u >= 0.72 && u < 0.88) setAvatarFace(this.localBody, "wink");
    else if (u >= 0.88) setAvatarFace(this.localBody, "idle");
    this.pickaxe.visible = false;
    if (this.cinematic.t >= 4.2) {
      this.cinematic = null;
      this.story.hat = true;
      this.persist();
      wearHat(this.localBody, true);
      this.localBody.visible = false;
      setAvatarFace(this.localBody, "idle");
      this.pickaxe.visible = true;
      this.p2p.send({ t: "look", hat: true } satisfies NetMsg);
      this.hudDirty = true;
    }
  }

  private updateHighlight() {
    const hit = this.playing && !this.cinematic
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

  private placeSpot(): { x: number; y: number; z: number; block: number; ok: boolean } | null {
    if (!this.hit) return null;
    const selected = this.palette()[this.selected] ?? AIR;

    // «Пусто» целится в сам блок под прицелом (стереть), а не в соседнюю клетку.
    if (selected === AIR) {
      const { x, y, z } = this.hit;
      const prev = this.world.get(x, y, z);
      return { x, y, z, block: AIR, ok: prev !== AIR };
    }

    const block = this.currentBlock();
    if (block === AIR) return null;
    const x = this.hit.x + this.hit.nx;
    const y = this.hit.y + this.hit.ny;
    const z = this.hit.z + this.hit.nz;
    const occupied = this.world.get(x, y, z) !== AIR;
    const inside = this.overlapsPlayer(x, y, z);
    return { x, y, z, block, ok: !occupied && !inside };
  }

  private updateBuild(dt: number) {
    if (this.cinematic) {
      this.placeGhost.mesh.visible = false;
      this.breakFx.group.visible = false;
      return;
    }
    this.updatePlaceHold(dt);
    this.updateBreakHold(dt);
  }

  private updatePlaceHold(dt: number) {
    if (this.placeArmed && !this.placing && performance.now() > this.placeArmedUntil) {
      this.placeArmed = false;
      this.hudDirty = true;
    }
    const aiming = this.placing || this.placeArmed;
    const spot = aiming ? this.placeSpot() : null;
    if (!aiming || !spot) {
      this.placeGhost.mesh.visible = false;
      if (this.placeCharge !== 0) {
        this.placeCharge = 0;
        this.placeT = 0;
        this.hudDirty = true;
      }
      return;
    }
    const key = `${spot.x},${spot.y},${spot.z},${spot.block}`;
    if (key !== this.placeKey) {
      this.placeKey = key;
      this.placeT = 0;
    }
    this.placeGhost.mesh.visible = true;
    this.placeGhost.mesh.position.set(spot.x + 0.5, spot.y + 0.5, spot.z + 0.5);
    const color = spot.block === AIR ? 0x6a90b8 : (BLOCK_COLORS[spot.block] ?? 0x888888);
    this.placeGhost.mat.color.setHex(spot.ok ? color : 0xa33b2a);
    const grow = 0.82 + 0.18 * this.placeCharge;
    this.placeGhost.mesh.scale.setScalar(spot.ok ? grow : 0.92);
    this.placeGhost.mat.opacity = this.placing
      ? spot.ok
        ? 0.2 + 0.28 * this.placeCharge
        : 0.22
      : 0.16;
    if (!this.placing) return;
    if (!spot.ok) {
      if (this.placeCharge !== 0) {
        this.placeT = 0;
        this.placeCharge = 0;
        this.hudDirty = true;
      }
      return;
    }
    if (this.placeWait > 0) {
      this.placeWait = Math.max(0, this.placeWait - dt);
      if (this.placeCharge !== 0) {
        this.placeT = 0;
        this.placeCharge = 0;
        this.hudDirty = true;
      }
      return;
    }
    this.placeT += dt;
    const next = Math.min(1, this.placeT / PLACE_HOLD_S);
    if (next !== this.placeCharge) {
      this.placeCharge = next;
      this.hudDirty = true;
    }
    this.placeTickT += dt;
    if (this.placeTickT >= 0.12) {
      this.placeTickT = 0;
      this.audio.placeTick(spot.block);
      this.swing = Math.max(this.swing, 0.4);
    }
    if (this.placeT >= PLACE_HOLD_S) {
      if (this.placeBlock()) this.opts.onPlaced?.();
      this.placeT = 0;
      this.placeCharge = 0;
      this.placeKey = "";
      this.placeWait = nextEditDelay();
      this.hudDirty = true;
    }
  }

  private updateBreakHold(dt: number) {
    if (!this.mining || !this.hit) {
      this.breakFx.group.visible = false;
      if (this.breakCharge !== 0) {
        this.breakCharge = 0;
        this.breakT = 0;
        this.hudDirty = true;
      }
      return;
    }
    const key = `${this.hit.x},${this.hit.y},${this.hit.z}`;
    if (key !== this.breakKey) {
      this.breakKey = key;
      this.breakT = 0;
      this.strikeT = 0;
      if (this.breakWait <= 0) {
        this.audio.strike(this.world.get(this.hit.x, this.hit.y, this.hit.z));
        this.swing = 1;
      }
    }
    if (this.breakWait > 0) {
      this.breakWait = Math.max(0, this.breakWait - dt);
      this.breakFx.group.visible = false;
      if (this.breakCharge !== 0) {
        this.breakT = 0;
        this.breakCharge = 0;
        this.hudDirty = true;
      }
      return;
    }
    this.breakT += dt;
    this.strikeT += dt;
    if (this.strikeT >= 0.15) {
      this.strikeT = 0;
      this.audio.strike(this.world.get(this.hit.x, this.hit.y, this.hit.z));
      this.swing = 1;
    }
    const next = Math.min(1, this.breakT / BREAK_HOLD_S);
    if (next !== this.breakCharge) {
      this.breakCharge = next;
      this.hudDirty = true;
    }
    this.breakFx.group.visible = true;
    this.breakFx.group.position.set(this.hit.x + 0.5, this.hit.y + 0.5, this.hit.z + 0.5);
    const veilMat = this.breakFx.veil.material as THREE.MeshBasicMaterial;
    veilMat.opacity = 0.08 + next * 0.38;
    const shown = Math.max(1, Math.floor(next * this.breakFx.segmentCount));
    this.breakFx.lines.geometry.setDrawRange(0, shown * 2);
    (this.breakFx.lines.material as THREE.LineBasicMaterial).opacity = 0.55 + next * 0.45;
    this.swing = Math.max(this.swing, next * 0.35);
    if (this.breakT >= BREAK_HOLD_S) {
      this.breakBlock();
      this.breakT = 0;
      this.breakCharge = 0;
      this.breakKey = "";
      this.breakWait = nextEditDelay();
      this.breakFx.group.visible = false;
      this.hudDirty = true;
    }
  }

  private updatePickaxe(dt: number) {
    if (this.swing > 0) this.swing = Math.max(0, this.swing - dt * 8);
    const waving = this.emote?.kind === "wave";
    this.pickaxe.visible = !waving && !this.cinematic;
    if (waving) return;
    const s = Math.sin(this.swing * Math.PI * 0.5);
    const bob = Math.sin(this.bob) * 0.018;
    const rest = ITEM_DEBUG;
    this.pickaxe.scale.setScalar(rest.scale);
    this.pickaxe.rotation.x = rest.rx - s * 0.82;
    this.pickaxe.rotation.y = rest.ry + s * 0.08;
    this.pickaxe.rotation.z = rest.rz - s * 0.36;
    this.pickaxe.position.set(
      rest.x - s * 0.06,
      rest.y - s * 0.12 + bob,
      rest.z - s * 0.03,
    );
    tickGoldObject(this.pickaxe, this.anim);
  }

  private currentBlock(): number {
    const block = this.palette()[this.selected] ?? AIR;
    if (block === AIR) return AIR;
    if (countOf(this.story, block) <= 0) return AIR;
    return block;
  }

  private overlapsPlayer(x: number, y: number, z: number): boolean {
    const r = PLAYER_RADIUS + 0.05;
    const px0 = this.pos.x - r;
    const px1 = this.pos.x + r;
    const py0 = this.pos.y;
    const py1 = this.pos.y + this.playerHeight();
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
            if (block === AIR && prev !== AIR && prev !== CHEST) takeBlock(this.story, prev);
            if (block !== AIR) addBlock(this.story, block);
            this.persist();
            this.hudDirty = true;
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
    if (prev === CHEST) {
      this.applyLocal(x, y, z, AIR, true);
      this.audio.break(prev);
      this.audio.pickup();
      if (!this.story.chest) {
        this.story.chest = true;
        this.story.friday = true;
        addBlock(this.story, GOLD, 16);
        this.persist();
        this.chestOffer = true;
      }
      this.swing = 1;
      this.hudDirty = true;
      return;
    }
    this.applyLocal(x, y, z, AIR, true);
    addBlock(this.story, prev, 1);
    this.persist();
    this.audio.break(prev);
    this.audio.pickup();
    this.swing = 1;
    this.hudDirty = true;
  }

  private placeBlock() {
    if (!this.hit) return false;
    const selected = this.palette()[this.selected] ?? AIR;

    // «Пусто»: стереть выбранный блок (без удержания кирки), ресурс возвращается.
    if (selected === AIR) {
      const { x, y, z } = this.hit;
      const prev = this.world.get(x, y, z);
      if (prev === AIR) return false;
      if (prev !== AIR) addBlock(this.story, prev);
      this.persist();
      this.applyLocal(x, y, z, AIR, true);
      this.audio.strike(prev);
      this.swing = 0.6;
      this.hudDirty = true;
      return true;
    }

    const block = this.currentBlock();
    if (block === AIR) return false;
    const x = this.hit.x + this.hit.nx;
    const y = this.hit.y + this.hit.ny;
    const z = this.hit.z + this.hit.nz;
    if (this.world.get(x, y, z) !== AIR) return false;
    if (this.overlapsPlayer(x, y, z)) return false;
    if (!takeBlock(this.story, block)) return false;
    this.persist();
    this.applyLocal(x, y, z, block, true);
    this.audio.place(block);
    this.swing = 0.6;
    this.hudDirty = true;
    return true;
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
    if (this.story.hat) this.p2p.send({ t: "look", hat: true } satisfies NetMsg);
  }

  private ensureRemote(id: string, fromP2p: boolean): Remote {
    let r = this.remotes.get(id);
    if (r) {
      r.fromP2p = r.fromP2p || fromP2p;
      return r;
    }
    const pal = remoteLook(this.opts.isCreator);
    const group = createAvatar(pal, { monocle: !this.opts.isCreator, hat: false });
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
    } else if (msg.t === "look" && channel === "reliable") {
      const r = this.ensureRemote(from, true);
      wearHat(r.group, msg.hat);
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
    const palette = this.palette();
    this.opts.onHud({
      palette,
      selected: this.selected,
      peerCount: this.peerCount,
      peerConnected: this.peerConnected || this.remotes.size > 0,
      playing: this.playing,
      locked: this.isLocked(),
      worldId: this.opts.worldId,
      isCreator: this.opts.isCreator,
      placeCharge: this.placeCharge,
      placeIntent: this.placeArmed && !this.placing,
      breakCharge: this.breakCharge,
      counts: palette.map((b) => countOf(this.story, b)),
      fridayUnlocked: this.story.friday && this.opts.isCreator,
      hatPrompt: this.hatPrompt,
      chestOffer: this.chestOffer,
      hatBusy: Boolean(this.cinematic),
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
    if (this.story.chest) this.world.hideChest();
    for (const mesh of this.chunkMeshes.values()) {
      this.terrain.remove(mesh);
      mesh.geometry.dispose();
    }
    this.chunkMeshes.clear();
    this.dirtyChunks.clear();
    this.streamChunks(false);
    this.flushDirty(9);
    const spawn = this.world.spawn();
    this.pos.set(spawn.x, spawn.y, spawn.z);
    this.vel.set(0, 0, 0);
  }
}
