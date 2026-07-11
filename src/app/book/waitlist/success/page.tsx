"use client";

import Link from "next/link";
import { CheckCircle } from "lucide-react";
import { useLocale } from "@/lib/i18n/LocaleContext";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";

export default function WaitlistSuccessPage() {
  const { t } = useLocale();

  return (
    <div className="flex min-h-screen flex-col bg-amber-50">
      <header className="flex justify-end px-4 py-3">
        <LanguageSwitcher />
      </header>
      <div className="flex flex-1 flex-col items-center justify-center px-4 pb-12">
        <div className="w-full max-w-sm rounded-2xl bg-white p-8 shadow-sm text-center">
          <div className="mb-4 flex justify-center">
            <CheckCircle size={48} className="text-amber-500" />
          </div>
          <h1 className="mb-2 text-xl font-bold text-gray-800">{t("waitlistSuccess.title")}</h1>
          <p className="mb-6 text-sm text-gray-500 leading-relaxed">
            {t("waitlistSuccess.descLine1")}
            <br />
            {t("waitlistSuccess.descLine2")}
          </p>
          <div className="space-y-3">
            <Link
              href="/book"
              className="block w-full rounded-xl bg-amber-500 py-3 text-sm font-semibold text-white hover:bg-amber-600"
            >
              {t("waitlistSuccess.otherSlots")}
            </Link>
            <Link
              href="/"
              className="block w-full rounded-xl border border-gray-200 py-3 text-sm font-medium text-gray-600 hover:bg-gray-50"
            >
              {t("waitlistSuccess.home")}
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
