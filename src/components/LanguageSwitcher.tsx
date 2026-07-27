"use client";

import { useLocale } from "@/lib/i18n/LocaleContext";
import { locales } from "@/lib/i18n/translations";

export function LanguageSwitcher({ className = "" }: { className?: string }) {
  const { locale, setLocale } = useLocale();

  return (
    <div
      className={`inline-flex items-center gap-1 rounded-full border border-ink/10 bg-white/60 p-1 text-xs backdrop-blur-[2px] ${className}`}
      role="group"
      aria-label="Language"
    >
      {locales.map((l) => (
        <button
          key={l.code}
          type="button"
          onClick={() => setLocale(l.code)}
          aria-current={locale === l.code ? "true" : undefined}
          aria-label={l.label}
          className={`min-h-[44px] min-w-[44px] rounded-full px-3 py-2 font-medium transition-[background-color,color,transform] duration-300 ease-[cubic-bezier(0.32,0.72,0,1)] active:scale-[0.97] ${
            locale === l.code
              ? "bg-caramel-deep text-paper"
              : "text-ink-faint hover:bg-paper-deep hover:text-ink-soft"
          }`}
        >
          {l.label}
        </button>
      ))}
    </div>
  );
}
