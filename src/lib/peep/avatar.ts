import * as THREE from "three";
import { EMOTE_DURATION, type EmoteKind } from "./types";

const SKIN = 0xe8c4a8;
const SCLERA = 0xf6efe6;
const IRIS = 0x2a221c;
const HEART = 0xc94a5a;
const MOUTH = 0x6a3a36;

export type AvatarPalette = {
  body: number;
  accent: number;
};

export type FaceMood = "idle" | EmoteKind;

export const PALETTES: AvatarPalette[] = [
  { body: 0xb85c38, accent: 0x3a241c },
  { body: 0x3d6e6b, accent: 0x1c3230 },
];

export function paletteFor(id: string, otherId?: string): AvatarPalette {
  if (otherId) return id < otherId ? PALETTES[0]! : PALETTES[1]!;
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0;
  return PALETTES[Math.abs(h) % PALETTES.length]!;
}

/** Shoulder-pivoted arm so a wave moves the hand, not the torso stub. */
function makeArm(x: number, color: number): THREE.Group {
  const arm = new THREE.Group();
  arm.position.set(x, 1.16, 0);
  const upper = box(0.14, 0.26, 0.14, color, -0.13);
  upper.name = "upper";
  arm.add(upper);
  const hand = new THREE.Group();
  hand.name = "hand";
  hand.position.set(0, -0.27, 0);
  const forearm = box(0.13, 0.22, 0.13, color, -0.1);
  const palm = box(0.11, 0.11, 0.11, SKIN, -0.24);
  hand.add(forearm, palm);
  arm.add(hand);
  return arm;
}

function box(
  w: number,
  h: number,
  d: number,
  color: number,
  y: number,
  x = 0,
  z = 0,
): THREE.Mesh {
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(w, h, d),
    new THREE.MeshLambertMaterial({ color }),
  );
  mesh.position.set(x, y, z);
  mesh.castShadow = false;
  return mesh;
}

/**
 * Readable clay figure, not a Steve clone: larger head, shorter limbs, a face
 * on the look direction (−Z) so Wave / Hearts / Laugh are visible to a friend.
 */
export function createAvatar(palette: AvatarPalette): THREE.Group {
  const g = new THREE.Group();

  const head = new THREE.Group();
  head.name = "head";
  head.position.set(0, 1.42, 0);
  const skull = box(0.4, 0.4, 0.4, SKIN, 0);
  skull.name = "skull";
  head.add(skull);

  const eyeL = box(0.09, 0.08, 0.04, SCLERA, 0.04, -0.09, -0.2);
  const eyeR = box(0.09, 0.08, 0.04, SCLERA, 0.04, 0.09, -0.2);
  eyeL.name = "eyeL";
  eyeR.name = "eyeR";
  const pupilL = box(0.045, 0.045, 0.03, IRIS, 0.035, -0.09, -0.22);
  const pupilR = box(0.045, 0.045, 0.03, IRIS, 0.035, 0.09, -0.22);
  pupilL.name = "pupilL";
  pupilR.name = "pupilR";
  const mouth = box(0.12, 0.035, 0.03, MOUTH, -0.1, 0, -0.205);
  mouth.name = "mouth";
  head.add(eyeL, eyeR, pupilL, pupilR, mouth);
  g.add(head);

  const body = box(0.46, 0.52, 0.26, palette.body, 0.92);
  body.name = "body";
  g.add(body);

  const armL = makeArm(-0.32, palette.body);
  const armR = makeArm(0.32, palette.body);
  armL.name = "armL";
  armR.name = "armR";
  const legL = box(0.18, 0.5, 0.18, palette.accent, 0.26, -0.11);
  const legR = box(0.18, 0.5, 0.18, palette.accent, 0.26, 0.11);
  legL.name = "legL";
  legR.name = "legR";
  g.add(armL, armR, legL, legR);

  const blob = new THREE.Mesh(
    new THREE.CircleGeometry(0.38, 16),
    new THREE.MeshBasicMaterial({
      color: 0x1a1612,
      transparent: true,
      opacity: 0.28,
      depthWrite: false,
    }),
  );
  blob.rotation.x = -Math.PI / 2;
  blob.position.y = 0.03;
  blob.name = "shadow";
  g.add(blob);
  return g;
}

function tint(mesh: THREE.Object3D | undefined, color: number) {
  if (!mesh || !("material" in mesh)) return;
  const mat = (mesh as THREE.Mesh).material;
  if (mat && "color" in mat) (mat as THREE.MeshLambertMaterial).color.setHex(color);
}

