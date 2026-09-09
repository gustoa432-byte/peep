import { useEffect, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import { GameHud } from "@/components/peep/game-hud";
import { TouchControls } from "@/components/peep/touch-controls";
import { Button } from "@/components/ui/button";
import { BLOCK_PALETTE } from "@/lib/peep/constants";
import { PeepGame } from "@/lib/peep/game";
import { markSessionDone } from "@/lib/peep/remember-world";
import { leaveWorld, trackEvent } from "@/lib/peep/world.functions";
import type { BlockEdit, HudState } from "@/lib/peep/types";

const EMPTY_HUD: HudState = {
  palette: BLOCK_PALETTE,
  selected: 0,
  peerCount: 1,
  peerConnected: false,
  playing: false,
  worldId: "",
  isCreator: false,
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
  const gameRef = useRef<PeepGame | null>(null);
  const [hud, setHud] = useState<HudState>({ ...EMPTY_HUD, worldId, isCreator });
  const [lost, setLost] = useState(false);

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
    });
    gameRef.current = game;
    return () => {
      game.dispose();
      gameRef.current = null;
      markSessionDone();
      void leaveWorld({ data: { worldId, playerId } });
    };
  }, [worldId, seed, edits, cursor, generation, isCreator, playerId]);

  const invite = async () => {
    const url = `${window.location.origin}/world/${worldId}`;
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      window.prompt("Ссылка на мир", url);
    }
    void trackEvent({ data: { name: "invite", worldId, playerId } });
  };

  return (
    <div className="relative h-dvh w-full overflow-hidden bg-bg-deep touch-none">
      <canvas ref={canvasRef} className="block h-full w-full touch-none" />
      <GameHud
        hud={hud}
        onSelect={(i) => gameRef.current?.setSelected(i)}
        onInvite={() => void invite()}
        onEmote={(kind) => gameRef.current?.playEmote(kind)}
        onReset={() => gameRef.current?.resetIsland() ?? Promise.resolve(false)}
      />

      {hud.playing ? (
        <TouchControls
          onAxis={(x, z) => gameRef.current?.setMoveAxis(x, z)}
          onBreak={() => gameRef.current?.breakTarget()}
          onPlace={() => gameRef.current?.placeTarget()}
          onJump={() => gameRef.current?.jump()}
        />
      ) : null}

      {!hud.playing && !lost ? (
        <div className="absolute inset-0 z-20 flex items-center justify-center bg-bg-deep/45 px-6">
          <div className="w-[min(420px,100%)] rounded-xl border border-border-ink bg-surface-ink p-6 text-fg-on-ink shadow-[var(--shadow-panel)]">
            <p className="font-display text-2xl font-semibold tracking-tight">Мир готов</p>
            <p className="mt-2 text-sm leading-relaxed text-muted-on-ink">
              Нажмите, чтобы войти. Отправьте другу ссылку Invite — вы окажетесь в одном мире.
            </p>
            <Button
              className="mt-5 w-full"
              size="lg"
              onClick={() => gameRef.current?.startPlaying()}
            >
              Войти в мир
            </Button>
            <p className="mt-3 text-center text-xs text-muted-on-ink md:hidden">
              Слева — джойстик, справа — взгляд и кнопки.
            </p>
          </div>
        </div>
      ) : null}

      {lost ? (
        <div className="absolute inset-0 z-40 flex items-center justify-center bg-bg-deep/70 px-6">
          <div className="w-[min(400px,100%)] rounded-xl bg-surface p-6 text-fg">
            <p className="font-display text-xl font-semibold">Connection lost</p>
            <p className="mt-2 text-sm text-muted">Сервер недоступен. Попробуйте открыть мир снова.</p>
            <Button asChild className="mt-5 w-full" variant="ink">
              <Link to="/">На главную</Link>
            </Button>
          </div>
        </div>
      ) : null}

    </div>
  );
}
