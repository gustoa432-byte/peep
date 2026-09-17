/**
 * Client-side entity smoothing for remote players.
 * Network updates set targets; the render loop lerps / slerps the mesh.
 */

import * as THREE from "three";
import { createPickaxe, disposePickaxe } from "../../peep/pickaxe.ts";
import type { EquippedItem, PlayerAction } from "./protocol.ts";

export type RemoteEntityOptions = {
  /** Exponential follow rate (higher = snappier). ~10–14 feels good at 60 FPS. */
  followHz?: number;
  /** Hard snap if mesh is farther than this from target (world units). */
  snapDistance?: number;
  /** Visual root. Defaults to an empty group (tests / headless). */
  mesh?: THREE.Object3D;
  /** Shared listener from the local camera (enables PositionalAudio). */
  listener?: THREE.AudioListener;
};

const Y_AXIS = new THREE.Vector3(0, 1, 0);
const _euler = new THREE.Euler(0, 0, 0, "YXZ");

const STEP_DIST = 0.55;
const REF_DISTANCE = 4;
const MAX_DISTANCE = 32;

export function disposeObject(root: THREE.Object3D): void {
  root.traverse((n) => {
    const mesh = n as THREE.Mesh;
    if (!mesh.isMesh) return;
    mesh.geometry.dispose();
    const mats = mesh.material;
    const list = Array.isArray(mats) ? mats : [mats];
    for (const m of list) m.dispose();
  });
}

function flashMaterials(root: THREE.Object3D, hex: number, intensity: number): void {
  root.traverse((n) => {
    const mesh = n as THREE.Mesh;
    if (!mesh.isMesh) return;
    const mats = mesh.material;
    const list = Array.isArray(mats) ? mats : [mats];
    for (const m of list) {
      if ("emissive" in m && m.emissive) {
        (m.emissive as THREE.Color).setHex(hex);
        if ("emissiveIntensity" in m) m.emissiveIntensity = intensity;
      }
    }
  });
}

/** Attach / detach a mini pickaxe on armRight so it swings with the limb. */
export function setEquippedItem(avatar: THREE.Object3D, item: EquippedItem | string | null | undefined): void {
  const arm =
    avatar.getObjectByName("armRight") ??
    avatar.getObjectByName("armR");
  if (!arm) return;

  let slot = arm.getObjectByName("equippedSlot") as THREE.Group | undefined;
  if (!slot) {
    slot = new THREE.Group();
    slot.name = "equippedSlot";
    // Near the hand tip (limb height 0.75, pivot at top).
    slot.position.set(0.06, -0.62, -0.08);
    slot.rotation.set(0.55, 0.35, -0.85);
    slot.scale.setScalar(0.42);
    arm.add(slot);
  }

  const want = item === "pickaxe";
  const existing = slot.getObjectByName("remotePickaxe") as THREE.Group | undefined;
  if (want && !existing) {
    const pick = createPickaxe();
    pick.name = "remotePickaxe";
    slot.add(pick);
  } else if (!want && existing) {
    slot.remove(existing);
    disposePickaxe(existing);
  } else if (existing) {
    existing.visible = want;
  }
}

function makeNoiseBuffer(ctx: AudioContext, seconds = 0.12): AudioBuffer {
  const rate = ctx.sampleRate;
  const n = Math.max(1, Math.floor(rate * seconds));
  const buf = ctx.createBuffer(1, n, rate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < n; i++) {
    const env = 1 - i / n;
    data[i] = (Math.random() * 2 - 1) * env * env;
  }
  return buf;
}

/**
 * One remote avatar: discrete WS targets + smooth display transform + spatial SFX.
 */
export class RemoteEntity {
  readonly id: string;
  readonly mesh: THREE.Object3D;
  readonly targetPosition = new THREE.Vector3();
  readonly targetRotation = new THREE.Quaternion();

  private readonly followHz: number;
  private readonly snapDistance: number;
  private readonly snapDistanceSq: number;
  private equipped: EquippedItem = "";
  private readonly listener: THREE.AudioListener | null;
  private voice: THREE.PositionalAudio | null = null;
  private noiseBuf: AudioBuffer | null = null;
  private lastStepAt = new THREE.Vector3();
  private stepReady = false;

