import { type ReactNode, useCallback, useRef, useState } from "react";
import { Pickaxe } from "lucide-react";
import { cn } from "@/lib/utils";

const BASE_R = 52;
const KNOB_R = 22;
const DEAD_ZONE = 8;

const TAP_MOVE = 16;
const TAP_DIST = 18;
const TAP_MS = 220;
const DOUBLE_MS = 280;
const DOUBLE_DIST = 40;

/** Capture is best-effort: a pointer the browser no longer tracks throws. */
function capture(el: Element, pointerId: number) {
  try {
    el.setPointerCapture(pointerId);
  } catch {
    /* the control still works without capture */
  }
}

function JumpIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden
    >
      <circle cx="12" cy="4.6" r="2.1" />
      <path d="M9.2 22 11 14.6 8.4 11.2h7.2L13 14.6 14.8 22" />
      <path d="M7.4 9.6c1.4-1.8 3-2.6 4.6-2.6s3.2.8 4.6 2.6" />
      <path d="M5.2 13.2 3.6 11.4" />
      <path d="M18.8 13.2 20.4 11.4" />
    </svg>
  );
}

/**
 * Full free-area look. Slow drag stays gentle; a sharp swipe (any axis) boosts
 * yaw/pitch on a superlinear curve so a flick turns the view much farther.
 * A sharp double-tap (little movement, short gap) places a block.
 */
export function LookSurface({
  onLook,
  onDoubleTap,
}: {
  onLook: (dx: number, dy: number) => void;
  onDoubleTap?: () => void;
}) {
  const active = useRef<number | null>(null);
  const last = useRef<{ x: number; y: number; t: number } | null>(null);
  const start = useRef<{ x: number; y: number; t: number } | null>(null);
  const traveled = useRef(0);
  const prevTap = useRef<{ t: number; x: number; y: number } | null>(null);

  const release = () => {
    active.current = null;
    last.current = null;
    start.current = null;
  };

  return (
    <div
      className="pointer-events-auto absolute inset-0 z-20 touch-none"
      onPointerDown={(e) => {
        if (active.current !== null) return;
        e.preventDefault();
        active.current = e.pointerId;
        const now = performance.now();
        last.current = { x: e.clientX, y: e.clientY, t: now };
        start.current = { x: e.clientX, y: e.clientY, t: now };
        traveled.current = 0;
        capture(e.currentTarget, e.pointerId);
      }}
      onPointerMove={(e) => {
        if (active.current !== e.pointerId || !last.current) return;
        const now = performance.now();
        const dx = e.clientX - last.current.x;
        const dy = e.clientY - last.current.y;
        const dt = Math.max(4, now - last.current.t);
        last.current = { x: e.clientX, y: e.clientY, t: now };
        traveled.current += Math.hypot(dx, dy);
        const speed = Math.hypot(dx, dy) / dt;
        const extra = Math.max(0, speed - 0.35);
        const gain = Math.min(3.8, 1 + extra ** 1.65 * 0.9);
        onLook(dx * gain, dy * gain);
      }}
      onPointerUp={(e) => {
        if (active.current !== e.pointerId) return;
        const from = start.current;
        const now = performance.now();
        release();
        if (!from || !onDoubleTap) return;
        const duration = now - from.t;
        const dist = Math.hypot(e.clientX - from.x, e.clientY - from.y);
        const isTap = traveled.current < TAP_MOVE && dist < TAP_DIST && duration < TAP_MS;
        if (!isTap) {
          prevTap.current = null;
          return;
        }
        const prev = prevTap.current;
        if (
          prev &&
          now - prev.t < DOUBLE_MS &&
          Math.hypot(e.clientX - prev.x, e.clientY - prev.y) < DOUBLE_DIST
        ) {
          prevTap.current = null;
          onDoubleTap();
          return;
        }
        prevTap.current = { t: now, x: e.clientX, y: e.clientY };
      }}
      onPointerCancel={(e) => {
        if (active.current !== e.pointerId) return;
        release();
        prevTap.current = null;
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
  children,
}: {
  label: string;
  onFire: () => void;
  repeatMs?: number;
  className?: string;
  children: ReactNode;
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
        "pointer-events-auto flex items-center justify-center touch-none select-none rounded-full border border-white/25",
        "bg-black/45 text-white",
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
      {children}
    </button>
  );
}

export function TouchControls({
  onAxis,
  onBreak,
  onJump,
}: {
  onAxis: (x: number, z: number) => void;
  onBreak: () => void;
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
          <ActionButton label="Ломать" onFire={onBreak} repeatMs={220} className="size-14">
            <Pickaxe className="size-6" strokeWidth={2.1} />
          </ActionButton>
          <ActionButton label="Прыжок" onFire={onJump} className="size-[4.25rem]">
            <JumpIcon className="size-8" />
          </ActionButton>
        </div>
      </div>
    </div>
  );
}

export function PlaceHint({ placed }: { placed: number }) {
  const opacity = placed >= 5 ? 0.05 : 0.4;
  return (
    <p
      className="pointer-events-none absolute z-30 hidden text-center font-display text-[10px] leading-snug text-white max-md:block [@media(pointer:coarse)]:block"
      style={{
        left: "7.25rem",
        right: "5.5rem",
        bottom: "calc(env(safe-area-inset-bottom, 0px) + 0.4rem)",
        opacity,
      }}
    >
      двойной клик по экрану  поставить блок
    </p>
  );
}
