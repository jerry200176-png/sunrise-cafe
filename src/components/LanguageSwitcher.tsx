"use client";

import { useLocale } from "@/lib/i18n/LocaleContext";
import { locales } from "@/lib/i18n/translations";

export function LanguageSwitcher({ className = "" }: { className?: string }) {
  const { locale, setLocale } = useLocale();

  return (
    <div className={`inline-flex items-center gap-0.5 rounded-full border border-stone-200 bg-white/70 p-0.5 text-xs ${className}`}>
      {locales.map((l) => (
        <button
          key={l.code}
          type="button"
          onClick={() => setLocale(l.code)}
          aria-current={locale === l.code}
          className={`rounded-full px-2.5 py-1 font-medium transition-colors ${
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
