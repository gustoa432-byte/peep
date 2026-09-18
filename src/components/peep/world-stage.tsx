import { useEffect, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useTranslation } from "@/lib/i18n/react";
import { BootLoader } from "@/components/peep/boot-loader";
import { GameHud } from "@/components/peep/game-hud";
import { LookSurface, PlaceHint, TouchControls } from "@/components/peep/touch-controls";
import { Button } from "@/components/ui/button";
import { BLOCK_PALETTE, DEFAULT_HOTBAR } from "@/lib/peep/constants";
import {
  canFullscreen,
  FS_EVENTS,
  isFullscreen,
  toggleFullscreen,
} from "@/lib/peep/fullscreen";
import { PeepGame } from "@/lib/peep/game";
import { startLazySave } from "@/lib/peep/lazy-save";
import { getTelegramSaveId } from "@/lib/peep/player-id";
import { markSessionDone, minedBlockCount, placedBlockCount, recordMinedBlock, recordPlacedBlock } from "@/lib/peep/remember-world";
import { lockOrient, unlockOrient, useDesktopMouseUi, usePhoneUi } from "@/lib/peep/settings";
import {
  fridayInviteLink,
  initTelegramWebApp,
  isTelegramDesktopPlatform,
  shareFridayInvite,
} from "@/lib/peep/telegram";
import type { Story } from "@/lib/peep/progress";
import { leaveWorld, trackEvent } from "@/lib/peep/world.functions";
import type { BlockEdit, HudState } from "@/lib/peep/types";

const EMPTY_HUD: HudState = {
  palette: [...DEFAULT_HOTBAR],
  selected: 1,
  peerCount: 1,
  peerConnected: false,
  playing: false,
  locked: false,
  worldId: "",
  isCreator: false,
  placeCharge: 0,
  placeIntent: false,
  breakCharge: 0,
  chestBar: null,
  counts: [0, 0, 0, 0, 0],
  catalog: [...BLOCK_PALETTE],
  catalogCounts: BLOCK_PALETTE.map(() => 0),
  invBadge: 0,
  dynamiteCd: 0,
  emoteCd: 0,
  fridayUnlocked: false,
  hatPrompt: false,
  chestOffer: false,
  hatBusy: false,
  guestBuildAllowed: false,
  islandLocked: false,
  fridayOnline: false,
  notice: null,
  lookHint: null,
  censorFlash: 0,
  cinematicActive: false,
  lockDenied: false,
  trollTracker: null,
};

