import { useEffect, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import { GameHud } from "@/components/peep/game-hud";
import { LookSurface, PlaceHint, TouchControls } from "@/components/peep/touch-controls";
import { Button } from "@/components/ui/button";
import { BLOCK_PALETTE } from "@/lib/peep/constants";
import {
  canFullscreen,
  FS_EVENTS,
  isFullscreen,
  toggleFullscreen,
} from "@/lib/peep/fullscreen";
import { PeepGame } from "@/lib/peep/game";
import { markSessionDone, placedBlockCount, recordPlacedBlock } from "@/lib/peep/remember-world";
import {
  lockOrient,
  readOrient,
  unlockOrient,
  useMatchMedia,
  usePhoneUi,
} from "@/lib/peep/settings";
import { leaveWorld, trackEvent } from "@/lib/peep/world.functions";
import type { BlockEdit, HudState } from "@/lib/peep/types";
import { cn } from "@/lib/utils";

const EMPTY_HUD: HudState = {
  palette: BLOCK_PALETTE,
  selected: 0,
  peerCount: 1,
  peerConnected: false,
  playing: false,
  worldId: "",
  isCreator: false,
  placeCharge: 0,
  placeIntent: false,
  breakCharge: 0,
};

export function WorldStage({
  worldId,
  seed,
  edits,
  cursor,
  generation,
  isCreator,
  playerId,
}: {
  worldId: string;
  seed: number;
  edits: BlockEdit[];
  cursor: number;
  generation: number;
  isCreator: boolean;
  playerId: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const gameRef = useRef<PeepGame | null>(null);
  const [hud, setHud] = useState<HudState>({ ...EMPTY_HUD, worldId, isCreator });
  const [lost, setLost] = useState(false);
  const [placed, setPlaced] = useState(placedBlockCount);
  const [storedOrient] = useState(readOrient);
  const [skipRotate, setSkipRotate] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [fsHint, setFsHint] = useState<string | null>(null);
  const phone = usePhoneUi();
  const coarse = useMatchMedia("(pointer: coarse)");
  const viewLand = useMatchMedia("(orientation: landscape)");
  const orient = phone ? storedOrient : "portrait";
  const inviteUrl = typeof window === "undefined" ? "" : `${window.location.origin}/world/${worldId}`;
  const needRotate =
    phone &&
    !skipRotate &&
    ((orient === "landscape" && !viewLand) || (orient === "portrait" && viewLand));

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
      onHud: setHud,
      onLost: () => setLost(true),
      onPlaced: () => setPlaced(recordPlacedBlock()),
    });
    gameRef.current = game;
    return () => {
      game.dispose();
      gameRef.current = null;
      markSessionDone();
      void leaveWorld({ data: { worldId, playerId } });
    };
  }, [worldId, seed, edits, cursor, generation, isCreator, playerId]);

  useEffect(() => {
    if (!phone) {
      unlockOrient();
      return;
    }
    void lockOrient(storedOrient);
    return () => unlockOrient();
  }, [phone, storedOrient]);

  useEffect(() => {
    const sync = () => setFullscreen(isFullscreen(stageRef.current));
    sync();
    for (const ev of FS_EVENTS) document.addEventListener(ev, sync);
    return () => {
      for (const ev of FS_EVENTS) document.removeEventListener(ev, sync);
    };
  }, []);

  const invite = async () => {
    const url = `${window.location.origin}/world/${worldId}`;
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      window.prompt("Ссылка на мир", url);
    }
    void trackEvent({ data: { name: "invite", worldId, playerId } });
  };

  const onFullscreen = async () => {
    const el = stageRef.current;
    if (!el) return;
    if (!canFullscreen()) {
      setFsHint("Этот браузер не умеет полноэкранный режим. Добавьте Peep на главный экран.");
      window.setTimeout(() => setFsHint(null), 3200);
      return;
    }
    const result = await toggleFullscreen(el);
    if (result === "denied") {
      setFsHint("Браузер не пустил. Добавьте Peep на главный экран — откроется как приложение.");
      window.setTimeout(() => setFsHint(null), 3200);
      return;
    }
    if (result === "on" && phone) void lockOrient(storedOrient);
  };

  return (
    <div
      ref={stageRef}
      className="fixed inset-0 overflow-hidden bg-bg-deep font-mono touch-none"
      data-orient={orient}
    >
      <canvas ref={canvasRef} className="absolute inset-0 size-full touch-none" />
      <GameHud
        hud={hud}
        orient={orient}
        phone={phone}
        inviteUrl={inviteUrl}
        onSelect={(i) => gameRef.current?.setSelected(i)}
        onInvite={() => void invite()}
        onEmote={(kind) => gameRef.current?.playEmote(kind)}
        onReset={() => gameRef.current?.resetIsland() ?? Promise.resolve(false)}
        fullscreen={fullscreen}
        onFullscreen={() => void onFullscreen()}
      />

      {hud.playing ? (
        <>
          <div
            className={cn(
              "pointer-events-none absolute inset-0 z-20",
              coarse ? "block" : "hidden max-md:block [@media(pointer:coarse)]:block",
            )}
          >
            <LookSurface
              onLook={(dx, dy) => gameRef.current?.lookBy(dx, dy)}
              onHoldStart={() => gameRef.current?.beginPlace()}
              onHoldEnd={() => gameRef.current?.endPlace()}
            />
          </div>
          <TouchControls
            orient={orient}
            force={coarse}
            breakCharge={hud.breakCharge}
            onAxis={(x, z) => gameRef.current?.setMoveAxis(x, z)}
            onBreakHold={() => gameRef.current?.beginBreak()}
            onBreakRelease={() => gameRef.current?.endBreak()}
            onJump={() => gameRef.current?.jump()}
          />
          <PlaceHint placed={placed} orient={orient} force={coarse} />
        </>
      ) : null}

      {needRotate && hud.playing ? (
        <div className="pointer-events-auto absolute inset-0 z-50 flex items-center justify-center bg-bg-deep/80 px-6">
          <div className="w-[min(360px,100%)] rounded-pixel border-2 border-border-ink bg-surface-ink p-5 text-center text-fg-on-ink">
            <p className="font-mono text-sm uppercase tracking-widest">поверните телефон</p>
            <p className="mt-2 text-sm leading-relaxed text-muted-on-ink">
              {orient === "landscape" ? "Нужна альбомная ориентация." : "Нужна книжная ориентация."}{" "}
              Меняется в меню на главной.
            </p>
            <Button asChild className="mt-4 w-full rounded-pixel font-mono uppercase tracking-wide" variant="secondary">
              <Link to="/">на главную</Link>
            </Button>
            <button
              type="button"
              className="mt-2 min-h-11 w-full font-mono text-xs uppercase tracking-wide text-muted-on-ink"
              onClick={() => setSkipRotate(true)}
            >
              играть так
            </button>
          </div>
        </div>
      ) : null}

      {!hud.playing && !lost ? (
        <div className="absolute inset-0 z-20 flex items-center justify-center bg-bg-deep/45 px-6">
          <div className="w-[min(420px,100%)] rounded-pixel border-2 border-border-ink bg-surface-ink p-6 text-fg-on-ink">
            <p className="font-mono text-xl uppercase tracking-wide">мир готов</p>
            <p className="mt-2 text-sm leading-relaxed text-muted-on-ink">
              Нажмите, чтобы войти. Invite — ссылка или QR. Друг окажется в том же мире.
            </p>
            <Button
              className="mt-5 w-full rounded-pixel font-mono uppercase tracking-wide"
              size="lg"
              onClick={() => gameRef.current?.startPlaying()}
            >
              войти в мир
            </Button>
            <p className="mt-3 text-center font-mono text-xs uppercase tracking-wide text-muted-on-ink md:hidden">
              стик — ход · свайп — взгляд · двойной тап-держи — блок · зажми кирку — ломать
            </p>
          </div>
        </div>
      ) : null}

      {lost ? (
        <div className="absolute inset-0 z-40 flex items-center justify-center bg-bg-deep/70 px-6">
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
  );
}
