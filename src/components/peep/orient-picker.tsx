import { writeOrient, type OrientMode } from "@/lib/peep/settings";
import { cn } from "@/lib/utils";

export function OrientPicker({
  value,
  onChange,
  tone = "light",
}: {
  value: OrientMode;
  onChange: (mode: OrientMode) => void;
  tone?: "light" | "ink";
}) {
  const pick = (mode: OrientMode) => {
    writeOrient(mode);
    onChange(mode);
  };
  const ink = tone === "ink";
  return (
    <div>
      <p className={cn("font-mono text-xs uppercase tracking-widest", ink ? "text-muted-on-ink" : "text-muted")}>
        ориентация
      </p>
      <p className={cn("mt-1 text-sm leading-relaxed", ink ? "text-muted-on-ink" : "text-muted")}>
        Только для телефона. На компьютере мир всегда на весь экран.
      </p>
      <div className="mt-3 grid grid-cols-2 gap-2">
        <button
          type="button"
          onClick={() => pick("portrait")}
          className={cn(
            "min-h-12 rounded-pixel border-2 px-3 font-mono text-xs uppercase tracking-wide",
            value === "portrait"
              ? "border-primary bg-primary text-primary-fg"
              : ink
                ? "border-border-ink bg-bg-deep/40 text-fg-on-ink"
                : "border-border bg-surface text-fg",
          )}
        >
          книжная
        </button>
        <button
          type="button"
          onClick={() => pick("landscape")}
          className={cn(
            "min-h-12 rounded-pixel border-2 px-3 font-mono text-xs uppercase tracking-wide",
            value === "landscape"
              ? "border-primary bg-primary text-primary-fg"
              : ink
                ? "border-border-ink bg-bg-deep/40 text-fg-on-ink"
                : "border-border bg-surface text-fg",
          )}
        >
          альбомная
        </button>
      </div>
    </div>
  );
}
