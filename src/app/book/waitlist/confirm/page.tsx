"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { CheckCircle2, Clock, XCircle } from "lucide-react";
import { format, parseISO } from "date-fns";
import { enUS, ja, zhTW } from "date-fns/locale";
import { CopyBookingCodeButton } from "@/components/CopyBookingCodeButton";
import { useLocale } from "@/lib/i18n/LocaleContext";
import { fetchWithTimeout } from "@/lib/fetch-with-timeout";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";

interface WaitlistDetail {
  status: "notified" | "waiting" | "booked" | "expired";
  customer_name: string;
  start_time: string;
  end_time: string;
  room_name: string;
  branch_name: string;
}

function formatRange(startIso: string, endIso: string, locale: "zh-TW" | "en" | "ja") {
  const dateFnsLocale = locale === "en" ? enUS : locale === "ja" ? ja : zhTW;
  const start = parseISO(startIso);
  const end = parseISO(endIso);
  const dateLabel = format(start, "M/d (EEE)", { locale: dateFnsLocale });
  const startLabel = format(start, "HH:mm");
  const endLabel = format(end, "HH:mm");
  return `${dateLabel} ${startLabel}–${endLabel}`;
}

function ConfirmContent() {
  const { t, locale } = useLocale();
  const searchParams = useSearchParams();
  const token = searchParams.get("token") ?? "";

  const [loading, setLoading] = useState(true);
  const [detail, setDetail] = useState<WaitlistDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [bookingCode, setBookingCode] = useState<string | null>(null);

  useEffect(() => {
    if (!token) {
      setError(t("waitlistConfirm.missingToken"));
      setLoading(false);
      return;
    }
    fetchWithTimeout(`/api/waitlist/confirm?token=${encodeURIComponent(token)}`)
      .then((r) => r.json())
      .then((d) => {
        if (d.error) {
          setError(d.error);
          return;
        }
        setDetail(d as WaitlistDetail);
      })
      .catch(() => setError(t("waitlistConfirm.loadFailed")))
      .finally(() => setLoading(false));
  }, [token, t]);

  const handleConfirm = async () => {
    setConfirming(true);
    setError(null);
    try {
      const res = await fetchWithTimeout("/api/waitlist/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? t("waitlistConfirm.confirmFailed"));
        return;
      }
      setBookingCode(data.booking_code ?? null);
    } catch {
      setError(t("waitlistConfirm.networkError"));
    } finally {
      setConfirming(false);
    }
  };

  return (
    <main className="min-h-screen bg-gray-50">
      <header className="flex justify-end px-4 py-3">
        <LanguageSwitcher />
      </header>
      <div className="mx-auto max-w-lg px-4 py-8">
        <div className="rounded-2xl border border-amber-200 bg-white p-6 shadow-lg">
          {loading ? (
            <p className="text-center text-gray-500">{t("waitlistConfirm.loading")}</p>
          ) : bookingCode ? (
            <>
              <div className="flex justify-center text-green-600">
                <CheckCircle2 className="h-14 w-14" />
              </div>
              <h1 className="mt-4 text-center text-xl font-bold text-gray-900">
                {t("waitlistConfirm.successTitle")}
              </h1>
              <p className="mt-2 text-center text-sm text-gray-500">{t("waitlistConfirm.successDesc")}</p>
              <div className="mt-6 rounded-xl bg-amber-50 p-4 text-center">
                <p className="text-sm text-amber-800">{t("waitlistConfirm.bookingCodeLabel")}</p>
                <p className="mt-1 font-mono text-2xl font-bold tracking-wider text-amber-900">{bookingCode}</p>
                <div className="mt-3 flex justify-center">
                  <CopyBookingCodeButton code={bookingCode} />
                </div>
              </div>
              <p className="mt-4 text-center text-xs text-gray-500">
                {t("waitlistConfirm.successDepositNote")}
              </p>
              <Link
                href="/book/query"
                className="mt-5 block w-full rounded-lg bg-amber-600 py-3 text-center font-medium text-white hover:bg-amber-700"
              >
                {t("waitlistConfirm.queryCta")}
              </Link>
            </>
          ) : error ? (
            <>
              <div className="flex justify-center text-rose-500">
                <XCircle className="h-14 w-14" />
              </div>
              <h1 className="mt-4 text-center text-xl font-bold text-gray-900">
                {t("waitlistConfirm.errorTitle")}
              </h1>
              <p className="mt-2 text-center text-sm text-gray-600">{error}</p>
              <Link
                href="/book/waitlist"
                className="mt-5 block w-full rounded-lg bg-amber-600 py-3 text-center font-medium text-white hover:bg-amber-700"
              >
                {t("waitlistConfirm.rejoinCta")}
              </Link>
            </>
          ) : detail && detail.status === "notified" ? (
            <>
              <div className="flex justify-center text-amber-500">
                <Clock className="h-14 w-14" />
              </div>
              <h1 className="mt-4 text-center text-xl font-bold text-gray-900">
                {t("waitlistConfirm.pendingTitle")}
              </h1>
              <div className="mt-5 space-y-1 rounded-xl bg-amber-50 p-4 text-sm text-amber-900">
                <p>👤 {detail.customer_name}</p>
                <p>🏠 {detail.branch_name} — {detail.room_name}</p>
                <p>📅 {formatRange(detail.start_time, detail.end_time, locale)}</p>
              </div>
              <p className="mt-4 text-center text-xs text-gray-500">{t("waitlistConfirm.pendingNote")}</p>
              <button
                onClick={handleConfirm}
                disabled={confirming}
                className="mt-5 w-full rounded-lg bg-amber-600 py-3 text-center font-medium text-white hover:bg-amber-700 disabled:opacity-50"
              >
                {confirming ? t("waitlistConfirm.confirming") : t("waitlistConfirm.confirmCta")}
              </button>
            </>
          ) : detail && detail.status === "booked" ? (
            <>
              <div className="flex justify-center text-green-600">
                <CheckCircle2 className="h-14 w-14" />
              </div>
              <h1 className="mt-4 text-center text-xl font-bold text-gray-900">
                {t("waitlistConfirm.alreadyBookedTitle")}
              </h1>
              <p className="mt-2 text-center text-sm text-gray-600">{t("waitlistConfirm.alreadyBookedDesc")}</p>
              <Link
                href="/book/query"
                className="mt-5 block w-full rounded-lg bg-amber-600 py-3 text-center font-medium text-white hover:bg-amber-700"
              >
                {t("waitlistConfirm.queryCta")}
              </Link>
            </>
          ) : detail ? (
            <>
              <div className="flex justify-center text-rose-500">
                <XCircle className="h-14 w-14" />
              </div>
              <h1 className="mt-4 text-center text-xl font-bold text-gray-900">
                {t("waitlistConfirm.expiredTitle")}
              </h1>
              <p className="mt-2 text-center text-sm text-gray-600">{t("waitlistConfirm.expiredDesc")}</p>
              <Link
                href="/book/waitlist"
                className="mt-5 block w-full rounded-lg bg-amber-600 py-3 text-center font-medium text-white hover:bg-amber-700"
              >
                {t("waitlistConfirm.rejoinCta")}
              </Link>
            </>
          ) : null}
        </div>
      </div>
    </main>
  );
}

export default function WaitlistConfirmPage() {
  const { t } = useLocale();

  return (
    <Suspense
      fallback={
        <main className="min-h-screen bg-gray-50 flex items-center justify-center">
          <p className="text-gray-500">{t("waitlistConfirm.loading")}</p>
        </main>
      }
    >
      <ConfirmContent />
    </Suspense>
  );
}
