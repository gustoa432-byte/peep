import { Link } from "@tanstack/react-router";
import { type ButtonHTMLAttributes, type ReactNode, useState } from "react";
import { EmoteBar } from "@/components/peep/emote-bar";
import {
  IconClose,
  IconCopy,
  IconFullscreen,
  IconFullscreenExit,
  IconGear,
  IconPick,
  IconQr,
  IconReset,
  IconUsers,
} from "@/components/peep/peep-icons";
import { QrMark } from "@/components/peep/qr-mark";
import { Button } from "@/components/ui/button";
import { BLOCK_COLORS, BLOCK_NAMES, GOLD, GRASS, LEAVES, WOOD } from "@/lib/peep/constants";
import type { OrientMode } from "@/lib/peep/settings";
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
  if (block === GOLD) return { background: "linear-gradient(#f0d36a 40%, #c4922a 40%)" };
  return { background: swatch(block) };
}

function Chip({
  className,
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { children: ReactNode }) {
  return (
    <button
      type="button"
      className={cn(
        "flex h-11 items-center justify-center gap-1.5 rounded-pixel border-2 border-fg-on-ink/25 bg-bg-deep/70 px-2.5 font-mono text-xs uppercase tracking-wide text-fg-on-ink active:scale-95",
        className,
      )}
      {...props}
    >
      {children}
    </button>
  );
}

export function GameHud({
  hud,
  orient,
  phone,
  onSelect,
  onInvite,
  onPickupHat,
  onDismissChest,
  inviteUrl,
  onEmote,
  onReset,
  fullscreen,
  onFullscreen,
}: {
  hud: HudState;
  orient: OrientMode;
  phone: boolean;
  onSelect: (i: number) => void;
  onInvite: () => void;
  onPickupHat: () => void;
  onDismissChest: () => void;
  inviteUrl: string;
  onEmote: (kind: EmoteKind) => void;
  onReset: () => Promise<boolean>;
  fullscreen: boolean;
  onFullscreen: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const [qrOpen, setQrOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  const [resetting, setResetting] = useState(false);
  const land = orient === "landscape";

  return (
    <div
      className="pointer-events-none absolute inset-0 z-30 font-mono text-fg-on-ink"
      style={{
        paddingTop: "env(safe-area-inset-top, 0px)",
        paddingBottom: "env(safe-area-inset-bottom, 0px)",
      }}
    >
      <div
        className={cn(
          "pointer-events-auto absolute flex items-start justify-between gap-1",
          land ? "top-2 right-2 left-2" : "top-3 right-3 left-3 gap-2",
        )}
      >
        <div className="flex items-center gap-1">
          <Link
            to="/"
            aria-label="На главную"
            className="flex h-11 min-w-11 flex-col justify-center rounded-pixel border-2 border-fg-on-ink/25 bg-bg-deep/70 px-2.5 active:scale-95"
          >
            <span className="font-display text-base leading-none font-semibold tracking-tight">Peep</span>
            {land ? null : <span className="mt-0.5 text-xs uppercase tracking-wider text-muted-on-ink">home</span>}
          </Link>
          <Chip
            aria-label={fullscreen ? "Выйти из полного экрана" : "Полный экран"}
            className="size-11 shrink-0 px-0"
            onClick={onFullscreen}
          >
            {fullscreen ? <IconFullscreenExit className="size-4" /> : <IconFullscreen className="size-4" />}
          </Chip>
        </div>

        {hud.playing ? <EmoteBar layout="row" onEmote={onEmote} /> : <span className="min-w-0 flex-1" />}

        <div className="flex shrink-0 items-center gap-1">
          <div className="hidden h-11 items-center gap-1.5 rounded-pixel border-2 border-fg-on-ink/25 bg-bg-deep/70 px-2 text-xs uppercase tracking-wide text-muted-on-ink sm:flex">
            <IconUsers className="size-3.5" />
            <span className="tabular-nums">{hud.peerCount}</span>
          </div>

          {hud.fridayUnlocked ? (
            <>
              <Chip
                aria-label="Пятница"
                className="bg-primary text-primary-fg border-primary px-3"
                onClick={() => {
                  onInvite();
                  setCopied(true);
                  window.setTimeout(() => setCopied(false), 1600);
                }}
              >
                <IconCopy className="size-3.5" />
                <span className="hidden sm:inline">{copied ? "ok" : "пятница"}</span>
              </Chip>
              <Chip aria-label="QR Пятницы" className="hidden size-11 px-0 sm:flex" onClick={() => setQrOpen(true)}>
                <IconQr className="size-4" />
              </Chip>
            </>
          ) : null}

          <Chip aria-label="Настройки" className="size-11 px-0" onClick={() => setSettingsOpen(true)}>
            <IconGear className="size-4" />
          </Chip>
        </div>
      </div>

      <div className="absolute top-1/2 left-1/2 z-10 -translate-x-1/2 -translate-y-1/2">
        <svg viewBox="0 0 36 36" className="size-9 -rotate-90" aria-hidden>
          {hud.placeIntent && hud.placeCharge === 0 ? (
            <circle cx="18" cy="18" r="14" fill="none" className="stroke-primary/70" strokeWidth="2" strokeDasharray="3 4" />
          ) : null}
          {hud.placeCharge > 0 ? (
            <circle
              cx="18"
              cy="18"
              r="14"
              fill="none"
              className="stroke-primary"
              strokeWidth="2.5"
              strokeDasharray={2 * Math.PI * 14}
              strokeDashoffset={2 * Math.PI * 14 * (1 - hud.placeCharge)}
            />
          ) : null}
        </svg>
        <div className="absolute top-1/2 left-1/2 size-3 -translate-x-1/2 -translate-y-1/2">
          <div className="absolute top-0 left-1/2 h-full w-px -translate-x-1/2 bg-fg-on-ink" />
          <div className="absolute top-1/2 left-0 h-px w-full -translate-y-1/2 bg-fg-on-ink" />
        </div>
      </div>

      <div
        className={cn(
          "pointer-events-auto absolute z-30 flex items-end gap-1",
          land
            ? "bottom-3 left-1/2 -translate-x-1/2 flex-row"
            : cn(
                "bottom-3 left-1/2 -translate-x-1/2 flex-row",
                "max-md:bottom-[9.75rem] max-md:left-3 max-md:translate-x-0 max-md:flex-col",
                "[@media(pointer:coarse)]:bottom-[9.75rem] [@media(pointer:coarse)]:left-3 [@media(pointer:coarse)]:translate-x-0 [@media(pointer:coarse)]:flex-col",
              ),
        )}
      >
        <div
          className={cn(
            "flex items-end gap-1 rounded-pixel border-2 border-fg-on-ink/15 bg-bg-deep/5 p-1",
            land ? "flex-row" : "flex-row max-md:flex-col [@media(pointer:coarse)]:flex-col",
          )}
        >
          <div
            aria-hidden
            className={cn(
              "relative hidden size-11 items-center justify-center rounded-pixel border-2 border-fg-on-ink/25 bg-fg-on-ink/10 sm:size-12 md:flex",
              "[@media(pointer:coarse)]:hidden",
              land && "size-10 sm:size-10",
            )}
          >
            <IconPick className="size-7" />
          </div>
          {hud.palette.map((block, i) => (
            <button
              key={block}
              type="button"
              onClick={() => onSelect(i)}
              aria-label={BLOCK_NAMES[block]}
              aria-pressed={hud.selected === i}
              className={cn(
                "relative flex size-11 items-center justify-center rounded-pixel border-2 transition-transform sm:size-12",
                "[@media(pointer:coarse)]:size-10",
                land && "size-10 sm:size-10",
                hud.selected === i
                  ? "scale-105 border-fg-on-ink bg-fg-on-ink/15"
                  : "border-transparent bg-fg-on-ink/5 active:scale-95",
              )}
            >
              <span
                className={cn(
                  "size-6 rounded-pixel border border-bg-deep/40 shadow-[inset_0_-3px_0_rgba(0,0,0,0.18)] sm:size-7",
                  (hud.counts[i] ?? 0) <= 0 && "opacity-30",
                )}
                style={swatchStyle(block)}
              />
              <span className="absolute right-0.5 bottom-0.5 text-[10px] leading-none tabular-nums text-fg-on-ink">
                {hud.counts[i] ?? 0}
              </span>
            </button>
          ))}
        </div>
      </div>

      <p className="absolute bottom-20 left-1/2 hidden -translate-x-1/2 text-center font-mono text-xs uppercase tracking-wide text-fg-on-ink/80 md:block [@media(pointer:coarse)]:hidden">
        WASD · мышь · пробел · ломай чтобы брать · зажать ПКМ ставить · 1–7 · E/R/T
      </p>

      {hud.hatPrompt && !hud.hatBusy ? (
        <div className="pointer-events-auto absolute bottom-36 left-1/2 z-40 w-[min(280px,calc(100%-2rem))] -translate-x-1/2">
          <Button
            className="min-h-12 w-full rounded-pixel font-mono uppercase tracking-wide"
            onClick={onPickupHat}
          >
            подобрать шляпу
          </Button>
        </div>
      ) : null}

      {hud.chestOffer ? (
        <div className="pointer-events-auto absolute inset-0 z-50 flex items-center justify-center bg-bg-deep/70 px-6">
          <div className="w-[min(380px,100%)] rounded-pixel border-2 border-border-ink bg-surface-ink p-5 text-fg-on-ink">
            <p className="font-mono text-lg uppercase tracking-wide">сундук</p>
            <p className="mt-2 text-sm leading-relaxed text-muted-on-ink">
              Внутри — золотой блок. Можно позвать Пятницу.
            </p>
            <div className="mt-5 flex flex-col gap-2">
              {hud.isCreator ? (
                <Button
                  className="w-full rounded-pixel font-mono uppercase tracking-wide"
                  onClick={() => {
                    onInvite();
                    onDismissChest();
                    setCopied(true);
                    window.setTimeout(() => setCopied(false), 1600);
                  }}
                >
                  позвать пятницу
                </Button>
              ) : null}
              <Button
                variant="ghost"
                className="w-full rounded-pixel border-2 border-border-ink font-mono uppercase"
                onClick={onDismissChest}
              >
                закрыть
              </Button>
            </div>
          </div>
        </div>
      ) : null}

      {qrOpen ? (
        <div className="pointer-events-auto absolute inset-0 z-50 flex items-center justify-center bg-bg-deep/70 px-6">
          <div className="w-[min(320px,100%)] rounded-pixel border-2 border-border-ink bg-surface-ink p-5 text-fg-on-ink">
            <div className="flex items-center justify-between gap-3">
              <p className="font-mono text-sm uppercase tracking-widest">пятница</p>
              <button
                type="button"
                aria-label="Закрыть"
                className="flex size-11 items-center justify-center text-muted-on-ink"
                onClick={() => setQrOpen(false)}
              >
                <IconClose className="size-4" />
              </button>
            </div>
            <div className="mt-3 border-2 border-fg-on-ink bg-surface p-2">
              <QrMark value={inviteUrl} className="aspect-square w-full" />
            </div>
            <p className="mt-3 break-all text-center font-mono text-xs text-muted-on-ink">{hud.worldId}</p>
            <Button
              className="mt-4 w-full rounded-pixel font-mono uppercase tracking-wide"
              onClick={() => {
                onInvite();
                setCopied(true);
                window.setTimeout(() => setCopied(false), 1600);
              }}
            >
              {copied ? "ссылка скопирована" : "позвать пятницу"}
            </Button>
          </div>
        </div>
      ) : null}

      {settingsOpen ? (
        <div className="pointer-events-auto absolute inset-0 z-50 flex items-center justify-center bg-bg-deep/70 px-6">
          <div className={cn("w-[min(380px,100%)] rounded-pixel border-2 border-border-ink bg-surface-ink p-5 text-fg-on-ink", land && "max-h-[90dvh] overflow-y-auto")}>
            <div className="flex items-center justify-between gap-3">
              <p className="font-mono text-sm uppercase tracking-widest">настройки</p>
              <button
                type="button"
                aria-label="Закрыть"
                className="flex size-11 items-center justify-center text-muted-on-ink"
                onClick={() => setSettingsOpen(false)}
              >
                <IconClose className="size-4" />
              </button>
            </div>
            <div className="mt-5">
              {phone ? (
                <p className="text-sm leading-relaxed text-muted-on-ink">
                  Полный экран — кнопка рядом с Peep. Ориентация — шестерёнка на главной.
                </p>
              ) : (
                <p className="text-sm leading-relaxed text-muted-on-ink">
                  На компьютере мир на весь экран. Кнопка полного экрана прячет панель браузера.
                </p>
              )}
            </div>
            {phone && hud.fridayUnlocked ? (
              <button
                type="button"
                onClick={() => {
                  setSettingsOpen(false);
                  setQrOpen(true);
                }}
                className="mt-4 flex min-h-12 w-full items-center justify-center gap-2 rounded-pixel border-2 border-border-ink font-mono text-xs uppercase tracking-wide"
              >
                <IconQr className="size-4" />
                пятница
              </button>
            ) : null}
            {hud.isCreator && hud.playing ? (
              <div className="mt-6 border-t-2 border-border-ink pt-5">
                <p className="font-mono text-xs uppercase tracking-widest text-muted-on-ink">остров</p>
                <button
                  type="button"
                  onClick={() => {
                    setSettingsOpen(false);
                    setConfirmReset(true);
                  }}
                  className="mt-2 flex min-h-12 w-full items-center justify-center gap-2 rounded-pixel border-2 border-danger/50 font-mono text-xs uppercase tracking-wide text-danger"
                >
                  <IconReset className="size-4" />
                  сбросить остров
                </button>
              </div>
            ) : null}
          </div>
        </div>
      ) : null}

      {confirmReset ? (
        <div className="pointer-events-auto absolute inset-0 z-50 flex items-center justify-center bg-bg-deep/70 px-6">
          <div className="w-[min(400px,100%)] rounded-pixel border-2 border-border-ink bg-surface-ink p-6 text-fg-on-ink">
            <p className="font-mono text-lg uppercase tracking-wide">сбросить остров?</p>
            <p className="mt-2 text-sm leading-relaxed text-muted-on-ink">
              Все поставленные блоки исчезнут. Остров станет таким, каким был в начале.
            </p>
            <div className="mt-5 flex flex-col gap-2 sm:flex-row">
              <Button
                variant="ghost"
                className="flex-1 rounded-pixel border-2 border-border-ink font-mono uppercase"
                disabled={resetting}
                onClick={() => setConfirmReset(false)}
              >
                отмена
              </Button>
              <Button
                className="flex-1 rounded-pixel bg-danger font-mono uppercase text-primary-fg"
                disabled={resetting}
                onClick={() => {
                  setResetting(true);
                  void onReset().then((ok) => {
                    setResetting(false);
                    if (ok) setConfirmReset(false);
                  });
                }}
              >
                {resetting ? "сбрасываем…" : "сбросить"}
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