export function setAvatarFace(group: THREE.Group, mood: FaceMood) {
  const eyeL = group.getObjectByName("eyeL");
  const eyeR = group.getObjectByName("eyeR");
  const pupilL = group.getObjectByName("pupilL");
  const pupilR = group.getObjectByName("pupilR");
  const mouth = group.getObjectByName("mouth");

  if (eyeL) eyeL.scale.set(1, mood === "laugh" ? 0.45 : 1, 1);
  if (eyeR) eyeR.scale.set(1, mood === "laugh" ? 0.45 : 1, 1);

  if (mood === "hearts") {
    tint(pupilL, HEART);
    tint(pupilR, HEART);
    if (pupilL) pupilL.scale.set(1.25, 1.15, 1);
    if (pupilR) pupilR.scale.set(1.25, 1.15, 1);
  } else {
    tint(pupilL, IRIS);
    tint(pupilR, IRIS);
    if (pupilL) pupilL.scale.set(1, mood === "laugh" ? 0.4 : 1, 1);
    if (pupilR) pupilR.scale.set(1, mood === "laugh" ? 0.4 : 1, 1);
  }

  if (mouth) {
    if (mood === "laugh") mouth.scale.set(0.85, 2.4, 1);
    else if (mood === "wave") mouth.scale.set(1.25, 0.55, 1);
    else if (mood === "hearts") mouth.scale.set(1.15, 0.7, 1);
    else mouth.scale.set(1, 1, 1);
  }
}

export function swingAvatar(
  group: THREE.Group,
  t: number,
  moving: boolean,
  emote: { kind: EmoteKind; age: number } | null,
) {
  const armL = group.getObjectByName("armL");
  const armR = group.getObjectByName("armR");
  const legL = group.getObjectByName("legL");
  const legR = group.getObjectByName("legR");
  const head = group.getObjectByName("head");
  const body = group.getObjectByName("body");

  const amp = moving ? 0.42 : 0.035;
  const a = Math.sin(t * 8) * amp;

  if (emote && emote.age < EMOTE_DURATION) {
    const u = emote.age / EMOTE_DURATION;
    const fade = u < 0.12 ? u / 0.12 : u > 0.82 ? (1 - u) / 0.18 : 1;
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
      if (body) body.position.y = 0.92 + Math.sin(emote.age * 6) * 0.03 * fade;
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
    body.position.y = 0.92;
  }
}

export const PICKAXE_REST = {
  x: 0.22,
  y: -0.24,
  z: -0.5,
  rx: -0.55,
  ry: 1.05,
  rz: 0.62,
};

export function createPickaxe(): THREE.Group {
  const g = new THREE.Group();
  const handleMat = new THREE.MeshLambertMaterial({ color: 0x6e4324 });
  const headMat = new THREE.MeshLambertMaterial({ color: 0x9a9690 });
  const handle = new THREE.Mesh(new THREE.BoxGeometry(0.048, 0.5, 0.048), handleMat);
  handle.position.y = -0.02;
  const collar = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.045, 0.06), handleMat);
  collar.position.y = 0.2;
  const bar = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.05, 0.05), headMat);
  bar.position.y = 0.24;
  const pick = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.05, 0.11), headMat);
  pick.position.set(0.085, 0.24, -0.03);
  const poll = new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.045, 0.07), headMat);
  poll.position.set(-0.09, 0.24, 0.02);
  g.add(handle, collar, bar, pick, poll);
  g.scale.setScalar(0.62);
  g.position.set(PICKAXE_REST.x, PICKAXE_REST.y, PICKAXE_REST.z);
  g.rotation.set(PICKAXE_REST.rx, PICKAXE_REST.ry, PICKAXE_REST.rz);
  return g;
}

/** First-person left arm: shoulder stays on the torso, reach matches the pickaxe. */
export function createLocalArm(): THREE.Group {
  const g = new THREE.Group();
  g.name = "localArm";
  const skin = new THREE.MeshLambertMaterial({ color: SKIN });
  const sleeve = new THREE.MeshLambertMaterial({ color: 0xb85c38 });
  const upper = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.22, 0.11), sleeve);
  upper.position.set(0, -0.1, 0);
  const elbow = new THREE.Group();
  elbow.name = "elbow";
  elbow.position.set(0, -0.21, 0);
  const forearm = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.18, 0.1), sleeve);
  forearm.position.set(0, -0.08, 0);
  const hand = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.1, 0.1), skin);
  hand.position.set(0, -0.19, 0.02);
  elbow.add(forearm, hand);
  g.add(upper, elbow);
  g.position.set(-0.18, -0.1, -0.4);
  g.rotation.set(0, 0, 0);
  g.visible = false;
  return g;
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
