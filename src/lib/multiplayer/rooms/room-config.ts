/**
 * Room configuration — pure data + validation.
 * No I/O, no globals. Safe to unit-test in isolation.
 */

export type RoomMode = "sandbox" | "survival" | "pvp";

export type RoomConfig = {
  mode: RoomMode;
  /** Seconds. 0 = no hard limit; room lives while players are present. */
  timeLimit: number;
  pvp: boolean;
  maxPlayers: number;
  isPublic: boolean;
};

export const defaultConfig: Readonly<RoomConfig> = Object.freeze({
  mode: "sandbox",
  timeLimit: 0,
  pvp: false,
  maxPlayers: 20,
  isPublic: false,
});

const MODES = new Set<RoomMode>(["sandbox", "survival", "pvp"]);

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * Deep-merge user overrides onto defaults and hard-validate types.
 * Unknown keys are dropped (injection / typo resistance).
 */
export function parseRoomConfig(userConfig: unknown): RoomConfig {
  const src = isPlainObject(userConfig) ? userConfig : {};

  const modeRaw = src.mode;
  const mode: RoomMode =
    typeof modeRaw === "string" && MODES.has(modeRaw as RoomMode)
      ? (modeRaw as RoomMode)
      : defaultConfig.mode;

  const timeLimit = clampInt(src.timeLimit, defaultConfig.timeLimit, 0, 86_400);
  const maxPlayers = clampInt(src.maxPlayers, defaultConfig.maxPlayers, 1, 64);
  const pvp = typeof src.pvp === "boolean" ? src.pvp : defaultConfig.pvp;
  const isPublic =
    typeof src.isPublic === "boolean" ? src.isPublic : defaultConfig.isPublic;

  return { mode, timeLimit, pvp, maxPlayers, isPublic };
}

function clampInt(
  raw: unknown,
  fallback: number,
  min: number,
  max: number,
): number {
  if (typeof raw !== "number" || !Number.isFinite(raw)) return fallback;
  const n = Math.trunc(raw);
  if (n < min) return min;
  if (n > max) return max;
  return n;
}
