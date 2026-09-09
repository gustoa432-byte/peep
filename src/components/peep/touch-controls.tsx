import { useCallback, useRef, useState } from "react";
import { cn } from "@/lib/utils";

const BASE_R = 56;
const KNOB_R = 28;
const DEAD_ZONE = 8;
const LOOK_GAIN = 1.15;

/** Capture is best-effort: a pointer the browser no longer tracks throws. */
function capture(el: Element, pointerId: number) {
  try {
    el.setPointerCapture(pointerId);
  } catch {
    /* the control still works without capture */
  }
}

type StickState = { id: number; cx: number; cy: number; kx: number; ky: number };

/**
 * Dynamic stick: the base spawns wherever the thumb lands instead of sitting at
 * a fixed spot, because on a phone the thumb never lands twice in the same
 * place and a fixed base makes the first step a miss.
 */
function MoveStick({ onAxis }: { onAxis: (x: number, z: number) => void }) {
  const [stick, setStick] = useState<StickState | null>(null);
  const active = useRef<number | null>(null);
  const origin = useRef<{ cx: number; cy: number } | null>(null);

  const release = useCallback(() => {
    active.current = null;
    origin.current = null;
    setStick(null);
    onAxis(0, 0);
  }, [onAxis]);

  const track = useCallback(
    (clientX: number, clientY: number) => {
      const base = origin.current;
      if (!base) return;
      const dx = clientX - base.cx;
      const dy = clientY - base.cy;
      const dist = Math.hypot(dx, dy);
      const clamped = Math.min(dist, BASE_R);
      const ux = dist > 0 ? dx / dist : 0;
      const uy = dist > 0 ? dy / dist : 0;
      setStick({ id: active.current ?? 0, ...base, kx: ux * clamped, ky: uy * clamped });
      if (dist < DEAD_ZONE) {
        onAxis(0, 0);
        return;
      }
      const power = clamped / BASE_R;
      // Screen y grows downward; pushing the stick up must walk forward.
      onAxis(ux * power, -uy * power);
    },
    [onAxis],
  );

  return (
    <div
      className="pointer-events-auto absolute bottom-[9.25rem] left-0 z-20 h-[40%] w-[42%] touch-none landscape:bottom-16 landscape:h-[42%]"
      onPointerDown={(e) => {
        if (active.current !== null) return;
        e.preventDefault();
        e.stopPropagation();
        active.current = e.pointerId;
        capture(e.currentTarget, e.pointerId);
        origin.current = { cx: e.clientX, cy: e.clientY };
        track(e.clientX, e.clientY);
      }}
      onPointerMove={(e) => {
        if (active.current !== e.pointerId) return;
        track(e.clientX, e.clientY);
      }}
      onPointerUp={(e) => {
        if (active.current !== e.pointerId) return;
        release();
      }}
      onPointerCancel={(e) => {
        if (active.current !== e.pointerId) return;
        release();
      }}
      aria-label="Движение"
    >
      {stick ? (
        <>
          <span
            className="pointer-events-none fixed rounded-full border border-white/25 bg-black/35"
            style={{
              width: BASE_R * 2,
              height: BASE_R * 2,
              left: stick.cx - BASE_R,
              top: stick.cy - BASE_R,
            }}
          />
          <span
            className="pointer-events-none fixed rounded-full border border-white/40 bg-white/70"
            style={{
              width: KNOB_R * 2,
              height: KNOB_R * 2,
              left: stick.cx + stick.kx - KNOB_R,
              top: stick.cy + stick.ky - KNOB_R,
            }}
          />
        </>
      ) : (
        <span className="pointer-events-none absolute bottom-6 left-6 text-[11px] tracking-wide text-white/45">
          Ходи
        </span>
      )}
    </div>
  );
}

/**
 * Right-thumb look: drag, not a velocity stick. Same signs as mouse-look.
 */
function LookPad({ onLook }: { onLook: (dx: number, dy: number) => void }) {
  const active = useRef<number | null>(null);
  const last = useRef<{ x: number; y: number } | null>(null);
  const [hint, setHint] = useState(true);

  const release = () => {
    active.current = null;
    last.current = null;
  };

  return (
    <div
      className="pointer-events-auto absolute top-[4.5rem] right-0 z-20 h-[52%] w-[46%] touch-none landscape:top-14 landscape:h-[40%]"
      onPointerDown={(e) => {
        if (active.current !== null) return;
        e.preventDefault();
        e.stopPropagation();
        active.current = e.pointerId;
        last.current = { x: e.clientX, y: e.clientY };
        setHint(false);
        capture(e.currentTarget, e.pointerId);
      }}
      onPointerMove={(e) => {
        if (active.current !== e.pointerId || !last.current) return;
        const dx = e.clientX - last.current.x;
        const dy = e.clientY - last.current.y;
        last.current = { x: e.clientX, y: e.clientY };
        onLook(dx * LOOK_GAIN, dy * LOOK_GAIN);
      }}
      onPointerUp={(e) => {
        if (active.current !== e.pointerId) return;
        release();
      }}
      onPointerCancel={(e) => {
        if (active.current !== e.pointerId) return;
        release();
      }}
      aria-label="Взгляд"
    >
      {hint ? (
        <span className="pointer-events-none absolute top-1/3 right-6 text-[11px] tracking-wide text-white/45">
          Смотри
        </span>
      ) : null}
    </div>
  );
}

/**
 * Hold-to-repeat action button. Digging one block per tap turns a trench into
 * a finger workout, so holding keeps the action firing.
 */
function ActionButton({
  label,
  onFire,
  repeatMs,
  className,
}: {
  label: string;
  onFire: () => void;
  repeatMs?: number;
  className?: string;
}) {
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const stop = () => {
    if (timer.current) {
      clearInterval(timer.current);
      timer.current = null;
    }
  };

  return (
    <button
      type="button"
      aria-label={label}
      className={cn(
        "pointer-events-auto touch-none select-none rounded-full border border-white/25",
        "bg-black/45 font-display text-[11px] font-semibold leading-none text-white",
        "active:scale-95 active:bg-black/55",
        className,
      )}
      onPointerDown={(e) => {
        e.preventDefault();
        e.stopPropagation();
        capture(e.currentTarget, e.pointerId);
        onFire();
        if (repeatMs) {
          stop();
          timer.current = setInterval(onFire, repeatMs);
        }
      }}
      onPointerUp={stop}
      onPointerCancel={stop}
    >
      {label}
    </button>
  );
}

export function TouchControls({
  onAxis,
  onLook,
  onBreak,
  onPlace,
  onJump,
}: {
  onAxis: (x: number, z: number) => void;
  onLook: (dx: number, dy: number) => void;
  onBreak: () => void;
  onPlace: () => void;
  onJump: () => void;
}) {
  return (
    <div className="pointer-events-none absolute inset-0 z-40 hidden max-md:block [@media(pointer:coarse)]:block">
      <MoveStick onAxis={onAxis} />
      <LookPad onLook={onLook} />

      <div
        className="pointer-events-none absolute right-2 z-40 flex items-end gap-2"
        style={{ bottom: "calc(env(safe-area-inset-bottom, 0px) + 0.75rem)" }}
      >
        <div className="flex flex-col items-end gap-2.5">
          <ActionButton label="Прыжок" onFire={onJump} className="size-14" />
          <div className="flex items-end gap-2.5">
            <ActionButton label="Ставить" onFire={onPlace} repeatMs={260} className="size-14" />
            <ActionButton label="Ломать" onFire={onBreak} repeatMs={220} className="size-[4.25rem]" />
          </div>
        </div>
      </div>
    </div>
  );
}
