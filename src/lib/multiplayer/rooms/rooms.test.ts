import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  GameInstance,
  RoomManager,
  bindSocketToRoom,
  defaultConfig,
  parseRoomConfig,
  routeClientInput,
  type RoomClient,
} from "./index.ts";

function mockClient(id: string): RoomClient & { messages: unknown[]; closed?: string } {
  const state = { messages: [] as unknown[], closed: undefined as string | undefined };
  return {
    id,
    messages: state.messages,
    get closed() {
      return state.closed;
    },
    send(message: unknown) {
      state.messages.push(message);
    },
    close(_code?: number, reason?: string) {
      state.closed = reason ?? "closed";
    },
  };
}

describe("parseRoomConfig", () => {
  it("returns defaults for empty / garbage input", () => {
    assert.deepEqual(parseRoomConfig(undefined), { ...defaultConfig });
    assert.deepEqual(parseRoomConfig(null), { ...defaultConfig });
    assert.deepEqual(parseRoomConfig("hack"), { ...defaultConfig });
  });

  it("merges valid overrides and drops unknown keys", () => {
    const cfg = parseRoomConfig({
      mode: "pvp",
      pvp: true,
      maxPlayers: 8,
      isPublic: true,
      __proto__: { x: 1 },
      evil: "nope",
    });
    assert.equal(cfg.mode, "pvp");
    assert.equal(cfg.pvp, true);
    assert.equal(cfg.maxPlayers, 8);
    assert.equal(cfg.isPublic, true);
    assert.equal(cfg.timeLimit, 0);
    assert.equal("evil" in cfg, false);
  });

  it("clamps numeric fields", () => {
    assert.equal(parseRoomConfig({ maxPlayers: 999 }).maxPlayers, 64);
    assert.equal(parseRoomConfig({ maxPlayers: 0 }).maxPlayers, 1);
    assert.equal(parseRoomConfig({ timeLimit: -5 }).timeLimit, 0);
  });
});

describe("RoomManager + GameInstance", () => {
  it("creates, lists public rooms, and GCs empty rooms", () => {
    let now = 1_000;
    const mgr = new RoomManager({
      autoGc: false,
      now: () => now,
      emptyTtlMs: 3 * 60_000,
      idFactory: () => "room01",
    });

    const id = mgr.createRoom({ isPublic: true, maxPlayers: 4 });
    assert.equal(id, "room01");
    const room = mgr.getRoom(id);
    assert.ok(room);

    const pub = mgr.getPublicRooms();
    assert.equal(pub.length, 1);
    assert.equal(pub[0]?.playerCount, 0);

    now += 3 * 60_000 + 1;
    assert.equal(mgr.runGarbageCollection(), 1);
    assert.equal(mgr.getRoom(id), undefined);

    mgr.shutdown();
  });

  it("routes inputs only into the bound instance", () => {
    const mgr = new RoomManager({ autoGc: false, idFactory: () => "abcd12" });
    const id = mgr.createRoom({ pvp: false });
    const room = mgr.getRoom(id)!;
    const client = mockClient("p1");

    const bind = bindSocketToRoom(mgr, client, { roomId: id, clientId: "p1" });
    assert.equal(bind.ok, true);
    assert.equal(
      (client.messages[0] as { t: string }).t,
      "welcome",
      "attach sends welcome",
    );

    routeClientInput(room, "p1", { type: "damage", payload: {} });
    // hit is not echoed to self
    assert.equal(client.messages.length, 1);

    room.broadcast({ hello: 1 });
    assert.equal(client.messages.length, 2);

    const missing = bindSocketToRoom(mgr, mockClient("x"), {
      roomId: "nope00",
      clientId: "x",
    });
    assert.equal(missing.ok, false);

    mgr.shutdown();
  });

  it("isolates broadcast between rooms", () => {
    let n = 0;
    const mgr = new RoomManager({
      autoGc: false,
      idFactory: () => `r${n++}xxxx`.slice(0, 6),
    });
    const a = mgr.createRoom({});
    const b = mgr.createRoom({});
    const ca = mockClient("a");
    const cb = mockClient("b");
    bindSocketToRoom(mgr, ca, { roomId: a, clientId: "a" });
    bindSocketToRoom(mgr, cb, { roomId: b, clientId: "b" });

    const beforeA = ca.messages.length;
    const beforeB = cb.messages.length;
    mgr.getRoom(a)!.broadcast({ room: "a" });
    assert.equal(ca.messages.length, beforeA + 1);
    assert.equal(cb.messages.length, beforeB);

    mgr.shutdown();
  });

  it("batches dirty poses and does not echo to sender", () => {
    const mgr = new RoomManager({ autoGc: false, idFactory: () => "pose01" });
    const id = mgr.createRoom({ mode: "sandbox" });
    const room = mgr.getRoom(id)!;
    const a = mockClient("aaa");
    const b = mockClient("bbb");
    bindSocketToRoom(mgr, a, { roomId: id, clientId: "aaa" });
    bindSocketToRoom(mgr, b, { roomId: id, clientId: "bbb" });

    room.processWire("aaa", JSON.stringify({ t: "pose", x: 1.234, y: 0, z: -2, r: 0.5 }));
    room.flushStateBroadcast();

    const stateToB = b.messages.filter((m) => (m as { t?: string }).t === "state");
    assert.equal(stateToB.length, 1);
    const payload = stateToB[0] as { p: [string, number, number, number, number][] };
    assert.equal(payload.p.length, 1);
    assert.equal(payload.p[0]?.[0], "aaa");
    assert.equal(payload.p[0]?.[1], 1.23);

    const stateToA = a.messages.filter((m) => (m as { t?: string }).t === "state");
    assert.equal(stateToA.length, 0);

    room.processWire("aaa", JSON.stringify({ t: "act", a: "jump" }));
    const acts = b.messages.filter((m) => (m as { t?: string }).t === "act");
    assert.equal(acts.length, 1);

    mgr.shutdown();
  });
});

describe("GameInstance config gates", () => {
  it("exposes frozen config copy", () => {
    const g = new GameInstance({
      roomId: "zzzzzz",
      config: parseRoomConfig({ mode: "survival", maxPlayers: 2 }),
    });
    assert.equal(g.config.mode, "survival");
    assert.equal(g.config.maxPlayers, 2);
    g.destroy();
  });
});
