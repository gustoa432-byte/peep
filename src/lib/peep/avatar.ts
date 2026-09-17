import * as THREE from "three";
import { PLAYER_HEIGHT } from "./constants";
import { getTelegramDisplayName, getTelegramPhotoUrl } from "./telegram";
import { EMOTE_ATTENTION_FLAPS, EMOTE_ATTENTION_S, EMOTE_DURATION, emoteDuration, type EmoteKind } from "./types";

const HEART = 0xc94a5a;

/** Unscaled model height: legs 0.75 + torso 0.75 + head 1.0. */
const MODEL_HEIGHT = 2.5;
/** Map unit-head proportions onto world player height (~1.72). */
const WORLD_SCALE = PLAYER_HEIGHT / MODEL_HEIGHT;

const LIMB_W = 0.4;
const LIMB_H = 0.75;
const LIMB_D = 0.4;
const TORSO_W = 0.4;
const TORSO_H = 0.75;
const TORSO_D = 0.4;
/** Half of limb/torso height — pivot at shoulder / hip. */
const LIMB_PIVOT = LIMB_H / 2;

const faceTexCache = new Map<string, THREE.CanvasTexture>();

function hexRgb(hex: number): [number, number, number] {
  return [(hex >> 16) & 255, (hex >> 8) & 255, hex & 255];
}

function nearestTex(c: HTMLCanvasElement): THREE.CanvasTexture {
  const tex = new THREE.CanvasTexture(c);
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}

/**
 * 16×16 pixel face from the Pip art ref (angry slant eyes + thick smirk).
 * `.` = body, `#` = face color.
 */
const FACE_IDLE = [
  "................",
  "................",
  ".###........###.",
  "..###......###..",
  "...##......##...",
  "................",
  "................",
  ".#............#.",
  ".###........###.",
  ".##############.",
  ".##############.",
  "..############..",
  "................",
  "................",
  "................",
  "................",
];

const FACE_WINK = [
  "................",
  "................",
  ".###............",
  "..###...........",
  "...##......####.",
  "................",
  "................",
  ".#............#.",
  ".###........###.",
  ".##############.",
  ".##############.",
  "..############..",
  "................",
  "................",
  "................",
  "................",
];

const FACE_SQUINT = [
  "................",
  "................",
  "................",
  ".####......####.",
  "................",
  "................",
  "................",
  ".#............#.",
  ".###........###.",
  ".##############.",
  ".##############.",
  "..############..",
  "................",
  "................",
  "................",
  "................",
];

const FACE_BLANK = Array.from({ length: 16 }, () => "................");

function faceGrid(mood: FaceMood): string[] {
  if (mood === "death") return FACE_BLANK;
  if (mood === "wink") return FACE_WINK;
  if (mood === "laugh" || mood === "fart" || mood === "sixSeven") return FACE_SQUINT;
  return FACE_IDLE;
}

function faceInk(mood: FaceMood, face: number): number {
  if (mood === "hearts") return HEART;
  if (mood === "censor") return 0x1a0a0a;
  return face;
}

function paintFaceTexture(face: number, body: number, mood: FaceMood): THREE.CanvasTexture {
  const ink = faceInk(mood, face);
  const key = `${face.toString(16)}_${body.toString(16)}_${mood}_${ink.toString(16)}`;
  const hit = faceTexCache.get(key);
  if (hit) return hit;
  const grid = faceGrid(mood);
  const scale = 2;
  const size = 16 * scale;
  const c = document.createElement("canvas");
  c.width = size;
  c.height = size;
  const ctx = c.getContext("2d")!;
  const [br, bg, bb] = hexRgb(body);
  const [fr, fg, fb] = hexRgb(ink);
  for (let y = 0; y < 16; y++) {
    const row = grid[y] ?? "................";
    for (let x = 0; x < 16; x++) {
      const on = row[x] === "#";
      ctx.fillStyle = on ? `rgb(${fr},${fg},${fb})` : `rgb(${br},${bg},${bb})`;
      ctx.fillRect(x * scale, y * scale, scale, scale);
    }
  }
  const tex = nearestTex(c);
  tex.userData = { cached: true };
  faceTexCache.set(key, tex);
  return tex;
}

