export type BlockEdit = {
  x: number;
  y: number;
  z: number;
  block: number;
};

/** Incremental sync row: same cell write plus the world version it landed at. */
export type BlockDelta = BlockEdit & {
  cursor: number;
};

export type EmoteKind = "wave" | "hearts" | "laugh";

export const EMOTE_DURATION = 2.6;

export type HudState = {
  /** Block ids of the five hotbar slots, in order. */
  palette: readonly number[];
  selected: number;
  peerCount: number;
  peerConnected: boolean;
  playing: boolean;
  worldId: string;
  isCreator: boolean;
};

export type NetPos = {
  t: "pos";
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
};

export type NetBlock = {
  t: "block";
  x: number;
  y: number;
  z: number;
  block: number;
};

export type NetHello = {
  t: "hello";
};

export type NetEmote = {
  t: "emote";
  kind: EmoteKind;
};

export type NetMsg = NetPos | NetBlock | NetHello | NetEmote;

export type PresencePlayer = {
  playerId: string;
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
};

export type JoinOk = {
  ok: true;
  seed: number;
  edits: BlockEdit[];
  /** World version at join. Later polls ask for edits with cursor > this. */
  cursor: number;
  generation: number;
  isCreator: boolean;
};

export type ApplyEditResult =
  | { ok: true; cursor: number }
  | { ok: false; error: "rate" | "not_found" };

export type EditPoll = {
  generation: number;
  reset: boolean;
  edits: BlockDelta[];
};

export type MetricName =
  | "open"
  | "create"
  | "first_break"
  | "invite"
  | "invite_open"
  | "pair"
  | "return";

export type JoinErr = {
  ok: false;
  error: "not_found" | "full";
};

export type JoinResult = JoinOk | JoinErr;
