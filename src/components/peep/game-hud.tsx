import { useNavigate } from "@tanstack/react-router";
import { type ButtonHTMLAttributes, type ReactNode, useEffect, useRef, useState } from "react";
import { EmoteBar, ReactionMenu } from "@/components/peep/emote-bar";
import {
  IconBag,
  IconClose,
  IconCopy,
  IconFullscreen,
  IconFullscreenExit,
  IconGear,
  IconQr,
  IconReset,
  IconUsers,
} from "@/components/peep/peep-icons";
import { QrMark } from "@/components/peep/qr-mark";
import { Button } from "@/components/ui/button";
import { BARRIER, BLOCK_COLORS, BLOCK_NAMES, DYNAMITE, GOLD, GRASS, LEAVES, NEON, WOOD } from "@/lib/peep/constants";
import { preferHomeMenu } from "@/lib/peep/remember-world";
import { KeyboardBindsPanel } from "@/components/peep/keyboard-binds-panel";
import { LanguageSwitchInk } from "@/components/peep/language-switch";
import { useTranslation } from "@/lib/i18n/react";
import type { OrientMode } from "@/lib/peep/settings";
import type { EmoteKind, HudState } from "@/lib/peep/types";
import { cn } from "@/lib/utils";

type SettingsTab = "game" | "keyboard";

const LONG_PRESS_MS = 500;

function swatch(block: number): string {
  const c = BLOCK_COLORS[block] ?? 0x3a332c;
  return `#${c.toString(16).padStart(6, "0")}`;
}

