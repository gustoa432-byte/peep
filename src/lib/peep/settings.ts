import { useEffect, useState } from "react";
import { isTelegramDesktopPlatform, isTelegramMobilePlatform } from "./telegram";

export type OrientMode = "portrait" | "landscape";

const ORIENT_KEY = "peep.orient";

export function readOrient(): OrientMode {
  if (typeof window === "undefined") return "landscape";
  try {
    return localStorage.getItem(ORIENT_KEY) === "portrait" ? "portrait" : "landscape";
  } catch {
    return "landscape";
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

/** True phone / touch-first UI — not a desktop with an optional touchscreen. */
export function usePhoneUi() {
  const [phone, setPhone] = useState(() => {
    if (typeof window === "undefined") return false;
    if (isTelegramDesktopPlatform()) return false;
    // TG iOS/Android WebViews often lie about pointer:fine — keep touch HUD.
    if (isTelegramMobilePlatform()) return true;
    const fine = window.matchMedia("(pointer: fine)").matches;
    if (fine) return false;
    return window.matchMedia("(pointer: coarse)").matches || window.matchMedia("(max-width: 767px)").matches;
  });
  useEffect(() => {
    const fine = window.matchMedia("(pointer: fine)");
    const coarse = window.matchMedia("(pointer: coarse)");
    const narrow = window.matchMedia("(max-width: 767px)");
    const sync = () => {
      // TG Desktop Mini App must stay on desktop controls (WASD + soft look).
      if (isTelegramDesktopPlatform()) {
        setPhone(false);
        return;
      }
      if (isTelegramMobilePlatform()) {
        setPhone(true);
        return;
      }
      // Mouse/trackpad → always desktop HUD, even on touchscreen laptops.
      setPhone(fine.matches ? false : coarse.matches || narrow.matches);
    };
    sync();
    // TG platform often arrives after first paint — re-check shortly.
    const t0 = window.setTimeout(sync, 0);
    const t1 = window.setTimeout(sync, 250);
    fine.addEventListener("change", sync);
    coarse.addEventListener("change", sync);
    narrow.addEventListener("change", sync);
    return () => {
      window.clearTimeout(t0);
      window.clearTimeout(t1);
      fine.removeEventListener("change", sync);
      coarse.removeEventListener("change", sync);
      narrow.removeEventListener("change", sync);
    };
  }, []);
  return phone;
}

/** Desktop mouse look (TG Desktop / fine pointer) — never mount LookSurface / sticks. */
export function useDesktopMouseUi() {
  const phone = usePhoneUi();
  const [desktop, setDesktop] = useState(() => {
    if (typeof window === "undefined") return true;
    if (isTelegramDesktopPlatform()) return true;
    if (isTelegramMobilePlatform()) return false;
    return window.matchMedia("(pointer: fine)").matches;
  });
  useEffect(() => {
    const fine = window.matchMedia("(pointer: fine)");
    const sync = () => {
      if (isTelegramDesktopPlatform()) {
        setDesktop(true);
        return;
      }
      if (isTelegramMobilePlatform()) {
        setDesktop(false);
        return;
      }
      setDesktop(fine.matches);
    };
    sync();
    const t0 = window.setTimeout(sync, 0);
    const t1 = window.setTimeout(sync, 250);
    fine.addEventListener("change", sync);
    return () => {
      window.clearTimeout(t0);
      window.clearTimeout(t1);
      fine.removeEventListener("change", sync);
    };
  }, []);
  return desktop || !phone;
}
