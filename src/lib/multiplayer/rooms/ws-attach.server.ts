/**
 * Attach WebSocket upgrade handler for ephemeral live rooms.
 * Path: /ws/rooms?roomId=&clientId=
 *
 * Does not claim other upgrades (Vite HMR, etc.).
 */

import type { Server as HttpServer, IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import { WebSocketServer, type WebSocket } from "ws";
import type { RoomManager } from "./room-manager.ts";
import { bindSocketToRoom, unbindSocketFromRoom } from "./ws-router.ts";

export const LIVE_WS_PATH = "/ws/rooms";

export type AttachLiveRoomsOptions = {
  manager: RoomManager;
  /** Pathname for room sockets. Default /ws/rooms */
  path?: string;
};

/**
 * Bind `upgrade` on an existing Node HTTP server (Vite / Nitro).
 * Returns a disposer that closes the WS server (not the HTTP server).
 */
export function attachLiveRooms(
  httpServer: HttpServer,
  opts: AttachLiveRoomsOptions,
): { close: () => void } {
  const path = opts.path ?? LIVE_WS_PATH;
  const manager = opts.manager;
  const wss = new WebSocketServer({ noServer: true });

  const onUpgrade = (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    const host = req.headers.host ?? "localhost";
    let url: URL;
    try {
      url = new URL(req.url ?? "/", `http://${host}`);
    } catch {
      return;
    }
    if (url.pathname !== path) return;

    const roomId = (url.searchParams.get("roomId") ?? "").trim();
    const clientId = (url.searchParams.get("clientId") ?? "").trim() || randomClientId();

    wss.handleUpgrade(req, socket, head, (ws) => {
      wireSocket(manager, ws, roomId, clientId);
    });
  };

  httpServer.on("upgrade", onUpgrade);

  return {
    close: () => {
      httpServer.off("upgrade", onUpgrade);
      wss.close();
    },
  };
}

function wireSocket(
  manager: RoomManager,
  ws: WebSocket,
  roomId: string,
  clientId: string,
): void {
  const sendJson = (message: unknown) => {
    if (ws.readyState !== ws.OPEN) return;
    ws.send(typeof message === "string" ? message : JSON.stringify(message));
  };

  const adapter = {
    id: clientId,
    send: sendJson,
    close: (code?: number, reason?: string) => {
      try {
        ws.close(code ?? 1000, reason);
      } catch {
        /* ignore */
      }
    },
  };

  const bound = bindSocketToRoom(manager, adapter, { roomId, clientId });
  if (!bound.ok) {
    // bindSocketToRoom already closed the adapter
    return;
  }
  const room = bound.room;

  ws.on("message", (data) => {
    const text = typeof data === "string" ? data : data.toString("utf8");
    room.processWire(clientId, text);
  });

  const detach = () => {
    unbindSocketFromRoom(room, clientId);
  };
  ws.on("close", detach);
  ws.on("error", detach);
}

function randomClientId(): string {
  const bytes = new Uint8Array(6);
  crypto.getRandomValues(bytes);
  return `c_${Array.from(bytes, (b) => b.toString(36).padStart(2, "0")).join("").slice(0, 10)}`;
}
