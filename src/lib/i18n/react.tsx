import {
  createContext,
  createElement,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  getLocale,
  initI18n,
  setLocale,
  subscribeLocale,
  t as translate,
  type Locale,
  type TParams,
  type TranslationKey,
} from "./index";

export type { Locale, TranslationKey, TParams };

type I18nApi = {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: (key: TranslationKey, params?: TParams) => string;
};

const I18nContext = createContext<I18nApi | null>(null);

let bootstrapped = false;

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(() => {
    if (!bootstrapped && typeof window !== "undefined") {
      initI18n();
      bootstrapped = true;
    }
    return getLocale();
  });

  useEffect(() => {
    if (!bootstrapped) {
      initI18n();
      bootstrapped = true;
      setLocaleState(getLocale());
    }
    return subscribeLocale(setLocaleState);
  }, []);

  const set = useCallback((next: Locale) => {
    setLocale(next);
  }, []);

  const t = useCallback(
    (key: TranslationKey, params?: TParams) => translate(key, params),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- rebind when locale flips
    [locale],
  );

  const value = useMemo(() => ({ locale, setLocale: set, t }), [locale, set, t]);

  return createElement(I18nContext.Provider, { value }, children);
}

export function useTranslation(): I18nApi {
  const ctx = useContext(I18nContext);
  if (!ctx) {
    // Safe fallback outside provider (SSR / early paint).
    return {
      locale: getLocale(),
      setLocale,
      t: translate,
    };
  }
  return ctx;
}
