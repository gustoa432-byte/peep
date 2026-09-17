/** Light / heavy device feedback for jump & TNT (Telegram + Vibration API). */

type HapticImpact = "light" | "medium" | "heavy" | "rigid" | "soft";

type TgHaptic = {
  impactOccurred?: (style: HapticImpact) => void;
  notificationOccurred?: (type: "error" | "success" | "warning") => void;
};

function tgHaptic(): TgHaptic | null {
  if (typeof window === "undefined") return null;
  return (
    (window.Telegram?.WebApp as { HapticFeedback?: TgHaptic } | undefined)?.HapticFeedback ?? null
  );
}

function vibrate(pattern: number | number[]) {
  try {
    navigator.vibrate?.(pattern);
  } catch {
    /* unsupported / denied */
  }
}

/** Soft tick — arcade jump. */
export function hapticJump() {
  try {
    tgHaptic()?.impactOccurred?.("light");
  } catch {
    /* ignore */
  }
  vibrate(18);
}

/** Hard bomb punch — TNT detonation. */
export function hapticBoom() {
  try {
    tgHaptic()?.impactOccurred?.("heavy");
  } catch {
    /* ignore */
  }
  try {
    tgHaptic()?.notificationOccurred?.("warning");
  } catch {
    /* ignore */
  }
  vibrate([55, 35, 90, 40, 140]);
}