export type AvatarPalette = {
  /** Primary block color (head + torso + limbs). */
  body: number;
  /** Slightly darker limbs / accents. */
  accent: number;
  /** Eyes + mouth pixels. */
  face: number;
  /** Kept for local-arm API compat (= body). */
  skin: number;
};

export type AvatarKind = "pip" | "friday";

export type FaceMood = "idle" | "wink" | EmoteKind;

/** Host — graphite matte body, white pixel face. */
export const PIP: AvatarPalette = {
  body: 0x1a1a1a,
  accent: 0x1a1a1a,
  face: 0xf4f6f8,
  skin: 0x1a1a1a,
};

/** Guest — white body, black face. */
export const FRIDAY: AvatarPalette = {
  body: 0xe8eaee,
  accent: 0xdcdfe4,
  face: 0x1a1c20,
  skin: 0xe8eaee,
};

/** @deprecated use PIP */
export const CASTAWAY = PIP;

export const PALETTES: AvatarPalette[] = [PIP, FRIDAY];

export function lookFor(isCreator: boolean): AvatarPalette {
  return isCreator ? PIP : FRIDAY;
}

export function remoteLook(selfIsCreator: boolean): AvatarPalette {
  return selfIsCreator ? FRIDAY : PIP;
}

export function paletteFor(id: string, otherId?: string): AvatarPalette {
  if (otherId) return id < otherId ? PALETTES[0]! : PALETTES[1]!;
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0;
  return PALETTES[Math.abs(h) % PALETTES.length]!;
}

/** Matte graphite plastic — zero specular, hard edges via flat boxes. */
function bodyMat(color: number): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    color,
    roughness: 0.9,
    metalness: 0,
    flatShading: true,
  });
}

/** Hip / top of legs (= bottom of torso). */
const HIP_Y = LIMB_H;
/** Torso center Y in unscaled model space (feet at 0). */
const TORSO_REST_Y = HIP_Y + TORSO_H / 2;
const BODY_REST_Y = TORSO_REST_Y;
/** Shoulder = top of torso (arms hang from here, not from head). */
const SHOULDER_Y = HIP_Y + TORSO_H;
/** Head center sits on torso top. */
const HEAD_Y = SHOULDER_Y + 0.5;

function box(
  w: number,
  h: number,
  d: number,
  color: number,
  y: number,
  x = 0,
  z = 0,
): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), bodyMat(color));
  mesh.position.set(x, y, z);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

/**
 * Limb mesh with pivot at the top (shoulder / hip).
 * Geometry translate(0, -0.375, 0) for h=0.75.
 */
function makeLimb(
  w: number,
  h: number,
  d: number,
  material: THREE.Material,
  name: string,
): THREE.Mesh {
  const geo = new THREE.BoxGeometry(w, h, d);
  geo.translate(0, -LIMB_PIVOT, 0);
  const mesh = new THREE.Mesh(geo, material);
  mesh.name = name;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  const hand = new THREE.Group();
  hand.name = "hand";
  hand.position.set(0, -h, 0);
  mesh.add(hand);
  return mesh;
}

function makeHead(body: number, face: number): THREE.Mesh {
  const side = bodyMat(body);
  const faceMat = new THREE.MeshStandardMaterial({
    map: paintFaceTexture(face, body, "idle"),
    roughness: 0.9,
    metalness: 0,
    flatShading: true,
  });
  faceMat.name = "faceMat";
  // BoxGeometry groups: +X -X +Y -Y +Z -Z. Look direction is −Z.
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), [
    side,
    side.clone(),
    side.clone(),
    side.clone(),
    side.clone(),
    faceMat,
  ]);
  mesh.name = "head";
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

