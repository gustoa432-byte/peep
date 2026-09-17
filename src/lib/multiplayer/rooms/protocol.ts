/**
 * Wire protocol for ephemeral live rooms (RAM only).
 * Compact JSON — no Blueprint / SQLite persistence on this path.
 */

export type PlayerAction = "jump" | "hit";

/** Held tool id synced over the wire (empty = bare hands). */
export type EquippedItem = "pickaxe" | "";

/** Authoritative pose stored per client inside a GameInstance. */
export type PlayerPose = {
  x: number;
  y: number;
  z: number;
  /** Yaw radians. */
  r: number;
  /** Currently equipped item (default bare hands). */
  equippedItem: EquippedItem;
};

/** Compact wire tuple: [clientId, x, y, z, r, equippedItem] */
export type PoseTuple = [string, number, number, number, number, EquippedItem];

export type ClientPoseMessage = {
  t: "pose";
  x: number;
  y: number;
  z: number;
  r: number;
  equippedItem?: EquippedItem | string;
};

export type ClientActMessage = {
  t: "act";
  a: PlayerAction;
};

export type ClientWireMessage = ClientPoseMessage | ClientActMessage;

export type ServerWelcomeMessage = {
  t: "welcome";
  roomId: string;
  clientId: string;
  players: PoseTuple[];
};

export type ServerJoinMessage = {
  t: "join";
  id: string;
  x: number;
  y: number;
  z: number;
  r: number;
  equippedItem?: EquippedItem;
};

export type ServerLeaveMessage = {
  t: "leave";
  id: string;
};

/** Dirty poses only — one tick batch to avoid flooding the channel. */
export type ServerStateMessage = {
  t: "state";
  p: PoseTuple[];
};

export type ServerActMessage = {
  t: "act";
  id: string;
  a: PlayerAction;
};

export type ServerWireMessage =
  | ServerWelcomeMessage
  | ServerJoinMessage
  | ServerLeaveMessage
  | ServerStateMessage
  | ServerActMessage;

const ACTIONS = new Set<PlayerAction>(["jump", "hit"]);

export function normalizeEquippedItem(raw: unknown): EquippedItem {
  if (raw === "pickaxe") return "pickaxe";
  return "";
}

/** Quantize to 2 decimals — enough for demo sync, smaller JSON. */
export function quantize(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100) / 100;
}

export function poseTuple(id: string, pose: PlayerPose): PoseTuple {
  return [
    id,
    quantize(pose.x),
    quantize(pose.y),
    quantize(pose.z),
    quantize(pose.r),
    normalizeEquippedItem(pose.equippedItem),
  ];
}

export function parsePoseTuple(row: unknown): PoseTuple | null {
  if (!Array.isArray(row) || row.length < 5) return null;
  const id = row[0];
  const x = Number(row[1]);
  const y = Number(row[2]);
  const z = Number(row[3]);
  const r = Number(row[4]);
  if (typeof id !== "string" || ![x, y, z, r].every((n) => Number.isFinite(n))) return null;
  const item = normalizeEquippedItem(row[5]);
  return [id, x, y, z, r, item];
}

export function parseClientMessage(raw: unknown): ClientWireMessage | null {
  let data: unknown = raw;
  if (typeof raw === "string") {
    try {
      data = JSON.parse(raw);
    } catch {
      return null;
    }
  }
  if (typeof data !== "object" || data === null || Array.isArray(data)) return null;
  const o = data as Record<string, unknown>;
  if (o.t === "pose") {
    const x = Number(o.x);
    const y = Number(o.y);
    const z = Number(o.z);
    const r = Number(o.r);
    if (![x, y, z, r].every((n) => Number.isFinite(n))) return null;
    return {
      t: "pose",
      x: clamp(x, -10_000, 10_000),
      y: clamp(y, -10_000, 10_000),
      z: clamp(z, -10_000, 10_000),
      r: clamp(r, -Math.PI * 4, Math.PI * 4),
      equippedItem: normalizeEquippedItem(o.equippedItem),
    };
  }
  if (o.t === "act") {
    const a = o.a;
    if (typeof a !== "string" || !ACTIONS.has(a as PlayerAction)) return null;
    return { t: "act", a: a as PlayerAction };
  }
  return null;
}

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}
