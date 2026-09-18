import { WORLD_ID_RE } from "./constants";

/** Minimal Telegram WebApp surface we actually use. */
export type TelegramWebAppUser = {
  id: number;
  language_code?: string;
  first_name?: string;
  last_name?: string;
  username?: string;
  photo_url?: string;
};

export type TelegramSafeArea = {
  top?: number;
  bottom?: number;
  left?: number;
  right?: number;
};

export type TelegramWebApp = {
  initData?: string;
  initDataUnsafe?: {
    user?: TelegramWebAppUser;
    start_param?: string;
  };
  ready: () => void;
  expand: () => void;
  isExpanded?: boolean;
  isFullscreen?: boolean;
  isOrientationLocked?: boolean;
  requestFullscreen?: () => void;
  exitFullscreen?: () => void;
  /** Bot API 8.0+: lock to current orientation (some clients accept 'landscape'). */
  lockOrientation?: ((orientation?: string) => void) | (() => void);
  unlockOrientation?: () => void;
  disableVerticalSwipes?: () => void;
  /** Ask before Esc / swipe closes the Mini App (helps Esc unlock aim in Desktop). */
  enableClosingConfirmation?: () => void;
  disableClosingConfirmation?: () => void;
  platform?: string;
  version?: string;
  safeAreaInset?: TelegramSafeArea;
  contentSafeAreaInset?: TelegramSafeArea;
  HapticFeedback?: {
    impactOccurred?: (style: "light" | "medium" | "heavy" | "rigid" | "soft") => void;
    notificationOccurred?: (type: "error" | "success" | "warning") => void;
  };
  onEvent?: (eventType: string, callback: () => void) => void;
  offEvent?: (eventType: string, callback: () => void) => void;
  /** Opens a t.me link inside Telegram (share sheet, bot deep links, …). */
  openTelegramLink?: (url: string) => void;
};

declare global {
  interface Window {
    Telegram?: { WebApp?: TelegramWebApp };
  }
}

/** Stable player id derived from Telegram user id (`tg_<id>`). */
export function telegramPlayerId(userId: number): string {
  return `tg_${userId}`;
}

export function getTelegramWebApp(): TelegramWebApp | null {
  if (typeof window === "undefined") return null;
  return window.Telegram?.WebApp ?? null;
}

export function getTelegramUserId(): number | null {
  const id = getTelegramWebApp()?.initDataUnsafe?.user?.id;
  return typeof id === "number" && Number.isFinite(id) && id > 0 ? id : null;
}

/** Display name for nametags: @username → first+last → first → «игрок». */
export function getTelegramDisplayName(): string {
  const u = getTelegramWebApp()?.initDataUnsafe?.user;
  if (!u) return "игрок";
  const nick = u.username?.trim();
  if (nick) return nick.slice(0, 24);
  const full = [u.first_name, u.last_name].filter(Boolean).join(" ").trim();
  if (full) return full.slice(0, 24);
  return "игрок";
}

/** Avatar photo from Telegram initData (may be CORS-blocked — callers need fallback). */
export function getTelegramPhotoUrl(): string | null {
  const url = getTelegramWebApp()?.initDataUnsafe?.user?.photo_url?.trim();
  return url || null;
}

export function isTelegramMiniApp(): boolean {
  return getTelegramUserId() != null;
}

/**
 * Desktop Telegram clients — Pointer Lock is blocked/silenced in their WebView.
 * Platforms: tdesktop, macos, windows (and linux desktop builds).
 */
export function isTelegramDesktopPlatform(): boolean {
  const wa = getTelegramWebApp();
  const p = wa?.platform?.toLowerCase()?.trim();
  if (!p) return false;
  return p === "tdesktop" || p === "macos" || p === "windows" || p === "linux";
}

/** Phone Telegram clients — native mobile only (not Telegram Web weba/webk). */
export function isTelegramMobilePlatform(): boolean {
  const wa = getTelegramWebApp();
  const p = wa?.platform?.toLowerCase()?.trim();
  if (!p) return false;
  return p === "ios" || p === "android" || p === "android_x";
}

/** @deprecated Hold-LMB drag look removed for mouse; touch pads only. */
export function preferDragLookCamera(): boolean {
  return false;
}

/** Push TG safe-area insets into CSS vars for HUD layout. */
function syncTelegramSafeAreaCss(wa: TelegramWebApp) {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  const content = wa.contentSafeAreaInset;
  const safe = wa.safeAreaInset;
  const top = content?.top ?? safe?.top;
  const bottom = content?.bottom ?? safe?.bottom;
  if (typeof top === "number" && Number.isFinite(top)) {
    root.style.setProperty("--tg-safe-area-inset-top", `${Math.max(0, top)}px`);
  }
  if (typeof bottom === "number" && Number.isFinite(bottom)) {
    root.style.setProperty("--tg-safe-area-inset-bottom", `${Math.max(0, bottom)}px`);
  }
}

/**
 * Call once on client boot: ready + expand + fullscreen + landscape lock.
 * Safe no-op outside Telegram.
 */