/** Skull emoji plate glued to the face for the death emote. */
function createDeathFaceMask(): THREE.Mesh {
  const tw = 128;
  const th = 128;
  const c = document.createElement("canvas");
  c.width = tw;
  c.height = th;
  const ctx = c.getContext("2d")!;
  ctx.clearRect(0, 0, tw, th);
  ctx.font = "bold 96px IBM Plex Mono, Apple Color Emoji, Segoe UI Emoji, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("💀", tw / 2, th / 2 + 4);
  const tex = nearestTex(c);
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(0.55, 0.55),
    new THREE.MeshBasicMaterial({
      map: tex,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
    }),
  );
  mesh.name = "deathMask";
  mesh.position.set(0, 0.02, -0.51);
  mesh.visible = false;
  mesh.renderOrder = 2;
  return mesh;
}

export function createTopHat(): THREE.Group {
  const hat = new THREE.Group();
  hat.name = "hat";
  const brim = box(0.85, 0.06, 0.85, 0x101010, 0);
  const crown = box(0.5, 0.32, 0.5, 0x0e0e0e, 0.19);
  const band = box(0.52, 0.07, 0.52, 0xa33b2a, 0.07);
  hat.add(brim, crown, band);
  return hat;
}

export function wearHat(group: THREE.Group, on: boolean) {
  const hat = group.getObjectByName("hat");
  if (hat) hat.visible = on;
}

/**
 * Hierarchical Minecraft-style player: 6 independent meshes.
 * Unit = head width. Feet sit on Y = 0. Root is scaled to PLAYER_HEIGHT.
 */
export function createPlayerModel(palette: AvatarPalette): THREE.Group {
  const g = new THREE.Group();
  g.name = "playerModel";

  const flesh = bodyMat(palette.body);
  const limbMat = bodyMat(palette.accent);

  // —— legs (pivot at hip, feet on Y=0) ——
  const legGap = 0.04;
  const legX = TORSO_W / 4 + legGap / 2;
  const legLeft = makeLimb(LIMB_W, LIMB_H, LIMB_D, limbMat, "legLeft");
  legLeft.position.set(-legX, HIP_Y, 0);
  const legRight = makeLimb(LIMB_W, LIMB_H, LIMB_D, limbMat.clone(), "legRight");
  legRight.position.set(legX, HIP_Y, 0);

  // —— torso ——
  const torso = new THREE.Mesh(new THREE.BoxGeometry(TORSO_W, TORSO_H, TORSO_D), flesh);
  torso.name = "torso";
  torso.position.set(0, TORSO_REST_Y, 0);
  torso.castShadow = true;
  torso.receiveShadow = true;

  // —— arms at torso shoulders (not neck / crown) ——
  const armOut = TORSO_W / 2 + LIMB_W / 2 + 0.02;
  const armLeft = makeLimb(LIMB_W, LIMB_H, LIMB_D, flesh.clone(), "armLeft");
  armLeft.position.set(-armOut, SHOULDER_Y, 0);
  const armRight = makeLimb(LIMB_W, LIMB_H, LIMB_D, flesh.clone(), "armRight");
  armRight.position.set(armOut, SHOULDER_Y, 0);

  // —— head ——
  const head = makeHead(palette.body, palette.face);
  head.position.set(0, HEAD_Y, 0);
  head.add(createDeathFaceMask());

  g.add(legLeft, legRight, torso, armLeft, armRight, head);
  g.scale.setScalar(WORLD_SCALE);
  return g;
}

/**
 * Pip / Friday voxel figure — hierarchical boxes (createPlayerModel) + hat/shadow.
 * Animation code still looks up armL/armR/legL/legR/body aliases.
 */
function applyFaceMap(head: THREE.Mesh, map: THREE.Texture) {
  const mats = head.material;
  const list = Array.isArray(mats) ? mats : [mats];
  const faceMat = list.find((m) => m.name === "faceMat") ?? list[5];
  if (faceMat && "map" in faceMat) {
    const prev = faceMat.map;
    faceMat.map = map;
    faceMat.needsUpdate = true;
    // Don't dispose shared paintFaceTexture cache entries.
    if (prev && prev !== map && !(prev as THREE.Texture & { userData?: { cached?: boolean } }).userData?.cached) {
      /* keep canvas face cache alive */
    }
  }
}

