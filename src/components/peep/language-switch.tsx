import { useTranslation, type Locale } from "@/lib/i18n/react";
import { cn } from "@/lib/utils";

export function LanguageSwitch({ className }: { className?: string }) {
  const { locale, setLocale, t } = useTranslation();

  const pick = (next: Locale) => {
    if (next === locale) return;
    setLocale(next);
  };

  return (
    <div className={cn("flex flex-col gap-2", className)}>
      <p className="font-mono text-[10px] font-bold uppercase tracking-wide text-muted">
        {t("common.language")}
      </p>
      <div className="flex overflow-hidden rounded-xl border border-white/20">
        <button
          type="button"
          onClick={() => pick("ru")}
          className={cn(
            "min-h-10 flex-1 px-3 font-mono text-xs font-bold uppercase tracking-wide",
            locale === "ru" ? "bg-white text-black" : "bg-transparent text-white/70",
          )}
        >
          {t("common.lang.ru")}
        </button>
        <button
          type="button"
          onClick={() => pick("en")}
          className={cn(
            "min-h-10 flex-1 px-3 font-mono text-xs font-bold uppercase tracking-wide",
            locale === "en" ? "bg-white text-black" : "bg-transparent text-white/70",
          )}
        >
          {t("common.lang.en")}
        </button>
      </div>
      <p className="text-xs leading-relaxed text-muted">{t("settings.languageHint")}</p>
    </div>
  );
}

/** In-game settings variant (ink surface). */
export function LanguageSwitchInk({ className }: { className?: string }) {
  const { locale, setLocale, t } = useTranslation();

  const pick = (next: Locale) => {
    if (next === locale) return;
    setLocale(next);
  };

  return (
    <div className={cn("mt-4 flex flex-col gap-2", className)}>
      <p className="font-mono text-[10px] font-bold uppercase tracking-wide text-muted-on-ink">
        {t("common.language")}
      </p>
      <div className="flex overflow-hidden rounded-pixel border-2 border-fg-on-ink/20">
        <button
          type="button"
          onClick={() => pick("ru")}
          className={cn(
            "min-h-10 flex-1 px-3 font-mono text-xs uppercase tracking-wide",
            locale === "ru" ? "bg-primary text-primary-fg" : "text-fg-on-ink",
          )}
        >
          {t("common.lang.ru")}
        </button>
        <button
          type="button"
          onClick={() => pick("en")}
          className={cn(
            "min-h-10 flex-1 px-3 font-mono text-xs uppercase tracking-wide",
            locale === "en" ? "bg-primary text-primary-fg" : "text-fg-on-ink",
          )}
        >
          {t("common.lang.en")}
        </button>
      </div>
      <p className="text-xs leading-relaxed text-muted-on-ink">{t("settings.languageHint")}</p>
    </div>
  );
}
