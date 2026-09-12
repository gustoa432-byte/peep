/**
 * WebRTC signaling over SQLite. Rendezvous only — game data is P2P.
 */
import { z } from "zod";
import { getSql, type Sql } from "@/lib/db";
import { readGuestPermissionsForWorld } from "@/lib/peep/world-perms.server";
import type { PeerRow, RtcPollResponse, SignalRow } from "./p2p";

const ID = z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/);
const signalSchema = z.object({
  op: z.literal("signal"),
  room: ID,
  from: ID,
  to: ID,
  kind: z.enum(["offer", "answer", "ice"]),
  payload: z.unknown().refine((v) => v !== undefined && JSON.stringify(v).length <= 32_768, {
    message: "payload too large",
  }),
});
const leaveSchema = z.object({ op: z.literal("leave"), room: ID, peer: ID });
const postSchema = z.discriminatedUnion("op", [signalSchema, leaveSchema]);

const PEER_TTL_SECONDS = 30;
const SIGNAL_TTL_SECONDS = 60;

function nowMs(): number {
  return Date.now();
}

async function roster(sql: Sql, room: string): Promise<PeerRow[]> {
  const cutoff = nowMs() - PEER_TTL_SECONDS * 1000;
  const rows = await sql.query<{ peer_id: string; name: string }>(
    `SELECT peer_id, name FROM webrtc_peers
     WHERE room = $1 AND last_seen > $2
     ORDER BY peer_id LIMIT 32`,
    [room, cutoff],
  );
  return rows.map((r) => ({ id: r.peer_id, name: r.name }));
}

async function touchPeer(sql: Sql, room: string, peer: string, name: string) {
  await sql.query(
    `INSERT INTO webrtc_peers (room, peer_id, name, last_seen)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (room, peer_id)
     DO UPDATE SET last_seen = excluded.last_seen, name = excluded.name`,
    [room, peer, name, nowMs()],
  );
}

async function prune(sql: Sql) {
  const peerCut = nowMs() - PEER_TTL_SECONDS * 1000;
  const sigCut = nowMs() - SIGNAL_TTL_SECONDS * 1000;
  await Promise.all([
    sql.query(`DELETE FROM webrtc_signals WHERE created_at < $1`, [sigCut]),
    sql.query(`DELETE FROM webrtc_peers WHERE last_seen < $1`, [peerCut]),
  ]);
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}

async function handleGet(url: URL): Promise<Response> {
  const parsed = z
    .object({
      room: ID,
      peer: ID,
      name: z.string().max(64).default(""),
      since: z.coerce.number().int().min(0).default(0),
    })
    .safeParse({
      room: url.searchParams.get("room"),
      peer: url.searchParams.get("peer"),
      name: url.searchParams.get("name") ?? "",
      since: url.searchParams.get("since") ?? "0",
    });
  if (!parsed.success) return json({ error: "bad_request" }, 400);

  const sql = await getSql();
  await prune(sql);

  const peersBefore = await roster(sql, parsed.data.room);
  const already = peersBefore.some((p) => p.id === parsed.data.peer);
  if (!already && peersBefore.length >= 1) {
    // world id rooms: block join when host locked the island
    try {
      const perms = await readGuestPermissionsForWorld(parsed.data.room);
      if (perms.locked) return json({ error: "locked", peers: [], signals: [] }, 403);
      if (perms.banned.includes(parsed.data.peer) || perms.banned.includes(parsed.data.name)) {
        return json({ error: "banned", peers: [], signals: [] }, 403);
      }
    } catch {
      /* room may not be a world id */
    }
  }

  await touchPeer(sql, parsed.data.room, parsed.data.peer, parsed.data.name);
  const peers = await roster(sql, parsed.data.room);
  const signals = await sql.query<{
    id: number;
    from_peer: string;
    kind: string;
    payload: string;
  }>(
    `SELECT id, from_peer, kind, payload FROM webrtc_signals
     WHERE room = $1 AND to_peer = $2 AND id > $3
     ORDER BY id ASC LIMIT 200`,
    [parsed.data.room, parsed.data.peer, parsed.data.since],
  );

  const body: RtcPollResponse = {
    peers,
    signals: signals.map(
      (s): SignalRow => ({
        id: s.id,
        from: s.from_peer,
        kind: s.kind as SignalRow["kind"],
        payload: typeof s.payload === "string" ? JSON.parse(s.payload) : s.payload,
      }),
    ),
  };
  return json(body);
}

async function handlePost(req: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return json({ error: "bad_json" }, 400);
  }
  const parsed = postSchema.safeParse(body);
  if (!parsed.success) return json({ error: "bad_request" }, 400);

  const sql = await getSql();
  if (parsed.data.op === "leave") {
    await sql.query(`DELETE FROM webrtc_peers WHERE room = $1 AND peer_id = $2`, [
      parsed.data.room,
      parsed.data.peer,
    ]);
    return json({ ok: true });
  }

  await sql.query(
    `INSERT INTO webrtc_signals (room, to_peer, from_peer, kind, payload, created_at)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [
      parsed.data.room,
      parsed.data.to,
      parsed.data.from,
      parsed.data.kind,
      JSON.stringify(parsed.data.payload),
      nowMs(),
    ],
  );
  return json({ ok: true });
}

export async function handleSignaling(request: Request): Promise<Response> {
  const url = new URL(request.url);
  if (request.method === "GET") return handleGet(url);
  if (request.method === "POST") return handlePost(request);
  return json({ error: "method" }, 405);
}
