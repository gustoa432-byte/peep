import { useEffect, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { ItemEditor } from "@/lib/peep/item-editor";
import { ITEM_KINDS, ITEM_LABELS, parseItemVoxels, type ItemKind } from "@/lib/peep/item-voxels";
import { cn } from "@/lib/utils";

function swatch(kind: ItemKind): string {
  const map: Record<ItemKind, string> = {
    wood: "var(--color-forge-wood)",
    metal: "var(--color-forge-metal)",
    accent: "var(--color-forge-terra)",
    gold: "var(--color-forge-gold)",
    cloth: "var(--color-forge-cloth)",
  };
  return map[kind];
}

export function ItemForge() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const editorRef = useRef<ItemEditor | null>(null);
  const gripRef = useRef<HTMLDivElement>(null);
  const [kind, setKind] = useState<ItemKind>("wood");
  const [erase, setErase] = useState(false);
  const [copied, setCopied] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [count, setCount] = useState(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const editor = new ItemEditor(canvas);
    editor.onChange = () => setCount(editor.voxelsList().length);
    setCount(editor.voxelsList().length);
    editorRef.current = editor;

    let frame = 0;
    const follow = () => {
      const tag = gripRef.current;
      if (tag) {
        const p = editor.projectGrip();
        tag.style.left = `${p.x}px`;
        tag.style.top = `${p.y}px`;
        tag.style.opacity = p.visible ? "1" : "0";
      }
      frame = requestAnimationFrame(follow);
    };
    frame = requestAnimationFrame(follow);

    return () => {
      cancelAnimationFrame(frame);
      editor.dispose();
      editorRef.current = null;
    };
  }, []);

  const pickKind = (next: ItemKind) => {
    setKind(next);
    setErase(false);
    editorRef.current?.setKind(next);
    editorRef.current?.setErase(false);
  };

  const toggleErase = (on: boolean) => {
    setErase(on);
    editorRef.current?.setErase(on);
  };

  const copyJson = async () => {
    const editor = editorRef.current;
    if (!editor) return;
    const json = editor.toJSON();
    editor.persist();
    try {
      if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(json);
      else throw new Error("clipboard");
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      const ta = document.createElement("textarea");
      ta.value = json;
      ta.setAttribute("readonly", "");
      ta.style.position = "fixed";
      ta.style.left = "-9999px";
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand("copy");
      ta.remove();
      setCopied(ok);
      if (ok) window.setTimeout(() => setCopied(false), 1600);
    }
  };

  const pasteJson = async () => {
    const editor = editorRef.current;
    if (!editor) return;
    let seed = "";
    try {
      if (navigator.clipboard?.readText) seed = (await navigator.clipboard.readText()).trim();
    } catch {
      seed = "";
    }
    const raw = window.prompt("Вставьте JSON предмета", seed.startsWith("[") ? seed : "");
    if (raw == null) return;
    const text = raw.trim();
    if (!text) return;
    try {
      const voxels = parseItemVoxels(text);
      editor.load(voxels);
      setLoaded(true);
      window.setTimeout(() => setLoaded(false), 1600);
    } catch {
      window.alert("Не получилось прочитать JSON");
    }
  };

  const clearAll = () => {
    const editor = editorRef.current;
    if (!editor) return;
    if (!window.confirm("Точно удалить всё?")) return;
    editor.clear();
  };

  return (
    <div className="fixed inset-0 bg-bg-deep font-mono text-fg-on-ink">
      <canvas ref={canvasRef} className="absolute inset-0 size-full touch-none" />
      <div
        ref={gripRef}
        className="peep-grip-tag pointer-events-none absolute z-10"
        style={{ left: "50%", top: "50%", opacity: 0 }}
      >
        Точка хвата
      </div>

      <header className="pointer-events-none absolute inset-x-0 top-0 z-20 flex items-start justify-between gap-3 p-4">
        <div className="pointer-events-auto">
          <p className="font-mono text-xs font-medium uppercase tracking-widest text-muted-on-ink">кузница</p>
          <p className="mt-1 max-w-xs text-sm leading-snug text-fg-on-ink/80">
            лкм — поставить · пкм — стереть · крути сцену мышью
          </p>
        </div>
        <div className="pointer-events-auto flex max-w-[min(100%,22rem)] flex-col items-end gap-2 sm:max-w-none sm:flex-row sm:flex-wrap">
          <Button asChild variant="ink" className="min-h-11 border-2 border-fg-on-ink/20">
            <Link to="/">назад в меню</Link>
          </Button>
          <Button variant="default" className="min-h-11" onClick={() => void copyJson()}>
            {copied ? "скопировано" : "Copy to JSON"}
          </Button>
          <Button variant="ink" className="min-h-11 border-2 border-fg-on-ink/20" onClick={() => void pasteJson()}>
            {loaded ? "загружено" : "Загрузить JSON"}
          </Button>
        </div>
      </header>

      <footer className="pointer-events-none absolute inset-x-0 bottom-0 z-20 p-4">
        <div className="pointer-events-auto mx-auto flex w-full max-w-3xl flex-col gap-3 rounded-pixel border-2 border-fg-on-ink/20 bg-surface-ink/90 p-3">
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => toggleErase(false)}
              className={cn(
                "min-h-11 rounded-pixel border-2 px-3 font-mono text-sm tracking-wide",
                !erase ? "border-primary bg-primary text-primary-fg" : "border-fg-on-ink/25 text-fg-on-ink",
              )}
            >
              ставить
            </button>
            <button
              type="button"
              onClick={() => toggleErase(true)}
              className={cn(
                "min-h-11 rounded-pixel border-2 px-3 font-mono text-sm tracking-wide",
                erase ? "border-primary bg-primary text-primary-fg" : "border-fg-on-ink/25 text-fg-on-ink",
              )}
            >
              стереть
            </button>
            <button
              type="button"
              onClick={clearAll}
              className="min-h-11 rounded-pixel border-2 border-danger/70 px-3 font-mono text-sm tracking-wide text-fg-on-ink"
            >
              Очистить всё
            </button>
            <span className="ml-auto font-mono text-xs uppercase tracking-widest text-muted-on-ink">
              {count} кл.
            </span>
          </div>
          <div className="flex flex-wrap gap-2">
            {ITEM_KINDS.map((id) => (
              <button
                key={id}
                type="button"
                aria-label={ITEM_LABELS[id]}
                aria-pressed={kind === id && !erase}
                onClick={() => pickKind(id)}
                className={cn(
                  "flex min-h-11 min-w-11 items-center gap-2 rounded-pixel border-2 px-2 text-xs tracking-wide",
                  kind === id && !erase ? "border-fg-on-ink bg-fg-on-ink/10" : "border-fg-on-ink/20",
                )}
              >
                <span className="size-6 rounded-pixel border border-fg-on-ink/30" style={{ background: swatch(id) }} />
                <span className="hidden sm:inline">{ITEM_LABELS[id]}</span>
              </button>
            ))}
          </div>
        </div>
      </footer>
    </div>
  );
}