  constructor(id: string, opts: RemoteEntityOptions = {}) {
    this.id = id;
    this.followHz = opts.followHz ?? 12;
    this.snapDistance = opts.snapDistance ?? 3;
    this.snapDistanceSq = this.snapDistance * this.snapDistance;
    this.mesh = opts.mesh ?? new THREE.Group();
    this.listener = opts.listener ?? null;

    this.mesh.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) {
        o.castShadow = true;
        o.receiveShadow = true;
      }
    });

    if (this.listener) {
      this.voice = new THREE.PositionalAudio(this.listener);
      this.voice.setRefDistance(REF_DISTANCE);
      this.voice.setMaxDistance(MAX_DISTANCE);
      this.voice.setRolloffFactor(1.4);
      this.voice.setVolume(0.85);
      this.mesh.add(this.voice);
      const ctx = this.listener.context;
      this.noiseBuf = makeNoiseBuffer(ctx, 0.1);
    }
  }

  setEquipped(item: EquippedItem | string | null | undefined): void {
    const next = item === "pickaxe" ? "pickaxe" : "";
    if (next === this.equipped) return;
    this.equipped = next;
    setEquippedItem(this.mesh, next);
  }

  getEquipped(): EquippedItem {
    return this.equipped;
  }

  setTarget(x: number, y: number, z: number, yaw: number): void {
    this.targetPosition.set(x, y, z);
    this.targetRotation.setFromAxisAngle(Y_AXIS, yaw);
  }

  snapTo(x: number, y: number, z: number, yaw: number): void {
    this.setTarget(x, y, z, yaw);
    this.mesh.position.copy(this.targetPosition);
    this.mesh.quaternion.copy(this.targetRotation);
    this.lastStepAt.copy(this.mesh.position);
    this.stepReady = true;
  }

  update(dtSeconds: number): void {
    const dt = Math.max(0, Math.min(0.1, dtSeconds));
    const distSq = this.mesh.position.distanceToSquared(this.targetPosition);

    if (distSq > this.snapDistanceSq) {
      this.mesh.position.copy(this.targetPosition);
      this.mesh.quaternion.copy(this.targetRotation);
      this.lastStepAt.copy(this.mesh.position);
      return;
    }

    const alpha = 1 - Math.exp(-this.followHz * dt);
    this.mesh.position.lerp(this.targetPosition, alpha);
    this.mesh.quaternion.slerp(this.targetRotation, alpha);

    if (this.stepReady) {
      const moved = this.mesh.position.distanceTo(this.lastStepAt);
      if (moved >= STEP_DIST) {
        this.lastStepAt.copy(this.mesh.position);
        this.playCue("step");
      }
    }
  }

  playAction(a: PlayerAction): void {
    if (a === "jump") this.playCue("jump");
    else if (a === "hit") this.playCue("hit");
  }

  flash(on: boolean): void {
    flashMaterials(this.mesh, on ? 0xffe08a : 0x000000, on ? 0.55 : 0);
  }

  private playCue(kind: "step" | "jump" | "hit"): void {
    if (!this.voice || !this.noiseBuf) return;
    if (this.voice.isPlaying) this.voice.stop();
    this.voice.setBuffer(this.noiseBuf);
    this.voice.setPlaybackRate(kind === "jump" ? 1.35 : kind === "hit" ? 0.75 : 1);
    this.voice.setVolume(kind === "hit" ? 1 : kind === "jump" ? 0.7 : 0.45);
    try {
      this.voice.play();
    } catch {
      /* AudioContext may be locked until a gesture */
    }
  }

  dispose(): void {
    if (this.voice) {
      try {
        if (this.voice.isPlaying) this.voice.stop();
      } catch {
        /* ignore */
      }
      this.mesh.remove(this.voice);
      this.voice.disconnect();
      this.voice = null;
    }
    setEquippedItem(this.mesh, "");
    disposeObject(this.mesh);
  }
}

export function applyYawPose(
  mesh: THREE.Object3D,
  x: number,
  y: number,
  z: number,
  yaw: number,
): void {
  mesh.position.set(x, y, z);
  _euler.set(0, yaw, 0);
  mesh.quaternion.setFromEuler(_euler);
}
