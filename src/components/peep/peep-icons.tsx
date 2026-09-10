import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

function Pixel({
  className,
  children,
  label,
}: {
  className?: string;
  children: ReactNode;
  label?: string;
}) {
  return (
    <svg
      viewBox="0 0 16 16"
      className={cn("size-4 shrink-0", className)}
      shapeRendering="crispEdges"
      aria-hidden={!label}
      aria-label={label}
    >
      {children}
    </svg>
  );
}

function Dots({ cells }: { cells: string }) {
  return <path fill="currentColor" d={cells} />;
}

export function IconJump({ className }: { className?: string }) {
  return (
    <Pixel className={className}>
      <Dots cells="M7 1h2v2H7V1zM6 3h4v1H6V3zM5 4h6v3H9v1H7V7H5V4zM3 5h2v2H3V5zm8 0h2v2h-2V5zM5 8h2v5H5V8zm4 1h2v5H9V9zM4 13h3v2H4v-2zm5 1h3v2H9v-2z" />
    </Pixel>
  );
}

export function IconPick({ className }: { className?: string }) {
  return (
    <Pixel className={className}>
      <Dots cells="M9 1h5v2h-1v1h-1v1H11v1H9V5H8V4H7V3h2V1zM8 6h2v2H8V6zM6 8h2v2H6V8zM4 10h2v2H4v-2zM2 12h2v3H1v-2h1v-1z" />
    </Pixel>
  );
}

export function IconCopy({ className }: { className?: string }) {
  return (
    <Pixel className={className}>
      <Dots cells="M5 2h9v9h-2V4H5V2zM2 5h9v9H2V5zm2 2v5h5V7H4z" />
    </Pixel>
  );
}

export function IconQr({ className }: { className?: string }) {
  return (
    <Pixel className={className}>
      <Dots cells="M1 1h6v6H1V1zm2 2h2v2H3V3zM9 1h6v6H9V1zm2 2h2v2h-2V3zM1 9h6v6H1V9zm2 2h2v2H3v-2zM9 9h2v2H9V9zm4 0h2v2h-2V9zM11 11h2v2h-2v-2zM9 13h2v2H9v-2zm4 0h2v2h-2v-2z" />
    </Pixel>
  );
}

export function IconGear({ className }: { className?: string }) {
  return (
    <Pixel className={className}>
      <Dots cells="M7 1h2v2h2v1h2v2h-1v2h1v2h-2v1H9v2H7v-2H5v-1H3v-2h1V8H3V6h2V5h2V1zM6 6v4h4V6H6z" />
    </Pixel>
  );
}

export function IconUsers({ className }: { className?: string }) {
  return (
    <Pixel className={className}>
      <Dots cells="M3 2h3v3H3V2zM1 6h7v2H1V6zm1 3h5v4H2V9zM10 3h3v3h-3V3zM8 7h7v2H8V7zm1 3h5v3H9v-3z" />
    </Pixel>
  );
}

export function IconReset({ className }: { className?: string }) {
  return (
    <Pixel className={className}>
      <Dots cells="M3 3h5V1h1v4H5v2H3V3zm9 1h2v8h-2V8H8V6h4V4zM3 9h2v4h8v2H3V9z" />
    </Pixel>
  );
}

export function IconWave({ className }: { className?: string }) {
  return (
    <Pixel className={className}>
      <Dots cells="M7 1h3v3H7V1zM6 4h5v4H9v5H7V8H4V6h2V4zm5 1h3v3h-3V5zM2 7h2v3H2V7zm11 2h2v4h-2V9zM3 12h2v3H3v-3z" />
    </Pixel>
  );
}

export function IconHeart({ className }: { className?: string }) {
  return (
    <Pixel className={className}>
      <Dots cells="M3 3h4v2h2V3h4v3h-1v2h-1v2h-1v2H9v2H7v-2H6v-2H5V8H4V6H3V3z" />
    </Pixel>
  );
}

export function IconLaugh({ className }: { className?: string }) {
  return (
    <Pixel className={className}>
      <Dots cells="M5 2h6v1h2v2h1v6h-1v2h-2v1H5v-1H3v-2H2V5h1V3h2V2zM5 5h2v2H5V5zm4 0h2v2H9V5zM5 9h6v1H9v1H7v-1H5V9z" />
    </Pixel>
  );
}

export function IconClose({ className }: { className?: string }) {
  return (
    <Pixel className={className}>
      <Dots cells="M3 3h2v2h2v2h2V5h2V3h2v2h-2v2h-2v2h2v2h2v2h-2v-2h-2v-2H9v2H7v2H5v-2h2v-2h2V7H7V5H5V3z" />
    </Pixel>
  );
}

export function IconPhone({ className }: { className?: string }) {
  return (
    <Pixel className={className}>
      <Dots cells="M5 1h6v14H5V1zm1 1v10h4V2H6zm1 11h2v1H7v-1z" />
    </Pixel>
  );
}

export function IconTrash({ className }: { className?: string }) {
  return (
    <Pixel className={className}>
      <Dots cells="M6 1h4v1h3v2H3V2h3V1zM4 5h8v10H4V5zm2 2v6h1V7H6zm3 0v6h1V7H9z" />
    </Pixel>
  );
}

export function IconSend({ className }: { className?: string }) {
  return (
    <Pixel className={className}>
      <Dots cells="M1 3h3v1h2v1h2v1h3V5h2V4h2V3l-1 5h-2v1h-2v1H9v1H7v1H5v1H3v1H1V3z" />
    </Pixel>
  );
}
