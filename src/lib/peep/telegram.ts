/** Minimal Telegram WebApp surface we actually use. */
export type TelegramWebAppUser = {
  id: number;
  first_name?: string;
  last_name?: string;
  username?: string;
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
 * `invite_{hostTelegramNumericId}` → host player id `tg_{id}`.
 */
export function parseInviteHostId(startParam: string | null | undefined): string | null {
  if (!startParam) return null;
  const m = startParam.trim().match(/^invite_(\d{1,16})$/i);
  return m ? telegramPlayerId(Number(m[1])) : null;
}

/** startapp value the host shares so Friday can join. */
export function hostInviteStartApp(): string | null {
  const id = getTelegramUserId();
  return id != null ? `invite_${id}` : null;
}

export function fridayInviteLink(botUsername: string): string | null {
  const start = hostInviteStartApp();
  if (!start || !botUsername) return null;
  const bot = botUsername.replace(/^@/, "");
  return `https://t.me/${bot}?startapp=${encodeURIComponent(start)}`;
}
