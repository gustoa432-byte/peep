import { en } from "./en";
import { ru, type TranslationKey } from "./ru";

export type Locale = "ru" | "en";
export type { TranslationKey };

const STORAGE_KEY = "peep.locale";

const dictionaries: Record<Locale, Record<TranslationKey, string>> = {
  ru,
  en,
};

type Listener = (locale: Locale) => void;

let locale: Locale = "ru";
const listeners = new Set<Listener>();

function readTelegramLang(): string | null {
  if (typeof window === "undefined") return null;
  try {
    const code = (
      window as unknown as {
        Telegram?: { WebApp?: { initDataUnsafe?: { user?: { language_code?: string } } } };
      }
    ).Telegram?.WebApp?.initDataUnsafe?.user?.language_code;
    return typeof code === "string" ? code.toLowerCase().trim() : null;
  } catch {
    return null;
  }
}

function normalizeLocale(raw: string | null | undefined): Locale | null {
  if (!raw) return null;
  const s = raw.toLowerCase().trim();
  if (s === "ru" || s.startsWith("ru-") || s.startsWith("ru_")) return "ru";
  if (s === "en" || s.startsWith("en-") || s.startsWith("en_")) return "en";
  return null;
}

/** Priority: localStorage → Telegram language_code → navigator.language → en. */
export function detectLocale(): Locale {
  if (typeof window === "undefined") return "en";
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    const fromStore = normalizeLocale(stored);
    if (fromStore) return fromStore;
  } catch {
    /* private mode */
  }
  const fromTg = normalizeLocale(readTelegramLang());
  if (fromTg) return fromTg;
  if (typeof navigator !== "undefined") {
    const fromNav = normalizeLocale(navigator.language);
    if (fromNav === "ru") return "ru";
  }
  return "en";
}

export function getLocale(): Locale {
  return locale;
}

export function setLocale(next: Locale) {
  if (locale === next) {
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      /* ignore */
    }
    return;
  }
  locale = next;
  try {
    localStorage.setItem(STORAGE_KEY, next);
  } catch {
    /* ignore */
  }
  if (typeof document !== "undefined") {
    document.documentElement.lang = next;
  }
  for (const fn of listeners) fn(next);
}

export function initI18n() {
  locale = detectLocale();
  if (typeof document !== "undefined") {
    document.documentElement.lang = locale;
  }
}

export function subscribeLocale(fn: Listener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export type TParams = Record<string, string | number>;

export function t(key: TranslationKey, params?: TParams): string {
  const dict = dictionaries[locale] ?? dictionaries.en;
  let out = dict[key] ?? dictionaries.en[key] ?? String(key);
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      out = out.replaceAll(`{{${k}}}`, String(v));
    }
  }
  return out;
}

/** Non-React singleton accessor (game engine / helpers). */
export function getT() {
  return t;
}
