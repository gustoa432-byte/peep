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
  /** Desktop: true only while the canvas owns Pointer Lock. */
  locked: boolean;
  worldId: string;
  isCreator: boolean;
  /** 0–1 while holding the second tap to place; 0 otherwise. */
  placeCharge: number;
  /** True after the first tap, before the hold starts or expires. */
  placeIntent: boolean;
  /** 0–1 while holding the break control; 0 otherwise. */
  breakCharge: number;
  /** Screen-space HP + craft bars over the buried chest, or null. */
  chestBar: {
    x: number;
    y: number;
    hp: number;
    craft: number;
    crafting: boolean;
  } | null;
  /** Counts for each palette slot — you place what you dug. */
  counts: readonly number[];
  fridayUnlocked: boolean;
  hatPrompt: boolean;
  chestOffer: boolean;
  hatBusy: boolean;
  /** Host island controls. */
  guestBuildAllowed: boolean;
  islandLocked: boolean;
  fridayOnline: boolean;
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

/** Guest → host: propose a block change (host is authority). */
export type NetBlockReq = {
  t: "block_req";
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

export type NetLook = {
  t: "look";
  hat: boolean;
};

export type NetKick = {
  t: "kick";
  reason?: string;
};

export type NetPerms = {
  t: "perms";
  buildAllowed: boolean;
  locked: boolean;
};

export type NetMsg =
  | NetPos
  | NetBlock
  | NetBlockReq
  | NetHello
  | NetEmote
  | NetLook
  | NetKick
  | NetPerms;

export type PresencePlayer = {
  playerId: string;
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
};

export type ApplyEditResult =
  | { ok: true; cursor: number }
  | { ok: false; error: "rate" | "not_found" | "forbidden" };

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
  error: "not_found" | "full" | "locked" | "banned";
};

export type JoinOk = {
  ok: true;
  seed: number;
  edits: BlockEdit[];
  /** World version at join. Later polls ask for edits with cursor > this. */
  cursor: number;
  generation: number;
  isCreator: boolean;
  guestPermissions: {
    locked: boolean;
    buildAllowed: boolean;
    banned: string[];
  };
};

export type JoinResult = JoinOk | JoinErr;
