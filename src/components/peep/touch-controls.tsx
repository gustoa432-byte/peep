import { remapLookDelta, remapStickOffset } from "@/lib/peep/fake-landscape";
import { PLACE_DOUBLE_MS, PLACE_HOLD_CONFIRM_MS, PLACE_TAP_MAX_MS } from "@/lib/peep/constants";
import { type CSSProperties, type ReactNode, useCallback, useEffect, useRef, useState } from "react";
import { IconJump, IconPick } from "@/components/peep/peep-icons";
import type { OrientMode } from "@/lib/peep/settings";
import { cn } from "@/lib/utils";

const BASE_R = 60;
const BASE_R_LAND = 48;
const KNOB_R = 25;
const KNOB_R_LAND = 21;
const DEAD_ZONE = 8;
/** Extra invisible pad around the stick rim (hitbox > visual). */
const STICK_PAD = 28;
const STICK_PAD_LAND = 24;

const LOOK_SLOP = 16;
const TAP_DIST = 48;

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
  const start = useRef<{ x: number; y: number; t: number } | null>(null);
  const looking = useRef(false);
  const holding = useRef(false);
  const comboDown = useRef(false);
  const pending = useRef<{ x: number; y: number; t: number } | null>(null);
  const confirmTimer = useRef(0);

  useEffect(
    () => () => {
      if (confirmTimer.current) window.clearTimeout(confirmTimer.current);
    },
    [],
  );

  const clearConfirm = () => {
    if (confirmTimer.current) {
      window.clearTimeout(confirmTimer.current);
      confirmTimer.current = 0;
    }
  };

  const stopHold = () => {
    clearConfirm();
    comboDown.current = false;
    if (holding.current) {
      holding.current = false;
      onHoldEnd?.();
    }
  };

  const release = () => {
    active.current = null;
    last.current = null;
    start.current = null;
    looking.current = false;
    holding.current = false;
    comboDown.current = false;
  };

  return (
    <div
      className="pointer-events-auto absolute inset-0 z-20 touch-none"
      onPointerDown={(e) => {
        if (active.current !== null) return;
        e.preventDefault();
        const now = performance.now();
        active.current = e.pointerId;
        last.current = { x: e.clientX, y: e.clientY, t: now };
        start.current = { x: e.clientX, y: e.clientY, t: now };
        looking.current = false;
        holding.current = false;
        capture(e.currentTarget, e.pointerId);

        const first = pending.current;
        pending.current = null;
        const sharp =
          first !== null &&
          now - first.t <= PLACE_DOUBLE_MS &&
          Math.hypot(e.clientX - first.x, e.clientY - first.y) <= TAP_DIST;
        comboDown.current = sharp;
        if (!sharp) return;
        clearConfirm();
        confirmTimer.current = window.setTimeout(() => {
          confirmTimer.current = 0;
          if (!comboDown.current || looking.current || active.current !== e.pointerId) return;
          holding.current = true;
          onHoldStart?.();
        }, PLACE_HOLD_CONFIRM_MS);
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
          pending.current = null;
          stopHold();
        }
        if (!looking.current) return;
        const speed = Math.hypot(dx, dy) / dt;
        const extra = Math.max(0, speed - 0.35);
        const gain = Math.min(3.8, 1 + extra ** 1.65 * 0.9);
        const remapped = remapLookDelta(dx * gain, dy * gain);
        onLook(remapped.dx, remapped.dy);
      }}
      onPointerUp={(e) => {
        if (active.current !== e.pointerId || !start.current) return;
        const wasLooking = looking.current;
        const wasHolding = holding.current;
        const wasCombo = comboDown.current;
        const downMs = performance.now() - start.current.t;
        const x = start.current.x;
        const y = start.current.y;
        clearConfirm();
        release();
        if (wasHolding) {
          onHoldEnd?.();
          return;
        }
        if (wasLooking) return;
        if (downMs > PLACE_TAP_MAX_MS) return;
        if (wasCombo) return;
        pending.current = { x, y, t: performance.now() };
      }}
      onPointerCancel={(e) => {
        if (active.current !== e.pointerId) return;
        const wasHolding = holding.current;
        clearConfirm();
        pending.current = null;
        release();
        if (wasHolding) onHoldEnd?.();
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
  const pad = compact ? STICK_PAD_LAND : STICK_PAD;

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
      let dx = clientX - cx;
      let dy = clientY - cy;
      ({ dx, dy } = remapStickOffset(dx, dy));
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
        left: compact ? "0.25rem" : "0.5rem",
        bottom: compact
          ? "calc(env(safe-area-inset-bottom, 0px) + 0.25rem)"
          : "calc(env(safe-area-inset-bottom, 0px) + 0.5rem)",
        width: radius * 2 + pad,
        height: radius * 2 + pad,
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
        className="pointer-events-none absolute rounded-pixel border-2 border-fg-on-ink/25 bg-bg-deep/20"
        style={{
          width: radius * 2,
          height: radius * 2,
          left: "50%",
          top: "50%",
          transform: "translate(-50%, -50%)",
        }}
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
  style,
  children,
}: {
  label: string;
  onFire: () => void;
  className?: string;
  style?: CSSProperties;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      style={style}
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
  style,
}: {
  charge: number;
  onHold: () => void;
  onRelease: () => void;
  className?: string;
  style?: CSSProperties;
}) {
  const c = 2 * Math.PI * 26;
  return (
    <button
      type="button"
      aria-label="Ломать"
      style={style}
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
      <span className="relative flex size-8 items-center justify-center rounded-pixel border-2 border-fg-on-ink/25 bg-bg-deep/40">
        <IconPick className="size-6" />
      </span>
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
        force ? "block" : "hidden",
      )}
    >
      <MoveStick onAxis={onAxis} compact={land} />

      {/* Jump sits in the thumb corner; pickaxe sits above/inward. */}
      <div
        className="pointer-events-none absolute z-40"
        style={{
          right: 0,
          bottom: 0,
          width: "13rem",
          height: "12rem",
        }}
      >
        <BreakSpell
          charge={breakCharge}
          onHold={onBreakHold}
          onRelease={onBreakRelease}
          className="absolute size-[65px]"
          style={{
            /* Inland from the right edge (левее) for thumb reach. */
            right: "4.75rem",
            bottom: "calc(env(safe-area-inset-bottom, 0px) + 7.4rem)",
          }}
        />
        <ActionButton
          label="Прыжок"
          onFire={onJump}
          className="absolute size-[72px]"
          style={{
            right: "6.25rem",
            bottom: "calc(env(safe-area-inset-bottom, 0px) + 1rem)",
          }}
        >
          <IconJump className="size-9" />
        </ActionButton>
      </div>
    </div>
  );
}

export function PlaceHint({
  placed,
  mined,
  force,
}: {
  placed: number;
  mined: number;
  orient: OrientMode;
  force?: boolean;
}) {
  // Phone / TG mobile only. Show after first dig until a few successful places.
  if (!force || mined < 1 || placed >= 2) return null;
  return (
    <p
      className="pointer-events-none absolute top-[42%] left-1/2 z-[90] max-w-[min(22rem,88vw)] -translate-x-1/2 -translate-y-1/2 animate-pulse border-2 border-fg-on-ink bg-bg-deep/90 px-4 py-2.5 text-center font-mono text-xs font-bold uppercase tracking-wide text-fg-on-ink shadow-[0_0_24px_rgba(255,255,255,0.35)]"
      role="status"
    >
      чтобы поставить блок — два раза тапнуть + удержание
    </p>
  );
}
