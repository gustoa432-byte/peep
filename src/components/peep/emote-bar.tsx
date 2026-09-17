import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { IconHeart, IconLaugh, IconWave } from "@/components/peep/peep-icons";
import { emoteIgnoresCooldown, type EmoteKind } from "@/lib/peep/types";
import { cn } from "@/lib/utils";

const EMOTES: { kind: EmoteKind; label: string; Icon?: typeof IconWave; emoji?: string }[] = [
  { kind: "wave", label: "Помахать", Icon: IconWave, emoji: "🖐️" },
  { kind: "hearts", label: "Сердца", Icon: IconHeart, emoji: "❤️" },
  { kind: "laugh", label: "Смех", Icon: IconLaugh, emoji: "😂" },
  { kind: "fart", label: "Говняшка", emoji: "💩" },
  { kind: "censor", label: "Гнев", emoji: "😡" },
  { kind: "death", label: "Смерть", emoji: "💀" },
  { kind: "attention", label: "Внимание", emoji: "⚠️" },
  { kind: "sixSeven", label: "67", emoji: "67" },
];

/** Per-icon recharge ring: `cd` remaining 0…1 (1 = just used). Fill grows as cd → 0. */
function EmoteCooldownRing({ cd, size = 36 }: { cd: number; size?: number }) {
  if (cd <= 0.001) return null;
  const stroke = 2.5;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const filled = 1 - cd;
  return (
    <svg
      width={size}
      height={size}
      className="pointer-events-none absolute inset-0 m-auto -rotate-90"
      aria-hidden
    >
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        stroke="currentColor"
        strokeWidth={stroke}
        className="text-fg-on-ink/25"
      />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        stroke="currentColor"
        strokeWidth={stroke}
        strokeLinecap="butt"
        strokeDasharray={c}
        strokeDashoffset={c * (1 - filled)}
        className="text-fg-on-ink"
      />
    </svg>
  );
}

export function EmoteBar({
  onEmote,
  layout,
  emoteCd = 0,
}: {
  onEmote: (kind: EmoteKind) => void;
  layout: "column" | "row";
  /** Remaining cooldown 0…1 (blocks presses while > 0). */
  emoteCd?: number;
}) {
  const cooling = emoteCd > 0.001;
  return (
    <div
      className={cn(
        "pointer-events-auto relative flex gap-1",
        layout === "column" ? "flex-col items-center" : "flex-row items-center",
      )}
    >
      {EMOTES.map(({ kind, label, Icon, emoji }) => {
        const free = emoteIgnoresCooldown(kind);
        const blocked = cooling && !free;
        return (
          <button
            key={kind}
            type="button"
            aria-label={label}
            disabled={blocked}
            onPointerDown={(e) => {
              e.preventDefault();
              if (blocked) return;
              onEmote(kind);
            }}
            className={cn(
              "relative flex size-10 items-center justify-center rounded-pixel sm:size-11",
              "border-2 border-fg-on-ink/30 bg-bg-deep/55 text-fg-on-ink",
              blocked ? "opacity-45" : "active:scale-95 active:bg-bg-deep/70",
              free && "font-mono text-[11px] font-black tracking-tight",
            )}
          >
            {!free ? <EmoteCooldownRing cd={emoteCd} size={34} /> : null}
            {Icon ? <Icon className="relative z-[1] size-5" /> : (
              <span className="relative z-[1] text-base leading-none">{emoji}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}

/** Mobile accordion — :) opens a horizontal tray under the top nav. */
export function ReactionMenu({
  onEmote,
  emoteCd = 0,
}: {
  onEmote: (kind: EmoteKind) => void;
  emoteCd?: number;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const trayRef = useRef<HTMLDivElement>(null);
  const cooling = emoteCd > 0.001;

  useEffect(() => {
    if (!open) return;
    const onPtr = (e: PointerEvent) => {
      const t = e.target;
      if (!(t instanceof Node)) return;
      if (rootRef.current?.contains(t) || trayRef.current?.contains(t)) return;
      setOpen(false);
    };
    window.addEventListener("pointerdown", onPtr, true);
    return () => window.removeEventListener("pointerdown", onPtr, true);
  }, [open]);

  const tray =
    open && typeof document !== "undefined" ? (
      <div
        id="reaction-tray"
        ref={trayRef}
        className="pointer-events-auto absolute left-1/2 z-[120] flex -translate-x-1/2 flex-row flex-wrap items-center justify-center gap-1 border-2 border-fg-on-ink/25 bg-bg-deep/85 p-1"
        style={{
          top: "calc(max(0.45rem, env(safe-area-inset-top, 0px)) + 3.15rem)",
        }}
        role="menu"
        aria-label="Реакции"
      >
        {EMOTES.map(({ kind, label, emoji }) => {
          const free = emoteIgnoresCooldown(kind);
          const blocked = cooling && !free;
          return (
            <button
              key={kind}
              type="button"
              role="menuitem"
              aria-label={label}
              disabled={blocked}
              className={cn(
                "relative flex size-11 items-center justify-center border-2 border-fg-on-ink/30 bg-bg-deep/70 text-xl leading-none text-fg-on-ink",
                blocked ? "opacity-45" : "active:scale-95",
                free && "font-mono text-sm font-black",
              )}
              onPointerDown={(e) => {
                e.preventDefault();
                e.stopPropagation();
                if (blocked) return;
                onEmote(kind);
                setOpen(false);
              }}
            >
              {!free ? <EmoteCooldownRing cd={emoteCd} size={38} /> : null}
              <span className="relative z-[1]">{emoji}</span>
            </button>
          );
        })}
      </div>
    ) : null;

  const host =
    typeof document !== "undefined"
      ? document.getElementById("ui-container") ?? document.body
      : null;

  return (
    <>
      <div id="reaction-menu" ref={rootRef} className="pointer-events-auto relative z-50">
        <button
          type="button"
          aria-label={open ? "Скрыть реакции" : "Реакции"}
          aria-expanded={open}
          className={cn(
            "relative flex size-11 items-center justify-center border-2 border-fg-on-ink bg-bg-deep font-mono text-lg font-black text-fg-on-ink active:scale-95",
            cooling && "opacity-70",
          )}
          onClick={(e) => {
            e.stopPropagation();
            setOpen((v) => !v);
          }}
        >
          :)
          {cooling ? (
            <span className="pointer-events-none absolute -top-1 -right-1 size-2 rounded-full bg-fg-on-ink/80" />
          ) : null}
        </button>
      </div>
      {tray && host ? createPortal(tray, host) : null}
    </>
  );
}
