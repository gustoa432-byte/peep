import { Link } from "@tanstack/react-router";
import { Copy, RotateCcw, Users } from "lucide-react";
import { useState } from "react";
import { EmoteBar } from "@/components/peep/emote-bar";
import { Button } from "@/components/ui/button";
import { BLOCK_COLORS, BLOCK_NAMES, GRASS, LEAVES, WOOD } from "@/lib/peep/constants";
import type { EmoteKind, HudState } from "@/lib/peep/types";
import { cn } from "@/lib/utils";

function swatch(block: number): string {
  const c = BLOCK_COLORS[block] ?? 0x3a332c;
  return `#${c.toString(16).padStart(6, "0")}`;
}

function swatchStyle(block: number): { background: string } {
  if (block === GRASS) return { background: "linear-gradient(#4fbe45 40%, #7a4e30 40%)" };
  if (block === WOOD) return { background: "linear-gradient(90deg, #8f5a30 0%, #c49254 46%, #8f5a30 52%, #c49254 100%)" };
  if (block === LEAVES) return { background: "linear-gradient(#5ed45a 55%, #2f8f34 55%)" };
  return { background: swatch(block) };
}

export function GameHud({
  hud,
  onSelect,
  onInvite,
  onEmote,
  onReset,
}: {
  hud: HudState;
  onSelect: (i: number) => void;
  onInvite: () => void;
  onEmote: (kind: EmoteKind) => void;
  onReset: () => Promise<boolean>;
}) {
  const [copied, setCopied] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  const [resetting, setResetting] = useState(false);

  return (
    <div
      className="pointer-events-none absolute inset-0 z-30 text-fg-on-ink"
      style={{
        paddingTop: "env(safe-area-inset-top, 0px)",
        paddingBottom: "env(safe-area-inset-bottom, 0px)",
      }}
    >
      <div className="pointer-events-auto absolute top-3 right-3 left-3 flex items-start justify-between gap-2">
        <Link
          to="/"
          aria-label="На главную"
          className="flex min-h-11 min-w-11 flex-col justify-center rounded-lg bg-bg-deep/70 px-2.5 py-1.5 active:scale-95"
        >
          <span className="font-display text-base leading-none font-semibold tracking-tight">Peep</span>
          <span className="mt-0.5 text-xs text-muted-on-ink">домой</span>
        </Link>

        {hud.playing ? <EmoteBar layout="row" onEmote={onEmote} /> : <span className="min-w-0 flex-1" />}

        <div className="flex items-center gap-2">
          {hud.isCreator && hud.playing ? (
            <button
              type="button"
              onClick={() => setConfirmReset(true)}
              aria-label="Сбросить остров"
              className="flex size-11 items-center justify-center rounded-lg bg-bg-deep/70 text-fg-on-ink active:scale-95"
            >
              <RotateCcw className="size-4" strokeWidth={2.2} />
            </button>
          ) : null}

          <div className="flex h-11 items-center gap-1.5 rounded-lg bg-bg-deep/70 px-2.5 text-xs text-muted-on-ink">
            <Users className="size-3.5" strokeWidth={2} />
            <span className="hidden sm:inline">
              {hud.peerCount < 2 ? "Один в мире" : hud.peerConnected ? "Вместе" : "Друг рядом"}
            </span>
            <span className="tabular-nums sm:hidden">{hud.peerCount}</span>
          </div>

          <button
            type="button"
            onClick={() => {
              onInvite();
              setCopied(true);
              window.setTimeout(() => setCopied(false), 1600);
            }}
            className={cn(
              "flex h-11 items-center gap-1.5 rounded-lg px-3.5 text-sm font-medium",
              "bg-primary text-primary-fg shadow-[var(--shadow-panel)] active:scale-95",
            )}
          >
            <Copy className="size-3.5" strokeWidth={2.2} />
            {copied ? "Скопировано" : "Invite"}
          </button>
        </div>
      </div>

      <div className="absolute top-1/2 left-1/2 z-10 -translate-x-1/2 -translate-y-1/2">
        <div className="size-[14px]">
          <div className="absolute top-0 left-1/2 h-full w-px -translate-x-1/2 bg-fg-on-ink/90" />
          <div className="absolute top-1/2 left-0 h-px w-full -translate-y-1/2 bg-fg-on-ink/90" />
        </div>
      </div>

      {/* Hotbar is the whole inventory (TZ §3.4). */}
      <div
        className={cn(
          "pointer-events-auto absolute z-30 flex items-end gap-2",
          "bottom-3 left-1/2 -translate-x-1/2",
          "[@media(pointer:coarse)]:max-md:bottom-[5.75rem]",
          "[@media(pointer:coarse)]:landscape:bottom-2 [@media(pointer:coarse)]:landscape:left-2 [@media(pointer:coarse)]:landscape:translate-x-0",
        )}
      >
        <div className="flex items-end gap-1 rounded-2xl bg-bg-deep/70 p-1.5">
          {hud.palette.map((block, i) => (
            <button
              key={block}
              type="button"
              onClick={() => onSelect(i)}
              aria-label={BLOCK_NAMES[block]}
              aria-pressed={hud.selected === i}
              className={cn(
                "flex size-11 items-center justify-center rounded-xl border-2 transition-transform sm:size-12",
                "[@media(pointer:coarse)]:size-10",
                hud.selected === i
                  ? "scale-105 border-white/90 bg-white/15"
                  : "border-transparent bg-white/5 active:scale-95",
              )}
            >
              <span
                className="size-6 rounded-md border border-black/25 shadow-[inset_0_-3px_0_rgba(0,0,0,0.18)] sm:size-7"
                style={swatchStyle(block)}
              />
            </button>
          ))}
        </div>
      </div>

      <p className="absolute bottom-20 left-1/2 hidden -translate-x-1/2 text-center text-[11px] text-fg-on-ink/80 md:block">
        WASD · мышь · пробел · ЛКМ ломать · ПКМ ставить · 1–6 блоки · E/R/T
      </p>

      {confirmReset ? (
        <div className="pointer-events-auto absolute inset-0 z-40 flex items-center justify-center bg-bg-deep/55 px-6">
          <div className="w-[min(400px,100%)] rounded-xl border border-border-ink bg-surface-ink p-6 text-fg-on-ink shadow-[var(--shadow-panel)]">
            <p className="font-display text-2xl font-semibold tracking-tight">Сбросить остров?</p>
            <p className="mt-2 text-sm leading-relaxed text-muted-on-ink">
              Все поставленные блоки исчезнут. Остров станет таким, каким был в начале.
            </p>
            <div className="mt-5 flex flex-col gap-2 sm:flex-row">
              <Button
                variant="ghost"
                className="flex-1 border border-border-ink"
                disabled={resetting}
                onClick={() => setConfirmReset(false)}
              >
                Отмена
              </Button>
              <Button
                className="flex-1 bg-danger text-primary-fg"
                disabled={resetting}
                onClick={() => {
                  setResetting(true);
                  void onReset().then((ok) => {
                    setResetting(false);
                    if (ok) setConfirmReset(false);
                  });
                }}
              >
                {resetting ? "Сбрасываем…" : "Сбросить"}
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