function letterFaceTexture(letter: string, body: number, ink: number): THREE.CanvasTexture {
  const size = 64;
  const c = document.createElement("canvas");
  c.width = size;
  c.height = size;
  const ctx = c.getContext("2d")!;
  const [br, bg, bb] = hexRgb(body);
  const [fr, fg, fb] = hexRgb(ink);
  ctx.fillStyle = `rgb(${br},${bg},${bb})`;
  ctx.fillRect(0, 0, size, size);
  ctx.fillStyle = `rgb(${fr},${fg},${fb})`;
  ctx.font = "bold 36px IBM Plex Mono, monospace";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText((letter || "?").slice(0, 1).toUpperCase(), size / 2, size / 2 + 2);
  const tex = nearestTex(c);
  tex.userData = { cached: false, letter: true };
  return tex;
}

function loadPhotoTexture(url: string): Promise<THREE.Texture> {
  return new Promise((resolve, reject) => {
    const loader = new THREE.TextureLoader();
    loader.setCrossOrigin("anonymous");
    loader.load(
      url,
      (tex) => {
        tex.magFilter = THREE.NearestFilter;
        tex.minFilter = THREE.NearestFilter;
        tex.generateMipmaps = false;
        tex.colorSpace = THREE.SRGBColorSpace;
        tex.needsUpdate = true;
        resolve(tex);
      },
      undefined,
      () => reject(new Error("photo_cors")),
    );
  });
}

/**
 * Front-face avatar: Telegram photo_url when available, else letter canvas.
 * Safe to call after createAvatar; no-ops if head/faceMat missing.
 */
export async function applyTelegramFace(group: THREE.Group): Promise<void> {
  const head = group.getObjectByName("head") as THREE.Mesh | undefined;
  if (!head) return;
  const body = (group.userData.bodyColor as number) ?? 0x1a1a1a;
  const face = (group.userData.faceColor as number) ?? 0xf4f6f8;
  const name = getTelegramDisplayName();
  const letter = name.replace(/^@/, "").trim().charAt(0) || "П";

  const applyFallback = () => {
    const tex = letterFaceTexture(letter, body, face);
    group.userData.facePhoto = null;
    group.userData.facePhotoMap = tex;
    applyFaceMap(head, tex);
  };

  const photoUrl = getTelegramPhotoUrl();
  if (!photoUrl) {
    applyFallback();
    return;
  }

  try {
    const tex = await loadPhotoTexture(photoUrl);
    if (group.userData.disposed) {
      tex.dispose();
      return;
    }
    group.userData.facePhoto = photoUrl;
    group.userData.facePhotoMap = tex;
    applyFaceMap(head, tex);
  } catch {
    applyFallback();
  }
}

export function createAvatar(
  palette: AvatarPalette,
  extras: { monocle?: boolean; hat?: boolean; telegramFace?: boolean } = {},
): THREE.Group {
  const g = createPlayerModel(palette);
  g.userData.faceColor = palette.face;
  g.userData.bodyColor = palette.body;
  g.userData.avatarKind = palette.body < 0x808080 ? "pip" : "friday";
  g.userData.bodyRestY = BODY_REST_Y;
  g.userData.faceMood = "idle" satisfies FaceMood;

  const head = g.getObjectByName("head");
  if (head) {
    const hat = createTopHat();
    hat.position.y = 0.53;
    hat.visible = Boolean(extras.hat);
    head.add(hat);
  }
  void extras.monocle;

  if (extras.telegramFace) {
    void applyTelegramFace(g);
  }
  return g;
}

function wrapNameLines(text: string, maxChars: number, maxLines: number): string[] {
  const words = text.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return ["?"];
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    const next = cur ? `${cur} ${w}` : w;
    if (next.length <= maxChars) {
      cur = next;
      continue;
    }
    if (cur) lines.push(cur);
    if (lines.length >= maxLines) break;
    cur = w.length > maxChars ? w.slice(0, maxChars) : w;
  }
  if (cur && lines.length < maxLines) lines.push(cur);
  if (lines.length === 0) {
    for (let i = 0; i < text.length && lines.length < maxLines; i += maxChars) {
      lines.push(text.slice(i, i + maxChars));
    }
  }
  return lines.length ? lines : ["?"];
}

/**
 * Paint a TG nick on the torso. Dark body → white text; light body → black.
 */
