"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { CheckCircle2, ArrowLeft, Clock, Copy, CalendarPlus, Calendar, MapPin, Phone, ExternalLink } from "lucide-react";
import { encodeLineBindState } from "@/lib/line-bind";
import { CopyBookingCodeButton } from "@/components/CopyBookingCodeButton";
import { useLocale } from "@/lib/i18n/LocaleContext";
import { CustomerShell } from "@/components/customer/CustomerShell";
import { loadBookingSuccessMeta, type BookingSuccessMeta } from "@/lib/booking-draft";
import {
  computeDepositDeadline,
  depositDeadlineRemainingMs,
  formatDepositDeadlineLabel,
  getDepositUrgency,
} from "@/lib/deposit-deadline";
import { formatBookingPolicyLines } from "@/lib/booking-policy";
import { buildGoogleCalendarUrl } from "@/lib/booking-ics";

const LINE_LOGIN_CLIENT_ID =
  process.env.NEXT_PUBLIC_LINE_LOGIN_CHANNEL_ID ?? "2009884734";
const PREORDER_ENABLED = process.env.NEXT_PUBLIC_RESERVATION_PREORDER_ENABLED === "1";

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
  const tokenFromUrl = searchParams.get("token") ?? "";
  const lineBound = searchParams.get("line_bound") === "1";
  const lineError = searchParams.get("line_error") === "1";
  const isPaid = searchParams.get("paid") === "1";
  const [bindPhone, setBindPhone] = useState("");
  const [meta, setMeta] = useState<BookingSuccessMeta | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [receiptCopied, setReceiptCopied] = useState(false);
  const [paymentInfoCopied, setPaymentInfoCopied] = useState(false);

  const effectiveToken = tokenFromUrl || meta?.lookupToken || "";

  const googleCalendarUrl = useMemo(() => {
    if (!code || !meta?.startTime) return null;
    const store = meta.branchName || "昇昇咖啡";
    const room = meta.roomName ? ` · ${meta.roomName}` : "";
    const endIso =
      meta.endTime ||
      new Date(new Date(meta.startTime).getTime() + 2 * 3600_000).toISOString();
    const origin = typeof window !== "undefined" ? window.location.origin : "";
    const manageUrl = origin
      ? effectiveToken
        ? `${origin}/book/query?token=${encodeURIComponent(effectiveToken)}`
        : `${origin}/book/query?code=${encodeURIComponent(code)}`
      : effectiveToken
      ? `/book/query?token=${encodeURIComponent(effectiveToken)}`
      : `/book/query?code=${encodeURIComponent(code)}`;
    return buildGoogleCalendarUrl({
      summary: `${store}${room}`,
      description: `訂位碼：${code}\n訂位人：${meta.customerName || "貴賓"}\n查看訂位：${manageUrl}`,
      location: meta.branchAddress || meta.branchName || "昇昇咖啡",
      startTime: meta.startTime,
      endTime: endIso,
    });
  }, [code, meta, effectiveToken]);

  async function copyPaymentInfo(text: string) {
    if (!text.trim()) return;
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
      setPaymentInfoCopied(true);
      window.setTimeout(() => setPaymentInfoCopied(false), 2000);
    } catch {
      /* ignore */
    }
  }

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
    const origin = typeof window !== "undefined" ? window.location.origin : "";
    const manageUrl = origin
      ? effectiveToken
        ? `${origin}/book/query?token=${encodeURIComponent(effectiveToken)}`
        : `${origin}/book/query?code=${encodeURIComponent(meta?.code ?? code)}`
      : effectiveToken
      ? `/book/query?token=${encodeURIComponent(effectiveToken)}`
      : `/book/query?code=${encodeURIComponent(meta?.code ?? code)}`;

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
      meta?.branchAddress ? `地址：${meta.branchAddress}` : null,
      `查詢／取消訂位：${manageUrl}`,
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
    <CustomerShell title={t("success.title")} backHref="/">
      <div className="py-6">
        <div className="rounded-2xl border border-green-200 bg-white p-6 shadow-lg">
          <div className="flex justify-center text-green-600">
            <CheckCircle2 className="h-14 w-14" />
          </div>
          {/* Header already exposes page title as the sole h1 via CustomerShell */}
          <p className="mt-4 text-center font-serif text-xl font-bold text-ink">{t("success.title")}</p>
          <p className="mt-2 text-center text-sm text-ink-soft">{t("success.subtitle")}</p>

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
              {meta?.paymentInfo && (
                <div className="mt-3 rounded-lg border border-amber-200 bg-white p-3 shadow-sm">
                  <div className="flex items-center justify-between gap-2 mb-1.5">
                    <p className="text-xs font-bold text-amber-900">{t("success.depositPaymentTitle")}</p>
                    <button
                      type="button"
                      onClick={() => copyPaymentInfo(meta.paymentInfo!)}
                      className="inline-flex items-center gap-1 text-xs font-semibold text-amber-700 hover:text-amber-800"
                    >
                      <Copy className="h-3.5 w-3.5" />
                      {paymentInfoCopied ? t("query.paymentInfoCopied") : t("query.copyPaymentInfo")}
                    </button>
                  </div>
                  <p className="whitespace-pre-line text-xs text-gray-800 font-mono leading-relaxed bg-amber-50/50 p-2.5 rounded border border-amber-100">
                    {meta.paymentInfo}
                  </p>
                  <p className="mt-1.5 text-xs text-amber-700">
                    {t("success.depositPaymentHint")}
                  </p>
                </div>
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

          <div className="mt-4 rounded-xl border border-gray-200 bg-gray-50 p-4">
            <p className="text-sm font-semibold text-gray-900">{t("book.form.policyTitle")}</p>
            <ul className="mt-2 space-y-1 text-xs text-gray-700">
              {formatBookingPolicyLines(undefined, t("book.form.cancelPolicy")).map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          </div>

          {(meta?.branchAddress || meta?.branchPhone) && (
            <div className="mt-4 rounded-xl border border-amber-200/80 bg-amber-50/50 p-4">
              <p className="text-sm font-semibold text-amber-950 mb-1">{t("common.storeInfo")}</p>
              <p className="font-medium text-sm text-gray-900">
                {meta.branchName || "昇昇咖啡"}
              </p>
              {meta.branchAddress && (
                <div className="mt-2 flex items-start gap-1.5 text-xs text-gray-700">
                  <MapPin className="h-4 w-4 shrink-0 text-amber-700 mt-0.5" />
                  <div>
                    <span>{meta.branchAddress}</span>
                    <a
                      href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(meta.branchAddress)}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="ml-2 inline-flex items-center gap-0.5 text-amber-700 underline hover:text-amber-800"
                    >
                      {t("common.openInMaps")}
                      <ExternalLink className="h-3 w-3" />
                    </a>
                  </div>
                </div>
              )}
              {meta.branchPhone && (
                <div className="mt-1.5 flex items-center gap-1.5 text-xs text-gray-700">
                  <Phone className="h-4 w-4 shrink-0 text-amber-700" />
                  <a href={`tel:${meta.branchPhone.replace(/[^\d+]/g, "")}`} className="hover:underline">
                    {meta.branchPhone}
                  </a>
                </div>
              )}
            </div>
          )}

          {code && (
            <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-2">
              {googleCalendarUrl && (
                <a
                  href={googleCalendarUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border border-amber-300 bg-amber-500 px-3 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-amber-600 transition"
                >
                  <CalendarPlus className="h-4 w-4" />
                  {t("calendar.google")}
                </a>
              )}
              {effectiveToken && (
                <a
                  href={`/api/guest/calendar?token=${encodeURIComponent(effectiveToken)}`}
                  className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border border-amber-200 bg-white px-3 py-2.5 text-sm font-semibold text-amber-950 hover:bg-amber-50 transition"
                >
                  <Calendar className="h-4 w-4" />
                  {t("calendar.apple")}
                </a>
              )}
            </div>
          )}

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
            {PREORDER_ENABLED && effectiveToken && meta?.reservationId && (
              <Link
                href={`/book/preorder?id=${encodeURIComponent(meta.reservationId)}&token=${encodeURIComponent(effectiveToken)}`}
                className="block w-full rounded-lg border border-emerald-300 bg-emerald-50 py-3 text-center font-medium text-emerald-900 hover:bg-emerald-100"
              >
                提前選擇預製餐點
              </Link>
            )}
            <Link
              href={
                effectiveToken
                  ? `/book/query?token=${encodeURIComponent(effectiveToken)}`
                  : code
                  ? `/book/query?code=${encodeURIComponent(code)}`
                  : "/book/query"
              }
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
    </CustomerShell>
  );
}

export default function BookSuccessPage() {
  const { t } = useLocale();
  return (
    <Suspense
      fallback={
        <CustomerShell title={t("success.title")}>
          <p className="text-center text-ink-soft">{t("common.loading")}</p>
        </CustomerShell>
      }
    >
      <SuccessContent />
    </Suspense>
  );
}
