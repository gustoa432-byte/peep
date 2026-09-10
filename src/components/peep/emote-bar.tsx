import { IconHeart, IconLaugh, IconWave } from "@/components/peep/peep-icons";
import type { EmoteKind } from "@/lib/peep/types";
import { cn } from "@/lib/utils";

const EMOTES: { kind: EmoteKind; label: string; Icon: typeof IconWave }[] = [
  { kind: "wave", label: "Помахать", Icon: IconWave },
  { kind: "hearts", label: "Сердца", Icon: IconHeart },
  { kind: "laugh", label: "Смех", Icon: IconLaugh },
];

export function EmoteBar({
  onEmote,
  layout,
}: {
  onEmote: (kind: EmoteKind) => void;
  layout: "column" | "row";
}) {
  return (
    <div
      className={cn(
        "pointer-events-auto flex gap-1",
        layout === "column" ? "flex-col items-center" : "flex-row items-center",
      )}
    >
      {EMOTES.map(({ kind, label, Icon }) => (
        <button
          key={kind}
          type="button"
          aria-label={label}
          onPointerDown={(e) => {
            e.preventDefault();
            onEmote(kind);
          }}
          className={cn(
            "flex size-10 items-center justify-center rounded-pixel sm:size-11",
            "border-2 border-fg-on-ink/30 bg-bg-deep/55 text-fg-on-ink",
            "active:scale-95 active:bg-bg-deep/70",
          )}
        >
          <Icon className="size-5" />
        </button>
      ))}
    </div>
  );
}
