/**
 * Isolated authoritative room instance (ephemeral — RAM only).
 * Owns world stub, clients, poses, and config. No disk persistence.
 */

import type { RoomConfig } from "./room-config.ts";
import {
  normalizeEquippedItem,
  parseClientMessage,
  poseTuple,
  quantize,
  type EquippedItem,
  type PlayerAction,
  type PlayerPose,
  type PoseTuple,
  type ServerWireMessage,
} from "./protocol.ts";

/** Minimal socket surface — keep transport (WS / test double) out of the core. */
export type RoomClient = {
  readonly id: string;
  send(message: unknown): void;
  close(code?: number, reason?: string): void;
};

export type ClientInput = {
  type: string;
  payload?: unknown;
  at?: number;
};

export type GameInstanceOptions = {
  roomId: string;
  config: RoomConfig;
  now?: () => number;
  /** State broadcast Hz. Default 20. */
  tickHz?: number;
};

type InternalPlayer = PlayerPose & { dirty: boolean };

/**
 * One live room. Game logic reads flags from `this.config` only.
 */
export class GameInstance {
  readonly roomId: string;
  readonly config: Readonly<RoomConfig>;

  private readonly world: { chunks: Map<string, unknown> } = {
    chunks: new Map(),
  };

  private readonly clients = new Map<string, RoomClient>();
  private readonly players = new Map<string, InternalPlayer>();
  private readonly now: () => number;
  private emptySinceMs: number | null;
  private createdAtMs: number;
  private destroyed = false;
  private readonly timers = new Set<ReturnType<typeof setInterval>>();

  constructor(opts: GameInstanceOptions) {
    this.roomId = opts.roomId;
    this.config = Object.freeze({ ...opts.config });
    this.now = opts.now ?? Date.now;
    this.createdAtMs = this.now();
    this.emptySinceMs = this.createdAtMs;

    const hz = Math.max(1, Math.min(60, opts.tickHz ?? 20));
    const tickMs = Math.round(1000 / hz);
    const tick = setInterval(() => this.flushStateBroadcast(), tickMs);
    this.timers.add(tick);
    if (typeof tick === "object" && tick && "unref" in tick) {
      (tick as NodeJS.Timeout).unref?.();
    }

    if (this.config.timeLimit > 0) {
      const ms = this.config.timeLimit * 1000;
      const handle = setInterval(() => {
        if (this.now() - this.createdAtMs >= ms) {
          this.destroy("time_limit");
        }
      }, 1_000);
      this.timers.add(handle);
      if (typeof handle === "object" && handle && "unref" in handle) {
        (handle as NodeJS.Timeout).unref?.();
      }
    }
  }

  get playerCount(): number {
    return this.clients.size;
  }

  getEmptySinceMs(): number | null {
    return this.emptySinceMs;
  }

  isDestroyed(): boolean {
    return this.destroyed;
  }

  /** Snapshot for tests / welcome payload. */
  getPoseSnapshot(): PoseTuple[] {
    const out: PoseTuple[] = [];
    for (const [id, p] of this.players) {
      out.push(poseTuple(id, p));
    }
    return out;
  }

  attachClient(client: RoomClient): boolean {
    if (this.destroyed) return false;
    if (this.clients.size >= this.config.maxPlayers) {
      client.close(4000, "room_full");
      return false;
    }
    if (this.clients.has(client.id)) {
      this.clients.get(client.id)?.close(4001, "replaced");
      this.players.delete(client.id);
    }
    this.clients.set(client.id, client);
    const pose: InternalPlayer = { x: 0, y: 0, z: 0, r: 0, equippedItem: "", dirty: false };
    this.players.set(client.id, pose);
    this.emptySinceMs = null;

    this.sendTo(client.id, {
      t: "welcome",
      roomId: this.roomId,
      clientId: client.id,
      players: this.getPoseSnapshot().filter((row) => row[0] !== client.id),
    });

    this.broadcast(
      {
        t: "join",
        id: client.id,
        x: pose.x,
        y: pose.y,
        z: pose.z,
        r: pose.r,
        equippedItem: pose.equippedItem,
      },
      client.id,
    );
    return true;
  }

  detachClient(clientId: string): void {
    if (!this.clients.has(clientId)) return;
    this.clients.delete(clientId);
    this.players.delete(clientId);
    this.broadcast({ t: "leave", id: clientId });
    if (this.clients.size === 0) {
      this.emptySinceMs = this.now();
    }
  }

