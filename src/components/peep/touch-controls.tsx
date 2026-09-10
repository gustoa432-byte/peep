import { type ReactNode, useCallback, useRef, useState } from "react";
import { IconJump, IconPick } from "@/components/peep/peep-icons";
import type { OrientMode } from "@/lib/peep/settings";
import { cn } from "@/lib/utils";

const BASE_R = 52;
const BASE_R_LAND = 40;
const KNOB_R = 22;
const KNOB_R_LAND = 18;
const DEAD_ZONE = 8;

const LOOK_SLOP = 16;

function capture(el: Element, pointerId: number) {
  try {
    el.setPointerCapture(pointerId);
  } catch {
    /* the control still works without capture */
  }
}

export function LookSurface({
  onLook,
  onHoldStart,
  onHoldEnd,
}: {
  onLook: (dx: number, dy: number) => void;
  onHoldStart?: () => void;
  onHoldEnd?: () => void;
}) {
  const active = useRef<number | null>(null);
  const last = useRef<{ x: number; y: number; t: number } | null>(null);
  const start = useRef<{ x: number; y: number } | null>(null);
  const looking = useRef(false);

  const release = () => {
    active.current = null;
    last.current = null;
    start.current = null;
    looking.current = false;
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
        start.current = { x: e.clientX, y: e.clientY };
        looking.current = false;
        capture(e.currentTarget, e.pointerId);
        onHoldStart?.();
      }}
      onPointerMove={(e) => {
        if (active.current !== e.pointerId || !last.current || !start.current) return;
        const now = performance.now();
        const dx = e.clientX - last.current.x;
        const dy = e.clientY - last.current.y;
        const dt = Math.max(4, now - last.current.t);
        last.current = { x: e.clientX, y: e.clientY, t: now };
        const fromStart = Math.hypot(e.clientX - start.current.x, e.clientY - start.current.y);
        if (!looking.current && fromStart > LOOK_SLOP) {
          looking.current = true;
          onHoldEnd?.();
        }
        if (!looking.current) return;
        const speed = Math.hypot(dx, dy) / dt;
        const extra = Math.max(0, speed - 0.35);
        const gain = Math.min(3.8, 1 + extra ** 1.65 * 0.9);
        onLook(dx * gain, dy * gain);
      }}
      onPointerUp={(e) => {
        if (active.current !== e.pointerId) return;
        const wasLooking = looking.current;
        release();
        if (!wasLooking) onHoldEnd?.();
      }}
      onPointerCancel={(e) => {
        if (active.current !== e.pointerId) return;
        release();
        onHoldEnd?.();
      }}
      aria-label="Взгляд"
    />
  );
}

