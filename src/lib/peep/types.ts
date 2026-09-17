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

export type EmoteKind =
  | "wave"
  | "hearts"
  | "laugh"
  | "fart"
  | "censor"
  | "death"
  | "attention"
  | "sixSeven";

export const EMOTE_DURATION = 2.6;
/** Shared cooldown after any reaction (except sixSeven). */
export const EMOTE_COOLDOWN_S = 15;

/** Reactions that never start or consume the shared emote cooldown. */
export function emoteIgnoresCooldown(kind: EmoteKind): boolean {
  return kind === "sixSeven";
}
/** Attention emote: arms flap this long. */
export const EMOTE_ATTENTION_S = 6;
/** Full raise+lower cycles during the attention emote. */
export const EMOTE_ATTENTION_FLAPS = 18;
/** Short plate / flash for censor. */
export const EMOTE_CENSOR_S = 1;
/** Fart particle lifetime. */
export const EMOTE_FART_S = 1.5;

export function emoteDuration(kind: EmoteKind): number {
  return kind === "attention" ? EMOTE_ATTENTION_S : EMOTE_DURATION;
}

export type HudState = {
  /** Block ids of the five hotbar slots, in order. */
  palette: readonly number[];
  selected: number;
  peerCount: number;
  peerConnected: boolean;
  playing: boolean;
  /** Desktop: true only while the canvas owns Pointer Lock. */
  locked: boolean;
  /** True when the browser rejected Pointer Lock (e.g. Telegram Desktop) — drag-to-look is active. */
  lockDenied: boolean;
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
  /** All placeable block ids for the global inventory sheet. */
  catalog: readonly number[];
  /** Counts for each catalog entry (same order). */
  catalogCounts: readonly number[];
  /** Unseen loot badge on the inventory button (0 = hide). */
  invBadge: number;
  /** 0…1 progress toward next dynamite recharge (0 when full). */
  dynamiteCd: number;
  /**
   * Shared reaction cooldown remaining, 0…1 (1 = just fired, 0 = ready).
   * Circular recharge ring fills as this falls to 0.
   */
  emoteCd: number;
  fridayUnlocked: boolean;
  hatPrompt: boolean;
  chestOffer: boolean;
  hatBusy: boolean;
  /** Host island controls. */
  guestBuildAllowed: boolean;
  islandLocked: boolean;
  fridayOnline: boolean;
  /** Brief HUD toast (empty inventory etc.). */
  /** 0…1 red screen flash for local censor emote. */
  censorFlash: number;
  notice: string | null;
  /** @deprecated Floor mesh replaces HUD look hint for troll quest. */
  lookHint: string | null;
  /** True while host/guest cinematic locks input and hides chrome. */
  cinematicActive: boolean;
  /** Underwater troll quest tracker (null when hidden). */
  trollTracker: {
    laps: number;
    total: number;
    secondsLeft: number;
    success: boolean;
    /** Title «ОПЛЫВИ ОСТРОВ 3 РАЗА» while swimming. */
    showTitle: boolean;
    /** Brief sector-crossing flash (0…1 remaining). */
    sectorFlash: number;
    /** Completed quarter-sectors this lap (0…3), for arrow ring. */
    sectorsDone: number;
    /** Suggested swim bearing around the island, degrees CW from +Z (forward). */
    guideDeg: number;
  } | null;
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
  /** Telegram display name for torso nametag. */
  name?: string;
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

/** Host ↔ guest Friday spawn cinematic. */
export type NetCine = {
  t: "cine";
  phase: "fall" | "landed" | "tnt" | "loot";
  x?: number;
  y?: number;
  z?: number;
  groundY?: number;
};

export type NetMsg =
  | NetPos
  | NetBlock
  | NetBlockReq
  | NetHello
  | NetEmote
  | NetLook
  | NetKick
  | NetPerms
  | NetCine;

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
  error: "not_found" | "full" | "locked" | "banned" | "occupied";
};

export type JoinOk = {
  ok: true;
  seed: number;
  edits: BlockEdit[];
  /** World version at join. Later polls ask for edits with cursor > this. */
  cursor: number;
  generation: number;
  isCreator: boolean;
  guestPermissions?: {
    locked: boolean;
    buildAllowed: boolean;
    banned: string[];
  };
};

export type JoinResult = JoinOk | JoinErr;
