"use client";

import { GuestCopyButton } from "@/components/GuestCopyButton";
import { useLocale } from "@/lib/i18n/LocaleContext";

type Props = {
  code: string;
  className?: string;
};

export function CopyBookingCodeButton({ code, className = "" }: Props) {
  const { t } = useLocale();
  return (
    <GuestCopyButton
      getText={() => code}
      label={t("copyCode.label")}
      copiedLabel={t("copyCode.copied")}
      ariaLabel={t("copyCode.ariaLabel")}
      className={`inline-flex items-center gap-1.5 rounded-lg border border-amber-300 bg-white px-3 py-1.5 text-sm font-medium text-amber-800 hover:bg-amber-100 transition ${className}`}
    />
  );
}