function MoveStick({
  onAxis,
  compact,
}: {
  onAxis: (x: number, z: number) => void;
  compact: boolean;
}) {
  const boxRef = useRef<HTMLDivElement>(null);
  const [knob, setKnob] = useState({ x: 0, y: 0 });
  const active = useRef<number | null>(null);
  const radius = compact ? BASE_R_LAND : BASE_R;
  const knobR = compact ? KNOB_R_LAND : KNOB_R;

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
      const clamped = Math.min(dist, radius);
      const ux = dist > 0 ? dx / dist : 0;
      const uy = dist > 0 ? dy / dist : 0;
      setKnob({ x: ux * clamped, y: uy * clamped });
      if (dist < DEAD_ZONE) {
        onAxis(0, 0);
        return;
      }
      const power = clamped / radius;
      onAxis(ux * power, -uy * power);
    },
    [onAxis, radius],
  );

  return (
    <div
      ref={boxRef}
      className="pointer-events-auto absolute z-40 touch-none"
      style={{
        left: compact ? "0.4rem" : "0.75rem",
        bottom: compact
          ? "calc(env(safe-area-inset-bottom, 0px) + 0.4rem)"
          : "calc(env(safe-area-inset-bottom, 0px) + 0.75rem)",
        width: radius * 2 + 16,
        height: radius * 2 + 16,
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
        className="pointer-events-none absolute inset-2 rounded-pixel border-2 border-fg-on-ink/25 bg-bg-deep/20"
        aria-hidden
      />
      <span
        className="pointer-events-none absolute rounded-pixel border-2 border-fg-on-ink/40 bg-fg-on-ink/15"
        style={{
          width: knobR * 2,
          height: knobR * 2,
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
  className,
  children,
}: {
  label: string;
  onFire: () => void;
  className?: string;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      className={cn(
        "pointer-events-auto flex items-center justify-center touch-none select-none rounded-pixel",
        "border-2 border-fg-on-ink/35 bg-bg-deep/55 text-fg-on-ink",
        "active:scale-95 active:bg-bg-deep/70",
        className,
      )}
      onPointerDown={(e) => {
        e.preventDefault();
        e.stopPropagation();
        capture(e.currentTarget, e.pointerId);
        onFire();
      }}
    >
      {children}
    </button>
  );
}

function BreakSpell({
  charge,
  onHold,
  onRelease,
  className,
}: {
  charge: number;
  onHold: () => void;
  onRelease: () => void;
  className?: string;
}) {
  const c = 2 * Math.PI * 26;
  return (
    <button
      type="button"
      aria-label="Ломать"
      className={cn(
        "pointer-events-auto relative flex items-center justify-center touch-none select-none rounded-pixel",
        "border-2 border-fg-on-ink/35 bg-bg-deep/55 text-fg-on-ink",
        "active:bg-bg-deep/70",
        className,
      )}
      onPointerDown={(e) => {
        e.preventDefault();
        e.stopPropagation();
        capture(e.currentTarget, e.pointerId);
        onHold();
      }}
      onPointerUp={onRelease}
      onPointerCancel={onRelease}
    >
      <svg viewBox="0 0 56 56" className="pointer-events-none absolute inset-0 size-full -rotate-90" aria-hidden>
        <circle cx="28" cy="28" r="26" fill="none" className="stroke-fg-on-ink/20" strokeWidth="3" />
        <circle
          cx="28"
          cy="28"
          r="26"
          fill="none"
          className="stroke-primary"
          strokeWidth="3"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - charge)}
        />
      </svg>
      <IconPick className="relative size-6" />
    </button>
  );
}

export function TouchControls({
  onAxis,
  onBreakHold,
  onBreakRelease,
  breakCharge,
  onJump,
  orient,
  force,
}: {
  onAxis: (x: number, z: number) => void;
  onBreakHold: () => void;
  onBreakRelease: () => void;
  breakCharge: number;
  onJump: () => void;
  orient: OrientMode;
  force?: boolean;
}) {
  const land = orient === "landscape";
  return (
    <div
      className={cn(
        "pointer-events-none absolute inset-0 z-40",
        force ? "block" : "hidden max-md:block [@media(pointer:coarse)]:block",
      )}
    >
      <MoveStick onAxis={onAxis} compact={land} />

      <div
        className={cn("pointer-events-none absolute z-40 flex", land ? "flex-row items-end gap-2" : "flex-col items-end gap-2")}
        style={{
          right: land ? "0.4rem" : "0.5rem",
          bottom: land
            ? "calc(env(safe-area-inset-bottom, 0px) + 0.4rem)"
            : "calc(env(safe-area-inset-bottom, 0px) + 0.75rem)",
        }}
      >
        <BreakSpell
          charge={breakCharge}
          onHold={onBreakHold}
          onRelease={onBreakRelease}
          className={land ? "size-14" : "size-14"}
        />
        <ActionButton label="Прыжок" onFire={onJump} className={land ? "size-16" : "size-[4.25rem]"}>
          <IconJump className={land ? "size-7" : "size-8"} />
        </ActionButton>
      </div>
    </div>
  );
}

export function PlaceHint({
  placed,
  orient,
  force,
}: {
  placed: number;
  orient: OrientMode;
  force?: boolean;
}) {
  const opacity = placed >= 5 ? 0.05 : 0.4;
  const land = orient === "landscape";
  return (
    <p
      className={cn(
        "pointer-events-none absolute z-30 text-center font-mono text-xs uppercase tracking-wide text-fg-on-ink",
        force ? "block" : "hidden max-md:block [@media(pointer:coarse)]:block",
      )}
      style={{
        left: land ? "7rem" : "7.25rem",
        right: land ? "8rem" : "5.5rem",
        bottom: land
          ? "calc(env(safe-area-inset-bottom, 0px) + 3.6rem)"
          : "calc(env(safe-area-inset-bottom, 0px) + 0.4rem)",
        opacity,
      }}
    >
      зажми экран  поставить блок
    </p>
  );
}
