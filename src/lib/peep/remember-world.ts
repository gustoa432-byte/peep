const WORLDS_KEY = "peep.worlds";
const SESSION_KEY = "peep.session.done";
const NUDGE_KEY = "peep.nudge.install";

export type SavedWorld = {
  id: string;
  at: number;
  role: "mine" | "visited";
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
    localStorage.setItem(WORLDS_KEY, JSON.stringify(list.slice(0, 8)));
  } catch {
    /* quota / private mode */
  }
}

export function rememberWorld(id: string, role: "mine" | "visited") {
  const list = readList();
  const prev = list.find((w) => w.id === id);
  const nextRole = prev?.role === "mine" || role === "mine" ? "mine" : "visited";
  writeList([{ id, at: Date.now(), role: nextRole }, ...list.filter((w) => w.id !== id)]);
}

export function listSavedWorlds(): SavedWorld[] {
  return readList();
}

export function forgetWorld(id: string) {
  writeList(readList().filter((w) => w.id !== id));
}

export function markSessionDone() {
  try {
    localStorage.setItem(SESSION_KEY, "1");
  } catch {
    /* ignore */
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
