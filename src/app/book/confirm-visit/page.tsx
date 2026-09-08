"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { CheckCircle2, CalendarCheck, AlertCircle } from "lucide-react";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { useLocale } from "@/lib/i18n/LocaleContext";

type Payload = {
  booking_code: string;
  customer_name: string;
  start_time: string;
  end_time: string;
  room_name: string;
  branch_name: string;
  guest_confirmed_at?: string | null;
  is_deposit_paid?: boolean;
};

function ConfirmVisitContent() {
  const { t } = useLocale();
  const searchParams = useSearchParams();
  const token = searchParams.get("token")?.trim() ?? "";
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<Payload | null>(null);
  const [done, setDone] = useState(false);

  const load = useCallback(async () => {
    if (!token) {
      setError(t("confirmVisit.missingToken"));
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/guest/confirm-attendance?token=${encodeURIComponent(token)}`);
      const json = await res.json();
      if (!res.ok) {
        setError(json.error ?? t("confirmVisit.loadFailed"));
        setData(null);
      } else {
        setData(json as Payload);
        if (json.guest_confirmed_at) setDone(true);
      }
    } catch {
      setError(t("confirmVisit.networkError"));
    } finally {
      setLoading(false);
    }
  }, [token, t]);

  useEffect(() => {
    load();
  }, [load]);

  async function confirm() {
    if (!token) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/guest/confirm-attendance", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error ?? t("confirmVisit.confirmFailed"));
      } else {
        setData(json as Payload);
        setDone(true);
      }
    } catch {
      setError(t("confirmVisit.networkError"));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="min-h-screen bg-gray-50">
      <header className="sticky top-0 z-10 border-b border-amber-100/60 bg-white/95 backdrop-blur-sm">
        <div className="mx-auto flex max-w-lg items-center justify-end px-4 py-3">
          <LanguageSwitcher />
        </div>
      </header>
      <div className="mx-auto max-w-lg px-4 py-10">
        <div className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
          {loading ? (
            <p className="text-center text-gray-500">{t("confirmVisit.loading")}</p>
          ) : error && !data ? (
            <div className="text-center">
              <AlertCircle className="mx-auto h-12 w-12 text-red-500" />
              <h1 className="mt-3 text-lg font-bold text-gray-900">{t("confirmVisit.errorTitle")}</h1>
              <p className="mt-2 text-sm text-red-700">{error}</p>
              <Link
                href="/book/query"
                className="mt-6 inline-block rounded-lg bg-amber-600 px-4 py-2.5 text-sm font-semibold text-white"
              >
                {t("confirmVisit.queryCta")}
              </Link>
            </div>
          ) : done && data ? (
            <div className="text-center">
              <CheckCircle2 className="mx-auto h-14 w-14 text-emerald-600" />
              <h1 className="mt-4 text-xl font-bold text-gray-900">{t("confirmVisit.successTitle")}</h1>
              <p className="mt-2 text-sm text-gray-600">{t("confirmVisit.successDesc")}</p>
              <p className="mt-4 font-mono text-lg font-bold text-amber-900">{data.booking_code}</p>
              <p className="mt-1 text-sm text-gray-700">
                {data.branch_name} · {data.room_name}
              </p>
              {data.start_time && data.end_time && (
                <p className="mt-1 text-xs text-amber-800 font-medium">
                  {new Date(data.start_time).toLocaleDateString("zh-TW", { timeZone: "Asia/Taipei" })}{" "}
                  {new Date(data.start_time).toLocaleTimeString("zh-TW", { timeZone: "Asia/Taipei", hour: "2-digit", minute: "2-digit", hour12: false })}
                  ～
                  {new Date(data.end_time).toLocaleTimeString("zh-TW", { timeZone: "Asia/Taipei", hour: "2-digit", minute: "2-digit", hour12: false })}
                </p>
              )}
              <Link
                href={`/book/query?code=${encodeURIComponent(data.booking_code)}`}
                className="mt-6 inline-block w-full rounded-lg bg-amber-600 py-3 text-center font-medium text-white hover:bg-amber-700 transition"
              >
                {t("confirmVisit.queryCta")}
              </Link>
            </div>
          ) : data ? (
            <>
              <div className="flex justify-center text-amber-600">
                <CalendarCheck className="h-12 w-12" />
              </div>
              <h1 className="mt-4 text-center text-xl font-bold text-gray-900">
                {t("confirmVisit.title")}
              </h1>
              <p className="mt-2 text-center text-sm text-gray-600">{t("confirmVisit.subtitle")}</p>
              <div className="mt-5 rounded-xl bg-amber-50 p-4 text-sm text-amber-950 space-y-1.5">
                <p>
                  <span className="text-amber-700">{t("confirmVisit.code")}</span>{" "}
                  <span className="font-mono font-bold">{data.booking_code}</span>
                </p>
                <p>
                  {data.customer_name} · {data.branch_name} {data.room_name}
                </p>
                {data.start_time && data.end_time && (
                  <p className="text-xs text-amber-800 font-medium">
                    {new Date(data.start_time).toLocaleDateString("zh-TW", { timeZone: "Asia/Taipei" })}{" "}
                    {new Date(data.start_time).toLocaleTimeString("zh-TW", { timeZone: "Asia/Taipei", hour: "2-digit", minute: "2-digit", hour12: false })}
                    ～
                    {new Date(data.end_time).toLocaleTimeString("zh-TW", { timeZone: "Asia/Taipei", hour: "2-digit", minute: "2-digit", hour12: false })}
                  </p>
                )}
              </div>
              {error && <p className="mt-3 text-center text-sm text-red-600">{error}</p>}
              <button
                type="button"
                disabled={submitting}
                onClick={confirm}
                className="mt-5 w-full min-h-11 rounded-lg bg-emerald-600 py-3 text-base font-semibold text-white hover:bg-emerald-700 disabled:opacity-60 transition"
              >
                {submitting ? t("confirmVisit.confirming") : t("confirmVisit.confirmCta")}
              </button>
              <Link
                href={`/book/query?code=${encodeURIComponent(data.booking_code)}`}
                className="mt-3 block w-full rounded-lg border border-gray-300 py-2.5 text-center text-sm font-medium text-gray-700 hover:bg-gray-50 transition"
              >
                {t("confirmVisit.manageCta")}
              </Link>
            </>
          ) : null}
        </div>
      </div>
    </main>
  );
}

export default function ConfirmVisitPage() {
  const { t } = useLocale();
  return (
    <Suspense
      fallback={
        <main className="flex min-h-screen items-center justify-center bg-gray-50">
          <p className="text-gray-500">{t("common.loading")}</p>
        </main>
      }
    >
      <ConfirmVisitContent />
    </Suspense>
  );
}