function swatchStyle(block: number): { background: string } | undefined {
  if (block === BARRIER) return undefined;
  if (block === GRASS) return { background: "linear-gradient(#5cb85c 40%, #825a38 40%)" };
  if (block === WOOD) return { background: "linear-gradient(90deg, #8f5a30 0%, #c49254 46%, #8f5a30 52%, #c49254 100%)" };
  if (block === LEAVES) return { background: "linear-gradient(#5ed45a 55%, #2f8f34 55%)" };
  if (block === GOLD) return { background: "linear-gradient(#f0d36a 40%, #c4922a 40%)" };
  if (block === NEON) {
    return { background: "linear-gradient(135deg, #00e5ff 0%, #00e5ff 45%, #ff2bd6 45%, #ff2bd6 100%)" };
  }
  if (block === DYNAMITE) {
    return { background: "linear-gradient(#c9a46a 22%, #d43c2c 22%, #d43c2c 78%, #8a2a1c 78%)" };
  }
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
  onSaveWorld,
  saveHint = null,
  onKickFriday,
  onToggleLock,
  onToggleBuild,
  fullscreen,
  onFullscreen,
  onSetHotbarSlot,
  onClearInvBadge,
  onOverlayChange,
  onKeybindsChange,
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
  onSaveWorld?: () => void;
  saveHint?: string | null;
  onKickFriday?: () => void;
  onToggleLock?: () => void;
  onToggleBuild?: () => void;
  fullscreen: boolean;
  onFullscreen: () => void;
  onSetHotbarSlot: (slot: number, block: number) => void;
  onClearInvBadge: () => void;
  /** True while settings / inventory / QR / confirm cover the play UI. */
  onOverlayChange?: (open: boolean) => void;
  /** Desktop: refresh in-game keybind cache after settings edit. */
  onKeybindsChange?: () => void;
}) {
  const { t } = useTranslation();
  const [qrOpen, setQrOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsTab, setSettingsTab] = useState<SettingsTab>("game");
  const [confirmReset, setConfirmReset] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [invOpen, setInvOpen] = useState(false);
  const [replaceSlot, setReplaceSlot] = useState<number | null>(null);
  const [badgeBounce, setBadgeBounce] = useState(false);
  const prevBadge = useRef(0);
  const longTimer = useRef(0);
  const longFired = useRef(false);
  const navigate = useNavigate();
  const land = orient === "landscape";
  const cine = hud.cinematicActive;
  const overlayOpen = settingsOpen || invOpen || qrOpen || confirmReset;

  const goHome = () => {
    preferHomeMenu();
    void navigate({ to: "/" });
  };

  useEffect(() => {
    onOverlayChange?.(overlayOpen);
    return () => onOverlayChange?.(false);
  }, [overlayOpen, onOverlayChange]);

  useEffect(() => {
    if (hud.invBadge > prevBadge.current && hud.invBadge > 0) {
      setBadgeBounce(true);
      const t = window.setTimeout(() => setBadgeBounce(false), 450);
      prevBadge.current = hud.invBadge;
      return () => window.clearTimeout(t);
    }
    prevBadge.current = hud.invBadge;
  }, [hud.invBadge]);

  useEffect(
    () => () => {
      if (longTimer.current) window.clearTimeout(longTimer.current);
    },
    [],
  );

  const openInventory = (slot: number | null = null) => {
    setReplaceSlot(slot);
    setInvOpen(true);
    onClearInvBadge();
  };

  const closeInventory = () => {
    setInvOpen(false);
    setReplaceSlot(null);
  };

  const clearLongPress = () => {
    if (longTimer.current) {
      window.clearTimeout(longTimer.current);
      longTimer.current = 0;
    }
  };

  return (
    <div
      data-peep-hud
      className={cn(
        "pointer-events-none absolute inset-0 font-mono text-fg-on-ink",
        overlayOpen ? "z-[400]" : "z-30",
      )}
      style={{
        paddingBottom: "var(--tg-safe-area-inset-bottom, env(safe-area-inset-bottom, 0px))",
        display: cine ? "none" : undefined,
      }}
    >
      {/* Clear Telegram header + notch; compact translucent top cluster. */}
      <div
        id="top-nav-bar"
        className="pointer-events-auto absolute z-[100] flex flex-nowrap items-center"
      >
        <button
          type="button"
          aria-label={t("hud.home.ariaLabel")}
          className="relative z-[110] flex h-11 min-w-11 items-center justify-center border-2 border-fg-on-ink/25 bg-bg-deep/40 px-2.5 active:scale-95"
          onPointerDown={(e) => {
            e.stopPropagation();
          }}
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            goHome();
          }}
        >
          <span className="font-display text-base leading-none font-semibold tracking-tight">Peep</span>
        </button>
        <Chip
          aria-label={fullscreen ? t("hud.fullscreen.exit") : t("hud.fullscreen.enter")}
          className="size-11 shrink-0 px-0"
          onClick={onFullscreen}
        >
          {fullscreen ? <IconFullscreenExit className="size-4" /> : <IconFullscreen className="size-4" />}
        </Chip>

        {hud.playing ? (
          phone ? (
            <ReactionMenu onEmote={onEmote} emoteCd={hud.emoteCd} />
          ) : (
            <EmoteBar layout="row" onEmote={onEmote} emoteCd={hud.emoteCd} />
          )
        ) : null}

        <div className="flex h-11 items-center gap-1.5 border-2 border-fg-on-ink/25 bg-bg-deep/70 px-2 text-xs uppercase tracking-wide text-muted-on-ink">
          <IconUsers className="size-3.5" />
          <span className="tabular-nums">{hud.peerCount}</span>
        </div>

        {hud.fridayUnlocked ? (
          <>
            <Chip
              aria-label={t("hud.friday.shareAria")}
              className="bg-primary text-primary-fg border-primary px-3"
              onClick={() => onInvite()}
            >
              <IconCopy className="size-3.5" />
              <span className="hidden sm:inline">{t("hud.friday.label")}</span>
            </Chip>
            <Chip aria-label="QR Пятницы" className="hidden size-11 px-0 sm:flex" onClick={() => setQrOpen(true)}>
              <IconQr className="size-4" />
            </Chip>
          </>
        ) : null}

        <Chip aria-label={t("hud.settings.ariaLabel")} className="size-11 px-0" onClick={() => setSettingsOpen(true)}>
          <IconGear className="size-4" />
        </Chip>
      </div>

      {/* Crosshair only while playing and no modal is covering the view. */}
      {!settingsOpen && !invOpen && !qrOpen && !confirmReset ? (
      <div
        aria-hidden
        className="pointer-events-none z-10"
        style={{
          position: "absolute",
          top: "50%",
          left: "50%",
          transform: "translate(-50%, -50%)",
        }}
      >
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
        <div
          className="pointer-events-none"
          style={{
            position: "absolute",
            top: "50%",
            left: "50%",
            width: 12,
            height: 12,
            transform: "translate(-50%, -50%)",
          }}
        >
          <div className="absolute top-0 left-1/2 h-full w-px -translate-x-1/2 bg-fg-on-ink" />
          <div className="absolute top-1/2 left-0 h-px w-full -translate-y-1/2 bg-fg-on-ink" />
        </div>
      </div>
      ) : null}

      {hud.censorFlash > 0 && !cine ? (
        <div
          className="pointer-events-none absolute inset-0 z-[60] bg-[#e04532] transition-opacity duration-75"
          style={{ opacity: Math.min(0.55, hud.censorFlash * 0.55) }}
          aria-hidden
        />
      ) : null}

      {hud.playing && !hud.locked && !phone && !cine ? (
        <div
          className="pointer-events-none absolute inset-x-0 bottom-24 z-20"
          style={{
            top: "calc(var(--tg-safe-area-inset-top, env(safe-area-inset-top, 20px)) + 7.5rem)",
          }}
          aria-hidden
        >
          <span className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 text-center font-mono text-xs uppercase tracking-wide text-fg-on-ink/90">
            {t("hud.mouse.captureTitle")}
            <span className="mt-1 block text-[10px] tracking-wider text-muted-on-ink">
              {t("hud.mouse.captureHint")}
            </span>
          </span>
        </div>
      ) : null}

      {hud.notice && !cine ? (
        <p className="pointer-events-none absolute top-[18%] left-1/2 z-50 -translate-x-1/2 border-2 border-fg-on-ink bg-bg-deep/90 px-3 py-1.5 font-mono text-sm font-bold uppercase tracking-wide text-fg-on-ink">
          {hud.notice}
        </p>
      ) : null}

      {hud.lookHint && !cine ? (
        <p className="pointer-events-none absolute bottom-[20%] left-1/2 z-50 -translate-x-1/2 border-2 border-[#ffe14a]/80 bg-bg-deep/80 px-3 py-1.5 text-center font-mono text-sm font-bold uppercase tracking-wide text-[#ffe14a] sm:text-base">
          {hud.lookHint}
        </p>
      ) : null}

      {hud.trollTracker && !cine ? (
        <div
          className={cn(
            "pointer-events-none absolute z-50 flex flex-col gap-2",
            phone
              ? "top-[14%] left-3 max-w-[min(46vw,13.5rem)] items-start"
              : "top-[10%] left-1/2 w-[min(92vw,28rem)] -translate-x-1/2 items-center",
          )}
        >
          {hud.trollTracker.showTitle ? (
            <p
              className={cn(
                "font-display font-black uppercase tracking-wide text-fg-on-ink",
                phone ? "text-left text-sm leading-tight" : "text-center text-lg sm:text-xl",
              )}
            >
              {t("hud.troll.title")}
            </p>
          ) : null}
          {!hud.trollTracker.success ? (
            <div
              className={cn(
                "flex items-center gap-3 border-2 border-fg-on-ink/40 bg-bg-deep/80 px-2 py-1.5",
                phone && "gap-2 px-1.5 py-1",
              )}
              aria-hidden
            >
              <span
                className="flex size-9 items-center justify-center font-mono text-xl font-black text-[#ffe14a] transition-transform duration-100"
                style={{ transform: `rotate(${hud.trollTracker.guideDeg}deg)` }}
              >
                ↑
              </span>
              <div className="flex items-center gap-1 font-mono text-base leading-none text-fg-on-ink/35">
                {[0, 1, 2, 3].map((i) => (
                  <span
                    key={i}
                    className={cn(
                      "transition-colors duration-150",
                      i < hud.trollTracker!.sectorsDone && "text-[#ffe14a]",
                      hud.trollTracker!.sectorFlash > 0 &&
                        i === hud.trollTracker!.sectorsDone - 1 &&
                        "text-[#ffe14a]",
                    )}
                  >
                    →
                  </span>
                ))}
              </div>
            </div>
          ) : null}
          <div
            className={cn(
              "flex items-baseline gap-3 border-2 border-fg-on-ink bg-bg-deep/85 px-3 py-1.5 font-mono text-fg-on-ink transition-transform duration-150",
              phone && "gap-2 px-2.5 py-1",
              hud.trollTracker.sectorFlash > 0 && "scale-110 border-[#ffe14a] bg-[#ffe14a]/25 text-[#ffe14a]",
            )}
          >
            <p className={cn("font-bold uppercase tracking-wide", phone ? "text-xs" : "text-sm")}>
              {hud.trollTracker.success
                ? `${hud.trollTracker.laps}/${hud.trollTracker.total} ✅`
                : t("hud.troll.lap", {
                    current: hud.trollTracker.laps,
                    total: hud.trollTracker.total,
                  })}
            </p>
            {!hud.trollTracker.success ? (
              <p
                className={cn(
                  "font-black tabular-nums text-[#e04532]",
                  phone ? "text-base" : "text-xl",
                )}
              >
                {String(Math.floor(hud.trollTracker.secondsLeft / 60)).padStart(2, "0")}:
                {String(hud.trollTracker.secondsLeft % 60).padStart(2, "0")}
              </p>
            ) : null}
          </div>
        </div>
      ) : null}

      <div
        className={cn(
          "pointer-events-auto absolute z-50 flex items-end gap-1",
          phone && !land
            ? "bottom-[9.75rem] left-3 translate-x-0 flex-col"
            : "bottom-3 left-1/2 -translate-x-1/2 flex-row",
        )}
      >
        <div
          className={cn(
            "flex items-end gap-1 rounded-pixel border-2 border-fg-on-ink/15 bg-bg-deep/5 p-1",
            phone && !land ? "flex-col" : "flex-row",
          )}
        >
          {hud.palette.slice(0, 5).map((block, i) => (
            <button
              key={`slot-${i}-${block}`}
              type="button"
              onClick={() => {
                if (longFired.current) {
                  longFired.current = false;
                  return;
                }
                onSelect(i);
              }}
              onPointerDown={(e) => {
                if (!phone) return;
                longFired.current = false;
                clearLongPress();
                longTimer.current = window.setTimeout(() => {
                  longTimer.current = 0;
                  longFired.current = true;
                  openInventory(i);
                }, LONG_PRESS_MS);
                e.stopPropagation();
              }}
              onPointerUp={() => clearLongPress()}
              onPointerCancel={() => clearLongPress()}
              onPointerLeave={() => clearLongPress()}
              onContextMenu={(e) => {
                e.preventDefault();
                openInventory(i);
              }}
              aria-label={BLOCK_NAMES[block] ?? `block ${block}`}
              aria-pressed={hud.selected === i}
              className={cn(
                "relative flex size-11 items-center justify-center rounded-pixel border-2 transition-transform sm:size-12",
                phone && "size-10",
                land && "size-10 sm:size-10",
                hud.selected === i || replaceSlot === i
                  ? "scale-105 border-fg-on-ink bg-fg-on-ink/15"
                  : "border-transparent bg-fg-on-ink/5 active:scale-95",
                replaceSlot === i && "ring-2 ring-primary",
              )}
            >
              <span
                className={cn(
                  "size-6 rounded-pixel border border-bg-deep/40 shadow-[inset_0_-3px_0_rgba(0,0,0,0.18)] sm:size-7",
                  block === BARRIER && "peep-air-swatch shadow-none",
                  block !== BARRIER && (hud.counts[i] ?? 0) <= 0 && "opacity-30",
                )}
                style={swatchStyle(block)}
              />
              {block === DYNAMITE && hud.dynamiteCd > 0 ? (
                <span
                  aria-hidden
                  className="pointer-events-none absolute inset-0 overflow-hidden rounded-[1px]"
                >
                  <span
                    className="absolute inset-x-0 bottom-0 bg-[#e04532]/70 transition-[height] duration-200"
                    style={{ height: `${Math.round(hud.dynamiteCd * 100)}%` }}
                  />
                  <span
                    className="absolute inset-0 rounded-[1px] border-2 border-[#ffe14a]/80"
                    style={{
                      clipPath: `inset(${Math.round((1 - hud.dynamiteCd) * 100)}% 0 0 0)`,
                    }}
                  />
                </span>
              ) : null}
              <span className="absolute right-0.5 bottom-0.5 z-[1] text-[10px] leading-none tabular-nums text-fg-on-ink">
                {block === BARRIER ? "∞" : (hud.counts[i] ?? 0)}
              </span>
            </button>
          ))}

          <button
            type="button"
            aria-label={t("hud.inventory.ariaLabel")}
            onClick={() => openInventory(null)}
            className={cn(
              "relative flex size-11 items-center justify-center rounded-pixel border-2 border-fg-on-ink/30 bg-bg-deep/55 text-fg-on-ink sm:size-12",
              phone && "size-10",
              land && "size-10 sm:size-10",
              "active:scale-95",
            )}
          >
            <IconBag className="size-6" />
            <div
              id="inventory-badge"
              className={cn(
                "inventory-badge",
                hud.invBadge <= 0 && "hidden",
                badgeBounce && "badge-bounce",
              )}
            >
              {hud.invBadge > 9 ? "9+" : hud.invBadge > 0 ? `+${hud.invBadge}` : ""}
            </div>
          </button>
        </div>
      </div>

      {invOpen ? (
        <div className="pointer-events-auto absolute inset-0 z-[300] flex items-end justify-center bg-bg-deep/85 px-3 pb-3 sm:items-center sm:pb-0">
          <div
            className={cn(
              "flex max-h-full w-[min(28rem,100%)] flex-col overflow-hidden rounded-pixel border-2 border-border-ink bg-surface-ink p-4 text-fg-on-ink",
            )}
          >
            <div className="flex items-center justify-between gap-3">
              <p className="font-mono text-sm uppercase tracking-widest">
                {replaceSlot != null
                  ? t("hud.inventory.replaceSlot", { slot: replaceSlot + 1 })
                  : t("hud.inventory.title")}
              </p>
              <button
                type="button"
                aria-label={t("common.close")}
                className="flex size-11 items-center justify-center text-muted-on-ink"
                onClick={closeInventory}
              >
                <IconClose className="size-4" />
              </button>
            </div>
            <div className="mt-3 grid grid-cols-5 gap-2 sm:grid-cols-6">
              {hud.catalog.map((block, i) => {
                const count = hud.catalogCounts[i] ?? 0;
                return (
                  <button
                    key={`cat-${block}`}
                    type="button"
                    aria-label={BLOCK_NAMES[block] ?? `block ${block}`}
                    className="relative flex aspect-square items-center justify-center rounded-pixel border-2 border-fg-on-ink/25 bg-bg-deep/40 active:scale-95"
                    onClick={() => {
                      if (replaceSlot != null) {
                        onSetHotbarSlot(replaceSlot, block);
                        closeInventory();
                        return;
                      }
                      const idx = hud.palette.indexOf(block);
                      if (idx >= 0) {
                        onSelect(idx);
                        closeInventory();
                        return;
                      }
                      onSetHotbarSlot(hud.selected, block);
                      closeInventory();
                    }}
                  >
                    <span
                      className={cn(
                        "size-7 rounded-pixel border border-bg-deep/40 shadow-[inset_0_-3px_0_rgba(0,0,0,0.18)]",
                        block === BARRIER && "peep-air-swatch shadow-none",
                        block !== BARRIER && count <= 0 && "opacity-30",
                      )}
                      style={swatchStyle(block)}
                    />
                    <span className="absolute right-0.5 bottom-0.5 text-[10px] leading-none tabular-nums text-fg-on-ink">
                      {block === BARRIER ? "∞" : count}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      ) : null}

      {!phone ? (
        <p className="absolute bottom-20 left-1/2 -translate-x-1/2 text-center font-mono text-xs uppercase tracking-wide text-fg-on-ink/80">
          {t("hud.controls.desktop")}
        </p>
      ) : null}

      {hud.chestBar ? (
        <div
          className="pointer-events-none absolute z-30 w-28 -translate-x-1/2 -translate-y-full"
          style={{ left: hud.chestBar.x, top: hud.chestBar.y }}
        >
          <p className="mb-1 text-center font-mono text-[10px] uppercase tracking-widest text-fg-on-ink drop-shadow-[0_1px_2px_rgba(0,0,0,0.85)]">
            {hud.chestBar.crafting ? t("hud.chest.opening") : t("hud.chest.label")}
          </p>
          <div className="h-2.5 overflow-hidden rounded-sm border border-fg-on-ink/40 bg-bg-deep/80 shadow-[0_1px_4px_rgba(0,0,0,0.55)]">
            <div
              className={cn(
                "h-full origin-left transition-[width] duration-75",
                hud.chestBar.crafting && "animate-pulse",
              )}
              style={{
                width: `${Math.round(hud.chestBar.hp * 100)}%`,
                background:
                  hud.chestBar.hp > 0.45
                    ? "#5ecf62"
                    : hud.chestBar.hp > 0.2
                      ? "#d4a017"
                      : "#e25555",
              }}
            />
          </div>
          <p className="mt-0.5 text-center font-mono text-[10px] tabular-nums text-fg-on-ink/90 drop-shadow-[0_1px_2px_rgba(0,0,0,0.85)]">
            {Math.round(hud.chestBar.hp * 100)}%
          </p>
        </div>
      ) : null}

      {hud.hatPrompt && !hud.hatBusy ? (
        <div className="pointer-events-auto absolute bottom-36 left-1/2 z-40 w-[min(280px,calc(100%-2rem))] -translate-x-1/2">
          <Button
            className="min-h-12 w-full rounded-pixel font-mono uppercase tracking-wide"
            onClick={onPickupHat}
          >
            {t("hud.hat.pickup")}
          </Button>
        </div>
      ) : null}

      {hud.chestOffer ? (
        <div className="pointer-events-auto absolute inset-0 z-50 flex items-center justify-center bg-bg-deep/70 px-6">
          <div className="w-[min(380px,100%)] rounded-pixel border-2 border-border-ink bg-surface-ink p-5 text-fg-on-ink">
            <p className="font-mono text-lg uppercase tracking-wide">{t("hud.chest.modalTitle")}</p>
            <p className="mt-2 text-sm leading-relaxed text-muted-on-ink">{t("hud.chest.modalBody")}</p>
            <div className="mt-5 flex flex-col gap-2">
              {hud.isCreator ? (
                <Button
                  className="w-full rounded-pixel font-mono uppercase tracking-wide"
                  onClick={() => {
                    onInvite();
                    onDismissChest();
                  }}
                >
                  {t("hud.chest.inviteFriday")}
                </Button>
              ) : null}
              <Button
                variant="ghost"
                className="w-full rounded-pixel border-2 border-border-ink font-mono uppercase"
                onClick={onDismissChest}
              >
                {t("common.close")}
              </Button>
            </div>
          </div>
        </div>
      ) : null}

      {qrOpen ? (
        <div className="pointer-events-auto absolute inset-0 z-[300] flex items-center justify-center bg-bg-deep/85 px-6">
          <div className="w-[min(320px,100%)] rounded-pixel border-2 border-border-ink bg-surface-ink p-5 text-fg-on-ink">
            <div className="flex items-center justify-between gap-3">
              <p className="font-mono text-sm uppercase tracking-widest">{t("hud.friday.label")}</p>
              <button
                type="button"
                aria-label={t("common.close")}
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
              onClick={() => onInvite()}
            >
              {t("hud.chest.inviteFriday")}
            </Button>
          </div>
        </div>
      ) : null}

      {settingsOpen ? (
        <div className="peep-safe pointer-events-auto absolute inset-0 z-[300] flex items-center justify-center bg-bg-deep/85">
          <div className="flex max-h-full w-[min(36rem,100%)] flex-col overflow-hidden rounded-pixel border-2 border-border-ink bg-surface-ink text-fg-on-ink">
            <div className="flex shrink-0 items-center justify-between gap-3 px-4 pt-4 pb-2">
              <p className="font-mono text-sm uppercase tracking-widest">{t("settings.title")}</p>
              <button
                type="button"
                aria-label={t("common.close")}
                className="flex size-10 items-center justify-center text-muted-on-ink"
                onClick={() => {
                  setSettingsOpen(false);
                  setSettingsTab("game");
                }}
              >
                <IconClose className="size-4" />
              </button>
            </div>
            {!phone ? (
              <div className="mx-4 flex shrink-0 rounded-pixel border-2 border-fg-on-ink/20">
                <button
                  type="button"
                  onClick={() => setSettingsTab("game")}
                  className={cn(
                    "min-h-10 flex-1 px-3 font-mono text-xs uppercase tracking-wide",
                    settingsTab === "game" ? "bg-primary text-primary-fg" : "text-fg-on-ink",
                  )}
                >
                  {t("settings.tab.game")}
                </button>
                <button
                  type="button"
                  onClick={() => setSettingsTab("keyboard")}
                  className={cn(
                    "min-h-10 flex-1 px-3 font-mono text-xs uppercase tracking-wide",
                    settingsTab === "keyboard" ? "bg-primary text-primary-fg" : "text-fg-on-ink",
                  )}
                >
                  {t("settings.tab.keyboard")}
                </button>
              </div>
            ) : null}
            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pt-3 pb-4">
              {!phone && settingsTab === "keyboard" ? (
                <KeyboardBindsPanel onChange={() => onKeybindsChange?.()} />
              ) : (
                <>
                  <p className="text-sm leading-relaxed text-muted-on-ink">
                    {phone ? t("settings.phoneFullscreenHint") : t("settings.desktopFullscreenHint")}
                  </p>
                  <LanguageSwitchInk />
                  <div className="mt-4 grid grid-cols-2 gap-2">
                    {phone && hud.fridayUnlocked ? (
                      <button
                        type="button"
                        onClick={() => {
                          setSettingsOpen(false);
                          setQrOpen(true);
                        }}
                        className="flex min-h-11 items-center justify-center gap-2 rounded-pixel border-2 border-border-ink font-mono text-xs uppercase tracking-wide"
                      >
                        <IconQr className="size-4" />
                        {t("hud.friday.label")}
                      </button>
                    ) : null}
                    {hud.isCreator && hud.playing && onKickFriday ? (
                      <button
                        type="button"
                        disabled={!hud.fridayOnline}
                        onClick={onKickFriday}
                        className="flex min-h-11 items-center justify-center rounded-pixel border-2 border-border-ink font-mono text-xs uppercase tracking-wide disabled:opacity-40"
                      >
                        {t("hud.settings.kickFriday")}
                      </button>
                    ) : null}
                    {hud.isCreator && hud.playing && onToggleLock ? (
                      <button
                        type="button"
                        onClick={onToggleLock}
                        className="flex min-h-11 items-center justify-center rounded-pixel border-2 border-border-ink font-mono text-xs uppercase tracking-wide"
                      >
                        {hud.islandLocked ? t("hud.settings.unlockIsland") : t("hud.settings.lockIsland")}
                      </button>
                    ) : null}
                    {hud.isCreator && hud.playing && onToggleBuild ? (
                      <button
                        type="button"
                        onClick={onToggleBuild}
                        className="flex min-h-11 items-center justify-center rounded-pixel border-2 border-border-ink font-mono text-xs uppercase tracking-wide"
                      >
                        {hud.guestBuildAllowed
                          ? t("hud.settings.disallowBuild")
                          : t("hud.settings.allowBuild")}
                      </button>
                    ) : null}
                    {hud.playing && onSaveWorld ? (
                      <button
                        type="button"
                        onClick={() => onSaveWorld()}
                        className="flex min-h-11 items-center justify-center gap-2 rounded-pixel border-2 border-border-ink font-mono text-xs uppercase tracking-wide"
                      >
                        {saveHint ?? t("hud.settings.saveWorld")}
                      </button>
                    ) : null}
                    {hud.playing && hud.isCreator ? (
                      <button
                        type="button"
                        onClick={() => {
                          setSettingsOpen(false);
                          setConfirmReset(true);
                        }}
                        className="col-span-2 flex min-h-11 items-center justify-center gap-2 rounded-pixel border-2 border-danger/50 font-mono text-xs uppercase tracking-wide text-danger"
                      >
                        <IconReset className="size-4" />
                        {t("hud.settings.resetIsland")}
                      </button>
                    ) : null}
                  </div>
                  {hud.isCreator && hud.playing ? (
                    <p className="mt-3 font-mono text-[10px] uppercase tracking-wide text-muted-on-ink">
                      {hud.fridayOnline ? t("hud.settings.fridayOnline") : t("hud.settings.fridayOffline")}
                    </p>
                  ) : null}
                </>
              )}
            </div>
          </div>
        </div>
      ) : null}

      {confirmReset ? (
        <div className="pointer-events-auto absolute inset-0 z-[300] flex items-center justify-center bg-bg-deep/85 p-3">
          <div className="max-h-full w-[min(24rem,100%)] overflow-y-auto rounded-pixel border-2 border-border-ink bg-surface-ink p-5 text-fg-on-ink">
            <p className="font-mono text-lg uppercase tracking-wide">{t("hud.reset.title")}</p>
            <p className="mt-2 text-sm leading-relaxed text-muted-on-ink">{t("hud.reset.body")}</p>
            <div className="mt-5 flex flex-row gap-2">
              <Button
                variant="ghost"
                className="flex-1 rounded-pixel border-2 border-border-ink font-mono uppercase"
                disabled={resetting}
                onClick={() => setConfirmReset(false)}
              >
                {t("common.cancel")}
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
                {resetting ? t("hud.reset.inProgress") : t("hud.reset.confirm")}
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
