import { useEffect, useState } from "react";
import {
  formatKeyCode,
  KEYBIND_ACTIONS,
  KEYBIND_LABELS,
  DEFAULT_KEYBINDS,
  patchKeybind,
  readKeybinds,
  writeKeybinds,
  type KeybindAction,
  type Keybinds,
} from "@/lib/peep/keybinds";
import { cn } from "@/lib/utils";

/**
 * Desktop build keybinds editor.
 * Controlled when `binds` is passed — parent owns draft + Save to server.
 * Uncontrolled (in-game): writes localStorage immediately.
 */
export function KeyboardBindsPanel({
  binds: controlled,
  onChange,
  compact = false,
}: {
  binds?: Keybinds;
  onChange?: (binds: Keybinds) => void;
  compact?: boolean;
}) {
  const [local, setLocal] = useState<Keybinds>(() => readKeybinds());
  const binds = controlled ?? local;
  const [listening, setListening] = useState<KeybindAction | null>(null);

  useEffect(() => {
    if (!listening) return;
    const finish = (code: string) => {
      if (code === "Escape") {
        setListening(null);
        return;
      }
      const next = patchKeybind(binds, listening, code);
      if (!controlled) {
        writeKeybinds(next);
        setLocal(next);
      }
      onChange?.(next);
      setListening(null);
    };
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      finish(e.code);
    };
    const onPtr = (e: PointerEvent) => {
      if (e.pointerType === "touch") return;
      if (e.button > 2) return;
      e.preventDefault();
      e.stopPropagation();
      finish(`Mouse${e.button}`);
    };
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("pointerdown", onPtr, true);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("pointerdown", onPtr, true);
    };
  }, [listening, binds, onChange, controlled]);

  const resetDraft = () => {
    const next = { ...DEFAULT_KEYBINDS };
    if (!controlled) {
      writeKeybinds(next);
      setLocal(next);
    }
    setListening(null);
    onChange?.(next);
  };

  return (
    <div className={cn("flex flex-col", compact ? "gap-1.5" : "gap-3")}>
      {!compact ? (
        <p className="text-sm leading-relaxed text-muted-on-ink">
          Бинды стройки на компьютере. Нажми строку и задай клавишу или кнопку мыши. Esc — отмена.
        </p>
      ) : null}
      <div className={cn("flex flex-col", compact ? "gap-1" : "gap-1.5")}>
        {KEYBIND_ACTIONS.map((action) => {
          const active = listening === action;
          return (
            <button
              key={action}
              type="button"
              onClick={() => setListening(active ? null : action)}
              className={cn(
                "flex items-center justify-between gap-3 rounded-pixel border-2 px-3 font-mono text-xs uppercase tracking-wide",
                compact ? "min-h-9" : "min-h-11",
                active
                  ? "border-primary bg-primary/15 text-fg-on-ink"
                  : "border-border-ink text-fg-on-ink",
              )}
            >
              <span>{KEYBIND_LABELS[action]}</span>
              <span className={cn("tabular-nums", active ? "text-primary" : "text-muted-on-ink")}>
                {active ? "…" : formatKeyCode(binds[action])}
              </span>
            </button>
          );
        })}
      </div>
      {!compact ? (
        <>
          <p className="font-mono text-[10px] uppercase tracking-wide text-muted-on-ink">
            WASD / стрелки — ходьба · 1–5 — хотбар · E R T F C X V B — реакции
          </p>
          <button
            type="button"
            onClick={resetDraft}
            className="flex min-h-11 items-center justify-center rounded-pixel border-2 border-border-ink font-mono text-xs uppercase tracking-wide"
          >
            сбросить бинды
          </button>
        </>
      ) : (
        <button
          type="button"
          onClick={resetDraft}
          className="self-start font-mono text-[10px] uppercase tracking-wide text-muted-on-ink underline"
        >
          сбросить
        </button>
      )}
    </div>
  );
}