  /**
   * Inbound packet. Prefer wire `{ t:"pose"|"act" }` via processWire;
   * legacy `{ type }` ClientInput still accepted for tests.
   */
  processInput(clientId: string, input: ClientInput): void {
    if (this.destroyed) return;
    if (!this.clients.has(clientId)) return;
    if (!input || typeof input.type !== "string") return;

    if (input.type === "pose" || input.type === "move") {
      const p = input.payload;
      if (typeof p !== "object" || p === null) return;
      const row = p as Record<string, unknown>;
      this.applyPose(clientId, {
        x: Number(row.x),
        y: Number(row.y),
        z: Number(row.z),
        r: Number(row.r ?? row.rotation ?? 0),
        equippedItem: normalizeEquippedItem(row.equippedItem),
      });
      return;
    }
    if (input.type === "act" || input.type === "action") {
      const a = (input.payload as { a?: unknown } | undefined)?.a;
      if (a === "jump" || a === "hit") this.applyAction(clientId, a);
      return;
    }
    if (input.type === "jump") {
      this.applyAction(clientId, "jump");
      return;
    }
    if (input.type === "hit" || input.type === "damage") {
      this.applyAction(clientId, "hit");
      return;
    }
    if (input.type === "build") {
      // Creator / Blueprint path later — live rooms ignore for now.
      return;
    }
  }

  /** Parse raw WS text/buffer and route into this instance. */
  processWire(clientId: string, raw: unknown): void {
    if (this.destroyed) return;
    if (!this.clients.has(clientId)) return;
    const msg = parseClientMessage(raw);
    if (!msg) return;
    if (msg.t === "pose") {
      this.applyPose(clientId, msg);
      return;
    }
    this.applyAction(clientId, msg.a);
  }

  private applyPose(clientId: string, next: {
    x?: number;
    y?: number;
    z?: number;
    r?: number;
    equippedItem?: EquippedItem | string;
  }): void {
    const cur = this.players.get(clientId);
    if (!cur) return;
    if (![next.x, next.y, next.z, next.r].every((n) => typeof n === "number" && Number.isFinite(n))) {
      return;
    }
    const x = quantize(next.x!);
    const y = quantize(next.y!);
    const z = quantize(next.z!);
    const r = quantize(next.r!);
    const equippedItem = normalizeEquippedItem(next.equippedItem);
    if (
      cur.x === x &&
      cur.y === y &&
      cur.z === z &&
      cur.r === r &&
      cur.equippedItem === equippedItem
    ) {
      return;
    }
    cur.x = x;
    cur.y = y;
    cur.z = z;
    cur.r = r;
    cur.equippedItem = equippedItem;
    cur.dirty = true;
  }

  private applyAction(clientId: string, a: PlayerAction): void {
    if (!this.players.has(clientId)) return;
    if (a === "hit" && !this.config.pvp && this.config.mode !== "sandbox") {
      // Non-sandbox without pvp: ignore hits.
      return;
    }
    // Immediate event — not batched (rare, low bandwidth).
    this.broadcast({ t: "act", id: clientId, a }, clientId);
  }

  /**
   * Send only dirty poses since last tick (except to self).
   * Avoids per-input fan-out overload.
   */
  flushStateBroadcast(): void {
    if (this.destroyed || this.clients.size === 0) return;
    const dirty: PoseTuple[] = [];
    for (const [id, p] of this.players) {
      if (!p.dirty) continue;
      p.dirty = false;
      dirty.push(poseTuple(id, p));
    }
    if (dirty.length === 0) return;

    // Each client gets others' dirty rows only (never own echo).
    for (const [viewerId, client] of this.clients) {
      const filtered = dirty.filter((row) => row[0] !== viewerId);
      if (filtered.length === 0) continue;
      try {
        client.send({ t: "state", p: filtered } satisfies ServerWireMessage);
      } catch {
        /* drop */
      }
    }
  }

  broadcast(message: unknown, exceptClientId?: string): void {
    for (const [id, client] of this.clients) {
      if (exceptClientId && id === exceptClientId) continue;
      try {
        client.send(message);
      } catch {
        /* drop */
      }
    }
  }

  private sendTo(clientId: string, message: ServerWireMessage): void {
    const client = this.clients.get(clientId);
    if (!client) return;
    try {
      client.send(message);
    } catch {
      /* drop */
    }
  }

  destroy(reason = "destroyed"): void {
    if (this.destroyed) return;
    this.destroyed = true;
    for (const t of this.timers) clearInterval(t);
    this.timers.clear();
    for (const client of this.clients.values()) {
      try {
        client.close(4002, reason);
      } catch {
        /* ignore */
      }
    }
    this.clients.clear();
    this.players.clear();
    this.world.chunks.clear();
    this.emptySinceMs = this.now();
  }
}