export function setAvatarNametag(group: THREE.Group, rawName: string) {
  const prev = group.getObjectByName("nametag");
  if (prev) {
    group.remove(prev);
    const mesh = prev as THREE.Mesh;
    mesh.geometry?.dispose?.();
    const mat = mesh.material as THREE.MeshBasicMaterial | undefined;
    mat?.map?.dispose?.();
    mat?.dispose?.();
  }

  const name = rawName.trim().replace(/\s+/g, " ").slice(0, 28) || "игрок";
  const darkBody = group.userData.avatarKind === "pip";
  const fill = darkBody ? "#ffffff" : "#111111";
  const lines = wrapNameLines(name, 10, 3);

  const tw = 256;
  const lineH = 36;
  const pad = 12;
  const th = pad * 2 + lines.length * lineH;
  const c = document.createElement("canvas");
  c.width = tw;
  c.height = th;
  const ctx = c.getContext("2d")!;
  ctx.clearRect(0, 0, tw, th);
  ctx.fillStyle = fill;
  ctx.font = "bold 28px IBM Plex Mono, monospace";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  lines.forEach((line, i) => {
    ctx.fillText(line, tw / 2, pad + lineH * (i + 0.5));
  });

  const tex = nearestTex(c);
  const aspect = tw / th;
  const worldW = 0.85;
  const worldH = worldW / aspect;
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(worldW, worldH),
    new THREE.MeshBasicMaterial({
      map: tex,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
    }),
  );
  mesh.name = "nametag";
  mesh.position.set(0, BODY_REST_Y - (worldH - 0.35) * 0.2, -(TORSO_D / 2 + 0.01));
  mesh.renderOrder = 3;
  group.add(mesh);
}

function restBodyY(group: THREE.Group): number {
  return (group.userData.bodyRestY as number) ?? BODY_REST_Y;
}

export function setAvatarFace(group: THREE.Group, mood: FaceMood) {
  const face = (group.userData.faceColor as number) ?? 0xf4f6f8;
  const body = (group.userData.bodyColor as number) ?? 0x1a1a1a;
  const angry = 0xc41e1e;
  const skull =
    (group.getObjectByName("head") as THREE.Mesh | undefined) ??
    (group.getObjectByName("skull") as THREE.Mesh | undefined);
  const deathMask = group.getObjectByName("deathMask");
  const dead = mood === "death";

  group.userData.faceMood = mood;
  if (deathMask) deathMask.visible = dead;

  if (skull) {
    const mats = skull.material;
    const list = Array.isArray(mats) ? mats : [mats];
    const faceMat = list.find((m) => m.name === "faceMat") ?? list[5];
    if (faceMat && "map" in faceMat) {
      const photoMap = group.userData.facePhotoMap as THREE.Texture | undefined;
      if (photoMap && (mood === "idle" || mood === "wink")) {
        faceMat.map = photoMap;
      } else {
        faceMat.map = paintFaceTexture(face, mood === "censor" ? angry : body, mood);
      }
      faceMat.needsUpdate = true;
    }
    const sideHex = mood === "censor" ? angry : body;
    for (let i = 0; i < 5; i++) {
      const m = list[i] as THREE.MeshStandardMaterial | undefined;
      if (m && "color" in m) m.color.setHex(sideHex);
    }
  }
}