export function initTelegramWebApp(): number | null {
  const wa = getTelegramWebApp();
  if (!wa) return null;
  try {
    wa.ready();
    wa.expand();
    wa.disableVerticalSwipes?.();
    // Desktop Esc often closes the Mini App — confirm so soft-look unlock can win first.
    if (isTelegramDesktopPlatform()) {
      try {
        wa.enableClosingConfirmation?.();
      } catch {
        /* older clients */
      }
    }

    // True fullscreen (hides TG chrome where supported).
    if (typeof wa.requestFullscreen === "function") {
      try {
        wa.requestFullscreen();
      } catch {
        /* older / denied */
      }
    }

    // Prefer landscape via Screen Orientation API, then lock Mini App orientation.
    void forceTelegramLandscape(wa);

    syncTelegramSafeAreaCss(wa);
    const onSafe = () => syncTelegramSafeAreaCss(wa);
    wa.onEvent?.("safeAreaChanged", onSafe);
    wa.onEvent?.("contentSafeAreaChanged", onSafe);
    wa.onEvent?.("fullscreenChanged", onSafe);
  } catch {
    /* older clients */
  }
  return getTelegramUserId();
}

/** Best-effort landscape lock for TMA + browser Screen Orientation. */
async function forceTelegramLandscape(wa: TelegramWebApp) {
  try {
    const { lockOrient, writeOrient } = await import("./settings");
    writeOrient("landscape");
    await lockOrient("landscape");
  } catch {
    /* ignore */
  }
  try {
    const lock = wa.lockOrientation;
    if (typeof lock !== "function") return;
    try {
      // Some clients accept an explicit mode; official API locks "current".
      (lock as (orientation?: string) => void).call(wa, "landscape");
    } catch {
      (lock as () => void).call(wa);
    }
  } catch {
    /* older clients */
  }
}

/** Raw `start_param` / startapp payload from Telegram. */
export function getTelegramStartParam(): string | null {
  if (typeof window === "undefined") return null;
  const fromInit = getTelegramWebApp()?.initDataUnsafe?.start_param?.trim();
  if (fromInit) return fromInit;
  try {
    const q = new URLSearchParams(window.location.search);
    const fromUrl =
      q.get("tgWebAppStartParam")?.trim() ||
      q.get("startapp")?.trim() ||
      q.get("startApp")?.trim();
    if (fromUrl) return fromUrl;
  } catch {
    /* ignore */
  }
  return null;
}

/**
 * Prefer direct `startapp=<world_id>` (strict Friday invite).
 * Falls back to legacy `invite_{hostTelegramNumericId}`.
 */
export function parseInviteWorldId(startParam: string | null | undefined): string | null {
  if (!startParam) return null;
  const s = startParam.trim().toLowerCase();
  if (WORLD_ID_RE.test(s)) return s;
  return null;
}

/**
 * `invite_{hostTelegramNumericId}` → host player id `tg_{id}` (legacy).
 */
export function parseInviteHostId(startParam: string | null | undefined): string | null {
  if (!startParam) return null;
  const m = startParam.trim().match(/^invite_(\d{1,16})$/i);
  return m ? telegramPlayerId(Number(m[1])) : null;
}

/** @deprecated Prefer fridayInviteLink(worldId). */
export function hostInviteStartApp(): string | null {
  const id = getTelegramUserId();
  return id != null ? `invite_${id}` : null;
}

/** Default Mini App identity for Friday invites (share card + «ЗАПУСТИТЬ»). */
export const TG_BOT_USERNAME = "peeplandbot";
export const TG_APP_SHORT_NAME = "friday";

/**
 * Telegram Mini App deep link for Friday:
 * `https://t.me/peeplandbot/friday?startapp=<world_id>`
 */
export function fridayInviteLink(worldId: string, botUsername?: string): string | null {
  if (!WORLD_ID_RE.test(worldId)) return null;
  return fridayStartAppLink(worldId, botUsername);
}

/** Mini App deep link with arbitrary startapp payload (invite world id or lnk_<token>). */
export function fridayStartAppLink(startParam: string, botUsername?: string): string {
  const envBot = (import.meta.env.VITE_TG_BOT_USERNAME as string | undefined)?.trim();
  const envApp = (import.meta.env.VITE_TG_APP_SHORT_NAME as string | undefined)?.trim();
  const bot = (botUsername ?? envBot ?? TG_BOT_USERNAME).replace(/^@/, "");
  const app = envApp || TG_APP_SHORT_NAME;
  return `https://t.me/${bot}/${app}?startapp=${encodeURIComponent(startParam)}`;
}

/** Browser→Telegram link challenge deep link. */
export function fridayAccountLinkUrl(token: string): string {
  return fridayStartAppLink(`lnk_${token}`);
}

/**
 * Native Telegram “Share” sheet over the Mini App (contacts picker).
 * Only the Mini App deep link — Telegram fills the rich preview from bot settings.
 */
export function shareFridayInvite(worldId: string): void {
  const inviteUrl = fridayInviteLink(worldId);
  if (!inviteUrl) return;
  const tgShareLink = `https://t.me/share/url?url=${encodeURIComponent(inviteUrl)}`;
  const wa = getTelegramWebApp();
  if (wa?.openTelegramLink) {
    wa.openTelegramLink(tgShareLink);
    return;
  }
  window.open(tgShareLink, "_blank", "noopener,noreferrer");
}
