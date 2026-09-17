/**
 * Authoritative room orchestrator skeleton (UGC multiplayer).
 *
 * Review surface before wiring Peep game logic / real WebSocket transport:
 *   RoomConfig  → parseRoomConfig
 *   GameInstance → per-room state + processInput / broadcast
 *   RoomManager  → create / get / public list / destroy + empty GC
 *   ws-router    → handshake roomId → bind → route into instance
 */

export {
  defaultConfig,
  parseRoomConfig,
  type RoomConfig,
  type RoomMode,
} from "./room-config.ts";

export {
  GameInstance,
  type ClientInput,
  type GameInstanceOptions,
  type RoomClient,
} from "./game-instance.ts";

export {
  RoomManager,
  getRoomManager,
  setRoomManagerForTests,
  type PublicRoomInfo,
  type RoomManagerOptions,
} from "./room-manager.ts";

export {
  bindSocketToRoom,
  routeClientInput,
  unbindSocketFromRoom,
  type HandshakePayload,
  type HandshakeResult,
  type RoutedSocket,
} from "./ws-router.ts";

export {
  parseClientMessage,
  poseTuple,
  quantize,
  type ClientWireMessage,
  type PlayerAction,
  type PlayerPose,
  type PoseTuple,
  type ServerWireMessage,
} from "./protocol.ts";

export {
  RemoteEntity,
  applyYawPose,
  setEquippedItem,
  type RemoteEntityOptions,
} from "./remote-entity.ts";

/** Server-only attach: import from `./ws-attach.server.ts` (not the barrel). */
