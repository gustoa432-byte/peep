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
/** Test neon accent block (cyan top / magenta sides). */
export const NEON = 10;
/** Dynamite — placeable charge item (hard cap + recharge), not dug from the world. */
export const DYNAMITE = 11;

export const BLOCK_COUNT = 11;

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
  "Neon",
  "Динамит",
] as const;

/** Buildable types. Counts start at zero — you place what you dig. */
export const BLOCK_PALETTE = [BARRIER, GRASS, DIRT, STONE, WOOD, SAND, LEAVES, NEON, DYNAMITE] as const;

/** Active hotbar slots (not counting the inventory button). */
export const HOTBAR_SLOTS = 5;

/** Host (Pip) starter belt — TNT first. */
export const DEFAULT_HOTBAR = [DYNAMITE, GRASS, DIRT, STONE, WOOD] as const;
/** Friday starter belt — TNT first. */
export const FRIDAY_HOTBAR = [DYNAMITE, GRASS, DIRT, STONE, WOOD] as const;

/** Max owned worlds per player account. */
export const MAX_WORLDS_PER_ACCOUNT = 3;

/** Dynamite inventory hard cap + recharge. */
export const DYNAMITE_MAX_CHARGES = 10;
/** One charge every 30s when below cap. */
export const DYNAMITE_RECHARGE_MS = 30 * 1000;
/** Fuse after place — half a second to detonation. */
export const DYNAMITE_FUSE_S = 0.5;
/** Destroyable blocks farmed per blast (nearest first). */
export const DYNAMITE_BLAST_BLOCKS = 100;
export const DYNAMITE_BLAST_RADIUS = 8;
export const DYNAMITE_SHAKE_RANGE = 10;
/** Rocket-jump / knockback scale vs baseline. */
export const DYNAMITE_KNOCKBACK_MUL = 1.5;

/** Hidden underwater laps → look up → TNT rain (troll dynamite farm). */
export const TROLL_LAPS = 3;
export const TROLL_ANGLE_RAD = TROLL_LAPS * Math.PI * 2;
/** Look-up trigger: camera aimed at sky (world +Y). */
export const TROLL_LOOK_UP_DOT = 0.42;
export const TROLL_DROP_COUNT = 3;
export const TROLL_DROP_GAP_S = 0.3;
export const TROLL_SPAWN_HEIGHT = 15;
/** Bonus charges when the underwater quest completes. */
export const TROLL_QUEST_REWARD = 6;
/** Panic timer while swimming laps underwater. */
export const TROLL_TIMER_S = 90;
/** Quiet sector feedback every quarter-lap. */
export const TROLL_SECTOR_RAD = Math.PI / 2;

/** Fake boot gag over the world canvas. */
export const BOOT_LOADER_S = 5;
export const BOOT_TIP_S = 2;
export const BOOT_TIPS = [
  "не копай под себя",
  "не выполняй квесты под водой",
  "не смотри на пятницу",
] as const;
export const BOOT_FOOTER = "зы я сделал всьо чтобы эта игра лагала не благадарите";

/** Host cinematic: Friday drops from the sky, then TNT “punishment”. */
export const FRIDAY_FALL_HEIGHT = 18;
export const FRIDAY_HOPE_S = 2;
export const FRIDAY_TNT_COUNT = 3;
export const FRIDAY_TNT_GAP_S = 0.5;
export const FRIDAY_TNT_HEIGHT = 12;
/** Optional vanity island id: latin letters, digits, _- ; 3–24 chars. */
export const ISLAND_SLUG_RE = /^[a-z][a-z0-9_-]{2,23}$/;

/** Empty for greedy meshing / AO (barrier is invisible but still solid). */
export function isMeshEmpty(block: number): boolean {
  return block === AIR || block === BARRIER;
}

/** Neighbor does not fully occlude a face (air / barrier / leafy see-through). */
export function isFaceTransparent(block: number): boolean {
  return block === AIR || block === BARRIER || block === LEAVES;
}

export const CHEST_X = 24;
export const CHEST_Y = 1;
export const CHEST_Z = 24;

