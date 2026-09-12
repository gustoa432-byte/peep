import { useEffect, useRef, useState, type CSSProperties } from "react";
import { Link } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { ItemEditor } from "@/lib/peep/item-editor";
import { FORGE_TEMPLATES, templateById } from "@/lib/peep/item-templates";
import { FORGE_PALETTE_MAX, readForgePalette, rememberForgeColor } from "@/lib/peep/item-palette";
import {
  DEFAULT_PAINT,
  defaultTransform,
  isGoldHex,
  normalizeHex,
  parseItemDocument,
  type ItemTransform,
} from "@/lib/peep/item-voxels";
import { cn } from "@/lib/utils";

type Mode = "edit" | "fit";

const SLIDERS: {
  key: keyof Pick<ItemTransform, "scale"> | "px" | "py" | "pz" | "rx" | "ry" | "rz";
  label: string;
  min: number;
  max: number;
}[] = [
  { key: "px", label: "Position X", min: -2, max: 2 },
  { key: "py", label: "Position Y", min: -2, max: 2 },
  { key: "pz", label: "Position Z", min: -3, max: 0 },
  { key: "rx", label: "Rotation X", min: -Math.PI, max: Math.PI },
  { key: "ry", label: "Rotation Y", min: -Math.PI, max: Math.PI },
  { key: "rz", label: "Rotation Z", min: -Math.PI, max: Math.PI },
  { key: "scale", label: "Scale", min: 0.1, max: 3 },
];

function readSlider(t: ItemTransform, key: (typeof SLIDERS)[number]["key"]): number {
  if (key === "px") return t.position[0];
  if (key === "py") return t.position[1];
  if (key === "pz") return t.position[2];
  if (key === "rx") return t.rotation[0];
  if (key === "ry") return t.rotation[1];
  if (key === "rz") return t.rotation[2];
  return t.scale;
}

function writeSlider(t: ItemTransform, key: (typeof SLIDERS)[number]["key"], value: number): ItemTransform {
  const next: ItemTransform = {
    position: [...t.position],
    rotation: [...t.rotation],
    scale: t.scale,
  };
  if (key === "px") next.position[0] = value;
  else if (key === "py") next.position[1] = value;
  else if (key === "pz") next.position[2] = value;
  else if (key === "rx") next.rotation[0] = value;
  else if (key === "ry") next.rotation[1] = value;
  else if (key === "rz") next.rotation[2] = value;
  else next.scale = value;
  return next;
}

