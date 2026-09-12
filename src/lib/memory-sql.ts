import type { Sql } from "./db";

type World = {
  id: string;
  seed: number;
  creator_id: string | null;
  generation: number;
  edit_cursor: number;
};
type Edit = {
  world_id: string;
  x: number;
  y: number;
  z: number;
  block: number;
  cursor: number;
  author_id: string | null;
};
type Presence = {
  world_id: string;
  player_id: string;
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
  last_seen: number;
};
type Rate = { player_id: string; window_start: number; count: number };
type Event = {
  id: number;
  at: number;
  name: string;
  world_id: string | null;
  player_id: string | null;
};
type RtcPeer = { room: string; peer_id: string; name: string; last_seen: number };
type RtcSignal = {
  id: number;
  room: string;
  to_peer: string;
  from_peer: string;
  kind: string;
  payload: unknown;
  created_at: number;
};

type TgSave = {
  tg_user_id: string;
  world_id: string | null;
  seed: number | null;
  edits: unknown;
  inventory: unknown;
  updated_at: number;
};

type Store = {
  worlds: Map<string, World>;
  edits: Edit[];
  presence: Presence[];
  rates: Map<string, Rate>;
  events: Event[];
  eventSeq: number;
  rtcPeers: RtcPeer[];
  rtcSignals: RtcSignal[];
  signalSeq: number;
  tgSaves: Map<string, TgSave>;
};

const globalRef = globalThis as typeof globalThis & { __peepMemoryStore__?: Store };

function store(): Store {
  globalRef.__peepMemoryStore__ ??= {
    worlds: new Map(),
    edits: [],
    presence: [],
    rates: new Map(),
    events: [],
    eventSeq: 1,
    rtcPeers: [],
    rtcSignals: [],
    signalSeq: 1,
    tgSaves: new Map(),
  };
  const s = globalRef.__peepMemoryStore__;
  if (!s.tgSaves) s.tgSaves = new Map();
  return s;
}

function norm(text: string): string {
  return text.replace(/\s+/g, " ").trim().toLowerCase();
}

function uniqueError(): Error {
  return Object.assign(new Error("duplicate key"), { code: "23505" });
}

function intervalMs(params: unknown[], n: string): number {
  const idx = Number(n) - 1;
  const raw = params[idx];
  const secs = typeof raw === "number" ? raw : Number(raw);
  return (Number.isFinite(secs) ? secs : 0) * 1000;
}

function p(params: unknown[], n: string): unknown {
  return params[Number(n) - 1];
}

/**
 * Process-local stand-in for Postgres on hosts that cannot run PGLite (Render
 * Free OOMs on the WASM image). Same Sql surface; data dies with the process.
 */
