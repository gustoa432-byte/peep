type FsEl = HTMLElement & {
  webkitRequestFullscreen?: () => Promise<void> | void;
  webkitRequestFullScreen?: () => Promise<void> | void;
};

type FsDoc = Document & {
  webkitFullscreenElement?: Element | null;
  webkitExitFullscreen?: () => Promise<void> | void;
  webkitCancelFullScreen?: () => Promise<void> | void;
};

export function fullscreenElement(): Element | null {
  const doc = document as FsDoc;
  return document.fullscreenElement ?? doc.webkitFullscreenElement ?? null;
}

export function isFullscreen(el?: HTMLElement | null): boolean {
  const current = fullscreenElement();
  if (!current || !el) return false;
  return current === el || el.contains(current);
}

export function canFullscreen(): boolean {
  if (typeof document === "undefined") return false;
  const el = document.documentElement as FsEl;
  return typeof el.requestFullscreen === "function" || typeof el.webkitRequestFullscreen === "function";
}

export async function enterFullscreen(el: HTMLElement): Promise<boolean> {
  const node = el as FsEl;
  try {
    if (typeof node.requestFullscreen === "function") {
      await node.requestFullscreen();
      return true;
    }
    const webkit = node.webkitRequestFullscreen ?? node.webkitRequestFullScreen;
    if (typeof webkit === "function") {
      await webkit.call(node);
      return true;
    }
  } catch {
    return false;
  }
  return false;
}

export async function exitFullscreen(): Promise<void> {
  const doc = document as FsDoc;
  try {
    if (typeof document.exitFullscreen === "function" && document.fullscreenElement) {
      await document.exitFullscreen();
      return;
    }
    const webkit = doc.webkitExitFullscreen ?? doc.webkitCancelFullScreen;
    if (typeof webkit === "function" && doc.webkitFullscreenElement) await webkit.call(document);
  } catch {
    /* already left or browser refused */
  }
}

export async function toggleFullscreen(el: HTMLElement): Promise<"on" | "off" | "denied"> {
  if (isFullscreen(el) || (!el && fullscreenElement())) {
    await exitFullscreen();
    return "off";
  }
  const ok = await enterFullscreen(el);
  return ok ? "on" : "denied";
}

export const FS_EVENTS = ["fullscreenchange", "webkitfullscreenchange"] as const;