export function WorldStage({
  worldId,
  seed,
  edits,
  cursor,
  generation,
  isCreator,
  playerId,
  inventoryOverride = null,
  guestBuildAllowed = false,
  islandLocked = false,
}: {
  worldId: string;
  seed: number;
  edits: BlockEdit[];
  cursor: number;
  generation: number;
  isCreator: boolean;
  playerId: string;
  inventoryOverride?: Story | null;
  guestBuildAllowed?: boolean;
  islandLocked?: boolean;
}) {
  const { t } = useTranslation();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const gameRef = useRef<PeepGame | null>(null);
  const lazyRef = useRef<ReturnType<typeof startLazySave> | null>(null);
  const [hud, setHud] = useState<HudState>({ ...EMPTY_HUD, worldId, isCreator });
  const [lost, setLost] = useState(false);
  const [kicked, setKicked] = useState(false);
  const [placed, setPlaced] = useState(placedBlockCount);
  const [mined, setMined] = useState(minedBlockCount);
  const [fullscreen, setFullscreen] = useState(false);
  const [fsHint, setFsHint] = useState<string | null>(null);
  const [saveHint, setSaveHint] = useState<string | null>(null);
  const [bootLoading, setBootLoading] = useState(true);
  const [bootProgress, setBootProgress] = useState(0.55);
  const phone = usePhoneUi();
  const desktopMouse = useDesktopMouseUi();
  const showTouchPads = phone && !desktopMouse && !isTelegramDesktopPlatform();
  const [hudOverlay, setHudOverlay] = useState(false);
  // Game is landscape-only on phones; desktop HUD stays "portrait" layout labels.
  const orient = phone ? "landscape" : "portrait";
  const inviteUrl =
    typeof window === "undefined" ? "" : fridayInviteLink(worldId) ?? "";

  useEffect(() => {
    initTelegramWebApp();
  }, []);

  useEffect(() => {
    if (!hudOverlay) return;
    gameRef.current?.setMoveAxis(0, 0);
    gameRef.current?.endBreak();
    gameRef.current?.endPlace();
    try {
      if (document.pointerLockElement) document.exitPointerLock();
    } catch {
      /* ignore */
    }
  }, [hudOverlay]);

  useEffect(() => {
    if (!phone) {
      unlockOrient();
      return;
    }
    void lockOrient("landscape");
    return () => unlockOrient();
  }, [phone]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const game = new PeepGame({
      canvas,
      worldId,
      seed,
      edits,
      cursor,
      generation,
      isCreator,
      playerId,
      inventoryOverride,
      guestBuildAllowed,
      islandLocked,
      onHud: setHud,
      onLost: () => setLost(true),
      onKicked: () => setKicked(true),
      onPlaced: () => setPlaced(recordPlacedBlock()),
      onBroken: () => setMined(recordMinedBlock()),
      onWorldDirty: () => lazyRef.current?.markDirty(),
      onBootProgress: (p) => setBootProgress(p),
    });
    gameRef.current = game;

    // Host-only lazy save (Telegram identity).
    const tg = getTelegramSaveId();
    if (tg && isCreator) {
      lazyRef.current = startLazySave(() => game.serializeWorld());
      void lazyRef.current.flush();
    }

    return () => {
      lazyRef.current?.stop();
      lazyRef.current = null;
      game.dispose();
      gameRef.current = null;
      markSessionDone();
      void leaveWorld({ data: { worldId, playerId } });
    };
  }, [
    worldId,
    seed,
    edits,
    cursor,
    generation,
    isCreator,
    playerId,
    inventoryOverride,
    guestBuildAllowed,
    islandLocked,
  ]);

  const onSaveWorld = async () => {
    if (!isCreator) {
      setSaveHint(t("world.save.ownerOnly"));
      window.setTimeout(() => setSaveHint(null), 2800);
      return;
    }
    const lazy = lazyRef.current;
    if (!lazy) {
      setSaveHint(t("world.save.telegramOnly"));
      window.setTimeout(() => setSaveHint(null), 2800);
      return;
    }
    setSaveHint(t("world.save.inProgress"));
    const ok = await lazy.flush();
    setSaveHint(ok ? t("world.save.success") : t("world.save.failed"));
    window.setTimeout(() => setSaveHint(null), 2200);
  };

  useEffect(() => {
    const sync = () => setFullscreen(isFullscreen(stageRef.current));
    sync();
    for (const ev of FS_EVENTS) document.addEventListener(ev, sync);
    return () => {
      for (const ev of FS_EVENTS) document.removeEventListener(ev, sync);
    };
  }, []);

  const invite = () => {
    shareFridayInvite(worldId);
    void trackEvent({ data: { name: "invite", worldId, playerId } });
  };

  const onFullscreen = async () => {
    const el = stageRef.current;
    if (!el) return;
    if (!canFullscreen()) {
      setFsHint(t("world.fullscreen.unsupported"));
      window.setTimeout(() => setFsHint(null), 3200);
      return;
    }
    const result = await toggleFullscreen(el);
    if (result === "denied") {
      setFsHint(t("world.fullscreen.denied"));
      window.setTimeout(() => setFsHint(null), 3200);
      return;
    }
    if (result === "on" && phone) void lockOrient("landscape");
  };

  return (
    <div
      ref={stageRef}
      className="peep-stage fixed inset-0 overflow-hidden bg-bg-deep font-mono touch-none select-none"
      data-orient={orient}
    >
      <div id="game-wrapper">
      <canvas ref={canvasRef} className="absolute inset-0 size-full touch-none" />
      {/* Must stay pointer-events-none or it shields the canvas (TG Desktop look dies). */}
      <div id="ui-container" className="pointer-events-none absolute inset-0 z-10">
      {bootLoading ? (
        <BootLoader progress={bootProgress} onDone={() => setBootLoading(false)} />
      ) : null}
      {/* HUD only after “войти в мир” — enter plaque must cover everything including crosshair. */}
      {hud.playing ? (
        <GameHud
          hud={hud}
          orient={orient}
          phone={phone}
          inviteUrl={inviteUrl}
          onSelect={(i) => gameRef.current?.setSelected(i)}
          onSetHotbarSlot={(slot, block) => gameRef.current?.setHotbarSlot(slot, block)}
          onClearInvBadge={() => gameRef.current?.clearInvBadge()}
          onInvite={() => void invite()}
          onPickupHat={() => gameRef.current?.pickupHat()}
          onDismissChest={() => gameRef.current?.dismissChest()}
          onEmote={(kind) => gameRef.current?.playEmote(kind)}
          onReset={() => gameRef.current?.resetIsland() ?? Promise.resolve(false)}
          onSaveWorld={isCreator ? () => void onSaveWorld() : undefined}
          saveHint={saveHint}
          onKickFriday={() => void gameRef.current?.kickFriday()}
          onToggleLock={() =>
            void gameRef.current?.setIslandLocked(!hud.islandLocked)
          }
          onToggleBuild={() =>
            void gameRef.current?.setGuestBuildAllowed(!hud.guestBuildAllowed)
          }
          fullscreen={fullscreen}
          onFullscreen={() => void onFullscreen()}
          onOverlayChange={setHudOverlay}
          onKeybindsChange={() => gameRef.current?.reloadKeybinds()}
        />
      ) : null}

      {kicked ? (
        <div className="pointer-events-auto absolute inset-0 z-50 flex items-center justify-center bg-bg-deep/80 px-6">
          <div className="w-[min(360px,100%)] rounded-pixel border-2 border-border-ink bg-surface-ink p-5 text-center text-fg-on-ink">
            <p className="font-mono text-sm uppercase tracking-widest">{t("world.kicked.title")}</p>
            <p className="mt-2 text-sm text-muted-on-ink">{t("world.kicked.body")}</p>
            <Button asChild className="mt-4 w-full rounded-pixel font-mono uppercase" variant="secondary">
              <Link to="/">{t("common.home")}</Link>
            </Button>
          </div>
        </div>
      ) : null}

      {hud.playing && hud.lockDenied && desktopMouse ? (
        <div className="pointer-events-auto absolute inset-0 z-50 flex items-center justify-center bg-black/80 text-white backdrop-blur-sm">
          <div className="max-w-sm rounded-2xl border border-zinc-700 bg-zinc-900 p-6 text-center">
            <h2 className="mb-3 text-xl font-bold">{t("world.tgWeb.title")}</h2>
            <p className="mb-6 text-sm text-zinc-400">{t("world.tgWeb.body")}</p>
            <button
              type="button"
              onClick={() => {
                const tg = (
                  window as unknown as {
                    Telegram?: { WebApp?: { openLink?: (url: string) => void } };
                  }
                ).Telegram?.WebApp;
                if (tg?.openLink) {
                  tg.openLink("https://peepland.ru");
                } else {
                  window.open("https://peepland.ru", "_blank");
                }
              }}
              className="w-full rounded-xl bg-white px-6 py-2 font-bold text-black hover:bg-zinc-200"
            >
              {t("world.tgWeb.openBrowser")}
            </button>
          </div>
        </div>
      ) : null}

      {hud.playing && !hud.cinematicActive && !hudOverlay && showTouchPads ? (
        <>
          <div className="pointer-events-none absolute inset-0 z-20">
            <LookSurface
              onLook={(dx, dy) => gameRef.current?.lookBy(dx, dy)}
              onHoldStart={() => gameRef.current?.beginPlace()}
              onHoldEnd={() => gameRef.current?.endPlace()}
            />
          </div>
          <TouchControls
            orient={orient}
            force
            breakCharge={hud.breakCharge}
            onAxis={(x, z) => gameRef.current?.setMoveAxis(x, z)}
            onBreakHold={() => gameRef.current?.beginBreak()}
            onBreakRelease={() => gameRef.current?.endBreak()}
            onJump={() => gameRef.current?.jump()}
          />
        </>
      ) : null}

      {/* Place hint follows phone UI (TG mobile), not nested under pads-only gate. */}
      {hud.playing && !hud.cinematicActive && !hudOverlay && phone ? (
        <PlaceHint placed={placed} mined={mined} orient={orient} force />
      ) : null}

      {!hud.playing && !lost && !bootLoading ? (
        <div className="pointer-events-auto absolute inset-0 z-[300] flex items-center justify-center bg-bg-deep/85 px-6">
          <div className="w-[min(420px,100%)] rounded-pixel border-2 border-border-ink bg-surface-ink p-6 text-fg-on-ink">
            <p className="font-mono text-xl uppercase tracking-wide">{t("world.enter.title")}</p>
            <p className="mt-2 text-sm leading-relaxed text-muted-on-ink">{t("world.enter.body")}</p>
            <Button
              className="mt-5 w-full rounded-pixel font-mono uppercase tracking-wide"
              size="lg"
              onClick={() => gameRef.current?.startPlaying()}
            >
              {t("world.enter.button")}
            </Button>
            <p className="mt-3 text-center font-mono text-xs uppercase tracking-wide text-muted-on-ink md:hidden">
              {t("world.enter.touchHint")}
            </p>
          </div>
        </div>
      ) : null}

      {lost ? (
        <div className="pointer-events-auto absolute inset-0 z-40 flex items-center justify-center bg-bg-deep/70 px-6">
          <div className="w-[min(400px,100%)] rounded-pixel border-2 border-border bg-surface p-6 text-fg">
            <p className="font-mono text-xl uppercase tracking-wide">connection lost</p>
            <p className="mt-2 text-sm text-muted">Сервер недоступен. Попробуйте открыть мир снова.</p>
            <Button asChild className="mt-5 w-full rounded-pixel font-mono uppercase" variant="ink">
              <Link to="/">на главную</Link>
            </Button>
          </div>
        </div>
      ) : null}
      {fsHint ? (
        <div className="pointer-events-none absolute inset-x-4 top-16 z-50 flex justify-center">
          <p className="max-w-sm rounded-pixel border-2 border-border-ink bg-surface-ink px-3 py-2 text-center text-sm text-fg-on-ink">
            {fsHint}
          </p>
        </div>
      ) : null}
      </div>
      </div>
    </div>
  );
}
