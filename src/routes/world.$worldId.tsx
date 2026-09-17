import { lazy, Suspense, useEffect, useState } from "react";
import { Link, createFileRoute, useNavigate } from "@tanstack/react-router";
import { BootLoader } from "@/components/peep/boot-loader";
import { Button } from "@/components/ui/button";
import { MAX_WORLDS_PER_ACCOUNT, WORLD_ID_RE } from "@/lib/peep/constants";
import { loadWorldFromServer } from "@/lib/peep/lazy-save";
import { getPlayerId, getTelegramSaveId } from "@/lib/peep/player-id";
import type { Story } from "@/lib/peep/progress";
import {
  countOwnedWorlds,
  preferHomeMenu,
  rememberWorld,
} from "@/lib/peep/remember-world";
import { initTelegramWebApp } from "@/lib/peep/telegram";
import { takeTelegramInventory } from "@/lib/peep/tg-boot-cache";
import type { JoinResult } from "@/lib/peep/types";
import { createWorld, getWorldMeta, joinWorld } from "@/lib/peep/world.functions";

const WorldStage = lazy(async () => {
  const m = await import("@/components/peep/world-stage");
  return { default: m.WorldStage };
});

export const Route = createFileRoute("/world/$worldId")({
  ssr: false,
  component: WorldPage,
});

function JoinSplash({ progress }: { progress: number }) {
  return (
    <main className="peep-home relative h-dvh overflow-hidden bg-black text-white">
      <div id="game-wrapper" className="absolute inset-0">
        <BootLoader progress={progress} autoFinish={false} onDone={() => {}} />
      </div>
    </main>
  );
}

function WorldPage() {
  const { worldId } = Route.useParams();
  const valid = WORLD_ID_RE.test(worldId);
  const [playerId] = useState(() => {
    initTelegramWebApp();
    return getPlayerId();
  });
  const [inventoryOverride] = useState<Story | null>(() => takeTelegramInventory(worldId));
  const [result, setResult] = useState<JoinResult | "loading" | "error">(
    valid ? "loading" : { ok: false, error: "not_found" },
  );
  const [remoteInv, setRemoteInv] = useState<Story | null>(null);
  const [joinProgress, setJoinProgress] = useState(0.05);

  useEffect(() => {
    if (!valid) return;
    let cancelled = false;
    const tg = getTelegramSaveId();
    setJoinProgress(0.08);
    void (async () => {
      try {
        if (tg && !inventoryOverride) {
          setJoinProgress(0.18);
          const snap = await loadWorldFromServer(tg);
          if (!cancelled && snap.ok && !snap.empty && snap.world_id === worldId) {
            setRemoteInv(snap.inventory);
          }
        }
        setJoinProgress(0.32);
        const r = await joinWorld({ data: { worldId, playerId } });
        if (cancelled) return;
        setJoinProgress(0.48);
        if (r.ok) {
          const meta = await getWorldMeta({ data: { worldId } }).catch(() => null);
          rememberWorld(worldId, r.isCreator ? "mine" : "visited", {
            name: meta && !("error" in meta) ? meta.name : undefined,
            slug: meta && !("error" in meta) ? meta.slug : undefined,
          });
        }
        setJoinProgress(0.55);
        setResult(r);
      } catch {
        if (!cancelled) setResult("error");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [worldId, playerId, valid, inventoryOverride]);

  if (result === "loading") {
    return <JoinSplash progress={joinProgress} />;
  }

  if (result === "error") {
    return (
      <ErrorScreen
        title="Connection lost"
        body="Сервер недоступен. Попробуйте ещё раз."
      />
    );
  }

  if (!result.ok) {
    if (result.error === "occupied" || result.error === "full") {
      return <FridayTakenScreen />;
    }
    if (result.error === "locked") {
      return (
        <ErrorScreen
          title="Остров закрыт"
          body="Хозяин закрыл остров. Новые гости не могут войти."
        />
      );
    }
    if (result.error === "banned") {
      return (
        <ErrorScreen
          title="Нет доступа"
          body="Хозяин выгнал вас с этого острова."
        />
      );
    }
    return (
      <ErrorScreen
        title="World not found"
        body="Такого мира нет. Проверьте ссылку или создайте новый."
      />
    );
  }

  return (
    <Suspense fallback={<JoinSplash progress={0.62} />}>
      <WorldStage
        worldId={worldId}
        seed={result.seed}
        edits={result.edits}
        cursor={result.cursor}
        generation={result.generation}
        isCreator={result.isCreator}
        playerId={playerId}
        inventoryOverride={inventoryOverride ?? remoteInv}
        guestBuildAllowed={result.guestPermissions?.buildAllowed ?? false}
        islandLocked={result.guestPermissions?.locked ?? false}
      />
    </Suspense>
  );
}

/** Invite arrived too late — Friday slot already claimed. */
function FridayTakenScreen() {
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const goMenu = () => {
    preferHomeMenu();
    void navigate({ to: "/" });
  };

  const createOwn = async () => {
    if (busy) return;
    if (countOwnedWorlds() >= MAX_WORLDS_PER_ACCOUNT) {
      setError(`Лимит: максимум ${MAX_WORLDS_PER_ACCOUNT} мира. Зайдите в меню.`);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      preferHomeMenu();
      const world = await createWorld({ data: { playerId: getPlayerId() } });
      rememberWorld(world.id, "mine", { name: world.name, slug: world.slug });
      await navigate({ to: "/world/$worldId", params: { worldId: world.id } });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "";
      setError(msg && msg.length < 160 ? msg : "Не удалось создать остров. Попробуйте из меню.");
      setBusy(false);
    }
  };

  return (
    <main className="peep-home relative h-dvh overflow-hidden bg-bg-deep text-fg-on-ink">
      <div id="game-wrapper" className="flex items-center justify-center px-6">
        <div className="w-full max-w-md rounded-pixel border-2 border-border-ink bg-surface-ink p-6">
          <h1 className="font-display text-2xl font-semibold tracking-wide">Пятница уже нашлась</h1>
          <p className="mt-3 text-sm leading-relaxed text-muted-on-ink">
            На этом острове уже заняты оба места Пятницы. Можно выйти в меню или создать свой остров.
          </p>
          {error ? <p className="mt-3 font-mono text-xs text-[#e04532]">{error}</p> : null}
          <div className="mt-6 flex flex-col gap-2">
            <Button
              className="w-full rounded-pixel font-mono uppercase tracking-wide"
              size="lg"
              disabled={busy}
              onClick={() => void createOwn()}
            >
              {busy ? "создаём…" : "создать свой остров"}
            </Button>
            <Button
              className="w-full rounded-pixel font-mono uppercase tracking-wide"
              variant="secondary"
              disabled={busy}
              onClick={goMenu}
            >
              в меню
            </Button>
          </div>
        </div>
      </div>
    </main>
  );
}

function ErrorScreen({ title, body }: { title: string; body: string }) {
  return (
    <main className="peep-home relative h-dvh overflow-hidden bg-bg text-fg">
      <div id="game-wrapper" className="flex items-center justify-center px-6">
        <div className="w-full max-w-md rounded-xl border border-border bg-surface p-6">
          <h1 className="font-display text-2xl font-semibold">{title}</h1>
          <p className="mt-2 text-sm leading-relaxed text-muted">{body}</p>
          <Button asChild className="mt-6 w-full" variant="ink">
            <Link
              to="/"
              onClick={() => {
                preferHomeMenu();
              }}
            >
              На главную
            </Link>
          </Button>
        </div>
      </div>
    </main>
  );
}
