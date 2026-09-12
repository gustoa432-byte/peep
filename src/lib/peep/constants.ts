export const WORLD_SX = 48;
export const WORLD_SY = 24;
export const WORLD_SZ = 48;
export const CHUNK_S = 16;

/** Water surface Y. Land with top > this is dry; the beach slips under it. */
export const WATER_LEVEL = 6;

/** Radial island: 1 inside CORE, 0 past SHORE (normalized to half-extent). */
export const ISLAND_CORE = 0.46;
export const ISLAND_SHORE = 0.84;

export const AIR = 0;
export const GRASS = 1;
export const DIRT = 2;
export const STONE = 3;
export const WOOD = 4;
export const SAND = 5;
export const LEAVES = 6;
export const CHEST = 7;
export const GOLD = 8;
/** Invisible solid — no mesh faces, placeable; physics treats it as solid. */
export const BARRIER = 9;

export const BLOCK_COUNT = 9;

export const BLOCK_NAMES = [
  "",
  "Grass",
  "Dirt",
  "Stone",
  "Wood",
  "Sand",
  "Leaves",
  "Chest",
  "Gold",
  "Пусто",
] as const;

/** Buildable types. Counts start at zero — you place what you dig. */
export const BLOCK_PALETTE = [BARRIER, GRASS, DIRT, STONE, WOOD, SAND, LEAVES] as const;

export const HOTBAR_SLOTS = BLOCK_PALETTE.length + 1;

/** Empty for greedy meshing / AO (barrier is invisible but still solid). */
export function isMeshEmpty(block: number): boolean {
  return block === AIR || block === BARRIER;
}

export const CHEST_X = 24;
export const CHEST_Y = 1;
export const CHEST_Z = 24;

/** Chunks kept meshed around the player. Island is the start, ocean goes on. */
export const VIEW_CHUNKS = 3;
export const MESH_PER_FRAME = 2;
export const WORLD_EDIT_LIM = 4095;
export const MAX_PLAYERS = 2;
export const REACH = 6;
export const EYE_HEIGHT = 1.62;
export const CROUCH_EYE_HEIGHT = 1.15;
export const PLAYER_RADIUS = 0.3;
export const PLAYER_HEIGHT = 1.72;
export const CROUCH_HEIGHT = 1.15;
export const WALK_SPEED = 4.6;
export const CROUCH_SPEED_MUL = 0.42;
export const JUMP_SPEED = 8.2;
export const GRAVITY = 23;
/** Arcade bhop: soft air steer, bounce mul, ice-like ground slide. */
export const BHOP_MAX_MUL = 2.2;
export const BHOP_BOUNCE_MUL = 1.1;
/** How fast air velocity turns toward wish (higher = snappier). */
export const BHOP_AIR_TURN = 7.5;
/** Drag when airborne with no move keys. */
export const BHOP_AIR_DRAG = 0.9;
/** Ground slide friction when not chaining jumps. */
export const GROUND_FRICTION = 5.5;
/** How quickly walk wish catches the ground velocity. */
export const GROUND_ACCEL = 14;
export const BHOP_AIR_CROUCH_GRAVITY = 0.82;
export const PRESENCE_TTL_SECONDS = 12;
/** Edits per window, stored in Postgres so a cold start cannot reset the cap. */
export const RATE_WINDOW_SECONDS = 8;
export const RATE_MAX_EDITS = 50;

/** Place: a lone tap never builds. Sharp double-tap, then hold the second tap. */
export const PLACE_TAP_MAX_MS = 260;
export const PLACE_DOUBLE_MS = 280;
export const PLACE_HOLD_CONFIRM_MS = 70;
export const PLACE_HOLD_S = 0.45;
export const BREAK_HOLD_S = 0.3;
/** After a place/break, wait a random beat before the next one can start. */
export const EDIT_REPEAT_DELAY_MIN_S = 0.2;
export const EDIT_REPEAT_DELAY_MAX_S = 0.3;

export function nextEditDelay(): number {
  return EDIT_REPEAT_DELAY_MIN_S + Math.random() * (EDIT_REPEAT_DELAY_MAX_S - EDIT_REPEAT_DELAY_MIN_S);
}

export const WORLD_ID_RE = /^[a-hjkmnp-z2-9]{6}$/;

export const BLOCK_COLORS: Record<number, number> = {
  [GRASS]: 0x68a85a,
  [DIRT]: 0x8a5a38,
  [STONE]: 0x7a7670,
  [WOOD]: 0xb07a45,
  [SAND]: 0xe0c48a,
  [LEAVES]: 0x4db84a,
  [CHEST]: 0x8a5a24,
  [GOLD]: 0xe2b84a,
};

export const SKY_ZENITH = 0x8eb8d4;
export const SKY_HORIZON = 0xf3d7b0;
export const FOG_COLOR = 0xe8d0b0;
export const FOG_NEAR = 28;
export const FOG_FAR = 104;
export const SUN_COLOR = 0xffd6a0;
export const WATER_SHALLOW = 0x6ebfb4;
export const WATER_DEEP = 0x1b5368;
export const WATER_FOAM = 0xe8f2ee;
export const UNDERWATER_FOG = 0x163e4c;
