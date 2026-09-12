import { lazy, Suspense, useEffect, useState } from "react";
import { Link, createFileRoute } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { WORLD_ID_RE } from "@/lib/peep/constants";
import { loadWorldFromServer } from "@/lib/peep/lazy-save";
import { getPlayerId, getTelegramSaveId } from "@/lib/peep/player-id";
import type { Story } from "@/lib/peep/progress";
import { rememberWorld } from "@/lib/peep/remember-world";
import { initTelegramWebApp } from "@/lib/peep/telegram";
import { takeTelegramInventory } from "@/lib/peep/tg-boot-cache";
import type { JoinResult } from "@/lib/peep/types";
import { joinWorld } from "@/lib/peep/world.functions";

const WorldStage = lazy(async () => {
  const m = await import("@/components/peep/world-stage");
  return { default: m.WorldStage };
});

export const Route = createFileRoute("/world/$worldId")({
  ssr: false,
  component: WorldPage,
});

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

  useEffect(() => {
    if (!valid) return;
    let cancelled = false;
    const tg = getTelegramSaveId();
    void (async () => {
      try {
        if (tg && !inventoryOverride) {
          const snap = await loadWorldFromServer(tg);
          if (!cancelled && snap.ok && !snap.empty && snap.world_id === worldId) {
            setRemoteInv(snap.inventory);
          }
        }
        const r = await joinWorld({ data: { worldId, playerId } });
        if (cancelled) return;
        if (r.ok) rememberWorld(worldId, r.isCreator ? "mine" : "visited");
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
    return (
      <main className="flex min-h-dvh items-center justify-center bg-bg-deep text-fg-on-ink">
        <p className="font-display text-xl">Загружаем мир…</p>
      </main>
    );
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
    if (result.error === "full") {
      return (
        <ErrorScreen
          title="World is full"
          body="В этом мире уже двое. Попросите новую ссылку или создайте свой мир."
        />
      );
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
    <Suspense
      fallback={
        <main className="flex min-h-dvh items-center justify-center bg-bg-deep text-fg-on-ink">
          <p className="font-display text-xl">Загружаем мир…</p>
        </main>
      }
    >
      <WorldStage
        worldId={worldId}
        seed={result.seed}
        edits={result.edits}
        cursor={result.cursor}
        generation={result.generation}
        isCreator={result.isCreator}
        playerId={playerId}
        inventoryOverride={inventoryOverride ?? remoteInv}
        guestBuildAllowed={result.guestPermissions.buildAllowed}
        islandLocked={result.guestPermissions.locked}
      />
    </Suspense>
  );
}

function ErrorScreen({ title, body }: { title: string; body: string }) {
  return (
    <main className="flex min-h-dvh items-center justify-center bg-bg px-6 text-fg">
      <div className="w-full max-w-md rounded-xl border border-border bg-surface p-6">
        <h1 className="font-display text-2xl font-semibold">{title}</h1>
        <p className="mt-2 text-sm leading-relaxed text-muted">{body}</p>
        <Button asChild className="mt-6 w-full" variant="ink">
          <Link to="/">На главную</Link>
        </Button>
      </div>
    </main>
  );
}
