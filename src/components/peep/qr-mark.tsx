import { encode } from "uqr";
import { cn } from "@/lib/utils";

export function QrMark({ value, className }: { value: string; className?: string }) {
  const { data, size } = encode(value, { ecc: "M", border: 2 });
  return (
    <svg
      viewBox={`0 0 ${size} ${size}`}
      className={cn("size-full bg-surface text-bg-deep", className)}
      shapeRendering="crispEdges"
      aria-label="QR-код мира"
    >
      {data.flatMap((row, y) =>
        row.map((on, x) =>
          on ? <rect key={`${x}-${y}`} x={x} y={y} width={1} height={1} fill="currentColor" /> : null,
        ),
      )}
    </svg>
  );
}