export function swingAvatar(
  group: THREE.Group,
  t: number,
  moving: boolean,
  emote: { kind: EmoteKind; age: number } | null,
) {
  const armL = group.getObjectByName("armL") ?? group.getObjectByName("armLeft");
  const armR = group.getObjectByName("armR") ?? group.getObjectByName("armRight");
  const legL = group.getObjectByName("legL") ?? group.getObjectByName("legLeft");
  const legR = group.getObjectByName("legR") ?? group.getObjectByName("legRight");
  const head = group.getObjectByName("head");
  const body = group.getObjectByName("body") ?? group.getObjectByName("torso");

  const amp = moving ? 0.42 : 0.035;
  const a = Math.sin(t * 8) * amp;

  if (emote && emote.age < emoteDuration(emote.kind)) {
    const dur = emoteDuration(emote.kind);
    const u = emote.age / dur;
    const fade = u < 0.08 ? u / 0.08 : u > 0.92 ? (1 - u) / 0.08 : 1;
    const wristL = armL?.getObjectByName("hand");
    const wristR = armR?.getObjectByName("hand");
    if (emote.kind !== "wave") {
      if (wristL) wristL.rotation.set(0, 0, 0);
      if (wristR) wristR.rotation.set(0, 0, 0);
    }
    if (emote.kind === "wave") {
      if (armR) {
        armR.rotation.x = 1.18 * fade;
        armR.rotation.y = 0.08 * fade;
        armR.rotation.z = 0.1 * fade;
        const elbow = armR.getObjectByName("hand");
        if (elbow) {
          elbow.rotation.x = 0.22 * fade;
          elbow.rotation.z = Math.sin(emote.age * 13) * 0.72 * fade;
        }
      }
      if (armL) armL.rotation.x = a * 0.25;
      if (head) head.rotation.y = 0.22 * fade;
    } else if (emote.kind === "hearts") {
      if (armL) {
        armL.rotation.z = 1.15 * fade;
        armL.rotation.x = -0.35 * fade;
      }
      if (armR) {
        armR.rotation.z = -1.15 * fade;
        armR.rotation.x = -0.35 * fade;
      }
      if (head) head.rotation.z = Math.sin(emote.age * 5) * 0.12 * fade;
      if (body) body.position.y = restBodyY(group) + Math.sin(emote.age * 6) * 0.03 * fade;
    } else if (emote.kind === "fart") {
      const squat = Math.sin(Math.min(1, emote.age / 0.25) * Math.PI) * fade;
      if (body) body.position.y = restBodyY(group) - 0.12 * squat;
      if (head) head.rotation.x = 0.2 * squat;
      if (armL) armL.rotation.z = 0.45 * fade;
      if (armR) armR.rotation.z = -0.45 * fade;
      if (legL) legL.rotation.x = 0.35 * squat;
      if (legR) legR.rotation.x = 0.35 * squat;
      return;
    } else if (emote.kind === "censor") {
      if (head) {
        head.rotation.x = -0.08 * fade;
        head.rotation.z = Math.sin(emote.age * 9) * 0.06 * fade;
      }
      if (armL) armL.rotation.x = 0.2 * fade;
      if (armR) armR.rotation.x = 0.2 * fade;
    } else if (emote.kind === "death") {
      if (head) {
        head.rotation.x = 0.15 * fade;
        head.rotation.z = Math.sin(emote.age * 4) * 0.04 * fade;
      }
      if (armL) {
        armL.rotation.x = -0.5 * fade;
        armL.rotation.z = 0.35 * fade;
      }
      if (armR) {
        armR.rotation.x = -0.5 * fade;
        armR.rotation.z = -0.35 * fade;
      }
      if (body) body.rotation.z = Math.sin(emote.age * 3) * 0.04 * fade;
    } else if (emote.kind === "attention") {
      const flap =
        (Math.sin((emote.age / EMOTE_ATTENTION_S) * EMOTE_ATTENTION_FLAPS * Math.PI * 2 - Math.PI / 2) + 1) / 2;
      const up = flap * fade;
      if (armL) {
        armL.rotation.x = -1.55 * up;
        armL.rotation.z = 0.55 * up;
        armL.rotation.y = 0.12 * up;
      }
      if (armR) {
        armR.rotation.x = -1.55 * up;
        armR.rotation.z = -0.55 * up;
        armR.rotation.y = -0.12 * up;
      }
      if (head) head.rotation.x = -0.08 * up;
    } else {
      const wob = Math.sin(emote.age * 18) * fade;
      if (head) {
        head.rotation.x = wob * 0.22;
        head.rotation.z = wob * 0.1;
      }
      if (body) body.rotation.z = wob * 0.08;
      if (armL) armL.rotation.z = 0.35 * fade;
      if (armR) armR.rotation.z = -0.35 * fade;
    }
    if (legL) legL.rotation.x = moving ? -a * 0.5 : 0;
    if (legR) legR.rotation.x = moving ? a * 0.5 : 0;
    return;
  }

  if (armL) {
    armL.rotation.x = a;
    armL.rotation.z = 0;
    const wristL = armL.getObjectByName("hand");
    if (wristL) wristL.rotation.set(0, 0, 0);
  }
  if (armR) {
    armR.rotation.x = -a;
    armR.rotation.z = 0;
    const wristR = armR.getObjectByName("hand");
    if (wristR) wristR.rotation.set(0, 0, 0);
  }
  if (legL) legL.rotation.x = -a;
  if (legR) legR.rotation.x = a;
  if (head) {
    head.rotation.x = 0;
    head.rotation.y = 0;
    head.rotation.z = 0;
  }
  if (body) {
    body.rotation.z = 0;
    body.position.y = restBodyY(group);
  }
}

