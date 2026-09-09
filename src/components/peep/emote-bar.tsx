import { Hand, Heart, Smile } from "lucide-react";
import type { EmoteKind } from "@/lib/peep/types";
import { cn } from "@/lib/utils";

const EMOTES: { kind: EmoteKind; label: string; Icon: typeof Hand }[] = [
  { kind: "wave", label: "Помахать", Icon: Hand },
  { kind: "hearts", label: "Сердца", Icon: Heart },
  { kind: "laugh", label: "Смех", Icon: Smile },
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
        "pointer-events-auto flex gap-2",
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
            "flex size-11 items-center justify-center rounded-full",
            "border border-white/25 bg-black/45 text-white",
            "active:scale-95 active:bg-black/55",
          )}
        >
          <Icon className="size-5" strokeWidth={2.2} />
        </button>
      ))}
    </div>
  );
}
