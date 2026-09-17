import type { ReactNode } from "react";
import { Hammer, Play, Settings } from "lucide-react";
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
    <svg
      viewBox="0 0 24 24"
      className={cn("size-4 shrink-0", className)}
      fill="none"
      aria-hidden
    >
      <path
        d="M5 13.5 L12 6.5 L19 13.5"
        stroke="#3dce4a"
        strokeWidth="3.2"
        strokeLinecap="square"
        strokeLinejoin="miter"
      />
      <path
        d="M5 19.5 L12 12.5 L19 19.5"
        stroke="#2fad3c"
        strokeWidth="3.2"
        strokeLinecap="square"
        strokeLinejoin="miter"
      />
    </svg>
  );
}

/** Chest / backpack glyph for the inventory hotbar slot. */
export function IconBag({ className }: { className?: string }) {
  return (
    <Pixel className={className}>
      <Dots cells="M4 5h8v1H4V5zM3 6h10v1H3V6zM3 7h2v7H3V7zm8 0h2v7h-2V7zM5 7h6v1H5V7zM5 9h6v5H5V9zM7 10h2v2H7v-2z" />
    </Pixel>
  );
}

/** 16×16 sprite of the V2 voxel pickaxe: wood handle, terracotta collar, metal tip. */
export function IconPick({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 16 16"
      className={cn("size-4 shrink-0", className)}
      shapeRendering="crispEdges"
      aria-hidden
    >
      <path fill="var(--color-block-wood)" d="M1 13h1v2H1zM2 11h1v2H2zM3 9h1v2H3zM4 7h1v2H4zM5 6h1v2H5zM6 5h2v2H6z" />
      <path fill="var(--color-primary)" d="M7 4h2v1H7z" />
      <path fill="var(--color-block-stone)" d="M6 1h6v1H6zM5 2h7v1H5zM10 3h3v1h-3zM11 4h2v1h-2zM12 5h2v1h-2z" />
    </svg>
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
  return <Settings className={cn("size-4 shrink-0", className)} strokeWidth={2} aria-hidden />;
}

export function IconHammer({ className }: { className?: string }) {
  return <Hammer className={cn("size-4 shrink-0", className)} strokeWidth={2.25} aria-hidden />;
}

export function IconPlay({ className }: { className?: string }) {
  return <Play className={cn("size-4 shrink-0", className)} strokeWidth={2.5} fill="currentColor" aria-hidden />;
}

export function IconFullscreen({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={cn("size-4 shrink-0", className)} aria-hidden>
      <path strokeLinecap="square" d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" />
    </svg>
  );
}

export function IconFullscreenExit({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={cn("size-4 shrink-0", className)} aria-hidden>
      <path strokeLinecap="square" d="M9 4H4v5M15 4h5v5M9 20H4v-5M15 20h5v-5" />
    </svg>
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

export function IconUser({ className }: { className?: string }) {
  return (
    <Pixel className={className}>
      <Dots cells="M6 2h4v1h1v3H9v1H7V6H5V3h1V2zm-3 9h10v1H3v-1zm1 2h8v1H4v-1zm1 2h6v1H5v-1z" />
    </Pixel>
  );
}