/** Chunks kept meshed around the player. Island is the start, ocean goes on. */
export const VIEW_CHUNKS = 3;
/** World units from player to chunk stream edge — also fog far (hide water rim). */
export const CHUNK_RENDER_DISTANCE = VIEW_CHUNKS * CHUNK_S;
export const MESH_PER_FRAME = 2;
export const WORLD_EDIT_LIM = 4095;
/** Host + up to two Fridays. */
export const MAX_PLAYERS = 3;
/** Concurrent Friday guest claims per island. */
export const MAX_GUESTS = 2;
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
/**
 * Bunnyhop only from the 2nd consecutive takeoff.
 * First jump = hard arcade hop (no slide carry).
 */
export const BHOP_MAX_MUL = 2.2;
export const BHOP_BOUNCE_MUL = 1.12;
/** How fast air velocity turns toward wish while bhops are active. */
export const BHOP_AIR_TURN = 7.5;
/** Drag when airborne with no move keys. */
export const BHOP_AIR_DRAG = 0.9;
/** Hard ground stop when not chaining bhops (higher = snappier halt). */
export const GROUND_FRICTION = 28;
/** Soft bleed only while carrying bhop speed on a brief ground touch. */
export const BHOP_GROUND_FRICTION = 4.2;
export const BHOP_AIR_CROUCH_GRAVITY = 0.82;
export const PRESENCE_TTL_SECONDS = 12;
/** Edits per window, stored in Postgres so a cold start cannot reset the cap. */
export const RATE_WINDOW_SECONDS = 8;
/** Raised so a dynamite blast (~100 cells) can sync in one window. */
export const RATE_MAX_EDITS = 120;

/** Place: a lone tap never builds. Sharp double-tap, then hold the second tap. */
export const PLACE_TAP_MAX_MS = 260;
export const PLACE_DOUBLE_MS = 280;
export const PLACE_HOLD_CONFIRM_MS = 70;
/** One hit / one anim to place or break a block. */
export const PLACE_HOLD_S = 0.15;
export const BREAK_HOLD_S = 0.15;
/** Opening the buried chest is a long hold — not a normal dig. */
export const CHEST_CRAFT_S = 30;
/** Show chest HP/craft HUD only when the player is this close (blocks). */
export const CHEST_BAR_RANGE = 3;
/** Cooldown between place/break actions (~10 edits / sec max). */
export const EDIT_REPEAT_DELAY_MIN_S = 0.1;
export const EDIT_REPEAT_DELAY_MAX_S = 0.1;

export function nextEditDelay(): number {
  return EDIT_REPEAT_DELAY_MIN_S + Math.random() * (EDIT_REPEAT_DELAY_MAX_S - EDIT_REPEAT_DELAY_MIN_S);
}

export const WORLD_ID_RE = /^[a-hjkmnp-z2-9]{6}$/;

/** Juicy Pixar-ish palette — hotbar swatches + vertex colors. */
export const BLOCK_COLORS: Record<number, number> = {
  [GRASS]: 0x60b347,
  [DIRT]: 0x9b7653,
  [STONE]: 0x8b8f96,
  [WOOD]: 0xa05a2c,
  [SAND]: 0xf0d060,
  [LEAVES]: 0x5fd64a,
  [CHEST]: 0xc47828,
  [GOLD]: 0xffd24a,
  [NEON]: 0x00e5ff,
  [DYNAMITE]: 0xff3b2f,
};

/** Midday sky — fog matches Sky.js horizon blue. */
export const SKY_ZENITH = 0x4a90d9;
export const SKY_HORIZON = 0x87ceeb;
export const FOG_COLOR = 0x87ceeb;
export const FOG_NEAR = 50;
export const FOG_FAR = 180;
export const SUN_COLOR = 0xffffee;
export const WATER_SHALLOW = 0x3d8a9e;
export const WATER_DEEP = 0x1a4a5c;
export const WATER_FOAM = 0xd8e8ec;
export const UNDERWATER_FOG = 0x0e1a24;
export const AMBIENT_COLOR = 0x6a7080;
export const SUN_LIGHT_COLOR = 0xffffee;
/** Ortho shadow frustum half-extent around the player (world units). */
export const SHADOW_EXTENT = 40;
export const SHADOW_MAP_SIZE = 2048;
/** Warm belt lantern — fills night without bleaching nearby voxels. */
export const LANTERN_COLOR = 0xffaa44;
export const LANTERN_INTENSITY = 1.55;
export const LANTERN_DISTANCE = 9;
export const LANTERN_DECAY = 2;
