/** Minimal Telegram WebApp surface we actually use. */
export type TelegramWebAppUser = {
  id: number;
  first_name?: string;
  last_name?: string;
  username?: string;
};

export type TelegramWebApp = {
  initData?: string;
  initDataUnsafe?: { user?: TelegramWebAppUser };
  ready: () => void;
  expand: () => void;
  isExpanded?: boolean;
  platform?: string;
  version?: string;
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

export function isTelegramMiniApp(): boolean {
  return getTelegramUserId() != null;
}

/**
 * Call once on client boot: ready + expand fullscreen.
 * Safe no-op outside Telegram.
 */
export function initTelegramWebApp(): number | null {
  const wa = getTelegramWebApp();
  if (!wa) return null;
  try {
    wa.ready();
    wa.expand();
  } catch {
    /* older clients */
  }
  return getTelegramUserId();
}
