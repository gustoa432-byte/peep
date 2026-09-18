import * as THREE from "three";
import { P2PRoom, type PeerInfo } from "@/lib/multiplayer";
import {
  createAvatar,
  createHeartMesh,
  createLocalArm,
  createTopHat,
  disposePickaxe,
  FRIDAY,
  PIP,
  poseHatPickup,
  poseLocalArm,
  setAvatarFace,
  setAvatarNametag,
  swingAvatar,
  wearHat,
} from "./avatar";
import { PeepAudio } from "./audio";
import {
  AIR,
  BARRIER,
  BHOP_AIR_CROUCH_GRAVITY,
  BHOP_AIR_DRAG,
  BHOP_AIR_TURN,
  BHOP_BOUNCE_MUL,
  BHOP_GROUND_FRICTION,
  BHOP_MAX_MUL,
  BLOCK_COLORS,
  BLOCK_PALETTE,
  BREAK_HOLD_S,
  DEFAULT_HOTBAR,
  CHEST,
  CHEST_BAR_RANGE,
  CHEST_CRAFT_S,
  CHEST_X,
  CHEST_Y,
  CHEST_Z,
  CHUNK_S,
  CROUCH_EYE_HEIGHT,
  CROUCH_HEIGHT,
  CROUCH_SPEED_MUL,
  DYNAMITE,
  DYNAMITE_BLAST_BLOCKS,
  DYNAMITE_BLAST_RADIUS,
  DYNAMITE_FUSE_S,
  DYNAMITE_KNOCKBACK_MUL,
  DYNAMITE_MAX_CHARGES,
  DYNAMITE_SHAKE_RANGE,
  EYE_HEIGHT,
  FOG_COLOR,
  FOG_FAR,
  FOG_NEAR,
  GOLD,
  GRAVITY,
  GROUND_FRICTION,
  HOTBAR_SLOTS,
  JUMP_SPEED,
  MESH_PER_FRAME,
  NEON,
  PLACE_DOUBLE_MS,
  EDIT_REPEAT_DELAY_MIN_S,
  PLACE_HOLD_S,
  PLAYER_HEIGHT,
  PLAYER_RADIUS,
  TROLL_DROP_COUNT,
  TROLL_DROP_GAP_S,
  TROLL_LOOK_UP_DOT,
  TROLL_LAPS,
  TROLL_QUEST_REWARD,
  TROLL_SECTOR_RAD,
  TROLL_SPAWN_HEIGHT,
  TROLL_TIMER_S,
  FRIDAY_FALL_HEIGHT,
  FRIDAY_HOPE_S,
  FRIDAY_TNT_COUNT,
  FRIDAY_TNT_GAP_S,
  FRIDAY_TNT_HEIGHT,
  VIEW_CHUNKS,
  WALK_SPEED,
  WATER_LEVEL,
  WORLD_SX,
  WORLD_SY,
  WORLD_SZ,
  SHADOW_EXTENT,
  SHADOW_MAP_SIZE,
  LANTERN_COLOR,
  LANTERN_DISTANCE,
  LANTERN_DECAY,
} from "./constants";
import { createAtmosphere, disposeAtmosphere, tickAtmosphere, SUN_DIR, type Atmosphere } from "./atmosphere";
import {
  createBreakCracks,
  createPlaceGhost,
  disposeBreakCracks,
  disposePlaceGhost,
  type BreakCracks,
  type PlaceGhost,
} from "./build-fx";
import { buildChunkGeometry } from "./mesh";
import { loadHotbar, saveHotbar } from "./hotbar";
import { addBlock, addDynamite, countOf, dynamiteCharges, dynamiteRechargeProgress, fillDynamite, loadStory, normalizeStory, refreshDynamite, refundDynamite, saveStory, takeBlock, takeDynamite, type Story } from "./progress";
import { gameViewSize } from "./fake-landscape";
import { hapticBoom, hapticJump } from "./haptics";
import { getTelegramSaveId } from "./player-id";
import { getTelegramDisplayName, isTelegramDesktopPlatform, isTelegramMobilePlatform } from "./telegram";
import type { WorldSavePayload } from "./world-serialize";
import { voxelRaycast, type VoxelHit } from "./raycast";
import { BLOCK_SHADE_GRAIN_GLSL, BLOCK_TEXEL_GLSL, createBlockAtlas } from "./textures";
import type { BlockEdit, EmoteKind, HudState, NetMsg, PresencePlayer } from "./types";
import { EMOTE_COOLDOWN_S, EMOTE_FART_S, emoteDuration, emoteIgnoresCooldown } from "./types";
import { createHeldItem } from "./held-item";
import { tickGoldObject } from "./item-voxels";
import {
  codeFromMouseButton,
  readKeybinds,
  type Keybinds,
} from "./keybinds";
import { hatSpot, pastIslandShore, VoxelWorld } from "./world";

export { buildItemFromJSON } from "./held-item";
import { applyEdit, heartbeat, listEdits, listPresence, resetWorld, updateGuestPermissions } from "./world.functions";

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
  name: string;
  /** Already answered their hello (avoid nametag handshake loops). */
  greetedBack: boolean;
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

export type PickaxeGrip = {
  x: number;
  y: number;
  z: number;
  rx: number;
  ry: number;
  rz: number;
  scale: number;
};

/** Rest pose for local armRight (pickaxe hand). */
export type ArmHoldPose = {
  rx: number;
  ry: number;
  rz: number;
};

