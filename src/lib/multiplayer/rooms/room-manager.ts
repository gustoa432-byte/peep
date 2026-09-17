/**
 * In-memory orchestrator for live GameInstance rooms (ephemeral / RAM-only).
 * Sessions are never written to SQLite — process death = rooms gone.
 * Application-level singleton via getRoomManager() — no other module globals.
 */

import { GameInstance } from "./game-instance.ts";
import { parseRoomConfig, type RoomConfig } from "./room-config.ts";

export type PublicRoomInfo = {
  id: string;
  playerCount: number;
  maxPlayers: number;
  mode: RoomConfig["mode"];
  pvp: boolean;
};

export type RoomManagerOptions = {
  now?: () => number;
  /** Empty-room TTL before destroy (ms). Default 3 minutes. */
  emptyTtlMs?: number;
  /** GC tick interval (ms). Default 30s. */
  gcIntervalMs?: number;
  /** Disable automatic GC (tests). */
  autoGc?: boolean;
  idFactory?: () => string;
};

const EMPTY_TTL_MS = 3 * 60_000;
const GC_INTERVAL_MS = 30_000;
const ID_ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789";

function randomRoomId(): string {
  const bytes = new Uint8Array(6);
  crypto.getRandomValues(bytes);
  let out = "";
  for (let i = 0; i < 6; i++) {
    out += ID_ALPHABET[bytes[i]! % ID_ALPHABET.length]!;
  }
  return out;
}

export class RoomManager {
  private readonly rooms = new Map<string, GameInstance>();
  private readonly now: () => number;
  private readonly emptyTtlMs: number;
  private readonly idFactory: () => string;
  private gcTimer: ReturnType<typeof setInterval> | null = null;

  constructor(opts: RoomManagerOptions = {}) {
    this.now = opts.now ?? Date.now;
    this.emptyTtlMs = opts.emptyTtlMs ?? EMPTY_TTL_MS;
    this.idFactory = opts.idFactory ?? randomRoomId;
    if (opts.autoGc !== false) {
      const interval = opts.gcIntervalMs ?? GC_INTERVAL_MS;
      this.gcTimer = setInterval(() => this.runGarbageCollection(), interval);
      // Allow Node to exit in tests / short-lived processes.
      if (typeof this.gcTimer === "object" && this.gcTimer && "unref" in this.gcTimer) {
        (this.gcTimer as NodeJS.Timeout).unref?.();
      }
    }
  }

  createRoom(userConfig: unknown): string {
    const config = parseRoomConfig(userConfig);
    let id = this.idFactory();
    for (let i = 0; i < 8 && this.rooms.has(id); i++) {
      id = this.idFactory();
    }
    if (this.rooms.has(id)) {
      throw new Error("Could not allocate room id");
    }
    const instance = new GameInstance({
      roomId: id,
      config,
      now: this.now,
    });
    this.rooms.set(id, instance);
    return id;
  }

  getRoom(id: string): GameInstance | undefined {
    const room = this.rooms.get(id);
    if (!room || room.isDestroyed()) return undefined;
    return room;
  }

  getPublicRooms(): PublicRoomInfo[] {
    const list: PublicRoomInfo[] = [];
    for (const room of this.rooms.values()) {
      if (room.isDestroyed()) continue;
      if (!room.config.isPublic) continue;
      list.push({
        id: room.roomId,
        playerCount: room.playerCount,
        maxPlayers: room.config.maxPlayers,
        mode: room.config.mode,
        pvp: room.config.pvp,
      });
    }
    list.sort((a, b) => b.playerCount - a.playerCount);
    return list;
  }

  destroyRoom(id: string): boolean {
    const room = this.rooms.get(id);
    if (!room) return false;
    room.destroy("manager_destroy");
    this.rooms.delete(id);
    return true;
  }

  /** Empty rooms idle longer than emptyTtlMs are destroyed. */
  runGarbageCollection(nowMs = this.now()): number {
    let removed = 0;
    for (const [id, room] of this.rooms) {
      if (room.isDestroyed()) {
        this.rooms.delete(id);
        removed++;
        continue;
      }
      if (room.playerCount > 0) continue;
      const emptySince = room.getEmptySinceMs();
      if (emptySince == null) continue;
      if (nowMs - emptySince >= this.emptyTtlMs) {
        this.destroyRoom(id);
        removed++;
      }
    }
    return removed;
  }

  /** Active room count (for metrics / tests). */
  size(): number {
    return this.rooms.size;
  }

  /** Stop GC timer and destroy all rooms — used on process shutdown / tests. */
  shutdown(): void {
    if (this.gcTimer != null) {
      clearInterval(this.gcTimer);
      this.gcTimer = null;
    }
    for (const id of [...this.rooms.keys()]) {
      this.destroyRoom(id);
    }
  }
}

/** Application singleton — not a module-level Map of rooms. */
let appRoomManager: RoomManager | null = null;

export function getRoomManager(): RoomManager {
  if (!appRoomManager) {
    appRoomManager = new RoomManager();
  }
  return appRoomManager;
}

/** Test helper — replaces the app singleton. */
export function setRoomManagerForTests(manager: RoomManager | null): void {
  if (appRoomManager) {
    appRoomManager.shutdown();
  }
  appRoomManager = manager;
}
