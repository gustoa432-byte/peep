const WORLDS_KEY = "peep.worlds";
const SESSION_KEY = "peep.session.done";
const NUDGE_KEY = "peep.nudge.install";

export type SavedWorld = {
  id: string;
  at: number;
  role: "mine" | "visited";
  /** Optional display name. */
  name?: string;
  /** Optional vanity island slug (latin). */
  slug?: string;
};

function readList(): SavedWorld[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(WORLDS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as SavedWorld[];
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((w) => w && typeof w.id === "string" && w.id.length === 6);
  } catch {
    return [];
  }
}

function writeList(list: SavedWorld[]) {
  try {
    localStorage.setItem(WORLDS_KEY, JSON.stringify(list.slice(0, 12)));
  } catch {
    /* quota / private mode */
  }
}

export function rememberWorld(
  id: string,
  role: "mine" | "visited",
  meta?: { name?: string | null; slug?: string | null },
) {
  const list = readList();
  const prev = list.find((w) => w.id === id);
  const nextRole = prev?.role === "mine" || role === "mine" ? "mine" : "visited";
  const name =
    meta?.name !== undefined
      ? meta.name?.trim() || undefined
      : prev?.name;
  const slug =
    meta?.slug !== undefined
      ? meta.slug?.trim().toLowerCase() || undefined
      : prev?.slug;
  writeList([
    { id, at: Date.now(), role: nextRole, name, slug },
    ...list.filter((w) => w.id !== id),
  ]);
}

export function updateSavedWorldMeta(
  id: string,
  meta: { name?: string | null; slug?: string | null },
) {
  const list = readList();
  const prev = list.find((w) => w.id === id);
  if (!prev) return;
  rememberWorld(id, prev.role, {
    name: meta.name !== undefined ? meta.name : prev.name,
    slug: meta.slug !== undefined ? meta.slug : prev.slug,
  });
}

export function listSavedWorlds(): SavedWorld[] {
  return readList();
}

export function countOwnedWorlds(): number {
  return readList().filter((w) => w.role === "mine").length;
}

export function worldLabel(w: SavedWorld): string {
  if (w.name?.trim()) return w.name.trim();
  if (w.slug?.trim()) return w.slug.trim();
  return w.id;
}

export function forgetWorld(id: string) {
  writeList(readList().filter((w) => w.id !== id));
}

/** Force role (e.g. demote local "mine" ghost that server does not own). */
export function setSavedWorldRole(id: string, role: "mine" | "visited") {
  const list = readList();
  const prev = list.find((w) => w.id === id);
  if (!prev || prev.role === role) return;
  writeList([{ ...prev, role }, ...list.filter((w) => w.id !== id)]);
}

export function markSessionDone() {
  try {
    localStorage.setItem(SESSION_KEY, "1");
  } catch {
    /* ignore */
  }
}

/** Prefer staying on the home menu (e.g. user tapped Peep → home). */
export function preferHomeMenu() {
  try {
    sessionStorage.setItem("peep.stayMenu", "1");
  } catch {
    /* ignore */
  }
  try {
    localStorage.setItem("peep.stayMenu", "1");
  } catch {
    /* ignore */
  }
}

export function consumeHomeMenuPrefer(): boolean {
  try {
    const viaSession = sessionStorage.getItem("peep.stayMenu") === "1";
    const viaLocal = localStorage.getItem("peep.stayMenu") === "1";
    if (!viaSession && !viaLocal) return false;
    sessionStorage.removeItem("peep.stayMenu");
    localStorage.removeItem("peep.stayMenu");
    return true;
  } catch {
    return false;
  }
}

const INVITE_ONCE_KEY = "peep.inviteHandled";
const INVITE_DONE_PREFIX = "peep.invite.done.";

/**
 * Follow a Telegram start_param invite at most once per token (persistent).
 * Telegram never clears start_param — session-only gating re-joined the island
 * on every Mini App cold open. localStorage keeps cold opens on the menu.
 */
export function consumeInviteAutoJoin(token: string): boolean {
  if (!token) return false;
  try {
    const doneKey = `${INVITE_DONE_PREFIX}${token}`;
    if (localStorage.getItem(doneKey) === "1") return false;
    if (sessionStorage.getItem(INVITE_ONCE_KEY) === token) return false;
    localStorage.setItem(doneKey, "1");
    sessionStorage.setItem(INVITE_ONCE_KEY, token);
    return true;
  } catch {
    return true;
  }
}

export function shouldShowInstallNudge(): boolean {
  if (typeof window === "undefined") return false;
  try {
    if (localStorage.getItem(NUDGE_KEY) === "1") return false;
    const nav = navigator as Navigator & { standalone?: boolean };
    if (nav.standalone) return false;
    if (window.matchMedia("(display-mode: standalone)").matches) return false;
    if (window.matchMedia("(display-mode: fullscreen)").matches) return false;
    if (!/iphone|ipad|ipod|android/i.test(navigator.userAgent) && !window.matchMedia("(pointer: coarse)").matches) {
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

export function dismissInstallNudge() {
  try {
    localStorage.setItem(NUDGE_KEY, "1");
  } catch {
    /* ignore */
  }
}

export function installTutorialHref(): string {
  const ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
  return `/?install=1&platform=${ios ? "ios" : "android"}`;
}

const PLACE_HINT_KEY = "peep.placeHint.count";
const MINE_HINT_KEY = "peep.mineHint.count";

export function placedBlockCount(): number {
  if (typeof window === "undefined") return 0;
  try {
    const n = Number(localStorage.getItem(PLACE_HINT_KEY) ?? "0");
    return Number.isFinite(n) && n > 0 ? n : 0;
  } catch {
    return 0;
  }
}

export function recordPlacedBlock(): number {
  const next = placedBlockCount() + 1;
  try {
    localStorage.setItem(PLACE_HINT_KEY, String(next));
  } catch {
    /* quota / private mode */
  }
  return next;
}

export function minedBlockCount(): number {
  if (typeof window === "undefined") return 0;
  try {
    const n = Number(localStorage.getItem(MINE_HINT_KEY) ?? "0");
    return Number.isFinite(n) && n > 0 ? n : 0;
  } catch {
    return 0;
  }
}

export function recordMinedBlock(): number {
  const next = minedBlockCount() + 1;
  try {
    localStorage.setItem(MINE_HINT_KEY, String(next));
  } catch {
    /* quota / private mode */
  }
  return next;
}
