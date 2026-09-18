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

/** True phone / touch-first UI.
 * TG iOS/Android WebViews often lie about pointer:fine — platform wins there.
 * Elsewhere, a real fine pointer (Telegram Web weba/webk on desktop) stays desktop.
 */
export function usePhoneUi() {
  const [phone, setPhone] = useState(() => {
    if (typeof window === "undefined") return false;
    // Native TG mobile first — PlaceHint / sticks must show in TMA on phones.
    if (isTelegramMobilePlatform()) return true;
    if (window.matchMedia("(pointer: fine)").matches) return false;
    if (isTelegramDesktopPlatform()) return false;
    return window.matchMedia("(pointer: coarse)").matches;
  });
  useEffect(() => {
    const fine = window.matchMedia("(pointer: fine)");
    const coarse = window.matchMedia("(pointer: coarse)");
    const sync = () => {
      if (isTelegramMobilePlatform()) {
        setPhone(true);
        return;
      }
      if (fine.matches) {
        setPhone(false);
        return;
      }
      if (isTelegramDesktopPlatform()) {
        setPhone(false);
        return;
      }
      setPhone(coarse.matches);
    };
    sync();
    const t0 = window.setTimeout(sync, 0);
    const t1 = window.setTimeout(sync, 250);
    fine.addEventListener("change", sync);
    coarse.addEventListener("change", sync);
    return () => {
      window.clearTimeout(t0);
      window.clearTimeout(t1);
      fine.removeEventListener("change", sync);
      coarse.removeEventListener("change", sync);
    };
  }, []);
  return phone;
}

/** Desktop mouse look — never mount LookSurface / sticks when fine pointer is present (except TG mobile). */
export function useDesktopMouseUi() {
  const phone = usePhoneUi();
  const [desktop, setDesktop] = useState(() => {
    if (typeof window === "undefined") return true;
    if (isTelegramMobilePlatform()) return false;
    if (window.matchMedia("(pointer: fine)").matches) return true;
    if (isTelegramDesktopPlatform()) return true;
    return false;
  });
  useEffect(() => {
    const fine = window.matchMedia("(pointer: fine)");
    const sync = () => {
      if (isTelegramMobilePlatform()) {
        setDesktop(false);
        return;
      }
      if (fine.matches) {
        setDesktop(true);
        return;
      }
      if (isTelegramDesktopPlatform()) {
        setDesktop(true);
        return;
      }
      setDesktop(false);
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
