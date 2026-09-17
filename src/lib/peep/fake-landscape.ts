/** CSS fake-landscape (rotate -90°) helpers for locked-portrait phones. */

export function isPortraitViewport(): boolean {
  if (typeof window === "undefined") return false;
  return window.matchMedia("(orientation: portrait)").matches;
}

/**
 * Remap viewport pointer deltas into game space when #game-wrapper is
 * `transform: rotate(-90deg)` (visual right ← −viewport Y, visual up ← −viewport X).
 */
export function remapLookDelta(dx: number, dy: number): { dx: number; dy: number } {
  if (!isPortraitViewport()) return { dx, dy };
  return { dx: -dy, dy: dx };
}

/** Same axis remap for joystick offsets from the stick center. */
export function remapStickOffset(dx: number, dy: number): { dx: number; dy: number } {
  return remapLookDelta(dx, dy);
}

/** Renderer size: landscape logical size even while the phone is upright. */
export function gameViewSize(fallbackParent?: HTMLElement | null): { w: number; h: number } {
  const parent = fallbackParent;
  if (isPortraitViewport()) {
    const w = Math.max(1, parent?.clientWidth || window.innerHeight);
    const h = Math.max(1, parent?.clientHeight || window.innerWidth);
    // CSS should already swap; if layout hasn't caught up, force it.
    if (w < h) return { w: Math.max(1, window.innerHeight), h: Math.max(1, window.innerWidth) };
    return { w, h };
  }
  return {
    w: Math.max(1, parent?.clientWidth || window.innerWidth),
    h: Math.max(1, parent?.clientHeight || window.innerHeight),
  };
}
