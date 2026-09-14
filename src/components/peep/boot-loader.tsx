import { useEffect, useRef, useState } from "react";
import { BOOT_FOOTER, BOOT_LOADER_S, BOOT_TIP_S, BOOT_TIPS } from "@/lib/peep/constants";
import { cn } from "@/lib/utils";

const FADE_MS = 480;

function nextHintIndex(last: number): number {
  if (BOOT_TIPS.length === 0) return 0;
  let randomIndex: number;
  do {
    randomIndex = Math.floor(Math.random() * BOOT_TIPS.length);
  } while (randomIndex === last && BOOT_TIPS.length > 1);
  return randomIndex;
}

/** Fake 5s boot gag — tips rotate at random (no consecutive repeat), footer never does, then fades out. */
export function BootLoader({ onDone }: { onDone: () => void }) {
  const [tipIdx, setTipIdx] = useState(() => nextHintIndex(-1));
  const [fading, setFading] = useState(false);
  const lastHintIndex = useRef(tipIdx);
  const onDoneRef = useRef(onDone);
  onDoneRef.current = onDone;

  useEffect(() => {
    const tipTimer = window.setInterval(() => {
      const next = nextHintIndex(lastHintIndex.current);
      lastHintIndex.current = next;
      setTipIdx(next);
    }, BOOT_TIP_S * 1000);
    const fadeTimer = window.setTimeout(() => setFading(true), BOOT_LOADER_S * 1000);
    const doneTimer = window.setTimeout(() => onDoneRef.current(), BOOT_LOADER_S * 1000 + FADE_MS);
    return () => {
      window.clearInterval(tipTimer);
      window.clearTimeout(fadeTimer);
      window.clearTimeout(doneTimer);
    };
  }, []);

  return (
    <div
      className={cn(
        "pointer-events-auto absolute inset-0 z-[100] flex flex-col items-center justify-center bg-black text-white transition-opacity duration-500",
        fading ? "opacity-0" : "opacity-100",
      )}
    >
      <div className="flex flex-col items-center gap-8 px-6">
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
      </div>
      <p className="absolute inset-x-4 bottom-6 text-center font-mono text-[10px] leading-snug tracking-wide text-white/45">
        {BOOT_FOOTER}
      </p>
    </div>
  );
}
