"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { CheckCircle2, ArrowLeft, Clock, Copy } from "lucide-react";
import { encodeLineBindState } from "@/lib/line-bind";
import { CopyBookingCodeButton } from "@/components/CopyBookingCodeButton";
import { useLocale } from "@/lib/i18n/LocaleContext";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { loadBookingSuccessMeta, type BookingSuccessMeta } from "@/lib/booking-draft";
import {
  computeDepositDeadline,
  depositDeadlineRemainingMs,
  formatDepositDeadlineLabel,
  getDepositUrgency,
} from "@/lib/deposit-deadline";

const LINE_LOGIN_CLIENT_ID =
  process.env.NEXT_PUBLIC_LINE_LOGIN_CHANNEL_ID ?? "2009884734";

function formatRemain(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${m}:${String(s).padStart(2, "0")}`;
}

function SuccessContent() {
  const { t } = useLocale();
  const searchParams = useSearchParams();
  const code = searchParams.get("code") ?? "";
  const lineBound = searchParams.get("line_bound") === "1";
  const lineError = searchParams.get("line_error") === "1";
  const isPaid = searchParams.get("paid") === "1";
  const [bindPhone, setBindPhone] = useState("");
  const [meta, setMeta] = useState<BookingSuccessMeta | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [receiptCopied, setReceiptCopied] = useState(false);

  useEffect(() => {
    const saved = sessionStorage.getItem("booking_success_phone");
    if (saved) setBindPhone(saved);
    const m = loadBookingSuccessMeta();
    if (m && (!code || m.code === code)) setMeta(m);
  }, [code]);

  useEffect(() => {
    if (!code) return;
    const phone = sessionStorage.getItem("booking_success_phone")?.trim();
    if (!phone) return;
    fetch("/api/guest-events", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ event: "booking_success_viewed", phone, booking_code: code }),
    }).catch(() => {});
  }, [code]);

  useEffect(() => {
    if (isPaid || !meta?.createdAt || !meta.startTime) return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [isPaid, meta?.createdAt, meta?.startTime]);

  const deadlineInfo = useMemo(() => {
    if (!meta?.createdAt || !meta.startTime) return null;
    const deadline = computeDepositDeadline(meta.createdAt, meta.startTime);
    const remain = depositDeadlineRemainingMs(deadline, new Date(now));
    return {
      deadline,
      label: formatDepositDeadlineLabel(deadline),
      urgency: getDepositUrgency(deadline, new Date(now)),
      remain,
    };
  }, [meta, now]);

  async function copyReceipt() {
    if (!meta && !code) return;
    const lines = [
      meta?.branchName ? `店名：${meta.branchName}` : "店名：昇昇咖啡",
      meta?.roomName ? `包廂：${meta.roomName}` : null,
      meta?.customerName ? `訂位人：${meta.customerName}` : null,
      `訂位碼：${meta?.code ?? code}`,
      meta?.startTime
        ? `時段：${formatDepositDeadlineLabel(new Date(meta.startTime)).replace(/ \(.*\)$/, "")}${
            meta.endTime
              ? `–${formatDepositDeadlineLabel(new Date(meta.endTime)).slice(-5)}`
              : ""
          }`
        : null,
      meta?.depositAmount != null ? `訂金：$${meta.depositAmount}` : null,
      deadlineInfo ? `繳款期限：${deadlineInfo.label}` : null,
      "查詢／取消：開啟網站「查詢我的訂位」",
    ].filter(Boolean) as string[];
    const text = lines.join("\n");
    try {
      if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(text);
      else {
        const ta = document.createElement("textarea");
        ta.value = text;
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        document.body.removeChild(ta);
      }
      setReceiptCopied(true);
      window.setTimeout(() => setReceiptCopied(false), 2000);
    } catch {
      /* ignore */
    }
  }

  function startLineLogin() {
    if (!code || !bindPhone.trim()) return;
    const state = encodeLineBindState(code, bindPhone.trim());
    const url =
      `https://access.line.me/oauth2/v2.1/authorize` +
      `?response_type=code` +
      `&client_id=${LINE_LOGIN_CLIENT_ID}` +
      `&redirect_uri=${encodeURIComponent(window.location.origin + "/api/auth/line/callback")}` +
      `&state=${encodeURIComponent(state)}` +
      `&scope=profile`;
    window.location.href = url;
  }

  return (
    <main className="min-h-screen bg-gray-50">
      <header className="sticky top-0 z-10 border-b border-amber-100/60 bg-white/95 backdrop-blur-sm">
        <div className="mx-auto flex max-w-lg items-center justify-end px-4 py-3">
          <LanguageSwitcher />
        </div>
      </header>
      <div className="mx-auto max-w-lg px-4 py-12">
        <div className="rounded-2xl border border-green-200 bg-white p-6 shadow-lg">
          <div className="flex justify-center text-green-600">
            <CheckCircle2 className="h-14 w-14" />
          </div>
          <h1 className="mt-4 text-center text-xl font-bold text-gray-900">{t("success.title")}</h1>
          <p className="mt-2 text-center text-sm text-gray-500">{t("success.subtitle")}</p>

          {code && (
            <div className="mt-6 rounded-xl bg-amber-50 p-4 text-center">
              <p className="text-sm text-amber-800">{t("success.codeLabel")}</p>
              <p className="mt-1 font-mono text-2xl font-bold tracking-wider text-amber-900">
                {code}
              </p>
              <div className="mt-3 flex flex-wrap justify-center gap-2">
                <CopyBookingCodeButton code={code} />
                <button
                  type="button"
                  onClick={copyReceipt}
                  className="inline-flex min-h-11 items-center gap-1.5 rounded-lg border border-amber-300 bg-white px-3 py-2 text-sm font-medium text-amber-900 hover:bg-amber-50"
                >
                  <Copy className="h-4 w-4" />
                  {receiptCopied ? t("success.receiptCopied") : t("success.copyReceipt")}
                </button>
              </div>
              <p className="mt-3 text-xs text-amber-700">{t("success.codeHint")}</p>
            </div>
          )}

          {isPaid && (
            <div className="mt-5 rounded-xl border border-green-200 bg-green-50 p-4">
              <div className="flex items-center gap-2 mb-2">
                <CheckCircle2 className="h-4 w-4 text-green-600 shrink-0" />
                <p className="font-semibold text-green-800">{t("success.paidTitle")}</p>
              </div>
              <p className="text-sm text-green-700 leading-relaxed">{t("success.paidBody")}</p>
            </div>
          )}

          {!isPaid && deadlineInfo && (
            <div
              className={`mt-5 rounded-xl border p-4 ${
                deadlineInfo.urgency === "past"
                  ? "border-red-200 bg-red-50"
                  : deadlineInfo.urgency === "soon"
                    ? "border-orange-200 bg-orange-50"
                    : "border-amber-200 bg-amber-50"
              }`}
            >
              <div className="flex items-center gap-2 mb-2">
                <Clock className="h-4 w-4 shrink-0 text-amber-700" />
                <p className="font-semibold text-amber-900">{t("success.depositDeadlineTitle")}</p>
              </div>
              <p className="text-sm text-amber-900">
                {t("success.depositDeadlineBody", { deadline: deadlineInfo.label })}
              </p>
              {deadlineInfo.urgency !== "past" && (
                <p className="mt-2 font-mono text-lg font-bold tabular-nums text-amber-950">
                  {t("success.depositCountdown", { remain: formatRemain(deadlineInfo.remain) })}
                </p>
              )}
              {meta?.depositAmount != null && (
                <p className="mt-1 text-sm text-amber-800">
                  {t("success.depositAmount", { amount: String(meta.depositAmount) })}
                </p>
              )}
            </div>
          )}

          <div className="mt-5 rounded-xl border border-blue-100 bg-blue-50 p-4">
            <div className="flex items-center gap-2 mb-2">
              <Clock className="h-4 w-4 text-blue-500 shrink-0" />
              <p className="font-semibold text-blue-800">{t("success.pendingTitle")}</p>
            </div>
            <p className="text-sm text-blue-700 leading-relaxed">
              {t("success.pendingBodyPrefix")}
              <strong>{t("success.pendingBodyBold")}</strong>
              {t("success.pendingBodySuffix")}
            </p>
          </div>

          {code && (
            <div className="mt-4 rounded-xl border border-green-100 bg-green-50 p-4">
              {lineBound ? (
                <div className="text-center">
                  <p className="text-sm font-semibold text-green-800">{t("success.lineBoundTitle")}</p>
                  <p className="text-xs text-green-700 mt-1">{t("success.lineBoundDesc")}</p>
                </div>
              ) : (
                <>
                  <p className="text-sm font-semibold text-green-800 mb-1">{t("success.lineBindTitle")}</p>
                  <p className="text-xs text-green-700 leading-relaxed mb-3">{t("success.lineBindDesc")}</p>
                  <input
                    type="tel"
                    value={bindPhone}
                    onChange={(e) => setBindPhone(e.target.value)}
                    placeholder={t("success.phonePlaceholder")}
                    className="mb-3 w-full rounded-lg border border-green-200 px-3 py-2 text-sm"
                  />
                  <button
                    onClick={startLineLogin}
                    disabled={!bindPhone.trim()}
                    className="inline-flex items-center gap-2 rounded-lg bg-[#06C755] px-4 py-2 text-sm font-semibold text-white hover:bg-green-600 transition disabled:opacity-50"
                  >
                    <span>💬</span>
                    {t("success.lineBindButton")}
                  </button>
                  {lineError && (
                    <p className="mt-2 text-xs text-red-600">{t("success.lineError")}</p>
                  )}
                </>
              )}
            </div>
          )}

          <div className="mt-4 space-y-3">
            <Link
              href={code ? `/book/query?code=${encodeURIComponent(code)}` : "/book/query"}
              className="block w-full rounded-lg bg-amber-600 py-3 text-center font-medium text-white hover:bg-amber-700"
            >
              {t("success.queryCta")}
            </Link>
            <Link
              href="/"
              className="flex items-center justify-center gap-2 py-2 text-gray-600 hover:text-gray-900"
            >
              <ArrowLeft className="h-4 w-4" /> {t("success.homeCta")}
            </Link>
          </div>
        </div>
      </div>
    </main>
  );
}

export default function BookSuccessPage() {
  const { t } = useLocale();
  return (
    <Suspense
      fallback={
        <main className="min-h-screen bg-gray-50 flex items-center justify-center">
          <p className="text-gray-500">{t("common.loading")}</p>
        </main>
      }
    >
      <SuccessContent />
    </Suspense>
  );
}
