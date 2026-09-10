import { useEffect, useState } from "react";

export type OrientMode = "portrait" | "landscape";

const ORIENT_KEY = "peep.orient";

export function readOrient(): OrientMode {
  if (typeof window === "undefined") return "portrait";
  try {
    return localStorage.getItem(ORIENT_KEY) === "landscape" ? "landscape" : "portrait";
  } catch {
    return "portrait";
  }
}

export function writeOrient(mode: OrientMode) {
  try {
    localStorage.setItem(ORIENT_KEY, mode);
  } catch {
    /* quota / private mode */
  }
}

type LockableOrientation = ScreenOrientation & {
  lock?: (orientation: string) => Promise<void>;
  unlock?: () => void;
};

export async function lockOrient(mode: OrientMode) {
  const orientation = screen.orientation as LockableOrientation | undefined;
  if (!orientation || typeof orientation.lock !== "function") return;
  const primary = mode === "landscape" ? "landscape" : "portrait";
  const fallback = mode === "landscape" ? "landscape-primary" : "portrait-primary";
  try {
    await orientation.lock(primary);
  } catch {
    try {
      await orientation.lock(fallback);
    } catch {
      /* iOS and many browsers refuse lock without fullscreen */
    }
  }
}

export function unlockOrient() {
  const orientation = screen.orientation as LockableOrientation | undefined;
  try {
    orientation?.unlock?.();
  } catch {
    /* ignore */
  }
}

export function useMatchMedia(query: string) {
  const [hit, setHit] = useState(() => {
    if (typeof window === "undefined") return false;
    return window.matchMedia(query).matches;
  });
  useEffect(() => {
    const media = window.matchMedia(query);
    const sync = () => setHit(media.matches);
    sync();
    media.addEventListener("change", sync);
    return () => media.removeEventListener("change", sync);
  }, [query]);
  return hit;
}

/** Phone or narrow viewport — orientation lock/HUD never apply on desktop. */
export function usePhoneUi() {
  const coarse = useMatchMedia("(pointer: coarse)");
  const narrow = useMatchMedia("(max-width: 767px)");
  return coarse || narrow;
}
