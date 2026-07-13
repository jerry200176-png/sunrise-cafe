"use client";

import { useLocale } from "@/lib/i18n/LocaleContext";
import { locales } from "@/lib/i18n/translations";

export function LanguageSwitcher({ className = "" }: { className?: string }) {
  const { locale, setLocale } = useLocale();

  return (
    <div
      className={`inline-flex items-center gap-1 rounded-full border border-stone-200 bg-white/70 p-1 text-xs ${className}`}
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
          className={`min-h-[44px] min-w-[44px] rounded-full px-3 py-2 font-medium transition-colors ${
            locale === l.code
              ? "bg-amber-600 text-white"
              : "text-stone-500 hover:bg-amber-50"
          }`}
        >
          {l.label}
        </button>
      ))}
    </div>
  );
}
