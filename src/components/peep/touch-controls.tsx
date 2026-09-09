import { useCallback, useRef, useState } from "react";
import { cn } from "@/lib/utils";

const BASE_R = 52;
const KNOB_R = 22;
const DEAD_ZONE = 8;

/** Capture is best-effort: a pointer the browser no longer tracks throws. */
function capture(el: Element, pointerId: number) {
  try {
    el.setPointerCapture(pointerId);
  } catch {
    /* the control still works without capture */
  }
}

/**
 * Full free-area look. Slow drag stays gentle; a sharp swipe (any axis) boosts
 * yaw/pitch on a superlinear curve so a flick turns the view much farther.
 */
export function LookSurface({ onLook }: { onLook: (dx: number, dy: number) => void }) {
  const active = useRef<number | null>(null);
  const last = useRef<{ x: number; y: number; t: number } | null>(null);

  const release = () => {
    active.current = null;
    last.current = null;
  };

  return (
    <div
      className="pointer-events-auto absolute inset-0 z-20 touch-none"
      onPointerDown={(e) => {
        if (active.current !== null) return;
        e.preventDefault();
        active.current = e.pointerId;
        last.current = { x: e.clientX, y: e.clientY, t: performance.now() };
        capture(e.currentTarget, e.pointerId);
      }}
      onPointerMove={(e) => {
        if (active.current !== e.pointerId || !last.current) return;
        const now = performance.now();
        const dx = e.clientX - last.current.x;
        const dy = e.clientY - last.current.y;
        const dt = Math.max(4, now - last.current.t);
        last.current = { x: e.clientX, y: e.clientY, t: now };
        const speed = Math.hypot(dx, dy) / dt;
        const extra = Math.max(0, speed - 0.35);
        const gain = Math.min(3.8, 1 + extra ** 1.65 * 0.9);
        onLook(dx * gain, dy * gain);
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
    />
  );
}

function MoveStick({ onAxis }: { onAxis: (x: number, z: number) => void }) {
  const boxRef = useRef<HTMLDivElement>(null);
  const [knob, setKnob] = useState({ x: 0, y: 0 });
  const active = useRef<number | null>(null);

  const origin = () => {
    const el = boxRef.current;
    if (!el) return { cx: 0, cy: 0 };
    const r = el.getBoundingClientRect();
    return { cx: r.left + r.width / 2, cy: r.top + r.height / 2 };
  };

  const release = useCallback(() => {
    active.current = null;
    setKnob({ x: 0, y: 0 });
    onAxis(0, 0);
  }, [onAxis]);

  const track = useCallback(
    (clientX: number, clientY: number) => {
      const { cx, cy } = origin();
      const dx = clientX - cx;
      const dy = clientY - cy;
      const dist = Math.hypot(dx, dy);
      const clamped = Math.min(dist, BASE_R);
      const ux = dist > 0 ? dx / dist : 0;
      const uy = dist > 0 ? dy / dist : 0;
      setKnob({ x: ux * clamped, y: uy * clamped });
      if (dist < DEAD_ZONE) {
        onAxis(0, 0);
        return;
      }
      const power = clamped / BASE_R;
      onAxis(ux * power, -uy * power);
    },
    [onAxis],
  );

  return (
    <div
      ref={boxRef}
      className="pointer-events-auto absolute z-40 touch-none"
      style={{
        left: "0.75rem",
        bottom: "calc(env(safe-area-inset-bottom, 0px) + 0.75rem)",
        width: BASE_R * 2 + 16,
        height: BASE_R * 2 + 16,
      }}
      onPointerDown={(e) => {
        if (active.current !== null) return;
        e.preventDefault();
        e.stopPropagation();
        active.current = e.pointerId;
        capture(e.currentTarget, e.pointerId);
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
      <span
        className="pointer-events-none absolute inset-2 rounded-full border border-white/10 bg-white/[0.1]"
        aria-hidden
      />
      <span
        className="pointer-events-none absolute rounded-full border border-white/15 bg-white/10"
        style={{
          width: KNOB_R * 2,
          height: KNOB_R * 2,
          left: "50%",
          top: "50%",
          transform: `translate(calc(-50% + ${knob.x}px), calc(-50% + ${knob.y}px))`,
        }}
        aria-hidden
      />
    </div>
  );
}

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
  onBreak,
  onPlace,
  onJump,
}: {
  onAxis: (x: number, z: number) => void;
  onBreak: () => void;
  onPlace: () => void;
  onJump: () => void;
}) {
  return (
    <div className="pointer-events-none absolute inset-0 z-40 hidden max-md:block [@media(pointer:coarse)]:block">
      <MoveStick onAxis={onAxis} />

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
