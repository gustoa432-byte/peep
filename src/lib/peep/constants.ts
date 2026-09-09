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

export const BLOCK_COUNT = 6;

export const BLOCK_NAMES = ["", "Grass", "Dirt", "Stone", "Wood", "Sand", "Leaves"] as const;

/**
 * The hotbar IS the inventory: every buildable type, always available.
 * Scarcity does not test the MVP hypothesis (TZ §3.4).
 */
export const BLOCK_PALETTE = [GRASS, DIRT, STONE, WOOD, SAND, LEAVES] as const;

export const HOTBAR_SLOTS = BLOCK_PALETTE.length;
export const MAX_PLAYERS = 2;
export const REACH = 6;
export const EYE_HEIGHT = 1.62;
export const PLAYER_RADIUS = 0.3;
export const PLAYER_HEIGHT = 1.72;
export const WALK_SPEED = 4.6;
export const JUMP_SPEED = 8.2;
export const GRAVITY = 23;
export const PRESENCE_TTL_SECONDS = 12;
/** Edits per window, stored in Postgres so a cold start cannot reset the cap. */
export const RATE_WINDOW_SECONDS = 8;
export const RATE_MAX_EDITS = 50;

export const WORLD_ID_RE = /^[a-hjkmnp-z2-9]{6}$/;

export const BLOCK_COLORS: Record<number, number> = {
  [GRASS]: 0x68a85a,
  [DIRT]: 0x8a5a38,
  [STONE]: 0x7a7670,
  [WOOD]: 0xb07a45,
  [SAND]: 0xe0c48a,
  [LEAVES]: 0x4db84a,
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
