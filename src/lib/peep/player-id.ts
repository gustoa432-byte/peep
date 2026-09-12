import {
  getTelegramUserId,
  initTelegramWebApp,
  telegramPlayerId,
} from "./telegram";

const KEY = "peep.playerId";

/**
 * Identity for peep worlds.
 * Inside Telegram Mini App → `tg_<telegramUserId>` (no localStorage).
 * Outside Telegram → device id in localStorage (dev / browser).
 */
export function getPlayerId(): string {
  if (typeof window === "undefined") return "p-ssr";
  initTelegramWebApp();
  const tgId = getTelegramUserId();
  if (tgId != null) return telegramPlayerId(tgId);

  try {
    const existing = localStorage.getItem(KEY);
    if (existing && /^[a-zA-Z0-9_-]{4,48}$/.test(existing)) return existing;
    const id = `p-${Math.random().toString(36).slice(2, 10)}`;
    localStorage.setItem(KEY, id);
    return id;
  } catch {
    return `p-${Math.random().toString(36).slice(2, 10)}`;
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