export type ToolPoseExport = {
  pickaxe: PickaxeGrip;
  arm: ArmHoldPose;
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
  /** Initial Friday permissions from server join/load. */
  guestBuildAllowed?: boolean;
  islandLocked?: boolean;
  /** When set (Telegram load), replaces localStorage story. */
  inventoryOverride?: Story | null;
  onHud: (hud: HudState) => void;
  onLost: () => void;
  onPlaced?: () => void;
  /** Fired after a successful dig (for place-hint tutorial). */
  onBroken?: () => void;
  /** Fired when blocks or inventory change — for lazy server save. */
  onWorldDirty?: () => void;
  /** Guest was kicked by host. */
  onKicked?: () => void;
  /** 0…1 boot progress (terrain mesh around spawn). */
  onBootProgress?: (progress: number) => void;
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
        gl_FragColor = vec4(vec3(0.55 + g * 0.7), 0.02);
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
  private readonly depthMaterial: THREE.MeshDepthMaterial;
  private readonly sun: THREE.DirectionalLight;
  private readonly lantern: THREE.PointLight;
  private readonly atlas: THREE.Texture;
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
  private guestBuildAllowed = false;
  private islandLocked = false;
  private readonly keys = new Set<string>();
  private keyOverride: Set<string> | null = null;
  private disposed = false;
  private playing = false;
  private pointerLocked = false;
  /** Set on pointerlockerror — PL unavailable (typical TG Desktop WebView). */
  private pointerLockDenied = false;
  /**
   * Desktop aim mode: ESC clears this (cursor free). Canvas click sets it
   * (cursor hidden + Pointer Lock). Dig/place only while engaged (or after PL).
   * Camera free-look does NOT depend on this — only lastX/lastY tracking.
   */
  private aimEngaged = false;
  /** Canvas free-look sample. Undefined until first move (skip one frame). */
  private lastMouseX: number | undefined = undefined;
  private lastMouseY: number | undefined = undefined;
  /** Legacy flag — must never gate mouse look. */
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
  /** Consecutive takeoffs: 0 idle, 1 first hop, 2+ bhop chain. */
  private jumpChain = 0;
  /** One-shot jump from touch / Space tap while airborne → fire on next land. */
  private jumpQueued = false;
  private crouching = false;
  private crouchHeld = false;
  /** Touch stick axis: +x strafes right, +z walks forward. Additive with WASD. */
  private moveX = 0;
  private moveZ = 0;
  private selected = 1;
  /** Five quick-slot block ids. */
  private hotbar: number[] = [...DEFAULT_HOTBAR];
  /** Unseen loot count for inventory badge. */
  private invBadge = 0;
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
  private chestBar: HudState["chestBar"] = null;
  private readonly chestScr = new THREE.Vector3();
  private chestCraftSaveT = 0;
  private placeTickT = 0;
  private placeWait = 0;
  private breakWait = 0;
  /** Earliest time a new click may break/place (ms, performance.now). */
  private nextEditAt = 0;
  private bob = 0;
  /** Distance-driven phase for FPS view / weapon bob (client-only). */
  private viewBobPhase = 0;
  /** 0 = left arm tucked below frame, 1 = raised into view (jump). */
  private leftArmRaise = 0;
  /** Ground-speed factor 0…1 for bob amplitude. */
  private bobWalkAmt = 0;
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
  private notice: string | null = null;
  private noticeUntil = 0;
  private lookHint: string | null = null;
  /** idle swim → floor hint → cinematic TNT drop → done. */
  private trollPhase: "idle" | "swim" | "hint" | "drop" | "done" = "idle";
  private trollAngle = 0;
  private trollSectors = 0;
  private trollSectorFlashUntil = 0;
  private trollLastAng: number | null = null;
  private trollTimer = TROLL_TIMER_S;
  private trollTrackerVisible = false;
  private floorHint: THREE.Mesh | null = null;
  private trollDropLeft = 0;
  private trollDropWait = 0;
  private readonly fallingTnt: {
    mesh: THREE.Mesh;
    vy: number;
  }[] = [];
  /** Host: Friday first-join cinematic. */
  private fridayIntro: {
    phase: "fall" | "hope" | "tnt";
    remoteId: string;
    hopeT: number;
    groundY: number;
    tnt: { mesh: THREE.Mesh; vy: number }[];
    tntLeft: number;
    tntWait: number;
    follow: THREE.Mesh | null;
  } | null = null;
  private fridayIntroDone = false;
  /** Guest: sky-drop physics while host watches. */
  private guestFall: { vy: number; groundY: number } | null = null;
  private guestTntLock = false;
  private readonly guestFallingTnt: { mesh: THREE.Mesh; vy: number }[] = [];
  private readonly fuses: { x: number; y: number; z: number; t: number; hiss: number }[] = [];
  private emote: { kind: EmoteKind; age: number } | null = null;
  /** First-person fart kick remaining (seconds). */
  private fartKick = 0;
  /** Local censor red flash end (performance.now). */
  private censorFlashUntil = 0;
  /** Shared reaction cooldown end (performance.now). */
  private emoteCdUntil = 0;
  /** Desktop build keybinds (break / place / jump / crouch). */
  private keybinds: Keybinds = readKeybinds();
  /** Initial view-ring mesh boot (for loading bar). */
  private bootMeshTotal = 0;
  private bootMeshDone = 0;
  private bootReported = -1;
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
    this.guestBuildAllowed = Boolean(opts.guestBuildAllowed);
    this.islandLocked = Boolean(opts.islandLocked);
    this.story = opts.inventoryOverride
      ? normalizeStory(opts.inventoryOverride)
      : loadStory(opts.worldId, opts.playerId);
    this.hotbar = loadHotbar(opts.worldId, opts.playerId, opts.isCreator);
    if (countOf(this.story, NEON) <= 0) addBlock(this.story, NEON, 8);
    if (this.story.trollQuestDone) this.trollPhase = "done";
    else this.trollPhase = "idle";
    this.world = new VoxelWorld(opts.seed, opts.edits);
    if (this.story.chest) this.world.hideChest();
    if (opts.inventoryOverride) this.persist();
    const spawn = this.world.spawn();
    this.pos.set(spawn.x, spawn.y, spawn.z);
    this.yaw = Math.atan2(-SUN_DIR.x, -SUN_DIR.z);
    this.pitch = -0.28;

    this.atlas = createBlockAtlas();
    // CRITICAL: bind atlas on material.map so Three keeps the sampler alive + visible in inspector.
    // World UVs are voxel coords — default map_fragment would scramble the atlas; we strip it below.
    this.material = new THREE.MeshLambertMaterial({
      map: this.atlas,
      vertexColors: true,
      flatShading: true,
      color: 0xffffff,
    });
    this.material.needsUpdate = true;
    this.material.customProgramCacheKey = () => "peep-atlas8-map-wired-v2";
    {
      const img = this.atlas.image as HTMLCanvasElement | undefined;
      if (img && typeof img.toDataURL === "function") {
        // Click the logged data-URL in DevTools to verify the crisp 8×8 atlas.
        console.log("ATLAS GENERATED", img.toDataURL());
      } else {
        console.log("ATLAS GENERATED", this.atlas);
      }
    }
    this.material.onBeforeCompile = (shader) => {
      shader.uniforms.uTime = this.grainTime;
      shader.uniforms.uPeepTime = this.grainTime;
      shader.uniforms.uAtlas = { value: this.atlas };
      // `uv` is already in Three's program prefix — do not redeclare (breaks compile → black world).
      shader.vertexShader = `attribute float peepKind;\nvarying float vKind;\nvarying vec3 vPeepW;\nvarying vec3 vPeepN;\nvarying vec2 vPeepUv;\n${shader.vertexShader}`
        .replace(
          "#include <beginnormal_vertex>",
          `#include <beginnormal_vertex>
vPeepN = objectNormal;
vKind = peepKind;
vPeepUv = uv;`,
        )
        .replace(
          "#include <worldpos_vertex>",
          `#include <worldpos_vertex>
vPeepW = (modelMatrix * vec4(transformed, 1.0)).xyz;`,
        );
      shader.fragmentShader = `uniform float uTime;\nuniform float uPeepTime;\nuniform sampler2D uAtlas;\nvarying float vKind;\nvarying vec3 vPeepW;\nvarying vec3 vPeepN;\nvarying vec2 vPeepUv;\n${shader.fragmentShader}`;
      // Skip Three's map_fragment — vUv is world-space, not atlas UV.
      shader.fragmentShader = shader.fragmentShader.replace(
        "#include <map_fragment>",
        "// peep: atlas via uAtlas in color_fragment (world UV ≠ atlas UV)\n",
      );
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

    // Tufts share chunk buffers — discard them in the depth pass so blocks
    // still cast shadows without tuft cards blacking out grass tops.
    this.depthMaterial = new THREE.MeshDepthMaterial({
      depthPacking: THREE.RGBADepthPacking,
    });
    this.depthMaterial.customProgramCacheKey = () => "peep-depth-tuft-v3";
    this.depthMaterial.onBeforeCompile = (shader) => {
      shader.vertexShader = `attribute float peepKind;\nvarying float vKind;\n${shader.vertexShader}`.replace(
        "#include <begin_vertex>",
        `#include <begin_vertex>
vKind = peepKind;`,
      );
      shader.fragmentShader = `varying float vKind;\n${shader.fragmentShader}`.replace(
        "#include <clipping_planes_fragment>",
        `#include <clipping_planes_fragment>
if (floor(vKind + 0.1) == 99.0) discard;`,
      );
    };
    // Same side as color pass so dual-wound tuft cards aren't flipped into the map.
    this.material.shadowSide = THREE.FrontSide;

    // near < 0.1 wrecks Z precision across the island — hard floor at 0.1.
    this.camera = new THREE.PerspectiveCamera(75, 1, 0.1, 220);
    this.camera.rotation.order = "YXZ";
    this.camera.layers.enable(0);
    this.overlayCam = new THREE.PerspectiveCamera(60, 1, 0.1, 10);
    this.overlayCam.position.set(0, 0, 0);

    this.renderer = new THREE.WebGLRenderer({
      canvas: opts.canvas,
      antialias: false,
      alpha: false,
      powerPreference: "high-performance",
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
    this.renderer.autoClear = false;
    this.renderer.setClearColor(FOG_COLOR, 1);
    this.renderer.setClearAlpha(1);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.CineonToneMapping;
    this.renderer.toneMappingExposure = 1.1;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    // Midday blue clear matches Sky.js horizon / fog (no orange stripe).
    this.fog = new THREE.Fog(FOG_COLOR, FOG_NEAR, FOG_FAR);
    this.scene.background = null;
    this.scene.fog = this.fog;
    this.scene.environment = null;
    this.scene.add(this.terrain);

    this.scene.add(new THREE.AmbientLight(0xffffff, 0.35));
    const hemi = new THREE.HemisphereLight(0x87ceeb, 0x666666, 0.55);
    this.sun = new THREE.DirectionalLight(0xffffee, 1.5);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(SHADOW_MAP_SIZE, SHADOW_MAP_SIZE);
    this.sun.shadow.bias = -0.002;
    this.sun.shadow.normalBias = 0.05;
    this.sun.shadow.radius = 2;
    const scam = this.sun.shadow.camera;
    scam.left = -SHADOW_EXTENT;
    scam.right = SHADOW_EXTENT;
    scam.top = SHADOW_EXTENT;
    scam.bottom = -SHADOW_EXTENT;
    scam.near = 1;
    scam.far = SHADOW_EXTENT * 3;
    scam.updateProjectionMatrix();
    this.scene.add(hemi, this.sun, this.sun.target);
    // Head stays on layer 1 in FPS so the main camera skips it, but shadows still see it.
    this.sun.shadow.camera.layers.enable(0);
    this.sun.shadow.camera.layers.enable(1);
    this.material.needsUpdate = true;
    this.placeSunLight();

    this.lantern = new THREE.PointLight(
      LANTERN_COLOR,
      0,
      LANTERN_DISTANCE,
      LANTERN_DECAY,
    );
    this.lantern.castShadow = false;

    this.atmo = createAtmosphere(opts.seed);
    this.scene.add(this.atmo.group);

    this.streamChunks(false);
    this.bootMeshTotal = Math.max(1, this.dirtyChunks.size);
    this.bootMeshDone = 0;
    this.emitBootProgress(0.12);
    this.flushDirty(9);
    this.emitBootProgress();

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

    // Local = graphite Pip (createPlayerModel via createAvatar); remotes = white Friday.
    this.pickaxe = createHeldItem();
    this.localArm = createLocalArm(PIP);
    this.localBody = createAvatar(PIP, { hat: this.story.hat, telegramFace: true });
    setAvatarNametag(this.localBody, getTelegramDisplayName());
    this.applyLocalFpsVisibility(true);
    this.localBody.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) {
        o.castShadow = true;
        o.receiveShadow = true;
      }
    });
    // World pickaxe rides armRight so walk/jump swing carries the tool.
    this.mountPickaxeOnArm();
    this.scene.add(this.localBody);
    this.hatAnchor = hatSpot(opts.seed);
    this.hatProp = createTopHat();
    this.hatProp.position.set(this.hatAnchor.x, this.hatAnchor.y + 0.08, this.hatAnchor.z);
    this.hatProp.visible = opts.isCreator && !this.story.hat;
    this.scene.add(this.hatProp);
    const grain = createFilmGrain();
    this.grainMesh = grain.mesh;
    this.grainTime = grain.time;
    this.overlayScene.add(this.localArm);
    this.overlayScene.add(this.grainMesh);
    this.overlayScene.add(new THREE.AmbientLight(0xfff4e8, 0.9));
    const vl = new THREE.DirectionalLight(0xfff0d8, 0.9);
    vl.position.set(0.4, 1.2, 0.8);
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
    // Canvas click engages aim; try PL once in case the browser allows it immediately.
    this.tryLock();
    if (this.isLocked()) this.engageAim();
    else this.applyAimCursor();
    this.applyLocalFpsVisibility(true);
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
    if (!this.playing || this.inputBlocked()) return;
    if (!this.canGuestBuild()) return;
    if (performance.now() < this.nextEditAt) return;
    const spot = this.placeSpot();
    if (!spot?.ok) return;
    this.placeArmed = false;
    this.placing = true;
    this.placeT = 0;
    this.placeCharge = 0;
    this.placeKey = `${spot.x},${spot.y},${spot.z},${spot.block}`;
    this.placeTickT = 0;
    this.placeWait = 0;
    this.hudDirty = true;
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
    if (!this.playing || this.inputBlocked()) return;
    if (!this.canGuestBuild()) return;
    if (performance.now() < this.nextEditAt) return;
    if (!this.hit) return;
    this.mining = true;
    this.breakT = 0;
    this.breakCharge = 0;
    this.strikeT = 0;
    this.breakWait = 0;
    this.breakKey = `${this.hit.x},${this.hit.y},${this.hit.z}`;
    const block = this.world.get(this.hit.x, this.hit.y, this.hit.z);
    this.breakT = block === CHEST ? this.story.chestCraft * CHEST_CRAFT_S : 0;
    this.hudDirty = true;
    this.audio.strike(block);
    this.swing = 1;
  }

  endBreak() {
    this.mining = false;
    this.breakT = 0;
    if (this.breakCharge !== 0) this.hudDirty = true;
    this.breakCharge = 0;
    this.breakWait = 0;
    this.breakKey = "";
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
    if (!this.playing || this.inputBlocked()) return;
    if (this.onGround) this.doArcadeJump();
    else this.jumpQueued = true;
  }

  /** Mobile / overlay crouch hold. Desktop also uses remapped crouch key. */
  setCrouch(on: boolean) {
    this.crouchHeld = on;
  }

  /** Re-read desktop keybinds after settings change. */
  reloadKeybinds() {
    this.keybinds = readKeybinds();
  }

  private bindMatches(action: keyof Keybinds, code: string): boolean {
    const bound = this.keybinds[action];
    if (!bound) return false;
    if (bound === code) return true;
    if (
      (bound === "ControlLeft" || bound === "ControlRight") &&
      (code === "ControlLeft" || code === "ControlRight")
    ) {
      return true;
    }
    if (
      (bound === "ShiftLeft" || bound === "ShiftRight") &&
      (code === "ShiftLeft" || code === "ShiftRight")
    ) {
      return true;
    }
    return false;
  }

  private jumpWanted(): boolean {
    return this.jumpQueued || this.held(this.keybinds.jump);
  }

  /**
   * Takeoff. First hop is a stiff arcade step into the air.
   * Bunnyhop momentum only from the 2nd consecutive takeoff.
   */
  private doArcadeJump(): boolean {
    if (!this.playing || this.inputBlocked() || !this.onGround) return false;

    this.jumpChain += 1;
    const bhop = this.jumpChain >= 2;
    const walk = WALK_SPEED * (this.crouching ? CROUCH_SPEED_MUL : 1);
    const wish = this.wishDir();
    const moving = wish.mag > 0.05;

    let hx = this.vel.x;
    let hz = this.vel.z;

    if (!bhop) {
      // First jump: no slide carry — hard wish snap.
      if (moving) {
        hx = wish.x * walk;
        hz = wish.z * walk;
      } else {
        hx = 0;
        hz = 0;
      }
    } else {
      // Second+ takeoff: keep / boost horizontal speed.
      let speed = Math.hypot(hx, hz);
      if (moving && speed > walk * 0.75) {
        speed = Math.min(speed * BHOP_BOUNCE_MUL, walk * BHOP_MAX_MUL);
        if (speed > 0.05) {
          const cur = Math.hypot(hx, hz) || 1;
          hx = (hx / cur) * speed;
          hz = (hz / cur) * speed;
        }
      } else if (moving) {
        hx = wish.x * walk;
        hz = wish.z * walk;
      }
    }

    this.vel.x = hx;
    this.vel.z = hz;
    this.vel.y = JUMP_SPEED;
    this.onGround = false;
    this.jumpQueued = false;
    this.audio.jump();
    hapticJump();
    return true;
  }

  private moveIntentMag(): number {
    let fwd = 0;
    let strafe = 0;
    if (this.held("KeyW") || this.held("ArrowUp")) fwd += 1;
    if (this.held("KeyS") || this.held("ArrowDown")) fwd -= 1;
    if (this.held("KeyD") || this.held("ArrowRight")) strafe += 1;
    if (this.held("KeyA") || this.held("ArrowLeft")) strafe -= 1;
    fwd += this.moveZ;
    strafe += this.moveX;
    return Math.hypot(fwd, strafe);
  }

  private wishDir(): { x: number; z: number; mag: number } {
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
    if (mag > 1e-6) {
      fwd /= mag;
      strafe /= mag;
    }
    return {
      x: fwdX * fwd + rightX * strafe,
      z: fwdZ * fwd + rightZ * strafe,
      mag: Math.min(1, mag),
    };
  }

  private playerHeight(): number {
    return this.crouching ? CROUCH_HEIGHT : PLAYER_HEIGHT;
  }

  private eyeHeight(): number {
    return this.crouching ? CROUCH_EYE_HEIGHT : EYE_HEIGHT;
  }

  private updateCrouchState() {
    const keyCrouch = this.bindMatches("crouch", "ControlLeft")
      ? this.held("ControlLeft") || this.held("ControlRight")
      : this.bindMatches("crouch", "ShiftLeft")
        ? this.held("ShiftLeft") || this.held("ShiftRight")
        : this.held(this.keybinds.crouch);
    this.crouching = this.crouchHeld || keyCrouch;
  }

  playEmote(kind: EmoteKind) {
    if (!this.playing || this.inputBlocked()) return;
    const free = emoteIgnoresCooldown(kind);
    if (!free && performance.now() < this.emoteCdUntil) return;
    this.emote = { kind, age: 0 };
    if (!free) this.emoteCdUntil = performance.now() + EMOTE_COOLDOWN_S * 1000;
    this.audio.emote(kind);
    this.p2p.send({ t: "emote", kind } satisfies NetMsg);
    setAvatarFace(this.localBody, kind);
    if (kind === "hearts") this.spawnOverlayHearts();
    if (kind === "fart") {
      this.fartKick = 0.2;
    }
    if (kind === "censor") {
      this.censorFlashUntil = performance.now() + 520;
    }
    this.hudDirty = true;
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
    if (this.lookBlocked()) return;
    this.lookDelta(dx, dy);
  }

  /** Hat pickup / Friday intro — camera override, hide touch controls. */
  private lookBlocked(): boolean {
    if (this.cinematic) return true;
    if (this.guestFall || this.guestTntLock) return true;
    const f = this.fridayIntro;
    return Boolean(f && (f.phase === "fall" || f.phase === "tnt"));
  }

  /** Block move / dig / place — includes troll TNT rain (look still works). */
  private inputBlocked(): boolean {
    if (this.lookBlocked()) return true;
    return this.trollPhase === "drop";
  }

  private isCinematicActive(): boolean {
    return this.lookBlocked();
  }

  /** After a cinematic: release lock; next click re-requests Pointer Lock. */
  private restoreDesktopAim() {
    if (this.lookBlocked()) return;
    this.releasePointerLock();
    this.hudDirty = true;
  }

  private releasePointerLock() {
    try {
      if (document.pointerLockElement) document.exitPointerLock();
    } catch {
      /* ignore */
    }
  }

  /** Standing surface Y (feet) at xz. */
  private surfaceY(x: number, z: number): number {
    const ix = Math.floor(x);
    const iz = Math.floor(z);
    for (let y = WORLD_SY - 1; y >= 0; y--) {
      if (this.world.get(ix, y, iz) !== AIR) return y + 1;
    }
    return 1;
  }

  /** Desktop: re-request pointer lock after Esc / unlock (must run in click handler). */
  requestPointerLock() {
    if (!this.playing || this.inputBlocked()) return;
    if (this.isLocked()) return;
    if (!this.wantsDesktopLock()) return;
    this.tryLock();
  }

  setSelected(i: number) {
    if (i < 0 || i >= HOTBAR_SLOTS) return;
    this.selected = i;
    this.hudDirty = true;
  }

  /** Put `block` into hotbar slot `i` (0…4) and select it. */
  setHotbarSlot(i: number, block: number) {
    if (i < 0 || i >= HOTBAR_SLOTS) return;
    if (!(BLOCK_PALETTE as readonly number[]).includes(block) && block !== GOLD) return;
    if (block === GOLD && !(this.story.chest || countOf(this.story, GOLD) > 0)) return;
    this.hotbar[i] = block;
    this.selected = i;
    saveHotbar(this.opts.worldId, this.opts.playerId, this.hotbar);
    this.hudDirty = true;
  }

  clearInvBadge() {
    if (this.invBadge === 0) return;
    this.invBadge = 0;
    this.hudDirty = true;
  }

  private bumpInvBadge(n: number) {
    if (n <= 0) return;
    this.invBadge = Math.min(99, this.invBadge + n);
    this.hudDirty = true;
  }

  private lootBlock(block: number, n = 1) {
    if (n <= 0 || block <= 0) return;
    const before = countOf(this.story, block);
    addBlock(this.story, block, n);
    this.bumpInvBadge(countOf(this.story, block) - before);
  }

  private lootDynamiteReward(n: number) {
    const before = dynamiteCharges(this.story);
    addDynamite(this.story, n);
    this.bumpInvBadge(dynamiteCharges(this.story) - before);
  }

  private lootDynamiteFill() {
    const before = dynamiteCharges(this.story);
    fillDynamite(this.story);
    this.bumpInvBadge(dynamiteCharges(this.story) - before);
  }

  private lootDynamiteRefund() {
    const before = dynamiteCharges(this.story);
    refundDynamite(this.story);
    this.bumpInvBadge(dynamiteCharges(this.story) - before);
  }

  pickupHat() {
    if (this.inputBlocked() || !this.opts.isCreator || this.story.hat || !this.hatPrompt) return;
    this.cinematic = { t: 0 };
    this.hatPrompt = false;
    this.playing = true;
    this.localBody.visible = true;
    this.applyLocalFpsVisibility(false); // show head during hat cinematic
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
    this.opts.onWorldDirty?.();
  }

  /**
   * Compact delta for Telegram lazy-save: only touched voxels + inventory.
   * Returns null outside Telegram (no tg_user_id).
   */
  serializeWorld(): WorldSavePayload | null {
    const tg = getTelegramSaveId();
    if (!tg) return null;
    return {
      tg_user_id: tg,
      world_id: this.opts.worldId,
      seed: this.opts.seed,
      edits: this.world.listEdits(),
      inventory: {
        counts: { ...this.story.counts },
        friday: this.story.friday,
        hat: this.story.hat,
        chest: this.story.chest,
        chestCraft: this.story.chestCraft,
        dynamiteCharges: this.story.dynamiteCharges,
        dynamiteRechargeAt: this.story.dynamiteRechargeAt,
        trollQuestDone: this.story.trollQuestDone,
      },
    };
  }

  private palette(): number[] {
    return this.hotbar.slice(0, HOTBAR_SLOTS);
  }

  /** Full inventory catalog (unlocked blocks). */
  private catalog(): number[] {
    const slots: number[] = [...BLOCK_PALETTE];
    const dynIdx = slots.indexOf(DYNAMITE);
    if (this.story.chest || countOf(this.story, GOLD) > 0) {
      if (dynIdx >= 0) slots.splice(dynIdx, 0, GOLD);
      else slots.push(GOLD);
    }
    return slots;
  }

  dispose() {
    this.disposed = true;
    this.renderer.setAnimationLoop(null);
    this.releasePointerLock();
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
    for (const f of this.fallingTnt) {
      this.scene.remove(f.mesh);
      f.mesh.geometry.dispose();
      (f.mesh.material as THREE.Material).dispose();
    }
    this.fallingTnt.length = 0;
    this.endFridayIntro(false);
    this.clearGuestTnt();
    this.clearFloorHint();
    this.renderer.dispose();
    this.resizeObs?.disconnect();
    if (window.__controlsTest) delete window.__controlsTest;
    window.__peepReady = false;
  }

  private bind() {
    const c = this.opts.canvas;
    this.onKeyDown = this.onKeyDown.bind(this);
    this.onKeyUp = this.onKeyUp.bind(this);
    this.onPointerDown = this.onPointerDown.bind(this);
    this.onPointerUp = this.onPointerUp.bind(this);
    this.onContext = this.onContext.bind(this);
    this.onWheel = this.onWheel.bind(this);
    this.onBlur = this.onBlur.bind(this);
    this.onVis = this.onVis.bind(this);
    this.onOrient = this.onOrient.bind(this);
    this.onLock = this.onLock.bind(this);
    this.onLockError = this.onLockError.bind(this);
    this.onCanvasClick = this.onCanvasClick.bind(this);
    window.addEventListener("keydown", this.onKeyDown);
    window.addEventListener("keyup", this.onKeyUp);
    window.addEventListener("blur", this.onBlur);
    document.addEventListener("visibilitychange", this.onVis);
    window.addEventListener("orientationchange", this.onOrient);
    window.addEventListener("resize", this.onOrient);
    document.addEventListener("pointerlockchange", this.onLock);
    document.addEventListener("pointerlockerror", this.onLockError);
    // Capture mousemove: CEF TG Desktop drops pointermove without button; mousemove is reliable.
    window.addEventListener("mousemove", this.onGlobalPointerMove, true);
    window.addEventListener("pointerdown", this.onPointerDown, true);
    c.addEventListener("click", this.onCanvasClick);
    window.addEventListener("pointerup", this.onPointerUp);
    window.addEventListener("pointercancel", this.onPointerUp);
    c.addEventListener("contextmenu", this.onContext);
    c.addEventListener("wheel", this.onWheel, { passive: true });
    c.addEventListener("selectstart", this.onContext);
    this.resizeObs = new ResizeObserver(() => this.resize());
    this.resizeObs.observe(c.parentElement ?? c);
  }

  private unbind() {
    const c = this.opts.canvas;
    window.removeEventListener("keydown", this.onKeyDown);
    window.removeEventListener("keyup", this.onKeyUp);
    window.removeEventListener("blur", this.onBlur);
    document.removeEventListener("visibilitychange", this.onVis);
    window.removeEventListener("orientationchange", this.onOrient);
    window.removeEventListener("resize", this.onOrient);
    document.removeEventListener("pointerlockchange", this.onLock);
    document.removeEventListener("pointerlockerror", this.onLockError);
    window.removeEventListener("mousemove", this.onGlobalPointerMove, true);
    window.removeEventListener("pointerdown", this.onPointerDown, true);
    c.removeEventListener("click", this.onCanvasClick);
    window.removeEventListener("pointerup", this.onPointerUp);
    window.removeEventListener("pointercancel", this.onPointerUp);
    c.removeEventListener("contextmenu", this.onContext);
    c.removeEventListener("wheel", this.onWheel);
    c.removeEventListener("selectstart", this.onContext);
  }

  private onKeyDown(e: KeyboardEvent) {
    if (e.repeat && e.code.startsWith("Digit")) return;
    if (e.code === "Escape") {
      this.hudDirty = true;
    }
    if (this.bindMatches("break", e.code)) {
      e.preventDefault();
      this.beginBreak();
      this.keys.add(e.code);
      return;
    }
    if (this.bindMatches("place", e.code)) {
      e.preventDefault();
      this.beginPlace();
      this.keys.add(e.code);
      return;
    }
    if (e.code === "KeyF") {
      this.playEmote("fart");
      return;
    }
    if (e.code === "KeyC") {
      this.playEmote("censor");
      return;
    }
    if (e.code >= "Digit1" && e.code <= "Digit5") {
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
    if (e.code === "KeyX") {
      this.playEmote("death");
      return;
    }
    if (e.code === "KeyV") {
      this.playEmote("attention");
      return;
    }
    if (e.code === "KeyB") {
      this.playEmote("sixSeven");
      return;
    }
    this.keys.add(e.code);
    if (
      [
        "KeyW",
        "KeyA",
        "KeyS",
        "KeyD",
        this.keybinds.jump,
        "ControlLeft",
        "ControlRight",
        "ShiftLeft",
        "ShiftRight",
      ].includes(e.code)
    ) {
      e.preventDefault();
    }
  }

  private onKeyUp(e: KeyboardEvent) {
    if (this.bindMatches("break", e.code)) this.endBreak();
    if (this.bindMatches("place", e.code)) this.endPlace();
    this.keys.delete(e.code);
  }

  private onBlur() {
    this.keys.clear();
    this.jumpQueued = false;
    this.dragging = false;
    this.moveX = 0;
    this.moveZ = 0;
    this.lastMouseX = undefined;
    this.lastMouseY = undefined;
    this.endPlace();
    this.endBreak();
  }

  private onVis() {
    if (document.visibilityState !== "visible") this.onBlur();
  }

  private onOrient() {
    window.setTimeout(() => this.resize(), 50);
  }

  private isLocked(): boolean {
    return document.pointerLockElement === this.opts.canvas;
  }

  /** Fine pointer desktop, or Telegram Desktop clients (tdesktop/macos/windows/linux). */
  private wantsDesktopLock(): boolean {
    if (isTelegramMobilePlatform()) return false;
    if (isTelegramDesktopPlatform()) return true;
    return window.matchMedia("(pointer: fine)").matches;
  }

  private applyAimCursor() {
    const c = this.opts.canvas;
    if (this.isLocked() || this.aimEngaged) {
      // CEF bypass: transparent GIF keeps mouse-move events flowing (cursor:none stalls them).
      if (isTelegramDesktopPlatform() && !this.isLocked()) {
        c.style.cursor =
          "url(data:image/gif;base64,R0lGODlhAQABAIAAAP///wAAACH5BAEAAAAALAAAAAABAAEAAAICRAEAOw==), auto";
      } else {
        c.style.cursor = "none";
      }
      c.classList.add("peep-aim-cursor");
    } else {
      c.style.cursor = "";
      c.classList.remove("peep-aim-cursor");
    }
  }

  private engageAim() {
    this.aimEngaged = true;
    this.applyAimCursor();
    this.hudDirty = true;
  }

  private disengageAim() {
    this.aimEngaged = false;
    // Reseed on next move — cursor may have jumped while free.
    this.lastMouseX = undefined;
    this.lastMouseY = undefined;
    this.applyAimCursor();
    this.hudDirty = true;
  }

  private onLock() {
    this.pointerLocked = this.isLocked();
    if (this.pointerLocked) {
      this.pointerLockDenied = false;
      this.aimEngaged = true;
      this.dragging = false;
      this.lastMouseX = undefined;
      this.lastMouseY = undefined;
    } else {
      // ESC / unlock — free the cursor until the next canvas click.
      this.disengageAim();
      this.endPlace();
      this.endBreak();
    }
    this.applyAimCursor();
    this.hudDirty = true;
  }

  private onLockError() {
    this.pointerLocked = false;
    this.pointerLockDenied = true;
    this.dragging = false;
    this.applyAimCursor();
    this.hudDirty = true;
  }

  private onCanvasClick(e: MouseEvent) {
    if (!this.playing || this.inputBlocked()) return;
    if (e.button !== 0) return;
    if (!this.wantsDesktopLock()) return;
    if (this.isLocked()) return;
    e.preventDefault();
    this.engageAim();
    this.tryLock();
  }

  /**
   * Window capture mousemove — survives HUD overlays.
   * Pointer Lock uses movementX; TG Desktop bypass uses clientX delta while aimEngaged.
   */
  private onGlobalPointerMove = (e: MouseEvent) => {
    // Безопасная проверка для MouseEvent:
    if ("pointerType" in e && (e as PointerEvent).pointerType === "touch") return;

    // 1. СТАНДАРТНЫЙ POINTER LOCK (Если сработал)
    if (this.isLocked()) {
      if (!this.playing || this.inputBlocked()) return;
      this.lookDelta(e.movementX, e.movementY);
      return;
    }

    // 2. BYPASS ДЛЯ TELEGRAM DESKTOP
    if (!this.wantsDesktopLock()) return;

    // Крутим камеру ТОЛЬКО если курсор скрыт (режим игры, а не меню)
    if (!this.aimEngaged) return;

    if (this.lastMouseX === undefined || this.lastMouseY === undefined) {
      this.lastMouseX = e.clientX;
      this.lastMouseY = e.clientY;
      return;
    }

    const mx = e.clientX - this.lastMouseX;
    const my = e.clientY - this.lastMouseY;

    this.lastMouseX = e.clientX;
    this.lastMouseY = e.clientY;

    if (!this.playing || this.inputBlocked()) return;
    if (mx === 0 && my === 0) return;

    this.lookDelta(mx, my);
  };

  private lookDelta(dx: number, dy: number) {
    this.yaw -= dx * LOOK_SENS;
    this.pitch -= dy * LOOK_SENS;
    this.pitch = Math.max(-PITCH_LIM, Math.min(PITCH_LIM, this.pitch));
  }

  private isCanvasPointerTarget(target: EventTarget | null): boolean {
    if (!(target instanceof Node)) return false;
    return target === this.opts.canvas || this.opts.canvas.contains(target);
  }

  private onPointerDown(e: PointerEvent) {
    if (!this.playing || this.inputBlocked()) return;
    if (e.button > 2) return;
    // Phone/tablet: look and break/place live on the pads, not the canvas.
    if (e.pointerType === "touch") return;
    // Capture on window: ignore HUD / buttons — only canvas engages dig/look.
    if (!this.isCanvasPointerTarget(e.target)) return;

    this.ptrButton = e.button;
    this.ptrStartX = e.clientX;
    this.ptrStartY = e.clientY;
    this.lastPtrX = e.clientX;
    this.lastPtrY = e.clientY;
    this.ptrMoved = false;
    this.tapSlop = 6;

    // First canvas click after ESC / cold start: engage + PL only — NOT dig.
    if (!this.isLocked() && this.wantsDesktopLock() && !this.aimEngaged) {
      e.preventDefault();
      this.engageAim();
      this.tryLock();
      return;
    }

    // LMB/RMB: dig & place ONLY — never feeds camera look.
    if (codeFromMouseButton(e.button) === this.keybinds.break) this.beginBreak();
    if (codeFromMouseButton(e.button) === this.keybinds.place) this.beginPlace();
  }

  private onPointerUp(e: PointerEvent) {
    if (codeFromMouseButton(e.button) === this.keybinds.break) this.endBreak();
    if (codeFromMouseButton(e.button) === this.keybinds.place) this.endPlace();
    this.dragging = false;
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
   * Classic sync Pointer Lock — must run inside click/mousedown with no await/setTimeout.
   */
  private tryLock() {
    if (this.isLocked()) return;
    const el = this.opts.canvas;
    try {
      el.requestPointerLock();
    } catch {
      this.onLockError();
    }
  }

  /** Grip pose relative to armRight hand (arm held forward). */
  private pickaxeGrip: PickaxeGrip = {
    x: -0.025,
    y: 0.155,
    z: -0.125,
    rx: -0.59,
    ry: 1.48,
    rz: -0.75,
    scale: 0.95,
  };

  /** Local right-arm rest pose (before dig / walk bob). */
  private armHold: ArmHoldPose = {
    rx: 1.12,
    ry: 0.06,
    rz: -0.12,
  };

  getPickaxeGrip(): Readonly<PickaxeGrip> {
    return { ...this.pickaxeGrip };
  }

  setPickaxeGrip(partial: Partial<PickaxeGrip>) {
    Object.assign(this.pickaxeGrip, partial);
  }

  getArmHold(): Readonly<ArmHoldPose> {
    return { ...this.armHold };
  }

  setArmHold(partial: Partial<ArmHoldPose>) {
    Object.assign(this.armHold, partial);
  }

  getToolPose(): ToolPoseExport {
    return { pickaxe: this.getPickaxeGrip(), arm: this.getArmHold() };
  }

  setToolPose(pose: Partial<ToolPoseExport>) {
    if (pose.pickaxe) this.setPickaxeGrip(pose.pickaxe);
    if (pose.arm) this.setArmHold(pose.arm);
  }

  private mountPickaxeOnArm() {
    const armR =
      this.localBody.getObjectByName("armRight") ?? this.localBody.getObjectByName("armR");
    const hand = (armR?.getObjectByName("hand") as THREE.Object3D | undefined) ?? armR;
    if (!hand) return;
    if (this.pickaxe.parent) this.pickaxe.parent.remove(this.pickaxe);
    const g = this.pickaxeGrip;
    this.pickaxe.position.set(g.x, g.y, g.z);
    this.pickaxe.rotation.set(g.rx, g.ry, g.rz);
    this.pickaxe.scale.setScalar(g.scale);
    this.pickaxe.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) {
        o.castShadow = true;
        o.receiveShadow = true;
      }
    });
    hand.add(this.pickaxe);
  }

  private held(code: string): boolean {
    return (this.keyOverride ?? this.keys).has(code);
  }

  private resize() {
    const parent = this.opts.canvas.parentElement ?? this.opts.canvas;
    const { w, h } = gameViewSize(parent);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.overlayCam.aspect = Math.max(w / h, 1.2);
    this.overlayCam.fov = 50;
    this.overlayCam.updateProjectionMatrix();
    this.renderer.setSize(w, h, false);
    this.opts.canvas.style.width = "100%";
    this.opts.canvas.style.height = "100%";
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
    const geo = buildChunkGeometry(this.world, cx, cz);
    const existing = this.chunkMeshes.get(key);
    if (existing) {
      // Reuse the Mesh so WebGL VAO/material bindings stay valid. Disposing the
      // previous geometry *before* reassigning leaves the shared Lambert program
      // briefly bound to freed buffers → black quads / broken shading on remesh.
      const prev = existing.geometry;
      existing.geometry = geo;
      existing.castShadow = true;
      existing.receiveShadow = true;
      existing.customDepthMaterial = this.depthMaterial;
      prev.dispose();
      return;
    }
    const mesh = new THREE.Mesh(geo, this.material);
    mesh.frustumCulled = true;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.customDepthMaterial = this.depthMaterial;
    this.terrain.add(mesh);
    this.chunkMeshes.set(key, mesh);
  }

  /** Shadow ortho follows the player; sun sits high for near-vertical midday shadows. */
  private placeSunLight() {
    const focusX = this.pos.x;
    const focusY = this.pos.y + 4;
    const focusZ = this.pos.z;
    this.sun.target.position.set(focusX, focusY, focusZ);
    this.sun.position
      .copy(SUN_DIR)
      .multiplyScalar(SHADOW_EXTENT * 1.6)
      .add(this.sun.target.position);
    this.sun.target.updateMatrixWorld();
    this.sun.shadow.camera.updateProjectionMatrix();
  }

  /** Belt lantern sits on the hip and shines ahead along yaw (not camera pitch). */
  private updateLantern() {
    const fx = -Math.sin(this.yaw);
    const fz = -Math.cos(this.yaw);
    this.lantern.position.set(
      this.pos.x + fx * 0.45,
      this.pos.y + 1.05,
      this.pos.z + fz * 0.45,
    );
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
    // Vertex AO samples ±1 (incl. diagonals) — remesh neighbors when near a seam
    // so border lighting stays continuous after place/break.
    const nearL = lx <= 1;
    const nearR = lx >= CHUNK_S - 2;
    const nearB = lz <= 1;
    const nearT = lz >= CHUNK_S - 2;
    if (nearL) this.markDirty(cx - 1, cz);
    if (nearR) this.markDirty(cx + 1, cz);
    if (nearB) this.markDirty(cx, cz - 1);
    if (nearT) this.markDirty(cx, cz + 1);
    if (nearL && nearB) this.markDirty(cx - 1, cz - 1);
    if (nearR && nearB) this.markDirty(cx + 1, cz - 1);
    if (nearL && nearT) this.markDirty(cx - 1, cz + 1);
    if (nearR && nearT) this.markDirty(cx + 1, cz + 1);
  }

  /** A few rebuilds per frame — mid-Android freeze otherwise. */
  private flushDirty(limit = MESH_PER_FRAME) {
    if (this.dirtyChunks.size === 0) {
      if (this.bootMeshTotal > 0 && this.bootMeshDone < this.bootMeshTotal) {
        this.bootMeshDone = this.bootMeshTotal;
      }
      this.emitBootProgress();
      return;
    }
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
      if (this.bootMeshDone < this.bootMeshTotal) this.bootMeshDone += 1;
    }
    this.lastMeshMs = performance.now() - t0;
    if (this.lastMeshMs > this.maxMeshMs) this.maxMeshMs = this.lastMeshMs;
    this.emitBootProgress();
  }

  private emitBootProgress(floor?: number) {
    if (!this.opts.onBootProgress) return;
    const mesh =
      this.bootMeshTotal > 0 ? Math.min(1, this.bootMeshDone / this.bootMeshTotal) : 1;
    // First ~12% is world/atlas init; the rest tracks view-ring chunk meshes.
    const p = Math.max(floor ?? 0, 0.12 + mesh * 0.88);
    const rounded = Math.round(p * 200) / 200;
    if (rounded <= this.bootReported && rounded < 1) return;
    this.bootReported = rounded;
    this.opts.onBootProgress(Math.min(1, rounded));
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
    this.updateFridayIntro(dt);
    this.updateGuestFall(dt);
    this.updateCamera(dt);
    this.updateLocalFpsBody(dt);
    tickAtmosphere(this.atmo, this.camera, dt);
    this.updateRemotes(dt);
    this.updateEmote(dt);
    this.updateParticles(dt);
    this.updateEmoteFx(dt);
    this.updatePickaxe(dt);
    this.grainTime.value = this.anim;
    this.audio.tickAmbient(dt);
    this.updateHighlight();
    this.updateBuild(dt);
    this.updateChestBar();
    this.updateTrollQuest(dt);
    this.netTick(now);
    this.flushDirty();
    if (this.hudDirty) this.emitHud();

    this.placeSunLight();
    this.renderer.clear();
    this.renderer.render(this.scene, this.camera);
    this.renderer.clearDepth();
    this.renderer.render(this.overlayScene, this.overlayCam);
    const info = this.renderer.info.render;
    this.drawCalls = info.calls;
    this.triangles = info.triangles;
  }

  private fixed(dt: number) {
    if (this.guestFall) {
      this.stepGuestFall(dt);
      return;
    }
    if (this.guestTntLock) {
      this.vel.x *= 0.7;
      this.vel.z *= 0.7;
      this.vel.y -= GRAVITY * dt;
      this.collide(dt);
      this.stepGuestTnt(dt);
      return;
    }
    if (!this.playing || this.inputBlocked()) {
      this.vel.x *= 0.7;
      this.vel.z *= 0.7;
      this.vel.y -= GRAVITY * dt;
      this.collide(dt);
      return;
    }

    this.updateCrouchState();
    const wish = this.wishDir();
    const wasGround = this.onGround;
    const fallSpeed = this.vel.y;
    const walk = WALK_SPEED * (this.crouching ? CROUCH_SPEED_MUL : 1);
    const bhopActive = this.jumpChain >= 2;

    if (this.onGround) {
      this.vel.y -= GRAVITY * dt;
      if (this.jumpWanted()) {
        this.doArcadeJump();
      } else {
        let hx = this.vel.x;
        let hz = this.vel.z;
        let speed = Math.hypot(hx, hz);

        if (!bhopActive) {
          // Hard steps: instant walk / hard stop — no ice slide.
          if (wish.mag > 0.05) {
            hx = wish.x * walk;
            hz = wish.z * walk;
          } else {
            hx = 0;
            hz = 0;
          }
        } else if (wish.mag > 0.05) {
          // Brief ground touch mid-bhop: keep speed, soft steer.
          const tx = wish.x * Math.max(walk, speed);
          const tz = wish.z * Math.max(walk, speed);
          const cur = Math.hypot(hx, hz);
          if (cur > walk) {
            const damp = Math.exp(-BHOP_GROUND_FRICTION * dt);
            const keep = walk + (cur - walk) * damp;
            const s = keep / cur;
            hx *= s;
            hz *= s;
            speed = Math.hypot(hx, hz);
          }
          if (speed > 0.05) {
            const dx = hx / speed;
            const dz = hz / speed;
            const wx = tx / (Math.hypot(tx, tz) || 1);
            const wz = tz / (Math.hypot(tx, tz) || 1);
            const t = 1 - Math.exp(-BHOP_AIR_TURN * 0.65 * dt);
            let nx = dx + (wx - dx) * t;
            let nz = dz + (wz - dz) * t;
            const nlen = Math.hypot(nx, nz) || 1;
            hx = (nx / nlen) * speed;
            hz = (nz / nlen) * speed;
          } else {
            hx = wish.x * walk;
            hz = wish.z * walk;
          }
        } else if (speed > 0.05) {
          const damp = Math.exp(-GROUND_FRICTION * dt);
          hx *= damp;
          hz *= damp;
          if (Math.hypot(hx, hz) < 0.12) {
            hx = 0;
            hz = 0;
          }
        } else {
          hx = 0;
          hz = 0;
        }
        this.vel.x = hx;
        this.vel.z = hz;
      }
    } else {
      let hx = this.vel.x;
      let hz = this.vel.z;
      let speed = Math.hypot(hx, hz);

      if (wish.mag > 0.05) {
        if (!bhopActive) {
          // First hop air control: gentle nudge, capped at walk — no ice glide.
          const tx = wish.x * walk;
          const tz = wish.z * walk;
          hx += (tx - hx) * Math.min(1, 10 * dt);
          hz += (tz - hz) * Math.min(1, 10 * dt);
          speed = Math.hypot(hx, hz);
          if (speed > walk) {
            hx = (hx / speed) * walk;
            hz = (hz / speed) * walk;
          }
        } else if (speed < 0.12) {
          hx = wish.x * walk * 0.45;
          hz = wish.z * walk * 0.45;
        } else {
          // Bhop air: preserve speed; turn velocity toward wish.
          const dx = hx / speed;
          const dz = hz / speed;
          const t = 1 - Math.exp(-BHOP_AIR_TURN * dt);
          let nx = dx + (wish.x - dx) * t;
          let nz = dz + (wish.z - dz) * t;
          const nlen = Math.hypot(nx, nz) || 1;
          nx /= nlen;
          nz /= nlen;
          hx = nx * speed;
          hz = nz * speed;
        }
      } else if (speed > 0.05) {
        speed *= Math.exp(-(bhopActive ? BHOP_AIR_DRAG : GROUND_FRICTION * 0.35) * dt);
        const cur = Math.hypot(hx, hz) || 1;
        hx = (hx / cur) * speed;
        hz = (hz / cur) * speed;
      }

      this.vel.x = hx;
      this.vel.z = hz;
      const gMul = this.crouching ? BHOP_AIR_CROUCH_GRAVITY : 1;
      this.vel.y -= GRAVITY * gMul * dt;
    }

    this.collide(dt);

    if (!wasGround && this.onGround) {
      if (fallSpeed < -3) this.audio.land(this.groundBlock());
      if (this.jumpWanted()) {
        // Second+ takeoff in the same chain (auto-bhop).
        this.doArcadeJump();
      } else {
        // Broke the chain — hard step resume.
        this.jumpChain = 0;
        if (wish.mag > 0.05) {
          this.vel.x = wish.x * walk;
          this.vel.z = wish.z * walk;
        } else {
          this.vel.x = 0;
          this.vel.z = 0;
        }
      }
    }

    if (this.pos.y < -6) {
      const s = this.world.spawn();
      this.pos.set(s.x, s.y, s.z);
      this.vel.set(0, 0, 0);
      this.jumpQueued = false;
      this.jumpChain = 0;
    }
    const moving = wish.mag > 0.05 && this.onGround;
    const groundSpd = Math.hypot(this.vel.x, this.vel.z);
    this.bobWalkAmt = this.onGround
      ? Math.min(1, groundSpd / Math.max(0.01, WALK_SPEED))
      : Math.max(0, this.bobWalkAmt - dt * 4);
    if (groundSpd > 0.08) this.viewBobPhase += groundSpd * dt * 2.35;
    else this.viewBobPhase += dt * 0.85; // idle breath cadence
    this.bob = this.viewBobPhase;
    if (moving) {
      this.stepAcc += groundSpd * dt;
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
      const u = this.emote.age / emoteDuration(this.emote.kind);
      const fade = u < 0.12 ? u / 0.12 : u > 0.8 ? (1 - u) / 0.2 : 1;
      if (this.emote.kind === "hearts") {
        this.camYawOff = Math.sin(this.emote.age * 3.2) * 0.045 * fade;
        this.camPitchOff = Math.cos(this.emote.age * 2.4) * 0.03 * fade;
      } else if (this.emote.kind === "laugh" || this.emote.kind === "sixSeven") {
        this.camRoll = Math.sin(this.emote.age * 18) * 0.05 * fade;
        this.camPitchOff = Math.sin(this.emote.age * 22) * 0.028 * fade;
      }
    }
    const walkAmt = this.bobWalkAmt;
    const breathe = Math.sin(this.anim * 1.7) * 0.01;
    const bobY = Math.sin(this.viewBobPhase) * 0.05 * walkAmt + breathe * (1 - walkAmt * 0.6);
    const bobSide = Math.cos(this.viewBobPhase * 0.5) * 0.025 * walkAmt;
    const eye = this.pos.y + this.eyeHeight() + bobY;
    const sideX = Math.cos(this.yaw) * bobSide;
    const sideZ = -Math.sin(this.yaw) * bobSide;
    const fi = this.fridayIntro;
    if (fi && (fi.phase === "fall" || fi.phase === "tnt")) {
      this.camera.position.set(this.pos.x, eye, this.pos.z);
      if (fi.phase === "tnt" && fi.follow) {
        this.camera.lookAt(fi.follow.position.x, fi.follow.position.y, fi.follow.position.z);
      } else {
        const r = this.remotes.get(fi.remoteId);
        if (r) this.camera.lookAt(r.x, r.y + 1.1, r.z);
      }
    } else if (this.cinematic) {
      const u = Math.min(1, this.cinematic.t / 4.2);
      const pull = u < 0.18 ? u / 0.18 : u > 0.82 ? 1 - (u - 0.82) / 0.18 : 1;
      // Face the character: stand in front along look-yaw, look back at the face.
      const fx = -Math.sin(this.yaw);
      const fz = -Math.cos(this.yaw);
      const dist = 0.12 + pull * 3.15;
      const height = eye + pull * 0.35;
      this.camera.position.set(this.pos.x + fx * dist, height, this.pos.z + fz * dist);
      this.camera.lookAt(this.pos.x, this.pos.y + 1.35, this.pos.z);
    } else {
      // Eyes near neck — look down to see torso / arms / legs.
      this.camera.position.set(this.pos.x + sideX, eye, this.pos.z + sideZ);
      this.camera.rotation.set(this.pitch + this.camPitchOff, this.yaw + this.camYawOff, this.camRoll);
    }
    if (this.fartKick > 0) {
      const k = Math.min(1, this.fartKick / 0.2);
      this.camera.position.y += 0.05 * k;
      this.camera.position.x -= Math.sin(this.yaw) * 0.03 * k;
      this.camera.position.z -= Math.cos(this.yaw) * 0.03 * k;
      this.camPitchOff -= 0.06 * k;
      this.camera.rotation.set(this.pitch + this.camPitchOff, this.yaw + this.camYawOff, this.camRoll);
      this.fartKick = Math.max(0, this.fartKick - dt);
    }
    this.updateLantern();
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
      this.applyLocalFpsVisibility(true);
      setAvatarFace(this.localBody, "idle");
      this.pickaxe.visible = true;
      this.p2p.send({ t: "look", hat: true } satisfies NetMsg);
      this.restoreDesktopAim();
      this.hudDirty = true;
    }
  }

  private updateHighlight() {
    const hit = this.playing && !this.inputBlocked()
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
    if (this.inputBlocked()) {
      this.placeGhost.mesh.visible = false;
      this.breakFx.group.visible = false;
      return;
    }
    refreshDynamite(this.story);
    if (this.story.dynamiteCharges < DYNAMITE_MAX_CHARGES) this.hudDirty = true;
    this.updateFuses(dt);
    if (this.notice && performance.now() >= this.noticeUntil) {
      this.notice = null;
      this.hudDirty = true;
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
    // Locked to the cell chosen on press — no slide-to-place while held.
    if (this.placing && this.placeKey && key !== this.placeKey) {
      this.endPlace();
      return;
    }
    if (!this.placing && key !== this.placeKey) {
      this.placeKey = key;
      this.placeT = 0;
    }
    this.placeGhost.mesh.visible = true;
    this.placeGhost.mesh.position.set(spot.x + 0.5, spot.y + 0.5, spot.z + 0.5);
    const color = spot.block === BARRIER ? 0x6a90b8 : (BLOCK_COLORS[spot.block] ?? 0x888888);
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
      this.endPlace();
      return;
    }
    this.placeT += dt;
    const next = Math.min(1, this.placeT / PLACE_HOLD_S);
    if (next !== this.placeCharge) {
      this.placeCharge = next;
      this.hudDirty = true;
    }
    // One swing when this place charge starts (1 hit = 1 anim).
    if (this.placeT - dt <= 0) {
      this.audio.placeTick(spot.block);
      this.swing = 1;
    }
    if (this.placeT >= PLACE_HOLD_S) {
      const ok = this.placeBlock();
      if (ok) this.opts.onPlaced?.();
      this.nextEditAt = performance.now() + EDIT_REPEAT_DELAY_MIN_S * 1000;
      // One press → one block. Holding RMB does not keep placing.
      this.endPlace();
      if (ok) this.hudDirty = true;
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
      // Lost target mid-press — cancel (no auto-acquire while held).
      if (this.mining && !this.hit) this.endBreak();
      return;
    }
    const block = this.world.get(this.hit.x, this.hit.y, this.hit.z);
    const chest = block === CHEST;
    const holdS = chest ? CHEST_CRAFT_S : BREAK_HOLD_S;
    const key = `${this.hit.x},${this.hit.y},${this.hit.z}`;
    // Locked to the cell chosen on press — looking away cancels.
    if (key !== this.breakKey) {
      this.endBreak();
      return;
    }
    this.breakT += dt;
    // Chest only: periodic strikes while crafting. Normal blocks = 1 swing at start.
    if (chest) {
      this.strikeT += dt;
      if (this.strikeT >= 0.55) {
        this.strikeT = 0;
        this.audio.strike(block);
        this.swing = 1;
      }
    }
    const next = Math.min(1, this.breakT / holdS);
    if (chest) {
      this.story.chestCraft = next;
      this.chestCraftSaveT += dt;
      if (this.chestCraftSaveT >= 0.5) {
        this.chestCraftSaveT = 0;
        this.persist();
      }
      // Chest has its own world-space HP bar — don't also charge the pickaxe ring.
      if (this.breakCharge !== 0) {
        this.breakCharge = 0;
        this.hudDirty = true;
      }
    } else if (next !== this.breakCharge) {
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
    if (this.breakT >= holdS) {
      if (chest) {
        this.story.chestCraft = 1;
        this.persist();
      }
      this.breakBlock();
      this.nextEditAt = performance.now() + EDIT_REPEAT_DELAY_MIN_S * 1000;
      this.breakFx.group.visible = false;
      this.hudDirty = true;
      // One press → one block. Holding LMB does not keep mining (chest ends too).
      this.endBreak();
    }
  }

  private updateChestBar() {
    if (this.story.chest || this.world.get(CHEST_X, CHEST_Y, CHEST_Z) !== CHEST) {
      if (this.chestBar) {
        this.chestBar = null;
        this.hudDirty = true;
      }
      return;
    }
    const dx = this.pos.x - (CHEST_X + 0.5);
    const dy = this.pos.y - (CHEST_Y + 0.5);
    const dz = this.pos.z - (CHEST_Z + 0.5);
    const near = dx * dx + dy * dy + dz * dz <= CHEST_BAR_RANGE * CHEST_BAR_RANGE;
    if (!near) {
      if (this.chestBar) {
        this.chestBar = null;
        this.hudDirty = true;
      }
      return;
    }
    this.chestScr.set(CHEST_X + 0.5, CHEST_Y + 1.35, CHEST_Z + 0.5);
    this.chestScr.project(this.camera);
    const behind = this.chestScr.z > 1;
    const el = this.renderer.domElement;
    const x = (this.chestScr.x * 0.5 + 0.5) * el.clientWidth;
    const y = (-this.chestScr.y * 0.5 + 0.5) * el.clientHeight;
    const onScreen =
      !behind &&
      x > -40 &&
      x < el.clientWidth + 40 &&
      y > -40 &&
      y < el.clientHeight + 40;
    const crafting =
      this.mining &&
      this.breakWait <= 0 &&
      !!this.hit &&
      this.hit.x === CHEST_X &&
      this.hit.y === CHEST_Y &&
      this.hit.z === CHEST_Z;
    const craft = this.story.chestCraft;
    const hp = 1 - craft;
    const next = onScreen
      ? { x, y, hp, craft, crafting }
      : null;
    const prev = this.chestBar;
    if (
      !prev !== !next ||
      (next &&
        prev &&
        (Math.abs(prev.x - next.x) > 0.5 ||
          Math.abs(prev.y - next.y) > 0.5 ||
          Math.abs(prev.hp - next.hp) > 0.002 ||
          Math.abs(prev.craft - next.craft) > 0.002 ||
          prev.crafting !== next.crafting))
    ) {
      this.chestBar = next;
      this.hudDirty = true;
    }
  }

  private updatePickaxe(dt: number) {
    // One full chop per hit (matches 0.15s break/place hold).
    if (this.swing > 0) this.swing = Math.max(0, this.swing - dt * (1 / 0.15));
    const waving = this.emote?.kind === "wave";
    this.pickaxe.visible = !waving && !this.inputBlocked() && !this.cinematic;
    if (waving) return;
    // 0→1→0 over the swing; tip follows the downward chop.
    const s = Math.sin((1 - this.swing) * Math.PI);
    const walkAmt = this.bobWalkAmt;
    const bobY = Math.sin(this.viewBobPhase) * 0.02 * walkAmt;
    const bobX = Math.cos(this.viewBobPhase * 0.5) * 0.012 * walkAmt;
    const g = this.pickaxeGrip;
    this.pickaxe.scale.setScalar(g.scale);
    // Light wrist twist only — chop is on armRight in updateLocalFpsBody.
    this.pickaxe.rotation.x = g.rx + s * 0.28 + bobY * 0.5;
    this.pickaxe.rotation.y = g.ry + s * 0.03;
    this.pickaxe.rotation.z = g.rz - s * 0.1 + bobX * 0.4;
    this.pickaxe.position.set(g.x + bobX * 0.5, g.y + bobY - s * 0.03, g.z);
    tickGoldObject(this.pickaxe, this.anim);
  }

  private currentBlock(): number {
    const block = this.palette()[this.selected] ?? AIR;
    if (block === BARRIER) return BARRIER;
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
    // Hard rule: never stack a solid into an occupied cell (duplicate faces → z-fight).
    // Digs (AIR) and empty-cell places still go through; overwrite only for those.
    if (block !== AIR && prev !== AIR) return;
    if (!this.world.set(x, y, z, block, true)) return;
    this.rebuildAround(x, z);
    // Sync remesh now — no client-prediction temp Mesh, and no ghost lingering in a stale chunk.
    this.flushDirty(32);
    if (import.meta.env.DEV) {
      const cx = Math.floor(x / CHUNK_S);
      const cz = Math.floor(z / CHUNK_S);
      const mesh = this.chunkMeshes.get(`${cx},${cz}`);
      const n = mesh?.geometry.attributes.position?.count ?? -1;
      console.log(`[peep-mesh] cell (${x},${y},${z}) → ${block} | chunk ${cx},${cz} position.count=${n}`);
    }
    if (block === AIR) this.burst(x, y, z, prev);
    if (block === DYNAMITE && !this.fuses.some((f) => f.x === x && f.y === y && f.z === z)) {
      this.fuses.push({ x, y, z, t: 0, hiss: 0 });
    }
    this.opts.onWorldDirty?.();
    if (!sync) return;

    // Host authority: only the island owner writes SQLite + broadcasts blocks.
    if (this.opts.isCreator) {
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
            this.world.set(x, y, z, prev, true);
            this.rebuildAround(x, z);
            this.p2p.send({ t: "block", x, y, z, block: prev } satisfies NetMsg);
            if (block === AIR && prev !== AIR && prev !== CHEST && prev !== DYNAMITE) takeBlock(this.story, prev);
            if (block === DYNAMITE) refundDynamite(this.story);
            else if (block !== AIR) addBlock(this.story, block);
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
      return;
    }

    // Friday: propose to host over P2P only (no server write).
    this.p2p.send({ t: "block_req", x, y, z, block } satisfies NetMsg);
  }

  private canGuestBuild(): boolean {
    return this.opts.isCreator || this.guestBuildAllowed;
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
        this.lootBlock(GOLD, 16);
        this.persist();
        this.chestOffer = true;
      }
      this.hudDirty = true;
      this.opts.onBroken?.();
      return;
    }
    this.applyLocal(x, y, z, AIR, true);
    this.lootBlock(prev, 1);
    this.persist();
    this.audio.break(prev);
    this.audio.pickup();
    this.hudDirty = true;
    this.opts.onBroken?.();
  }

  private placeBlock() {
    if (!this.canGuestBuild()) return false;
    if (!this.hit) return false;
    const wanted = this.palette()[this.selected] ?? AIR;
    const block = this.currentBlock();
    if (block === AIR) {
      if (wanted && wanted !== BARRIER && wanted !== AIR) {
        this.flashNotice("Блоков нет ❌");
      }
      return false;
    }
    const x = this.hit.x + this.hit.nx;
    const y = this.hit.y + this.hit.ny;
    const z = this.hit.z + this.hit.nz;
    // Occupied cell — never stack solids (root cause of duplicate-face z-fight).
    if (this.world.get(x, y, z) !== AIR) return false;
    if (this.overlapsPlayer(x, y, z)) return false;
    if (block === DYNAMITE) {
      if (!takeDynamite(this.story)) {
        this.flashNotice("Блоков нет ❌");
        return false;
      }
    } else if (block !== BARRIER && !takeBlock(this.story, block)) {
      this.flashNotice("Блоков нет ❌");
      return false;
    }
    this.persist();
    this.applyLocal(x, y, z, block, true);
    this.audio.place(block === BARRIER ? 3 : block);
    this.swing = 0.6;
    this.hudDirty = true;
    return true;
  }

  private flashNotice(text: string) {
    this.notice = text;
    this.noticeUntil = performance.now() + 500;
    this.hudDirty = true;
  }

  /**
   * Troll dynamite farm: leave the island shore → 3 underwater laps in 90s →
   * look up → TNT rain → +3 charges.
   */
  private updateTrollQuest(dt: number) {
    if (this.trollPhase === "done") {
      this.updateFallingTnt(dt);
      return;
    }
    if (!this.playing) {
      this.updateFallingTnt(dt);
      return;
    }

    // TNT rain blocks gameplay input but not look — keep quest ticking during drop/hint.
    if (this.inputBlocked() && this.trollPhase !== "drop" && this.trollPhase !== "hint") {
      this.updateFallingTnt(dt);
      return;
    }

    const eyeY = this.pos.y + this.eyeHeight();
    const under = eyeY < WATER_LEVEL - 0.05;
    // Only past the sandy shore — diving in the middle of the island does nothing.
    const offshore = pastIslandShore(this.pos.x, this.pos.z);
    const inRing = offshore && under;

    if (this.trollPhase === "idle" || this.trollPhase === "swim") {
      if (inRing) {
        if (this.trollPhase === "idle") {
          this.trollPhase = "swim";
          this.trollAngle = 0;
          this.trollSectors = 0;
          this.trollTimer = TROLL_TIMER_S;
          this.trollLastAng = null;
        }
        this.trollTrackerVisible = true;
        this.trollTimer = Math.max(0, this.trollTimer - dt);

        const cx = WORLD_SX * 0.5;
        const cz = WORLD_SZ * 0.5;
        const ang = Math.atan2(this.pos.z - cz, this.pos.x - cx);
        if (this.trollLastAng != null) {
          let d = ang - this.trollLastAng;
          while (d > Math.PI) d -= Math.PI * 2;
          while (d < -Math.PI) d += Math.PI * 2;
          this.trollAngle += Math.abs(d);
        }
        this.trollLastAng = ang;

        const sectors = Math.floor(this.trollAngle / TROLL_SECTOR_RAD);
        if (sectors > this.trollSectors) {
          this.trollSectors = sectors;
          this.trollSectorFlashUntil = performance.now() + 200;
          this.audio.bubble();
        }

        const laps = Math.min(TROLL_LAPS, Math.floor(this.trollAngle / (Math.PI * 2)));
        if (laps >= TROLL_LAPS) {
          this.trollPhase = "hint";
          this.trollTrackerVisible = true;
          this.lookHint = "посмотри наверх";
          this.spawnFloorHint();
          this.hudDirty = true;
        } else if (this.trollTimer <= 0) {
          this.failTrollSwim();
        } else {
          this.hudDirty = true;
        }
      } else {
        // Back on the island / surfaced: pause angle, hide tracker until offshore dive again.
        this.trollLastAng = null;
        if (this.trollPhase === "swim") {
          this.trollTrackerVisible = false;
          this.hudDirty = true;
        }
      }
    } else if (this.trollPhase === "hint") {
      this.trollTrackerVisible = true;
      this.lookHint = "посмотри наверх";
      // Prefer world-space look (pitch sign / soft-look quirks can't miss this).
      this.camera.getWorldDirection(this.tmpFwd);
      if (this.tmpFwd.y >= TROLL_LOOK_UP_DOT) {
        this.beginTrollDrop();
      }
    } else if (this.trollPhase === "drop") {
      if (this.trollDropLeft > 0) {
        this.trollDropWait -= dt;
        if (this.trollDropWait <= 0) {
          this.spawnFallingTnt();
          this.trollDropLeft -= 1;
          this.trollDropWait = TROLL_DROP_GAP_S;
        }
      }
    }

    this.updateFallingTnt(dt);
  }

  private trollLaps(): number {
    return Math.min(TROLL_LAPS, Math.floor(this.trollAngle / (Math.PI * 2)));
  }

  private failTrollSwim() {
    this.trollPhase = "swim";
    this.trollAngle = 0;
    this.trollSectors = 0;
    this.trollTimer = TROLL_TIMER_S;
    this.trollLastAng = null;
    this.trollTrackerVisible = true;
    this.hudDirty = true;
  }

  private beginTrollDrop() {
    this.trollPhase = "drop";
    this.lookHint = null;
    this.releasePointerLock();
    this.trollDropLeft = TROLL_DROP_COUNT;
    this.trollDropWait = 0;
    this.spawnFallingTnt();
    this.trollDropLeft -= 1;
    this.trollDropWait = TROLL_DROP_GAP_S;
    this.hudDirty = true;
  }

  private spawnFloorHint() {
    this.clearFloorHint();
    const tw = 512;
    const th = 128;
    const c = document.createElement("canvas");
    c.width = tw;
    c.height = th;
    const ctx = c.getContext("2d")!;
    ctx.clearRect(0, 0, tw, th);
    ctx.fillStyle = "#ffe14a";
    ctx.font = "bold 48px IBM Plex Mono, monospace";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("посмотри наверх", tw / 2, th / 2);
    const tex = new THREE.CanvasTexture(c);
    tex.magFilter = THREE.NearestFilter;
    tex.minFilter = THREE.NearestFilter;
    tex.needsUpdate = true;
    const mat = new THREE.MeshBasicMaterial({
      map: tex,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(5.5, 1.35), mat);
    mesh.rotation.x = -Math.PI / 2;
    const fx = -Math.sin(this.yaw);
    const fz = -Math.cos(this.yaw);
    const px = this.pos.x + fx * 2.4;
    const pz = this.pos.z + fz * 2.4;
    const gy = Math.min(this.surfaceY(px, pz), WATER_LEVEL - 0.4);
    mesh.position.set(px, gy + 0.08, pz);
    mesh.renderOrder = 2;
    this.scene.add(mesh);
    this.floorHint = mesh;
  }

  private clearFloorHint() {
    if (!this.floorHint) return;
    this.scene.remove(this.floorHint);
    this.floorHint.geometry.dispose();
    const mat = this.floorHint.material as THREE.MeshBasicMaterial;
    mat.map?.dispose();
    mat.dispose();
    this.floorHint = null;
  }

  private spawnFallingTnt() {
    const mat = new THREE.MeshLambertMaterial({ color: BLOCK_COLORS[DYNAMITE] ?? 0xd43c2c });
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(0.92, 0.92, 0.92), mat);
    const ox = (Math.random() - 0.5) * 0.35;
    const oz = (Math.random() - 0.5) * 0.35;
    mesh.position.set(this.pos.x + ox, this.pos.y + TROLL_SPAWN_HEIGHT, this.pos.z + oz);
    mesh.castShadow = false;
    this.scene.add(mesh);
    this.fallingTnt.push({ mesh, vy: 0 });
  }

  private updateFallingTnt(dt: number) {
    if (this.fallingTnt.length === 0) {
      if (this.trollPhase === "drop" && this.trollDropLeft <= 0) {
        this.finishTrollQuest();
      }
      return;
    }
    const headY = this.pos.y + this.playerHeight();
    const r = PLAYER_RADIUS + 0.55;
    for (let i = this.fallingTnt.length - 1; i >= 0; i--) {
      const f = this.fallingTnt[i]!;
      f.vy -= GRAVITY * dt;
      f.mesh.position.y += f.vy * dt;
      f.mesh.rotation.x += dt * 1.2;
      f.mesh.rotation.z += dt * 0.7;

      const dx = f.mesh.position.x - this.pos.x;
      const dz = f.mesh.position.z - this.pos.z;
      const horiz = Math.hypot(dx, dz);
      const hitHead = f.mesh.position.y <= headY + 0.15 && f.mesh.position.y >= this.pos.y && horiz < r;
      const gx = Math.floor(f.mesh.position.x);
      const gy = Math.floor(f.mesh.position.y - 0.45);
      const gz = Math.floor(f.mesh.position.z);
      const hitGround =
        f.mesh.position.y < this.pos.y + 0.2 ||
        (gy >= 0 && this.world.get(gx, gy, gz) !== AIR && horiz < r + 1.2);

      if (hitHead || hitGround || f.mesh.position.y < 0) {
        this.collectFallingTnt(i);
      }
    }
    if (this.trollPhase === "drop" && this.trollDropLeft <= 0 && this.fallingTnt.length === 0) {
      this.finishTrollQuest();
    }
  }

  private collectFallingTnt(index: number) {
    const f = this.fallingTnt[index];
    if (!f) return;
    this.scene.remove(f.mesh);
    f.mesh.geometry.dispose();
    (f.mesh.material as THREE.Material).dispose();
    this.fallingTnt.splice(index, 1);
    // Visual-only rain for the underwater quest — charges come from TROLL_QUEST_REWARD.
    this.audio.pickup();
    this.hudDirty = true;
  }

  private finishTrollQuest() {
    if (this.trollPhase === "done") return;
    this.trollPhase = "done";
    this.trollTrackerVisible = false;
    this.lookHint = null;
    this.clearFloorHint();
    this.story.trollQuestDone = true;
    this.lootDynamiteReward(TROLL_QUEST_REWARD);
    this.persist();
    this.restoreDesktopAim();
    this.hudDirty = true;
  }

  private updateFuses(dt: number) {
    for (let i = this.fuses.length - 1; i >= 0; i--) {
      const f = this.fuses[i]!;
      if (this.world.get(f.x, f.y, f.z) !== DYNAMITE) {
        this.fuses.splice(i, 1);
        continue;
      }
      f.t += dt;
      f.hiss += dt;
      if (f.hiss >= 0.22) {
        f.hiss = 0;
        this.audio.hiss();
        // Visual fuse blink: spark particles on alternate ticks.
        if (Math.floor(f.t * 5) % 2 === 0) {
          this.burst(f.x, f.y, f.z, DYNAMITE);
        }
      }
      if (f.t >= DYNAMITE_FUSE_S) {
        this.fuses.splice(i, 1);
        this.detonate(f.x, f.y, f.z);
      }
    }
  }

  private detonate(cx: number, cy: number, cz: number) {
    this.audio.boom();
    hapticBoom();
    // Collect destroyable voxels by distance (chest / air / barrier skip).
    const candidates: { x: number; y: number; z: number; d: number; block: number }[] = [];
    const R = DYNAMITE_BLAST_RADIUS;
    for (let y = Math.max(0, cy - R); y <= Math.min(WORLD_SY - 1, cy + R); y++) {
      for (let z = cz - R; z <= cz + R; z++) {
        for (let x = cx - R; x <= cx + R; x++) {
          const b = this.world.get(x, y, z);
          if (b === AIR || b === CHEST || b === BARRIER) continue;
          const dx = x + 0.5 - (cx + 0.5);
          const dy = y + 0.5 - (cy + 0.5);
          const dz = z + 0.5 - (cz + 0.5);
          const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
          if (d > R + 0.01) continue;
          candidates.push({ x, y, z, d, block: b });
        }
      }
    }
    candidates.sort((a, b) => a.d - b.d);
    const take = candidates.slice(0, DYNAMITE_BLAST_BLOCKS);
    // Always clear the dynamite cell itself if still present.
    if (this.world.get(cx, cy, cz) === DYNAMITE) {
      this.applyLocal(cx, cy, cz, AIR, true);
    }
    for (const c of take) {
      if (c.x === cx && c.y === cy && c.z === cz) continue;
      if (this.world.get(c.x, c.y, c.z) !== c.block) continue;
      this.applyLocal(c.x, c.y, c.z, AIR, true);
      if (c.block !== DYNAMITE) this.lootBlock(c.block, 1);
    }
    this.persist();
    this.applyBlastImpulse(cx + 0.5, cy + 0.5, cz + 0.5);
    this.hudDirty = true;
  }

  private applyBlastImpulse(bx: number, by: number, bz: number) {
    const px = this.pos.x;
    const py = this.pos.y + this.playerHeight() * 0.45;
    const pz = this.pos.z;
    const dx = px - bx;
    const dy = py - by;
    const dz = pz - bz;
    const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
    const k = DYNAMITE_KNOCKBACK_MUL;
    // Always a bit of shake within hear range.
    const shake = Math.max(0, 1 - dist / (DYNAMITE_SHAKE_RANGE * 1.4));
    this.camRoll += (Math.random() - 0.5) * 0.12 * shake * k;
    this.camPitchOff += (Math.random() - 0.5) * 0.08 * shake * k;
    this.camYawOff += (Math.random() - 0.5) * 0.06 * shake * k;
    if (dist > DYNAMITE_SHAKE_RANGE || dist < 1e-4) return;

    const near = 1 - dist / DYNAMITE_SHAKE_RANGE;
    const onTop = Math.abs(dx) < 0.85 && Math.abs(dz) < 0.85 && dy > -0.35;
    if (onTop) {
      this.onGround = false;
      this.vel.y = Math.max(this.vel.y, JUMP_SPEED * (1.55 + near * 1.1) * k);
      this.vel.x += dx * near * 2.2 * k;
      this.vel.z += dz * near * 2.2 * k;
      return;
    }
    const inv = 1 / dist;
    const push = near * near * 18 * k;
    this.onGround = false;
    this.vel.x += dx * inv * push;
    this.vel.z += dz * inv * push;
    this.vel.y += near * 6.5 * k;
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
        if (p.connectionState === "connected") {
          this.p2p.send(
            { t: "hello", name: getTelegramDisplayName() } satisfies NetMsg,
            p.id,
          );
        }
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
    const pal = FRIDAY;
    const group = createAvatar(pal, { hat: false });
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
      name: "",
      greetedBack: false,
    };
    setAvatarNametag(group, "…");
    this.remotes.set(id, r);
    this.hudDirty = true;
    if (this.opts.isCreator && !this.fridayIntroDone && !this.fridayIntro && fromP2p) {
      r.appear = 1;
      r.group.scale.setScalar(1);
      this.beginFridayIntro(r);
    } else {
      this.celebrateJoin(r);
    }
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
    } else if (msg.t === "hello" && channel === "reliable") {
      const r = this.ensureRemote(from, true);
      const name = typeof msg.name === "string" && msg.name.trim() ? msg.name.trim().slice(0, 28) : "игрок";
      if (r.name !== name) {
        r.name = name;
        setAvatarNametag(r.group, name);
      }
      if (!r.greetedBack) {
        r.greetedBack = true;
        this.p2p.send({ t: "hello", name: getTelegramDisplayName() } satisfies NetMsg, from);
      }
    } else if (msg.t === "block" && channel === "reliable") {
      this.applyLocal(msg.x, msg.y, msg.z, msg.block, false);
    } else if (msg.t === "block_req" && channel === "reliable") {
      if (!this.opts.isCreator || !this.guestBuildAllowed) return;
      const prev = this.world.get(msg.x, msg.y, msg.z);
      if (prev === msg.block) return;
      this.applyLocal(msg.x, msg.y, msg.z, msg.block, true);
    } else if (msg.t === "perms" && channel === "reliable") {
      this.guestBuildAllowed = Boolean(msg.buildAllowed);
      this.islandLocked = Boolean(msg.locked);
      this.hudDirty = true;
    } else if (msg.t === "kick" && channel === "reliable") {
      if (this.opts.isCreator) return;
      this.p2p.close();
      this.opts.onKicked?.();
    } else if (msg.t === "look" && channel === "reliable") {
      const r = this.ensureRemote(from, true);
      wearHat(r.group, msg.hat);
    } else if (msg.t === "emote" && channel === "reliable") {
      const kind = msg.kind;
      if (
        kind !== "wave" &&
        kind !== "hearts" &&
        kind !== "laugh" &&
        kind !== "fart" &&
        kind !== "censor" &&
        kind !== "death" &&
        kind !== "attention" &&
        kind !== "sixSeven"
      ) {
        return;
      }
      const r = this.ensureRemote(from, true);
      r.emote = { kind, age: 0 };
      setAvatarFace(r.group, kind);
      this.audio.emote(kind);
      if (kind === "hearts") this.spawnHearts(r.x, r.y + 1.35, r.z, 6);
      if (kind === "fart") this.spawnFartCloud(r.x, r.y, r.z, r.yaw);
    } else if (msg.t === "cine" && channel === "reliable") {
      this.onCineMsg(from, msg);
    }
  }

  private onCineMsg(from: string, msg: Extract<NetMsg, { t: "cine" }>) {
    if (msg.phase === "fall" && !this.opts.isCreator) {
      const x = msg.x ?? this.pos.x;
      const z = msg.z ?? this.pos.z;
      const groundY = msg.groundY ?? this.surfaceY(x, z);
      const y = msg.y ?? groundY + FRIDAY_FALL_HEIGHT;
      this.pos.set(x, y, z);
      this.vel.set(0, 0, 0);
      this.guestFall = { vy: 0, groundY };
      this.releasePointerLock();
      this.hudDirty = true;
      return;
    }
    if (msg.phase === "landed" && this.opts.isCreator && this.fridayIntro?.remoteId === from) {
      if (this.fridayIntro.phase === "fall") {
        this.fridayIntro.phase = "hope";
        this.fridayIntro.hopeT = 0;
        this.hudDirty = true;
      }
      return;
    }
    if (msg.phase === "tnt" && !this.opts.isCreator) {
      this.guestTntLock = true;
      if (!this.isLocked()) this.releasePointerLock();
      this.spawnGuestTntRain();
      this.hudDirty = true;
      return;
    }
    if (msg.phase === "loot" && !this.opts.isCreator) {
      this.lootDynamiteFill();
      this.persist();
      this.guestTntLock = false;
      this.clearGuestTnt();
      this.restoreDesktopAim();
      this.hudDirty = true;
    }
  }

  private beginFridayIntro(r: Remote) {
    if (!this.opts.isCreator || this.fridayIntroDone || this.fridayIntro) return;
    const dist = 4.2;
    const x = this.pos.x - Math.sin(this.yaw) * dist;
    const z = this.pos.z - Math.cos(this.yaw) * dist;
    const groundY = this.surfaceY(x, z);
    const y = groundY + FRIDAY_FALL_HEIGHT;
    r.x = x;
    r.y = y;
    r.z = z;
    r.tx = x;
    r.ty = y;
    r.tz = z;
    r.group.position.set(x, y, z);
    r.group.scale.setScalar(1);
    this.fridayIntro = {
      phase: "fall",
      remoteId: r.id,
      hopeT: 0,
      groundY,
      tnt: [],
      tntLeft: 0,
      tntWait: 0,
      follow: null,
    };
    this.p2p.send(
      { t: "cine", phase: "fall", x, y, z, groundY } satisfies NetMsg,
      r.id,
    );
    this.releasePointerLock();
    if (this.playing) this.audio.join();
    this.hudDirty = true;
  }

  private updateFridayIntro(dt: number) {
    const fi = this.fridayIntro;
    if (!fi) return;
    const r = this.remotes.get(fi.remoteId);
    if (!r) {
      this.endFridayIntro(false);
      return;
    }

    if (fi.phase === "fall") {
      // Guest drives physics; host also snaps if they report near ground.
      if (r.y <= fi.groundY + 0.35) {
        fi.phase = "hope";
        fi.hopeT = 0;
        this.hudDirty = true;
      }
      return;
    }

    if (fi.phase === "hope") {
      fi.hopeT += dt;
      if (fi.hopeT >= FRIDAY_HOPE_S) {
        fi.phase = "tnt";
        fi.tntLeft = FRIDAY_TNT_COUNT;
        fi.tntWait = 0;
        this.releasePointerLock();
        this.p2p.send({ t: "cine", phase: "tnt" } satisfies NetMsg, fi.remoteId);
        this.spawnFridayCineTnt(r);
        fi.tntLeft -= 1;
        fi.tntWait = FRIDAY_TNT_GAP_S;
        this.hudDirty = true;
      }
      return;
    }

    // tnt phase
    if (fi.tntLeft > 0) {
      fi.tntWait -= dt;
      if (fi.tntWait <= 0) {
        this.spawnFridayCineTnt(r);
        fi.tntLeft -= 1;
        fi.tntWait = FRIDAY_TNT_GAP_S;
      }
    }
    this.stepFridayCineTnt(dt, r);
  }

  private spawnFridayCineTnt(r: Remote) {
    const fi = this.fridayIntro;
    if (!fi) return;
    const mat = new THREE.MeshLambertMaterial({ color: BLOCK_COLORS[DYNAMITE] ?? 0xd43c2c });
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(0.92, 0.92, 0.92), mat);
    mesh.position.set(
      r.x + (Math.random() - 0.5) * 0.3,
      r.y + FRIDAY_TNT_HEIGHT,
      r.z + (Math.random() - 0.5) * 0.3,
    );
    this.scene.add(mesh);
    const entry = { mesh, vy: 0 };
    fi.tnt.push(entry);
    if (!fi.follow) fi.follow = mesh;
  }

  private stepFridayCineTnt(dt: number, r: Remote) {
    const fi = this.fridayIntro;
    if (!fi) return;
    const headY = r.y + PLAYER_HEIGHT;
    for (let i = fi.tnt.length - 1; i >= 0; i--) {
      const t = fi.tnt[i]!;
      t.vy -= GRAVITY * dt;
      t.mesh.position.y += t.vy * dt;
      t.mesh.rotation.x += dt * 1.4;
      const hit =
        t.mesh.position.y <= headY + 0.2 ||
        t.mesh.position.y <= fi.groundY + 0.5;
      if (hit) {
        if (fi.follow === t.mesh) fi.follow = fi.tnt[i - 1]?.mesh ?? fi.tnt[0]?.mesh ?? null;
        this.scene.remove(t.mesh);
        t.mesh.geometry.dispose();
        (t.mesh.material as THREE.Material).dispose();
        fi.tnt.splice(i, 1);
        this.audio.pickup();
      }
    }
    if (fi.tntLeft <= 0 && fi.tnt.length === 0) {
      this.p2p.send({ t: "cine", phase: "loot" } satisfies NetMsg, fi.remoteId);
      this.endFridayIntro(true);
    }
  }

  private endFridayIntro(success: boolean) {
    const fi = this.fridayIntro;
    if (fi) {
      for (const t of fi.tnt) {
        this.scene.remove(t.mesh);
        t.mesh.geometry.dispose();
        (t.mesh.material as THREE.Material).dispose();
      }
    }
    this.fridayIntro = null;
    if (success) this.fridayIntroDone = true;
    this.restoreDesktopAim();
    this.hudDirty = true;
  }

  private stepGuestFall(dt: number) {
    const g = this.guestFall;
    if (!g) return;
    g.vy -= GRAVITY * dt;
    this.pos.y += g.vy * dt;
    this.vel.y = g.vy;
    if (this.pos.y <= g.groundY) {
      this.pos.y = g.groundY;
      this.vel.set(0, 0, 0);
      this.onGround = true;
      this.guestFall = null;
      this.p2p.send({ t: "cine", phase: "landed" } satisfies NetMsg);
      this.restoreDesktopAim();
      this.hudDirty = true;
    }
  }

  private spawnGuestTntRain() {
    this.clearGuestTnt();
    for (let i = 0; i < FRIDAY_TNT_COUNT; i++) {
      const mat = new THREE.MeshLambertMaterial({ color: BLOCK_COLORS[DYNAMITE] ?? 0xd43c2c });
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(0.92, 0.92, 0.92), mat);
      mesh.position.set(
        this.pos.x + (Math.random() - 0.5) * 0.35,
        this.pos.y + FRIDAY_TNT_HEIGHT + i * 0.15,
        this.pos.z + (Math.random() - 0.5) * 0.35,
      );
      // Stagger visually; host drives timing — guest drops all with slight offset.
      this.scene.add(mesh);
      this.guestFallingTnt.push({ mesh, vy: -i * 0.5 });
    }
  }

  private stepGuestTnt(dt: number) {
    const headY = this.pos.y + this.playerHeight();
    for (let i = this.guestFallingTnt.length - 1; i >= 0; i--) {
      const t = this.guestFallingTnt[i]!;
      t.vy -= GRAVITY * dt;
      t.mesh.position.y += t.vy * dt;
      if (t.mesh.position.y <= headY + 0.15 || t.mesh.position.y < this.pos.y) {
        this.scene.remove(t.mesh);
        t.mesh.geometry.dispose();
        (t.mesh.material as THREE.Material).dispose();
        this.guestFallingTnt.splice(i, 1);
        this.lootDynamiteRefund();
        this.audio.pickup();
        this.persist();
        this.hudDirty = true;
      }
    }
  }

  private clearGuestTnt() {
    for (const t of this.guestFallingTnt) {
      this.scene.remove(t.mesh);
      t.mesh.geometry.dispose();
      (t.mesh.material as THREE.Material).dispose();
    }
    this.guestFallingTnt.length = 0;
  }

  private updateGuestFall(_dt: number) {
    // Physics runs in fixed(); this hook keeps HUD in sync if needed.
    void _dt;
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
        if (r.emote.age >= emoteDuration(r.emote.kind)) {
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
      // Left FP arm visibility driven by updateLocalFpsBody.
      return;
    }
    this.emote.age += dt;
    if (this.emote.kind === "wave") poseLocalArm(this.localArm, this.emote.age);
    if (this.emote.age >= emoteDuration(this.emote.kind)) {
      this.emote = null;
      this.pickaxe.visible = true;
      setAvatarFace(this.localBody, "idle");
    }
  }

  /**
   * FPS: body visible; head stays visible for shadows but on a layer the
   * main camera does not draw (shadow camera enables that layer).
   */
  private applyLocalFpsVisibility(hideHead: boolean) {
    this.localBody.visible = true;
    const head = this.localBody.getObjectByName("head");
    if (head) {
      head.visible = true;
      head.layers.set(hideHead ? 1 : 0);
      head.traverse((o) => {
        o.layers.set(hideHead ? 1 : 0);
      });
    }
    const nametag = this.localBody.getObjectByName("nametag");
    if (nametag) nametag.visible = false;
  }

  /**
   * Client-only: sync local avatar pose + walk/jump arm feel.
   * Does not go on the wire.
   */
  private updateLocalFpsBody(dt: number) {
    if (!this.playing) return;
    if (this.cinematic) return;

    this.applyLocalFpsVisibility(true);
    this.localBody.position.copy(this.pos);
    this.localBody.rotation.y = this.yaw;

    const armL =
      this.localBody.getObjectByName("armLeft") ?? this.localBody.getObjectByName("armL");
    const armR =
      this.localBody.getObjectByName("armRight") ?? this.localBody.getObjectByName("armR");
    const legL =
      this.localBody.getObjectByName("legLeft") ?? this.localBody.getObjectByName("legL");
    const legR =
      this.localBody.getObjectByName("legRight") ?? this.localBody.getObjectByName("legR");

    // Left arm raise from vertical velocity — forward on jump, tuck on fall.
    const jumpTarget = THREE.MathUtils.clamp(this.vel.y * 0.22 + 0.12, 0, 1);
    const raiseK = 1 - Math.exp(-(this.vel.y > 0 ? 16 : 9) * dt);
    this.leftArmRaise += (jumpTarget - this.leftArmRaise) * raiseK;

    const walkAmt = this.bobWalkAmt;
    const swing = Math.sin(this.viewBobPhase) * 0.55 * walkAmt;
    const bob = Math.sin(this.viewBobPhase) * 0.16 * walkAmt;
    const raise = this.leftArmRaise;
    // Downward chop: peaks mid-swing (swing 1→0), not an upward snap.
    const dig = Math.sin((1 - this.swing) * Math.PI);

    if (armL) {
      // +X is forward (same as dig/hat poses). Jump punches the arm ahead.
      armL.rotation.x = swing + raise * 1.35;
      armL.rotation.y = 0;
      armL.rotation.z = 0.08 + raise * 0.25;
    }
    if (armR) {
      const hold = this.armHold;
      // Dig/build: whole arm chops down — pickaxe is parented to hand.
      armR.rotation.x = hold.rx + bob - dig * 1.05;
      armR.rotation.y = hold.ry + dig * 0.05;
      armR.rotation.z = hold.rz - dig * 0.28;
    }
    if (legL) legL.rotation.x = -swing;
    if (legR) legR.rotation.x = swing;

    // Overlay left hand: reaches forward into frame on jump.
    const waving = this.emote?.kind === "wave";
    if (!waving && !this.inputBlocked()) {
      const y = -0.68 + raise * 0.28;
      const x = -0.24;
      const z = -0.4 - raise * 0.14;
      this.localArm.visible = true;
      this.localArm.position.set(x, y, z);
      this.localArm.rotation.set(0.5 + raise * 1.15, 0.14, 0.1);
      const elbow = this.localArm.getObjectByName("elbow");
      if (elbow) elbow.rotation.set(0.15 + raise * 0.2, 0, 0);
    } else if (!waving) {
      this.localArm.visible = false;
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

  /** Brown-green puff behind a remote avatar. */
  private spawnFartCloud(x: number, y: number, z: number, yaw: number) {
    const bx = Math.sin(yaw);
    const bz = Math.cos(yaw);
    const colors = [0x5a3a1a, 0x3d5a22, 0x6b4a28, 0x4a6220];
    for (let i = 0; i < 14; i++) {
      const c = colors[i % colors.length]!;
      const mat = new THREE.MeshBasicMaterial({
        color: c,
        transparent: true,
        opacity: 0.85,
        depthWrite: false,
      });
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.12, 0.12), mat);
      mesh.position.set(
        x + bx * 0.35 + (Math.random() - 0.5) * 0.25,
        y + 0.35 + Math.random() * 0.2,
        z + bz * 0.35 + (Math.random() - 0.5) * 0.25,
      );
      this.scene.add(mesh);
      const life = EMOTE_FART_S * (0.75 + Math.random() * 0.25);
      this.particles.push({
        mesh,
        vx: bx * (0.4 + Math.random() * 0.5) + (Math.random() - 0.5) * 0.35,
        vy: 0.35 + Math.random() * 0.55,
        vz: bz * (0.4 + Math.random() * 0.5) + (Math.random() - 0.5) * 0.35,
        life,
        maxLife: life,
        grav: 0.4,
      });
    }
  }

  private updateEmoteFx(_dt: number) {
    const now = performance.now();
    if (this.censorFlashUntil > 0 && now < this.censorFlashUntil) this.hudDirty = true;
    if (this.emoteCdUntil > 0 && now < this.emoteCdUntil) this.hudDirty = true;
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
    const catalog = this.catalog();
    this.opts.onHud({
      palette,
      selected: this.selected,
      peerCount: this.peerCount,
      peerConnected: this.peerConnected || this.remotes.size > 0,
      playing: this.playing,
      // Aim engaged (PL or free-look after canvas click) — hide "click to aim" prompt.
      locked: this.isLocked() || this.aimEngaged,
      lockDenied: this.pointerLockDenied && !this.isLocked(),
      worldId: this.opts.worldId,
      isCreator: this.opts.isCreator,
      placeCharge: this.placeCharge,
      placeIntent: this.placeArmed && !this.placing,
      breakCharge: this.breakCharge,
      chestBar: this.chestBar,
      counts: palette.map((b) => countOf(this.story, b)),
      catalog,
      catalogCounts: catalog.map((b) => countOf(this.story, b)),
      invBadge: this.invBadge,
      dynamiteCd: dynamiteRechargeProgress(this.story),
      emoteCd: Math.max(0, Math.min(1, (this.emoteCdUntil - performance.now()) / (EMOTE_COOLDOWN_S * 1000))),
      fridayUnlocked: this.story.friday && this.opts.isCreator,
      hatPrompt: this.hatPrompt,
      chestOffer: this.chestOffer,
      hatBusy: Boolean(this.cinematic),
      cinematicActive: this.isCinematicActive(),
      guestBuildAllowed: this.guestBuildAllowed,
      islandLocked: this.islandLocked,
      fridayOnline: this.remotes.size > 0,
      notice: this.notice,
      lookHint: this.lookHint,
      censorFlash: Math.max(0, (this.censorFlashUntil - performance.now()) / 520),
      trollTracker:
        this.trollTrackerVisible && this.trollPhase !== "done"
          ? (() => {
              const lapAng = this.trollAngle % (Math.PI * 2);
              const sectorsDone = Math.min(3, Math.floor(lapAng / TROLL_SECTOR_RAD));
              const cx = WORLD_SX * 0.5;
              const cz = WORLD_SZ * 0.5;
              const rx = this.pos.x - cx;
              const rz = this.pos.z - cz;
              // Counter-clockwise tangent around the island.
              const tx = -rz;
              const tz = rx;
              const fx = -Math.sin(this.yaw);
              const fz = -Math.cos(this.yaw);
              const cross = fx * tz - fz * tx;
              const dot = fx * tx + fz * tz;
              const guideDeg = (Math.atan2(cross, dot) * 180) / Math.PI;
              return {
                laps: this.trollPhase === "hint" || this.trollPhase === "drop" ? TROLL_LAPS : this.trollLaps(),
                total: TROLL_LAPS,
                secondsLeft: Math.ceil(this.trollTimer),
                success: this.trollPhase === "hint" || this.trollPhase === "drop",
                showTitle: this.trollPhase === "swim",
                sectorFlash: Math.max(0, (this.trollSectorFlashUntil - performance.now()) / 200),
                sectorsDone,
                guideDeg,
              };
            })()
          : null,
    });
  }

  /** Host: kick current Fridays and ban their player ids if known. */
  async kickFriday(): Promise<void> {
    if (!this.opts.isCreator) return;
    this.p2p.send({ t: "kick", reason: "host" } satisfies NetMsg);
    const guestIds = [...this.remotes.keys()];
    for (const guestId of guestIds) {
      await updateGuestPermissions({
        data: { playerId: this.opts.playerId, patch: { banPlayerId: guestId } },
      });
    }
    this.p2p.close();
    void this.p2p.join();
    this.hudDirty = true;
  }

  async setIslandLocked(locked: boolean): Promise<void> {
    if (!this.opts.isCreator) return;
    this.islandLocked = locked;
    await updateGuestPermissions({
      data: { playerId: this.opts.playerId, patch: { locked } },
    });
    this.broadcastPerms();
    this.hudDirty = true;
  }

  async setGuestBuildAllowed(buildAllowed: boolean): Promise<void> {
    if (!this.opts.isCreator) return;
    this.guestBuildAllowed = buildAllowed;
    await updateGuestPermissions({
      data: { playerId: this.opts.playerId, patch: { buildAllowed } },
    });
    this.broadcastPerms();
    this.hudDirty = true;
  }

  private broadcastPerms() {
    this.p2p.send({
      t: "perms",
      buildAllowed: this.guestBuildAllowed,
      locked: this.islandLocked,
    } satisfies NetMsg);
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