export function createMemorySql(): Sql {
  const run = async <T>(text: string, params: unknown[] = []): Promise<T[]> => {
    const q = norm(text);
    const db = store();
    const now = Date.now();

    if (q.startsWith("create table") || q.startsWith("create index")) return [];

    if (q.startsWith("insert into peep_worlds")) {
      const id = String(p(params, "1"));
      if (db.worlds.has(id)) throw uniqueError();
      db.worlds.set(id, {
        id,
        seed: Number(p(params, "2")),
        creator_id: (p(params, "3") as string | null) ?? null,
        generation: 0,
        edit_cursor: 0,
      });
      return [];
    }

    if (q.includes("from peep_worlds where id = $1") && q.startsWith("select seed, edit_cursor")) {
      const w = db.worlds.get(String(p(params, "1")));
      return (w
        ? [
            {
              seed: w.seed,
              edit_cursor: w.edit_cursor,
              generation: w.generation,
              creator_id: w.creator_id,
            },
          ]
        : []) as T[];
    }

    if (q === "select seed from peep_worlds where id = $1") {
      const w = db.worlds.get(String(p(params, "1")));
      return (w ? [{ seed: w.seed }] : []) as T[];
    }

    if (q === "select 1 from peep_worlds where id = $1") {
      return (db.worlds.has(String(p(params, "1"))) ? [{ "?column?": 1 }] : []) as T[];
    }

    if (q.startsWith("update peep_worlds set creator_id")) {
      const w = db.worlds.get(String(p(params, "1")));
      if (w && w.creator_id == null) w.creator_id = String(p(params, "2"));
      return [];
    }

    if (q.startsWith("update peep_worlds set edit_cursor = edit_cursor + 1")) {
      const w = db.worlds.get(String(p(params, "1")));
      if (!w) return [];
      w.edit_cursor += 1;
      return [{ edit_cursor: w.edit_cursor }] as T[];
    }

    if (q.startsWith("update peep_worlds set generation = generation + 1")) {
      const w = db.worlds.get(String(p(params, "1")));
      if (!w) return [];
      w.generation += 1;
      w.edit_cursor = 0;
      return [{ generation: w.generation }] as T[];
    }

    if (q === "delete from peep_worlds where id = $1") {
      const id = String(p(params, "1"));
      db.worlds.delete(id);
      db.edits = db.edits.filter((e) => e.world_id !== id);
      db.presence = db.presence.filter((r) => r.world_id !== id);
      db.events = db.events.filter((e) => e.world_id !== id);
      return [];
    }

    if (q.startsWith("insert into peep_edits")) {
      const world_id = String(p(params, "1"));
      const x = Number(p(params, "2"));
      const y = Number(p(params, "3"));
      const z = Number(p(params, "4"));
      const block = Number(p(params, "5"));
      const cursor = Number(p(params, "6"));
      const author_id = (p(params, "7") as string | null) ?? null;
      const i = db.edits.findIndex((e) => e.world_id === world_id && e.x === x && e.y === y && e.z === z);
      const row: Edit = { world_id, x, y, z, block, cursor, author_id };
      if (i >= 0) db.edits[i] = row;
      else db.edits.push(row);
      return [];
    }

    if (q.startsWith("select x, y, z, block from peep_edits where world_id = $1")) {
      return db.edits
        .filter((e) => e.world_id === String(p(params, "1")))
        .map((e) => ({ x: e.x, y: e.y, z: e.z, block: e.block })) as T[];
    }

    if (q.includes("from peep_edits where world_id = $1 and cursor > $2")) {
      return db.edits
        .filter((e) => e.world_id === String(p(params, "1")) && e.cursor > Number(p(params, "2")))
        .sort((a, b) => a.cursor - b.cursor)
        .map((e) => ({ x: e.x, y: e.y, z: e.z, block: e.block, cursor: e.cursor })) as T[];
    }

    if (q.includes("from peep_edits where world_id = $1") && q.includes("order by cursor")) {
      return db.edits
        .filter((e) => e.world_id === String(p(params, "1")))
        .sort((a, b) => a.cursor - b.cursor)
        .map((e) => ({ x: e.x, y: e.y, z: e.z, block: e.block, cursor: e.cursor })) as T[];
    }

    if (q === "delete from peep_edits where world_id = $1") {
      const id = String(p(params, "1"));
      db.edits = db.edits.filter((e) => e.world_id !== id);
      return [];
    }

    if (q.startsWith("delete from peep_presence where world_id = $1 and last_seen <")) {
      const id = String(p(params, "1"));
      const cutoff = now - intervalMs(params, "2");
      db.presence = db.presence.filter((r) => r.world_id !== id || r.last_seen >= cutoff);
      return [];
    }

    if (q.startsWith("select player_id from peep_presence")) {
      const id = String(p(params, "1"));
      const cutoff = now - intervalMs(params, "2");
      return db.presence
        .filter((r) => r.world_id === id && r.last_seen > cutoff)
        .map((r) => ({ player_id: r.player_id })) as T[];
    }

    if (q.startsWith("insert into peep_presence") && q.includes("yaw")) {
      const world_id = String(p(params, "1"));
      const player_id = String(p(params, "2"));
      const next: Presence = {
        world_id,
        player_id,
        x: Number(p(params, "3")),
        y: Number(p(params, "4")),
        z: Number(p(params, "5")),
        yaw: Number(p(params, "6")),
        pitch: Number(p(params, "7")),
        last_seen: now,
      };
      const i = db.presence.findIndex((r) => r.world_id === world_id && r.player_id === player_id);
      if (i >= 0) db.presence[i] = { ...db.presence[i], ...next };
      else db.presence.push(next);
      return [];
    }

    if (q.startsWith("insert into peep_presence")) {
      const world_id = String(p(params, "1"));
      const player_id = String(p(params, "2"));
      const i = db.presence.findIndex((r) => r.world_id === world_id && r.player_id === player_id);
      if (i >= 0) db.presence[i].last_seen = now;
      else {
        db.presence.push({
          world_id,
          player_id,
          x: 0,
          y: 0,
          z: 0,
          yaw: 0,
          pitch: 0,
          last_seen: now,
        });
      }
      return [];
    }

    if (q.startsWith("select count(*)")) {
      const id = String(p(params, "1"));
      const cutoff = now - intervalMs(params, "2");
      const n = db.presence.filter((r) => r.world_id === id && r.last_seen > cutoff).length;
      return [{ n }] as T[];
    }

    if (q.startsWith("select player_id, x, y, z, yaw, pitch from peep_presence")) {
      const worldId = String(p(params, "1"));
      const self = String(p(params, "2"));
      const cutoff = now - intervalMs(params, "3");
      return db.presence
        .filter(
          (r) =>
            r.world_id === worldId && r.player_id !== self && r.last_seen > cutoff && r.y > 0,
        )
        .map((r) => ({
          player_id: r.player_id,
          x: r.x,
          y: r.y,
          z: r.z,
          yaw: r.yaw,
          pitch: r.pitch,
        })) as T[];
    }

    if (q === "delete from peep_presence where world_id = $1 and player_id = $2") {
      const world_id = String(p(params, "1"));
      const player_id = String(p(params, "2"));
      db.presence = db.presence.filter((r) => !(r.world_id === world_id && r.player_id === player_id));
      return [];
    }

    if (q.startsWith("insert into peep_events")) {
      db.events.push({
        id: db.eventSeq++,
        at: now,
        name: String(p(params, "1")),
        world_id: (p(params, "2") as string | null) ?? null,
        player_id: (p(params, "3") as string | null) ?? null,
      });
      return [];
    }

    if (q.includes("from peep_events") && q.includes("name = 'open'")) {
      const world_id = String(p(params, "1"));
      const player_id = String(p(params, "2"));
      const hits = db.events
        .filter((e) => e.name === "open" && e.world_id === world_id && e.player_id === player_id)
        .sort((a, b) => b.at - a.at);
      return (hits[0] ? [{ at: new Date(hits[0].at).toISOString() }] : []) as T[];
    }

    if (q.includes("from peep_events") && q.includes("first_break")) {
      const world_id = String(p(params, "1"));
      const player_id = String(p(params, "2"));
      const hit = db.events.some(
        (e) => e.name === "first_break" && e.world_id === world_id && e.player_id === player_id,
      );
      return (hit ? [{ "?column?": 1 }] : []) as T[];
    }

    if (q.includes("from peep_events") && q.includes("name = 'pair'")) {
      const world_id = String(p(params, "1"));
      const hit = db.events.some(
        (e) => e.name === "pair" && e.world_id === world_id && now - e.at < 60 * 60 * 1000,
      );
      return (hit ? [{ "?column?": 1 }] : []) as T[];
    }

    if (q === "delete from peep_events where world_id = $1") {
      const id = String(p(params, "1"));
      db.events = db.events.filter((e) => e.world_id !== id);
      return [];
    }

    if (q.startsWith("select window_start, count from peep_rate")) {
      const row = db.rates.get(String(p(params, "1")));
      return (row
        ? [{ window_start: new Date(row.window_start).toISOString(), count: row.count }]
        : []) as T[];
    }

    if (q.startsWith("insert into peep_rate")) {
      db.rates.set(String(p(params, "1")), { player_id: String(p(params, "1")), window_start: now, count: 1 });
      return [];
    }

    if (q.startsWith("update peep_rate set window_start")) {
      db.rates.set(String(p(params, "1")), { player_id: String(p(params, "1")), window_start: now, count: 1 });
      return [];
    }

    if (q.startsWith("update peep_rate set count = count + 1")) {
      const row = db.rates.get(String(p(params, "1")));
      if (row) row.count += 1;
      return [];
    }

    if (q.startsWith("insert into webrtc_peers")) {
      const room = String(p(params, "1"));
      const peer_id = String(p(params, "2"));
      const name = String(p(params, "3") ?? "");
      const i = db.rtcPeers.findIndex((r) => r.room === room && r.peer_id === peer_id);
      if (i >= 0) {
        db.rtcPeers[i].last_seen = now;
        db.rtcPeers[i].name = name;
      } else db.rtcPeers.push({ room, peer_id, name, last_seen: now });
      return [];
    }

    if (q.startsWith("select peer_id, name from webrtc_peers")) {
      const room = String(p(params, "1"));
      const cutoff = now - intervalMs(params, "2");
      return db.rtcPeers
        .filter((r) => r.room === room && r.last_seen > cutoff)
        .sort((a, b) => a.peer_id.localeCompare(b.peer_id))
        .slice(0, 32)
        .map((r) => ({ peer_id: r.peer_id, name: r.name })) as T[];
    }

    if (q.startsWith("delete from webrtc_peers where last_seen <")) {
      const cutoff = now - intervalMs(params, "1");
      db.rtcPeers = db.rtcPeers.filter((r) => r.last_seen >= cutoff);
      return [];
    }

    if (q.startsWith("delete from webrtc_peers where room = $1")) {
      const room = String(p(params, "1"));
      const peer_id = String(p(params, "2"));
      db.rtcPeers = db.rtcPeers.filter((r) => !(r.room === room && r.peer_id === peer_id));
      return [];
    }

    if (q.startsWith("insert into webrtc_signals")) {
      let payload = p(params, "5");
      if (typeof payload === "string") {
        try {
          payload = JSON.parse(payload);
        } catch {
          /* keep string */
        }
      }
      db.rtcSignals.push({
        id: db.signalSeq++,
        room: String(p(params, "1")),
        to_peer: String(p(params, "2")),
        from_peer: String(p(params, "3")),
        kind: String(p(params, "4")),
        payload,
        created_at: now,
      });
      return [];
    }

    if (q.startsWith("select id, from_peer, kind, payload from webrtc_signals")) {
      const room = String(p(params, "1"));
      const to = String(p(params, "2"));
      const since = Number(p(params, "3"));
      return db.rtcSignals
        .filter((s) => s.room === room && s.to_peer === to && s.id > since)
        .sort((a, b) => a.id - b.id)
        .slice(0, 200)
        .map((s) => ({
          id: s.id,
          from_peer: s.from_peer,
          kind: s.kind,
          payload: s.payload,
        })) as T[];
    }

    if (q.startsWith("insert into peep_tg_saves")) {
      const tg_user_id = String(p(params, "1"));
      let edits: unknown = p(params, "4");
      let inventory: unknown = p(params, "5");
      if (typeof edits === "string") {
        try {
          edits = JSON.parse(edits);
        } catch {
          /* keep */
        }
      }
      if (typeof inventory === "string") {
        try {
          inventory = JSON.parse(inventory);
        } catch {
          /* keep */
        }
      }
      db.tgSaves.set(tg_user_id, {
        tg_user_id,
        world_id: (p(params, "2") as string | null) ?? null,
        seed: p(params, "3") == null ? null : Number(p(params, "3")),
        edits,
        inventory,
        updated_at: now,
      });
      return [];
    }

    if (q.startsWith("select world_id, seed, edits, inventory from peep_tg_saves")) {
      const row = db.tgSaves.get(String(p(params, "1")));
      return (row
        ? [
            {
              world_id: row.world_id,
              seed: row.seed,
              edits: row.edits,
              inventory: row.inventory,
            },
          ]
        : []) as T[];
    }

    if (q.startsWith("delete from webrtc_signals")) {
      const cutoff = now - intervalMs(params, "1");
      db.rtcSignals = db.rtcSignals.filter((s) => s.created_at >= cutoff);
      return [];
    }

    console.error("[memory-sql] unhandled query:", text);
    throw new Error(`memory-sql: unhandled query`);
  };

  return toSql(run);
}

function toSql(run: <T>(text: string, params: unknown[]) => Promise<T[]>): Sql {
  const sql = (async <T = Record<string, unknown>>(
    strings: TemplateStringsArray,
    ...values: unknown[]
  ): Promise<T[]> => {
    let text = strings[0];
    for (let i = 0; i < values.length; i += 1) text += `$${i + 1}${strings[i + 1]}`;
    return run<T>(text, values);
  }) as unknown as Sql;
  sql.query = <T = Record<string, unknown>>(text: string, params: unknown[] = []) =>
    run<T>(text, params);
  return sql;
}
