import { useEffect, useState } from "react";
import { Link, createFileRoute, useNavigate } from "@tanstack/react-router";
import { IconClose, IconGear, IconPhone, IconSend, IconTrash } from "@/components/peep/peep-icons";
import { OrientPicker } from "@/components/peep/orient-picker";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { getPlayerId, parseWorldId } from "@/lib/peep/player-id";
import {
  dismissInstallNudge,
  forgetWorld,
  listSavedWorlds,
  shouldShowInstallNudge,
  type SavedWorld,
} from "@/lib/peep/remember-world";
import { useInstallPrompt } from "@/lib/peep/install";
import { readOrient, usePhoneUi, type OrientMode } from "@/lib/peep/settings";
import { createWorld, deleteWorld } from "@/lib/peep/world.functions";

export const Route = createFileRoute("/")({ component: Home });

function Home() {
  const navigate = useNavigate();
  const [join, setJoin] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [worlds, setWorlds] = useState<SavedWorld[]>([]);
  const [nudge, setNudge] = useState(false);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [removing, setRemoving] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [orient, setOrient] = useState<OrientMode>(readOrient);
  const phone = usePhoneUi();
  const install = useInstallPrompt();

  useEffect(() => {
    setWorlds(listSavedWorlds());
    setNudge(shouldShowInstallNudge());
  }, []);

  const onCreate = async () => {
    setBusy(true);
    setError(null);
    try {
      const world = await createWorld({ data: { playerId: getPlayerId() } });
      await navigate({ to: "/world/$worldId", params: { worldId: world.id } });
    } catch {
      setError("Не удалось создать мир. Попробуйте ещё раз.");
      setBusy(false);
    }
  };

  const onJoin = async (e: React.FormEvent) => {
    e.preventDefault();
    const id = parseWorldId(join);
    if (!id) {
      setError("Вставьте ссылку или код мира из шести знаков.");
      return;
    }
    await navigate({ to: "/world/$worldId", params: { worldId: id } });
  };

  const hideNudge = () => {
    dismissInstallNudge();
    setNudge(false);
  };

  const onRemove = async (world: SavedWorld) => {
    setRemoving(true);
    setError(null);
    try {
      if (world.role === "mine") {
        const r = await deleteWorld({ data: { worldId: world.id, playerId: getPlayerId() } });
        if (!r.ok) {
          setError("Не удалось удалить мир. Он уже чужой или его нет.");
          setRemoving(false);
          return;
        }
      }
      forgetWorld(world.id);
      setWorlds(listSavedWorlds());
      setConfirmId(null);
    } catch {
      setError("Не удалось удалить мир. Попробуйте ещё раз.");
    }
    setRemoving(false);
  };

  return (
    <main className="relative min-h-dvh overflow-hidden bg-bg text-fg">
      {phone ? (
        <button
          type="button"
          aria-label="Настройки"
          className="absolute right-5 top-5 z-20 flex size-11 items-center justify-center rounded-pixel border-2 border-border bg-surface text-fg shadow-[var(--shadow-panel)]"
          onClick={() => setSettingsOpen(true)}
        >
          <IconGear className="size-5" />
        </button>
      ) : null}
      <div className="pointer-events-none absolute inset-0 opacity-70" aria-hidden>
        <div className="pointer-events-none absolute -left-16 top-24 size-40 rotate-12 bg-sage/20" />
        <div className="pointer-events-none absolute left-16 top-40 size-24 bg-primary/20" />
        <div className="pointer-events-none absolute right-[12%] top-28 size-28 -rotate-6 bg-block-sand/35" />
        <div className="pointer-events-none absolute right-[18%] top-52 size-16 bg-block-dirt/30" />
        <div className="pointer-events-none absolute bottom-24 left-[18%] size-20 rotate-6 bg-block-stone/25" />
      </div>

      <div className="relative mx-auto flex min-h-dvh w-full max-w-xl flex-col px-6 py-16">
        <div className="flex flex-1 flex-col justify-center">
        <p className="font-mono text-xs font-medium uppercase tracking-widest text-muted">voxel · together</p>
        <h1 className="mt-3 font-display text-6xl font-semibold leading-none tracking-tight md:text-7xl">
          Peep
        </h1>
        <p className="mt-5 max-w-md text-lg leading-snug text-muted">
          Альтернативная история великой стройки.
        </p>
        <p className="mt-3 max-w-md text-sm leading-relaxed text-muted">
          Один маленький мир. Два человека. Несколько блоков. Одна ссылка.
        </p>

        <div className="mt-10 flex flex-col gap-3 sm:flex-row">
          <Button size="lg" className="min-h-12 flex-1" onClick={() => void onCreate()} disabled={busy}>
            {busy ? "создаём…" : "создать мир"}
          </Button>
        </div>

        <form onSubmit={(e) => void onJoin(e)} className="mt-8">
          <p className="mb-2 font-mono text-xs font-medium uppercase tracking-widest text-muted">войти в мир</p>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Input
              value={join}
              onChange={(ev) => setJoin(ev.target.value)}
              placeholder="код или ссылка"
              aria-label="Код мира"
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
              className="font-mono"
            />
            <Button type="submit" variant="ink" className="sm:w-36">
              войти
            </Button>
          </div>
        </form>

        {worlds.length > 0 ? (
          <section className="mt-8">
            <p className="mb-2 font-mono text-xs font-medium uppercase tracking-widest text-muted">мои миры</p>
            <ul className="flex flex-col gap-2">
              {worlds.map((w) => (
                <li key={w.id} className="rounded-pixel border-2 border-border bg-surface shadow-[var(--shadow-panel)]">
                  {confirmId === w.id ? (
                    <div className="flex flex-col gap-3 p-3 sm:flex-row sm:items-center">
                      <p className="min-w-0 flex-1 text-sm leading-snug text-fg">
                        {w.role === "mine"
                          ? `Удалить ${w.id}? Ссылка перестанет открываться.`
                          : `Убрать ${w.id} из списка?`}
                      </p>
                      <div className="flex gap-2">
                        <Button
                          type="button"
                          variant="secondary"
                          className="flex-1 sm:flex-none"
                          disabled={removing}
                          onClick={() => setConfirmId(null)}
                        >
                          Отмена
                        </Button>
                        <Button
                          type="button"
                          className="flex-1 bg-danger text-primary-fg sm:flex-none"
                          disabled={removing}
                          onClick={() => void onRemove(w)}
                        >
                          {removing ? "Удаляем…" : "Удалить"}
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex items-stretch">
                      <Link
                        to="/world/$worldId"
                        params={{ worldId: w.id }}
                        className="flex min-h-12 min-w-0 flex-1 items-center justify-between px-4 text-fg active:scale-[0.99]"
                      >
                        <span className="font-mono text-base tracking-wider">{w.id}</span>
                        <span className="text-xs text-muted">{w.role === "mine" ? "мой" : "гость"}</span>
                      </Link>
                      <button
                        type="button"
                        aria-label={`Удалить ${w.id}`}
                        onClick={() => setConfirmId(w.id)}
                        className="flex size-12 shrink-0 items-center justify-center text-muted hover:text-danger"
                      >
                        <IconTrash className="size-4" />
                      </button>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        {nudge && !install.installed ? (
          <aside className="mt-8 flex items-start gap-3 rounded-pixel border-2 border-border bg-surface p-4 shadow-[var(--shadow-panel)]">
            <IconPhone className="mt-0.5 size-5 shrink-0 text-primary" />
            <div className="min-w-0 flex-1">
              <p className="font-display text-base font-semibold leading-tight">Добавить Peep на главный экран</p>
              <p className="mt-1 text-sm leading-relaxed text-muted">
                Откроется как приложение: без строки браузера, ссылку искать не нужно.
              </p>
              <button
                type="button"
                onClick={() => void install.addToHome()}
                className="mt-3 inline-flex min-h-11 items-center font-mono text-sm uppercase tracking-wide text-primary"
              >
                {install.canNative ? "добавить" : "как поставить"}
              </button>
            </div>
            <button
              type="button"
              onClick={hideNudge}
              aria-label="Закрыть"
              className="flex size-11 shrink-0 items-center justify-center rounded-pixel text-muted"
            >
              <IconClose className="size-4" />
            </button>
          </aside>
        ) : null}

        {error ? <p className="mt-4 text-sm text-danger">{error}</p> : null}

        <ul className="mt-14 grid grid-cols-6 gap-2" aria-hidden>
          {[
            ["bg-block-grass", "Grass"],
            ["bg-block-dirt", "Dirt"],
            ["bg-block-stone", "Stone"],
            ["bg-block-wood", "Wood"],
            ["bg-block-sand", "Sand"],
            ["bg-block-leaf", "Leaves"],
          ].map(([color, name]) => (
            <li key={name} className="flex flex-col items-center gap-2">
              <span className={`size-10 rounded-sm border border-border shadow-panel ${color}`} />
              <span className="text-xs text-muted">{name}</span>
            </li>
          ))}
        </ul>
        </div>

        <footer className="mt-14 border-t border-border pt-5 pb-10">
          <p className="mb-2 font-mono text-xs font-medium uppercase tracking-widest text-muted">контакты</p>
          <a
            href="https://t.me/peep_gm"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex min-h-11 items-center gap-2 font-mono text-sm uppercase tracking-wide text-fg hover:text-primary"
          >
            <IconSend className="size-4" />
            Telegram
          </a>
          {phone && !install.installed ? (
            <button
              type="button"
              onClick={() => void install.addToHome()}
              className="mt-3 flex min-h-11 items-center font-mono text-xs uppercase tracking-wide text-muted hover:text-primary"
            >
              Добавить Peep на главный экран
            </button>
          ) : null}
        </footer>
      </div>

      {settingsOpen ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-fg/40 px-6"
          onClick={() => setSettingsOpen(false)}
        >
          <div
            className="w-[min(380px,100%)] rounded-pixel border-2 border-border bg-surface p-5 text-fg shadow-[var(--shadow-panel)]"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between gap-3">
              <p className="font-mono text-sm uppercase tracking-widest">настройки</p>
              <button
                type="button"
                aria-label="Закрыть"
                className="flex size-11 items-center justify-center text-muted"
                onClick={() => setSettingsOpen(false)}
              >
                <IconClose className="size-4" />
              </button>
            </div>
            <div className="mt-5">
              <OrientPicker value={orient} onChange={setOrient} />
            </div>
          </div>
        </div>
      ) : null}
    </main>
  );
}
