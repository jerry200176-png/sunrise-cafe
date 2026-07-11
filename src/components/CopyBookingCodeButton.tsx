"use client";

import { useState } from "react";
import { Copy, Check } from "lucide-react";
import { useLocale } from "@/lib/i18n/LocaleContext";

type Props = {
  code: string;
  className?: string;
};

export function CopyBookingCodeButton({ code, className = "" }: Props) {
  const { t } = useLocale();
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(code);
      } else {
        const ta = document.createElement("textarea");
        ta.value = code;
        ta.style.position = "fixed";
        ta.style.left = "-9999px";
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        document.body.removeChild(ta);
      }
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      /* ignore */
    }
  };

  return (
    <button
      type="button"
      onClick={copy}
      className={`inline-flex items-center gap-1.5 rounded-lg border border-amber-300 bg-white px-3 py-1.5 text-sm font-medium text-amber-800 hover:bg-amber-100 transition ${className}`}
      aria-label={t("copyCode.ariaLabel")}
    >
      {copied ? (
        <>
          <Check className="h-4 w-4" aria-hidden />
          {t("copyCode.copied")}
        </>
      ) : (
        <>
          <Copy className="h-4 w-4" aria-hidden />
          {t("copyCode.label")}
        </>
      )}
      <span className="sr-only" aria-live="polite">
        {copied ? t("copyCode.srCopied") : ""}
      </span>
    </button>
  );
}
