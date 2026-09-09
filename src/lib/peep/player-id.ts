const KEY = "peep.playerId";

/**
 * Device identity, deliberately in localStorage rather than sessionStorage: it
 * has to survive a closed tab so the world's creator is still the creator
 * tomorrow, and so reopening a world does not register as a second player and
 * lock the actual friend out with "World is full".
 */
export function getPlayerId(): string {
  if (typeof window === "undefined") return "p-ssr";
  try {
    const existing = localStorage.getItem(KEY);
    if (existing && /^[a-zA-Z0-9_-]{4,32}$/.test(existing)) return existing;
    const id = `p-${Math.random().toString(36).slice(2, 10)}`;
    localStorage.setItem(KEY, id);
    return id;
  } catch {
    return `p-${Math.random().toString(36).slice(2, 10)}`;
  }
}

export function parseWorldId(raw: string): string | null {
  const t = raw.trim().toLowerCase();
  const fromUrl = t.match(/world\/([a-hjkmnp-z2-9]{6})/i);
  if (fromUrl?.[1]) return fromUrl[1].toLowerCase();
  if (/^[a-hjkmnp-z2-9]{6}$/.test(t)) return t;
  return null;
}
