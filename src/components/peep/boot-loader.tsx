import { useEffect, useRef, useState } from "react";
import { BOOT_FOOTER, BOOT_TIP_S, BOOT_TIPS } from "@/lib/peep/constants";
import { cn } from "@/lib/utils";

const FADE_MS = 420;
const MIN_SHOW_MS = 500;
/** Safety: never leave the player stuck if progress stalls. */
const MAX_BOOT_MS = 14_000;

function nextHintIndex(last: number): number {
  if (BOOT_TIPS.length === 0) return 0;
  let randomIndex: number;
  do {
    randomIndex = Math.floor(Math.random() * BOOT_TIPS.length);
  } while (randomIndex === last && BOOT_TIPS.length > 1);
  return randomIndex;
}

/**
 * Boot overlay with tip rotation + progress bar.
 * Completes when `progress` reaches 1 (real mesh/join work), with a short min display.
 */
export function BootLoader({
  progress = 0,
  onDone,
  autoFinish = true,
}: {
  /** 0…1 real load progress from join / terrain mesh. */
  progress?: number;
  onDone: () => void;
  /** When false, stays up until unmounted (join splash). */
  autoFinish?: boolean;
}) {
  const [tipIdx, setTipIdx] = useState(() => nextHintIndex(-1));
  const [fading, setFading] = useState(false);
  const [shown, setShown] = useState(0);
  const lastHintIndex = useRef(tipIdx);
  const onDoneRef = useRef(onDone);
  onDoneRef.current = onDone;
  const startedAt = useRef(performance.now());
  const finished = useRef(false);
  const doneTimer = useRef<number | null>(null);

  // Smooth display so the bar doesn't jump; never go backwards.
  useEffect(() => {
    const target = Math.max(0, Math.min(1, progress));
    let frame = 0;
    const tick = () => {
      setShown((prev) => {
        if (target <= prev) return prev;
        const next = prev + Math.max(0.012, (target - prev) * 0.22);
        return next >= target - 0.002 ? target : next;
      });
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [progress]);

  useEffect(() => {
    const tipTimer = window.setInterval(() => {
      const next = nextHintIndex(lastHintIndex.current);
      lastHintIndex.current = next;
      setTipIdx(next);
    }, BOOT_TIP_S * 1000);
    return () => window.clearInterval(tipTimer);
  }, []);

  // Single finish path: never cancel onDone when `shown` ticks — that left an
  // invisible pointer-events overlay forever (no HUD / no enter / no controls).
  useEffect(() => {
    if (!autoFinish) return;

    const finish = () => {
      if (finished.current) return;
      finished.current = true;
      setShown(1);
      setFading(true);
      doneTimer.current = window.setTimeout(() => onDoneRef.current(), FADE_MS);
    };

    const check = () => {
      if (finished.current) return;
      const elapsed = performance.now() - startedAt.current;
      if (elapsed >= MAX_BOOT_MS || (progress >= 0.999 && elapsed >= MIN_SHOW_MS)) {
        finish();
      }
    };

    check();
    const id = window.setInterval(check, 120);
    return () => {
      window.clearInterval(id);
      // Only clear pending onDone on unmount / autoFinish flip — not on progress ticks.
    };
  }, [progress, autoFinish]);

  useEffect(() => {
    return () => {
      if (doneTimer.current != null) window.clearTimeout(doneTimer.current);
    };
  }, []);

  const pct = Math.round(shown * 100);

  return (
    <div
      className={cn(
        "pointer-events-auto absolute inset-0 z-[100] flex flex-col items-center justify-center bg-black text-white transition-opacity duration-500",
        fading ? "opacity-0" : "opacity-100",
      )}
      role="status"
      aria-live="polite"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={pct}
    >
      <div className="flex w-full max-w-sm flex-col items-center gap-7 px-6">
        <div
          className="size-10 animate-spin rounded-full border-2 border-white/25 border-t-white"
          aria-hidden
        />
        <p
          key={tipIdx}
          className="max-w-sm text-center font-mono text-sm font-medium uppercase tracking-wide text-white/90"
        >
          {BOOT_TIPS[tipIdx]}
        </p>
        <div className="w-full">
          <div className="h-2 w-full overflow-hidden rounded-pixel border border-white/30 bg-white/10">
            <div
              className="h-full bg-white transition-[width] duration-150 ease-out"
              style={{ width: `${pct}%` }}
            />
          </div>
          <p className="mt-2 text-center font-mono text-[11px] tabular-nums tracking-widest text-white/70">
            {pct}%
          </p>
        </div>
      </div>
      <p className="absolute inset-x-4 bottom-6 text-center font-mono text-[10px] leading-snug tracking-wide text-white/45">
        {BOOT_FOOTER}
      </p>
    </div>
  );
}
