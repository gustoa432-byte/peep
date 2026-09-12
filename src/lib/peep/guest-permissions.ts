export type GuestPermissions = {
  /** Block new guests from joining / P2P. */
  locked: boolean;
  /** Friday may place/break blocks. */
  buildAllowed: boolean;
  /** Banned Telegram player ids (`tg_…`). */
  banned: string[];
};

export const DEFAULT_GUEST_PERMISSIONS: GuestPermissions = {
  locked: false,
  buildAllowed: false,
  banned: [],
};

export function parseGuestPermissions(raw: unknown): GuestPermissions {
  let obj: unknown = raw;
  if (typeof raw === "string") {
    try {
      obj = JSON.parse(raw);
    } catch {
      return { ...DEFAULT_GUEST_PERMISSIONS, banned: [] };
    }
  }
  if (!obj || typeof obj !== "object") {
    return { ...DEFAULT_GUEST_PERMISSIONS, banned: [] };
  }
  const p = obj as Record<string, unknown>;
  const banned = Array.isArray(p.banned)
    ? p.banned.map((x) => String(x)).filter((id) => /^tg_\d{1,16}$/.test(id) || /^[a-zA-Z0-9_-]{4,48}$/.test(id))
    : [];
  return {
    locked: Boolean(p.locked),
    buildAllowed: Boolean(p.buildAllowed),
    banned,
  };
}

export function stringifyGuestPermissions(p: GuestPermissions): string {
  return JSON.stringify({
    locked: Boolean(p.locked),
    buildAllowed: Boolean(p.buildAllowed),
    banned: [...new Set(p.banned)],
  });
}
