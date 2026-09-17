/**
 * Connection routing into isolated GameInstance rooms.
 *
 * Transport-agnostic: callers adapt real WebSocket / test doubles to RoomClient.
 * First message (or handshake query) MUST include roomId — unknown room → close.
 */

import type { ClientInput, GameInstance, RoomClient } from "./game-instance.ts";
import type { RoomManager } from "./room-manager.ts";

export type HandshakePayload = {
  roomId: string;
  clientId: string;
};

export type RoutedSocket = RoomClient & {
  /** Optional raw close used when handshake fails before attach. */
};

export type HandshakeResult =
  | { ok: true; room: GameInstance }
  | { ok: false; reason: "missing_room" | "room_not_found" | "room_full" | "invalid_client" };

/**
 * Bind a socket to exactly one GameInstance.
 * On failure the socket is closed immediately and not retained anywhere.
 */
export function bindSocketToRoom(
  manager: RoomManager,
  socket: RoutedSocket,
  handshake: HandshakePayload,
): HandshakeResult {
  const roomId = typeof handshake.roomId === "string" ? handshake.roomId.trim() : "";
  const clientId =
    typeof handshake.clientId === "string" ? handshake.clientId.trim() : socket.id;

  if (!roomId) {
    socket.close(4003, "missing_room");
    return { ok: false, reason: "missing_room" };
  }
  if (!clientId || clientId.length > 64) {
    socket.close(4004, "invalid_client");
    return { ok: false, reason: "invalid_client" };
  }

  const room = manager.getRoom(roomId);
  if (!room) {
    socket.close(4005, "room_not_found");
    return { ok: false, reason: "room_not_found" };
  }

  const client: RoomClient = {
    id: clientId,
    send: (message) => socket.send(message),
    close: (code, reason) => socket.close(code, reason),
  };

  if (!room.attachClient(client)) {
    return { ok: false, reason: "room_full" };
  }

  return { ok: true, room };
}

/**
 * After a successful bind, all inputs go straight into the instance —
 * no global packet handlers.
 */
export function routeClientInput(
  room: GameInstance,
  clientId: string,
  input: ClientInput,
): void {
  room.processInput(clientId, input);
}

export function unbindSocketFromRoom(room: GameInstance, clientId: string): void {
  room.detachClient(clientId);
}