export function ItemForge() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const editorRef = useRef<ItemEditor | null>(null);
  const gripRef = useRef<HTMLDivElement>(null);
  const [color, setColor] = useState(DEFAULT_PAINT);
  const [erase, setErase] = useState(false);
  const [mode, setMode] = useState<Mode>("edit");
  const [copied, setCopied] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [count, setCount] = useState(0);
  const [transform, setTransform] = useState<ItemTransform>(defaultTransform);
  const [template, setTemplate] = useState("");
  const [palette, setPalette] = useState<string[]>(() => readForgePalette());

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const editor = new ItemEditor(canvas);
    editor.onChange = () => setCount(editor.voxelsList().length);
    setCount(editor.voxelsList().length);
    setTransform(editor.getTransform());
    setColor(editor.getColor());
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

  const pickColor = (next: string) => {
    const hex = normalizeHex(next) ?? DEFAULT_PAINT;
    setColor(hex);
    setPalette(rememberForgeColor(hex));
    setErase(false);
    editorRef.current?.setColor(hex);
    editorRef.current?.setErase(false);
  };

  const toggleErase = (on: boolean) => {
    setErase(on);
    editorRef.current?.setErase(on);
  };

  const switchMode = (next: Mode) => {
    setMode(next);
    editorRef.current?.setPreview(next === "fit");
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
    const raw = window.prompt("Вставьте JSON предмета", seed.startsWith("{") || seed.startsWith("[") ? seed : "");
    if (raw == null) return;
    const text = raw.trim();
    if (!text) return;
    try {
      const doc = parseItemDocument(text);
      editor.loadDocument(doc);
      setTransform(editor.getTransform());
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

  const applyTemplate = (id: string) => {
    setTemplate(id);
    const editor = editorRef.current;
    const voxels = templateById(id);
    if (!editor || !voxels) return;
    if (editor.voxelsList().length && !window.confirm("Заменить текущую модель шаблоном?")) {
      setTemplate("");
      return;
    }
    editor.load(voxels);
    const paint = normalizeHex(voxels[0]?.color) ?? DEFAULT_PAINT;
    pickColor(paint);
    setTemplate("");
  };

  const slide = (key: (typeof SLIDERS)[number]["key"], value: number) => {
    const editor = editorRef.current;
    if (!editor) return;
    const next = writeSlider(transform, key, value);
    setTransform(next);
    editor.setTransform(next);
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

      <header className="pointer-events-none absolute inset-x-0 top-0 z-20 flex items-start justify-between gap-3 p-3 sm:p-4">
        <div className="pointer-events-auto flex min-w-0 flex-col gap-2">
          <p className="font-mono text-xs font-medium uppercase tracking-widest text-muted-on-ink">кузница</p>
          <div className="flex rounded-pixel border-2 border-fg-on-ink/20">
            <button
              type="button"
              onClick={() => switchMode("edit")}
              className={cn(
                "min-h-11 px-3 text-sm tracking-wide",
                mode === "edit" ? "bg-primary text-primary-fg" : "text-fg-on-ink",
              )}
            >
              Редактор
            </button>
            <button
              type="button"
              onClick={() => switchMode("fit")}
              className={cn(
                "min-h-11 px-3 text-sm tracking-wide",
                mode === "fit" ? "bg-primary text-primary-fg" : "text-fg-on-ink",
              )}
            >
              Примерочная
            </button>
          </div>
          {mode === "edit" ? (
            <p className="max-w-xs text-sm leading-snug text-fg-on-ink/80">
              лкм — поставить · пкм — стереть · крути сцену мышью
            </p>
          ) : (
            <p className="max-w-xs text-sm leading-snug text-fg-on-ink/80">вид от первого лица · крути ползунки</p>
          )}
        </div>
        <div className="pointer-events-auto flex max-w-[min(100%,22rem)] flex-col items-end gap-2">
          <div className="flex flex-wrap justify-end gap-2">
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
          {mode === "edit" ? (
            <label className="flex min-h-11 items-center gap-2 border-2 border-fg-on-ink/20 bg-surface-ink/80 px-2 text-xs uppercase tracking-widest text-muted-on-ink">
              шаблон
              <select
                value={template}
                onChange={(e) => applyTemplate(e.target.value)}
                className="min-h-9 min-w-36 bg-transparent text-sm normal-case tracking-normal text-fg-on-ink"
              >
                <option value="">загрузить шаблон</option>
                {FORGE_TEMPLATES.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.label}
                  </option>
                ))}
              </select>
            </label>
          ) : (
            <Button variant="ink" className="min-h-11 border-2 border-fg-on-ink/20" onClick={() => editorRef.current?.playSwing()}>
              Play Animation
            </Button>
          )}
        </div>
      </header>

      <footer
        className={cn(
          "pointer-events-none absolute inset-x-0 bottom-0 z-20 p-3 sm:p-4",
          mode === "fit" && "right-auto w-full max-w-md",
        )}
      >
        <div
          className={cn(
            "pointer-events-auto flex w-full flex-col gap-3 rounded-pixel border-2 border-fg-on-ink/20 bg-surface-ink/90 p-3",
            mode === "edit" ? "mx-auto max-w-3xl" : "max-w-md",
          )}
        >
          {mode === "edit" ? (
            <>
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
              <div className="flex items-start gap-2">
                <label className="flex min-h-11 shrink-0 items-center gap-2 border-2 border-fg-on-ink/20 px-2">
                  <input
                    type="color"
                    value={color}
                    aria-label="свой цвет"
                    onChange={(e) => pickColor(e.target.value)}
                    className="peep-color-input"
                  />
                  <span className="hidden font-mono text-xs uppercase tracking-widest text-muted-on-ink sm:inline">
                    {color}
                  </span>
                </label>
                <div className="min-w-0 flex-1">
                  <p className="mb-1 font-mono text-xs uppercase tracking-widest text-muted-on-ink">
                    палитра · {palette.length}/{FORGE_PALETTE_MAX}
                  </p>
                  <div className="flex max-h-28 flex-wrap content-start gap-1.5 overflow-y-auto">
                    {palette.map((hex) => (
                      <button
                        key={hex}
                        type="button"
                        aria-label={hex}
                        aria-pressed={color === hex && !erase}
                        onClick={() => pickColor(hex)}
                        className={cn(
                          "size-8 rounded-pixel border-2 sm:size-9",
                          color === hex && !erase ? "border-fg-on-ink" : "border-fg-on-ink/20",
                        )}
                      >
                        <span
                          className={cn(
                            "peep-swatch-chip block size-full rounded-pixel border border-fg-on-ink/35",
                            isGoldHex(hex) && "peep-gold-swatch",
                          )}
                          style={
                            isGoldHex(hex)
                              ? undefined
                              : ({ "--swatch": hex } as CSSProperties)
                          }
                        />
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </>
          ) : (
            <div className="grid gap-2 sm:grid-cols-2">
              {SLIDERS.map((row) => {
                const value = readSlider(transform, row.key);
                return (
                  <label key={row.key} className="flex items-center gap-2 text-xs uppercase tracking-widest text-muted-on-ink">
                    <span className="w-24 shrink-0">{row.label}</span>
                    <input
                      type="range"
                      min={row.min}
                      max={row.max}
                      step={0.01}
                      value={value}
                      onChange={(e) => slide(row.key, Number(e.target.value))}
                      className="peep-forge-slider min-h-11 flex-1"
                    />
                    <span className="w-12 text-right text-fg-on-ink">{value.toFixed(2)}</span>
                  </label>
                );
              })}
            </div>
          )}
        </div>
      </footer>
    </div>
  );
}
