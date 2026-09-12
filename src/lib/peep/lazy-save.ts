import type { WorldSavePayload } from "./world-serialize";

const SAVE_URL = "/api/world/save";
const AUTO_SAVE_MS = 5 * 60 * 1000;

export type SerializeWorldFn = () => WorldSavePayload | null;

/**
 * POST snapshot. Prefer keepalive fetch on hide; fall back to sendBeacon.
 */
export async function saveWorldToServer(
  payload: WorldSavePayload,
  opts?: { keepalive?: boolean },
): Promise<boolean> {
  const body = JSON.stringify(payload);
  const keepalive = opts?.keepalive === true;

  if (keepalive && typeof navigator !== "undefined" && typeof navigator.sendBeacon === "function") {
    try {
      const blob = new Blob([body], { type: "application/json" });
      if (navigator.sendBeacon(SAVE_URL, blob)) return true;
    } catch {
      /* fall through to fetch */
    }
  }

  try {
    const res = await fetch(SAVE_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
      keepalive,
      credentials: "same-origin",
    });
    if (!res.ok) return false;
    const json = (await res.json().catch(() => null)) as { ok?: boolean } | null;
    return json?.ok === true;
  } catch {
    return false;
  }
}

export async function loadWorldFromServer(tgUserId: string) {
  const url = `/api/world/load?tg_user_id=${encodeURIComponent(tgUserId)}`;
  const res = await fetch(url, { credentials: "same-origin", cache: "no-store" });
  if (!res.ok) throw new Error("load_failed");
  return (await res.json()) as import("./world-serialize").WorldLoadResult;
}

/**
 * Lazy-save: every 5 minutes, on manual flush, and on visibility hidden (keepalive).
 */
export function startLazySave(getPayload: SerializeWorldFn): {
  flush: (opts?: { keepalive?: boolean }) => Promise<boolean>;
  markDirty: () => void;
  stop: () => void;
} {
  let dirty = true;
  let timer: ReturnType<typeof setInterval> | null = null;
  let stopped = false;

  const flush = async (opts?: { keepalive?: boolean }) => {
    if (stopped) return false;
    const payload = getPayload();
    if (!payload) return false;
    if (!dirty && !opts?.keepalive) return true;
    const ok = await saveWorldToServer(payload, opts);
    if (ok) dirty = false;
    return ok;
  };

  const onVisibility = () => {
    if (document.visibilityState !== "hidden") return;
    void flush({ keepalive: true });
  };

  const onPageHide = () => {
    void flush({ keepalive: true });
  };

  document.addEventListener("visibilitychange", onVisibility);
  window.addEventListener("pagehide", onPageHide);
  timer = setInterval(() => {
    void flush();
  }, AUTO_SAVE_MS);

  return {
    flush,
    markDirty: () => {
      dirty = true;
    },
    stop: () => {
      stopped = true;
      if (timer) clearInterval(timer);
      timer = null;
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", onPageHide);
      void flush({ keepalive: true });
    },
  };
}
