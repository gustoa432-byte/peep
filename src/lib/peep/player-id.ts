import {
  getTelegramUserId,
  getTelegramWebApp,
  initTelegramWebApp,
  telegramPlayerId,
} from "./telegram";

const KEY = "peep.playerId";

function readStoredId(): string | null {
  try {
    const existing = localStorage.getItem(KEY);
    if (existing && /^[a-zA-Z0-9_-]{4,48}$/.test(existing)) return existing;
  } catch {
    /* ignore */
  }
  return null;
}

/**
 * Browser `p-*` left in localStorage after Telegram identity takes over.
 * Used to fold orphan worlds onto `tg_*` without a manual link dance.
 */
export function getLegacyBrowserPlayerId(): string | null {
  if (typeof window === "undefined") return null;
  const stored = readStoredId();
  return stored?.startsWith("p-") ? stored : null;
}

/**
 * Identity for peep worlds.
 * Inside Telegram Mini App → `tg_<telegramUserId>` (no localStorage).
 * Outside Telegram → device id in localStorage (dev / browser).
 * After browser↔TG link, localStorage may hold `tg_*`.
 */
export function getPlayerId(): string {
  if (typeof window === "undefined") return "p-ssr";
  initTelegramWebApp();
  const tgId = getTelegramUserId();
  if (tgId != null) return telegramPlayerId(tgId);

  // Telegram shell present but user id not ready — never mint a throwaway p-*.
  // That race owned worlds under p-* while the UI later deleted as tg_*.
  if (getTelegramWebApp() != null) {
    return readStoredId() ?? "p-tgpending";
  }

  try {
    const existing = readStoredId();
    if (existing) return existing;
    const id = `p-${Math.random().toString(36).slice(2, 10)}`;
    localStorage.setItem(KEY, id);
    return id;
  } catch {
    return `p-${Math.random().toString(36).slice(2, 10)}`;
  }
}

/** Persist linked Telegram id for browser sessions (after account link). */
export function adoptPlayerId(id: string) {
  if (typeof window === "undefined") return;
  if (!/^[a-zA-Z0-9_-]{4,48}$/.test(id)) return;
  try {
    localStorage.setItem(KEY, id);
  } catch {
    /* ignore */
  }
}

/** Telegram snapshot key (`tg_123`) or null when not in TMA. */
export function getTelegramSaveId(): string | null {
  if (typeof window === "undefined") return null;
  const tgId = getTelegramUserId();
  return tgId != null ? telegramPlayerId(tgId) : null;
}

export function parseWorldId(raw: string): string | null {
  const t = raw.trim().toLowerCase();
  const fromUrl = t.match(/world\/([a-hjkmnp-z2-9]{6})/i);
  if (fromUrl?.[1]) return fromUrl[1].toLowerCase();
  if (/^[a-hjkmnp-z2-9]{6}$/.test(t)) return t;
  return null;
}

/** System world id, vanity slug, or URL → code for resolveWorldId. */
export function parseJoinCode(raw: string): string | null {
  const t = raw.trim().toLowerCase();
  const fromUrl = t.match(/world\/([a-z0-9_-]{3,24})/i);
  if (fromUrl?.[1]) return fromUrl[1].toLowerCase();
  if (/^[a-hjkmnp-z2-9]{6}$/.test(t)) return t;
  if (/^[a-z][a-z0-9_-]{2,23}$/.test(t)) return t;
  return null;
}