export { createPickaxe, disposePickaxe, PICKAXE_REST, PICKAXE_TIP, pickaxeTip } from "./pickaxe";

/** First-person left arm: same block color as the avatar body. */
export function createLocalArm(palette: AvatarPalette = PIP): THREE.Group {
  const g = new THREE.Group();
  g.name = "localArm";
  const sleeve = bodyMat(palette.body);
  const upper = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.22, 0.11), sleeve);
  upper.position.set(0, -0.1, 0);
  const elbow = new THREE.Group();
  elbow.name = "elbow";
  elbow.position.set(0, -0.21, 0);
  const forearm = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.18, 0.1), sleeve.clone());
  forearm.position.set(0, -0.08, 0);
  const hand = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.1, 0.1), sleeve.clone());
  hand.position.set(0, -0.19, 0.02);
  elbow.add(forearm, hand);
  g.add(upper, elbow);
  g.position.set(-0.18, -0.1, -0.4);
  g.rotation.set(0, 0, 0);
  g.visible = false;
  return g;
}

/** 0 = stand, 0.35 = bend to the hat, 0.7 = hat on, 1 = wink-ready stand. */
export function poseHatPickup(group: THREE.Group, u: number) {
  const armR = group.getObjectByName("armR") ?? group.getObjectByName("armRight");
  const armL = group.getObjectByName("armL") ?? group.getObjectByName("armLeft");
  const head = group.getObjectByName("head");
  const body = group.getObjectByName("body") ?? group.getObjectByName("torso");
  const reach = u < 0.38 ? u / 0.38 : u < 0.62 ? 1 : Math.max(0, 1 - (u - 0.62) / 0.2);
  const bow = u < 0.5 ? u / 0.5 : Math.max(0, 1 - (u - 0.5) / 0.35);
  if (body) {
    body.rotation.x = bow * 0.42;
    body.position.y = restBodyY(group) - bow * 0.08;
  }
  if (head) {
    head.rotation.x = bow * 0.35;
    head.rotation.y = u > 0.72 ? (u - 0.72) * 0.8 : 0;
  }
  if (armR) {
    armR.rotation.x = reach * 1.15;
    armR.rotation.z = -reach * 0.25;
  }
  if (armL) {
    armL.rotation.x = reach * 0.2;
    armL.rotation.z = 0;
  }
}

export function poseLocalArm(arm: THREE.Group, age: number) {
  const u = Math.min(1, age / EMOTE_DURATION);
  const fade = u < 0.12 ? u / 0.12 : u > 0.8 ? (1 - u) / 0.2 : 1;
  arm.visible = fade > 0.02;
  arm.position.set(-0.18, -0.1, -0.4);
  arm.rotation.set(1.2 * fade, 0.16 * fade, 0.1 * fade);
  const elbow = arm.getObjectByName("elbow");
  if (elbow) {
    elbow.rotation.x = 0.2 * fade;
    elbow.rotation.z = Math.sin(age * 13) * 0.7 * fade;
  }
}

export function createHeartMesh(): THREE.Mesh {
  const mesh = new THREE.Mesh(
    new THREE.OctahedronGeometry(0.07, 0),
    new THREE.MeshBasicMaterial({
      color: HEART,
      transparent: true,
      opacity: 0.92,
      depthWrite: false,
    }),
  );
  mesh.scale.set(1, 1.25, 0.55);
  return mesh;
}
