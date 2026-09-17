import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import type { ArmHoldPose, PickaxeGrip, ToolPoseExport } from "@/lib/peep/game";
import { cn } from "@/lib/utils";

type Tab = "pickaxe" | "arm";

const PICK_FIELDS: { key: keyof PickaxeGrip; label: string; min: number; max: number; step: number }[] = [
  { key: "x", label: "pos X", min: -0.5, max: 0.5, step: 0.005 },
  { key: "y", label: "pos Y", min: -0.5, max: 0.5, step: 0.005 },
  { key: "z", label: "pos Z", min: -0.5, max: 0.5, step: 0.005 },
  { key: "rx", label: "rot X", min: -3.2, max: 3.2, step: 0.01 },
  { key: "ry", label: "rot Y", min: -3.2, max: 3.2, step: 0.01 },
  { key: "rz", label: "rot Z", min: -3.2, max: 3.2, step: 0.01 },
  { key: "scale", label: "scale", min: 0.2, max: 1.5, step: 0.01 },
];

const ARM_FIELDS: { key: keyof ArmHoldPose; label: string; min: number; max: number; step: number }[] = [
  { key: "rx", label: "rot X", min: -1.5, max: 2.5, step: 0.01 },
  { key: "ry", label: "rot Y", min: -1.5, max: 1.5, step: 0.01 },
  { key: "rz", label: "rot Z", min: -1.5, max: 1.5, step: 0.01 },
];

export function PickaxeGripPanel({
  pose,
  onChange,
  onClose,
}: {
  pose: ToolPoseExport;
  onChange: (next: ToolPoseExport) => void;
  onClose: () => void;
}) {
  const [tab, setTab] = useState<Tab>("pickaxe");
  const [copied, setCopied] = useState(false);
  const json = useMemo(() => JSON.stringify(pose, null, 2), [pose]);

  useEffect(() => {
    if (!copied) return;
    const t = window.setTimeout(() => setCopied(false), 1500);
    return () => window.clearTimeout(t);
  }, [copied]);

  const download = () => {
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "tool-pose.json";
    a.click();
    URL.revokeObjectURL(url);
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(json);
      setCopied(true);
    } catch {
      /* ignore */
    }
  };

  return (
    <div
      className={cn(
        "pointer-events-auto absolute bottom-3 left-3 z-40 flex w-[min(360px,calc(100%-1.5rem))] flex-col gap-2",
        "rounded-pixel border-2 border-border-ink bg-surface-ink/95 p-3 text-fg-on-ink shadow-lg backdrop-blur-sm",
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <p className="font-mono text-[11px] uppercase tracking-widest">tool pose</p>
        <button
          type="button"
          className="font-mono text-[10px] uppercase text-muted-on-ink hover:text-fg-on-ink"
          onClick={onClose}
        >
          закрыть
        </button>
      </div>

      <div className="flex gap-1">
        <button
          type="button"
          className={cn(
            "flex-1 rounded-pixel px-2 py-1.5 font-mono text-[10px] uppercase",
            tab === "pickaxe" ? "bg-primary text-primary-fg" : "bg-bg-deep text-muted-on-ink",
          )}
          onClick={() => setTab("pickaxe")}
        >
          кирка
        </button>
        <button
          type="button"
          className={cn(
            "flex-1 rounded-pixel px-2 py-1.5 font-mono text-[10px] uppercase",
            tab === "arm" ? "bg-primary text-primary-fg" : "bg-bg-deep text-muted-on-ink",
          )}
          onClick={() => setTab("arm")}
        >
          рука
        </button>
      </div>

      <div className="flex max-h-[38vh] flex-col gap-2 overflow-y-auto pr-1">
        {tab === "pickaxe"
          ? PICK_FIELDS.map((f) => (
              <label key={f.key} className="grid grid-cols-[64px_1fr_52px] items-center gap-2">
                <span className="font-mono text-[10px] uppercase text-muted-on-ink">{f.label}</span>
                <input
                  type="range"
                  min={f.min}
                  max={f.max}
                  step={f.step}
                  value={pose.pickaxe[f.key]}
                  onChange={(e) =>
                    onChange({
                      ...pose,
                      pickaxe: { ...pose.pickaxe, [f.key]: Number(e.target.value) },
                    })
                  }
                  className="w-full accent-primary"
                />
                <input
                  type="number"
                  min={f.min}
                  max={f.max}
                  step={f.step}
                  value={Number(pose.pickaxe[f.key].toFixed(3))}
                  onChange={(e) => {
                    const n = Number(e.target.value);
                    if (!Number.isFinite(n)) return;
                    onChange({
                      ...pose,
                      pickaxe: { ...pose.pickaxe, [f.key]: n },
                    });
                  }}
                  className="h-7 w-full rounded-pixel border border-border-ink bg-bg-deep px-1 font-mono text-[10px] text-fg-on-ink"
                />
              </label>
            ))
          : ARM_FIELDS.map((f) => (
              <label key={f.key} className="grid grid-cols-[64px_1fr_52px] items-center gap-2">
                <span className="font-mono text-[10px] uppercase text-muted-on-ink">{f.label}</span>
                <input
                  type="range"
                  min={f.min}
                  max={f.max}
                  step={f.step}
                  value={pose.arm[f.key]}
                  onChange={(e) =>
                    onChange({
                      ...pose,
                      arm: { ...pose.arm, [f.key]: Number(e.target.value) },
                    })
                  }
                  className="w-full accent-primary"
                />
                <input
                  type="number"
                  min={f.min}
                  max={f.max}
                  step={f.step}
                  value={Number(pose.arm[f.key].toFixed(3))}
                  onChange={(e) => {
                    const n = Number(e.target.value);
                    if (!Number.isFinite(n)) return;
                    onChange({
                      ...pose,
                      arm: { ...pose.arm, [f.key]: n },
                    });
                  }}
                  className="h-7 w-full rounded-pixel border border-border-ink bg-bg-deep px-1 font-mono text-[10px] text-fg-on-ink"
                />
              </label>
            ))}
      </div>

      <div className="border-t border-border-ink/60 pt-2">
        <p className="mb-1 font-mono text-[10px] uppercase tracking-wide text-muted-on-ink">
          json · скинь мне этот файл
        </p>
        <textarea
          readOnly
          value={json}
          rows={9}
          className="w-full resize-none rounded-pixel border border-border-ink bg-bg-deep p-2 font-mono text-[10px] leading-snug text-fg-on-ink"
          onFocus={(e) => e.target.select()}
        />
        <div className="mt-2 flex gap-2">
          <Button type="button" size="sm" className="flex-1 rounded-pixel font-mono uppercase" onClick={() => void copy()}>
            {copied ? "скопировано" : "копировать"}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="secondary"
            className="flex-1 rounded-pixel font-mono uppercase"
            onClick={download}
          >
            скачать .json
          </Button>
        </div>
      </div>
    </div>
  );
}
