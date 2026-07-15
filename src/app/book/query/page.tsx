"use client";

import { useState, useEffect, useCallback, useRef, Suspense, useMemo } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import Image from "next/image";
import { ArrowLeft, Calendar, Clock } from "lucide-react";
import { format, parseISO } from "date-fns";
import { enUS, ja, zhTW } from "date-fns/locale";
import { useLocale } from "@/lib/i18n/LocaleContext";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { computeDepositDeadline, getDepositUrgency } from "@/lib/deposit-deadline";
import { toTaipei, formatTaipeiTime } from "@/lib/datetime";
import {
  availableStarts,
  durationHoursBetween,
} from "@/lib/slot-grid";

interface BookingItem {
  id: string;
  booking_code: string;
  room_id: string;
  branch_id: string | null;
  room_name: string;
  branch_name: string;
  branch_display_name?: string | null;
  payment_info?: string | null;
  line_pay_url?: string | null;
  start_time: string;
  end_time: string;
  status: string;
  total_price: number | null;
  guest_count: number | null;
  customer_name: string;
  deposit_required: boolean;
  deposit_amount: number | null;
  is_deposit_paid?: boolean;
  created_at: string;
  guest_confirmed_at?: string | null;
  confirm_attendance_url?: string | null;
  payment_review_status?: "pending_review" | "approved" | "rejected" | null;
}

interface AvailabilitySlot {
  start: string;
  end: string;
  available: boolean;
}

const OFFICIAL_LINE_URL =
  process.env.NEXT_PUBLIC_OFFICIAL_LINE_URL?.trim() || "https://lin.ee/cxcV0lo";

function QueryLoadingFallback() {
  const { t } = useLocale();
  return (
    <main className="min-h-screen bg-gradient-to-b from-amber-50/40 to-white flex items-center justify-center">
      <p className="text-gray-500">{t("common.loading")}</p>
    </main>
  );
}

export default function BookQueryPage() {
  return (
    <Suspense fallback={<QueryLoadingFallback />}>
      <BookQueryContent />
    </Suspense>
  );
}

function BookQueryContent() {
  const { t, locale } = useLocale();
  const dateFnsLocale = locale === "en" ? enUS : locale === "ja" ? ja : zhTW;
  const searchParams = useSearchParams();
  const STATUS_LABELS: Record<string, string> = {
    pending: t("query.status.pending"),
    confirmed: t("query.status.confirmed"),
    checked_in: t("query.status.checked_in"),
    cancelled: t("query.status.cancelled"),
    completed: t("query.status.completed"),
  };
  const [phone, setPhone] = useState("");
  const [bookingCode, setBookingCode] = useState("");
  const [bookingDate, setBookingDate] = useState("");
  const [forgotMode, setForgotMode] = useState(false);
  const [list, setList] = useState<BookingItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cancellingId, setCancellingId] = useState<string | null>(null);
  const [confirmingCancelId, setConfirmingCancelId] = useState<string | null>(null);
  const [pendingReschedule, setPendingReschedule] = useState<{ start: string; end: string } | null>(null);
  const reschedulePanelRef = useRef<HTMLDivElement | null>(null);
  const [reschedulingItem, setReschedulingItem] = useState<BookingItem | null>(null);
  const [rescheduleDate, setRescheduleDate] = useState("");
  const [rescheduleSlots, setRescheduleSlots] = useState<AvailabilitySlot[]>([]);
  const [rescheduleSlotsLoading, setRescheduleSlotsLoading] = useState(false);
  const [rescheduleGuestCount, setRescheduleGuestCount] = useState<number | "">("");
  const [rescheduleSubmitting, setRescheduleSubmitting] = useState(false);
  const [rescheduleError, setRescheduleError] = useState<string | null>(null);
  const [hasSearched, setHasSearched] = useState(false);
  const depositViewedRef = useRef<Set<string>>(new Set());
  const stickyViewedRef = useRef(false);

  const unpaidDepositItems = useMemo(
    () =>
      list.filter((item) => {
        const isConfirmed = item.status === "confirmed" || item.status === "checked_in";
        return (
          item.deposit_required &&
          isConfirmed &&
          !item.is_deposit_paid &&
          item.status !== "cancelled"
        );
      }),
    [list]
  );

  const [stickyDepositIndex, setStickyDepositIndex] = useState(0);
  const unpaidDepositItem = unpaidDepositItems[stickyDepositIndex] ?? unpaidDepositItems[0] ?? null;

  useEffect(() => {
    setStickyDepositIndex(0);
    stickyViewedRef.current = false;
  }, [unpaidDepositItems.length, phone, bookingCode]);

  const trackGuestEvent = useCallback(
    (event: string, code?: string) => {
      const codeVal = (code ?? bookingCode).trim();
      if (!phone.trim() || !codeVal) return;
      fetch("/api/guest-events", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          event,
          phone: phone.trim(),
          booking_code: codeVal,
        }),
      }).catch(() => {});
    },
    [phone, bookingCode]
  );

  const runSearch = useCallback(
    async (phoneVal: string, codeOrDate: string, mode: "code" | "date") => {
      if (!phoneVal.trim() || !codeOrDate.trim()) return;
      setLoading(true);
      setError(null);
      setList([]);
      try {
        const body =
          mode === "code"
            ? { phone: phoneVal.trim(), booking_code: codeOrDate.trim() }
            : { phone: phoneVal.trim(), booking_date: codeOrDate.trim() };
        const res = await fetch("/api/my-bookings", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        const data = await res.json();
        if (!res.ok) {
          setError((data as { error?: string })?.error ?? t("query.searchFailed"));
          return;
        }
        const items = Array.isArray(data) ? (data as BookingItem[]) : [];
        setList(items);
        // After date recovery, seed form code so cancel/reschedule auth works
        if (mode === "date" && items[0]?.booking_code) {
          setBookingCode(items[0].booking_code);
          setForgotMode(false);
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : t("query.connectionFailed"));
      } finally {
        setLoading(false);
        setHasSearched(true);
      }
    },
    [t]
  );

  useEffect(() => {
    const codeFromUrl = searchParams.get("code");
    const codeVal = codeFromUrl ? codeFromUrl.trim().toUpperCase() : "";
    if (codeVal) setBookingCode(codeVal);

    const savedPhone = sessionStorage.getItem("booking_success_phone") ?? "";
    if (savedPhone) setPhone(savedPhone);

    if (savedPhone && codeVal) {
      runSearch(savedPhone, codeVal, "code");
    }
  }, [searchParams, runSearch]);

  const search = async (e: React.FormEvent) => {
    e.preventDefault();
    if (forgotMode) {
      await runSearch(phone, bookingDate, "date");
    } else {
      await runSearch(phone, bookingCode, "code");
    }
  };

  const cancel = async (id: string, code: string) => {
    setCancellingId(id);
    setConfirmingCancelId(null);
    setError(null);
    try {
      const res = await fetch("/api/cancel-booking", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id,
          booking_code: code.trim(),
          phone: phone.trim(),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError((data as { error?: string })?.error ?? t("query.cancelFailed"));
        return;
      }
      setList((prev) => prev.filter((r) => r.id !== id));
    } catch (e) {
      setError(e instanceof Error ? e.message : t("query.connectionFailed"));
    } finally {
      setCancellingId(null);
    }
  };

  const CANCEL_WINDOW_MS = 24 * 60 * 60 * 1000;

  const canCancel = (item: BookingItem) => {
    if (item.status === "cancelled") return false;
    const start = new Date(item.start_time).getTime();
    return Date.now() + CANCEL_WINDOW_MS <= start;
  };

  const cancelDeadline = (item: BookingItem) => {
    const d = new Date(new Date(item.start_time).getTime() - CANCEL_WINDOW_MS);
    return format(d, "yyyy/MM/dd (EEE) HH:mm", { locale: dateFnsLocale });
  };

  const depositDeadlineLabel = (item: BookingItem) => {
    if (!item.created_at) return "";
    const deadline = computeDepositDeadline(item.created_at, item.start_time);
    return format(toTaipei(deadline.toISOString()), "yyyy/MM/dd (EEE) HH:mm", {
      locale: dateFnsLocale,
    });
  };

  const depositUrgency = (item: BookingItem) => {
    if (!item.created_at) return "ok" as const;
    return getDepositUrgency(computeDepositDeadline(item.created_at, item.start_time));
  };

  const canReschedule = (item: BookingItem) => {
    if (!["pending", "confirmed"].includes(item.status)) return false;
    return canCancel(item);
  };

  const durationHoursOf = (item: BookingItem) =>
    durationHoursBetween(item.start_time, item.end_time);

  const openReschedule = (item: BookingItem) => {
    setReschedulingItem(item);
    setRescheduleDate("");
    setRescheduleSlots([]);
    setRescheduleGuestCount(item.guest_count ?? "");
    setRescheduleError(null);
    setPendingReschedule(null);
  };

  const closeReschedule = () => {
    setReschedulingItem(null);
    setRescheduleSlots([]);
    setRescheduleError(null);
    setPendingReschedule(null);
  };

  useEffect(() => {
    if (!reschedulingItem) return;
    reschedulePanelRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    const input = document.getElementById(`reschedule-date-${reschedulingItem.id}`);
    if (input instanceof HTMLInputElement) {
      input.focus();
    }
  }, [reschedulingItem]);

  useEffect(() => {
    for (const item of list) {
      const isConfirmed = item.status === "confirmed" || item.status === "checked_in";
      if (
        item.deposit_required &&
        isConfirmed &&
        !item.is_deposit_paid &&
        !depositViewedRef.current.has(item.id)
      ) {
        depositViewedRef.current.add(item.id);
        trackGuestEvent("deposit_instructions_viewed", item.booking_code);
      }
    }
  }, [list, trackGuestEvent]);

  useEffect(() => {
    if (!unpaidDepositItem || stickyViewedRef.current) return;
    stickyViewedRef.current = true;
    trackGuestEvent("payment_sticky_viewed", unpaidDepositItem.booking_code);
  }, [unpaidDepositItem, trackGuestEvent]);

  const fetchRescheduleSlots = async (date: string) => {
    if (!reschedulingItem?.branch_id || !date) return;
    setRescheduleDate(date);
    setPendingReschedule(null);
    setRescheduleSlotsLoading(true);
    setRescheduleError(null);
    setRescheduleSlots([]);
    try {
      const res = await fetch(
        `/api/availability?branchId=${encodeURIComponent(reschedulingItem.branch_id)}&roomId=${encodeURIComponent(reschedulingItem.room_id)}&date=${encodeURIComponent(date)}`
      );
      const data = await res.json();
      if (!res.ok || data?.closed) {
        setRescheduleError(data?.error ?? t("query.rescheduleClosedDay"));
        return;
      }
      setRescheduleSlots(Array.isArray(data.slots) ? data.slots : []);
    } catch (e) {
      setRescheduleError(e instanceof Error ? e.message : t("query.rescheduleSlotsFailed"));
    } finally {
      setRescheduleSlotsLoading(false);
    }
  };

  // 連續半小時格、長度等於原訂位時長的起始時段（支援 13:30、2.5h）
  const validRescheduleStarts = () => {
    if (!reschedulingItem) return [];
    return availableStarts(rescheduleSlots, durationHoursOf(reschedulingItem));
  };

  const confirmReschedule = async (start: string, end: string) => {
    if (!reschedulingItem) return;
    setRescheduleSubmitting(true);
    setRescheduleError(null);
    try {
      const res = await fetch("/api/reschedule-booking", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: reschedulingItem.id,
          booking_code: reschedulingItem.booking_code.trim(),
          phone: phone.trim(),
          start_time: start,
          end_time: end,
          guest_count: rescheduleGuestCount === "" ? null : Number(rescheduleGuestCount),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setRescheduleError((data as { error?: string })?.error ?? t("query.rescheduleFailed"));
        return;
      }
      setList((prev) =>
        prev.map((r) =>
          r.id === reschedulingItem.id
            ? {
                ...r,
                start_time: start,
                end_time: end,
                guest_count: rescheduleGuestCount === "" ? r.guest_count : Number(rescheduleGuestCount),
              }
            : r
        )
      );
      closeReschedule();
    } catch (e) {
      setRescheduleError(e instanceof Error ? e.message : t("query.connectionFailed"));
    } finally {
      setRescheduleSubmitting(false);
    }
  };

  return (
    <main className="min-h-screen bg-gradient-to-b from-amber-50/40 to-white">
      <header className="sticky top-0 z-10 border-b border-amber-100/60 bg-white/95 backdrop-blur-sm">
        <div className="mx-auto flex max-w-lg items-center justify-between gap-3 px-4 py-3">
          <div className="flex items-center gap-3">
            <Link
              href="/"
              className="flex items-center justify-center rounded-lg p-2 text-stone-500 hover:bg-amber-50"
              aria-label={t("common.back")}
            >
              <ArrowLeft className="h-5 w-5" />
            </Link>
            <div className="flex items-center gap-2">
              <div className="relative h-7 w-7">
                <Image src="/logo.webp" alt="" fill className="object-contain" />
              </div>
              <h1 className="text-base font-medium tracking-wide text-stone-800">{t("query.headerTitle")}</h1>
            </div>
          </div>
          <LanguageSwitcher />
        </div>
      </header>

      <div className={`mx-auto max-w-lg px-4 py-6 ${unpaidDepositItem ? "pb-sticky-form" : ""}`}>
        <form onSubmit={search} className="mb-6 space-y-3">
          <div className="flex gap-2">
            <label htmlFor="query-phone" className="sr-only">{t("query.phonePlaceholder")}</label>
            <input
              id="query-phone"
              type="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder={t("query.phonePlaceholder")}
              className="flex-1 rounded-lg border border-gray-300 px-4 py-2.5"
              required
              autoComplete="tel"
            />
          </div>
          {forgotMode ? (
            <div>
              <label htmlFor="query-booking-date" className="sr-only">
                {t("query.bookingDatePlaceholder")}
              </label>
              <input
                id="query-booking-date"
                type="date"
                value={bookingDate}
                onChange={(e) => setBookingDate(e.target.value)}
                className="w-full rounded-lg border border-gray-300 px-4 py-2.5"
                required
              />
            </div>
          ) : (
            <div>
              <label htmlFor="query-booking-code" className="sr-only">{t("query.bookingCodePlaceholder")}</label>
              <input
                id="query-booking-code"
                type="text"
                value={bookingCode}
                onChange={(e) => setBookingCode(e.target.value.toUpperCase())}
                placeholder={t("query.bookingCodePlaceholder")}
                className="w-full rounded-lg border border-gray-300 px-4 py-2.5 font-mono uppercase tracking-wider"
                required
                maxLength={6}
                autoComplete="off"
                spellCheck={false}
              />
            </div>
          )}
          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-lg bg-amber-600 px-4 py-2.5 text-white disabled:opacity-50"
          >
            {loading ? t("query.searching") : t("query.searchButton")}
          </button>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs text-gray-500">
              {forgotMode ? t("query.bookingDateHint") : t("query.bookingCodeHint")}
            </p>
            <button
              type="button"
              onClick={() => {
                setForgotMode((v) => !v);
                setError(null);
                setHasSearched(false);
                setList([]);
              }}
              className="text-xs font-medium text-amber-700 underline-offset-2 hover:underline"
            >
              {forgotMode ? t("query.useCodeInstead") : t("query.forgotCode")}
            </button>
          </div>
        </form>

        {error && (
          <div
            role="alert"
            className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800"
          >
            {error}
          </div>
        )}

        {hasSearched &&
          list.length === 0 &&
          !loading &&
          phone &&
          (forgotMode ? bookingDate : bookingCode) && (
          <p className="text-center text-gray-500">{t("query.empty")}</p>
        )}

        <ul className="space-y-4">
          {list.map((item) => {
            const isConfirmed = item.status === "confirmed" || item.status === "checked_in";
            return (
              <li
                key={item.id}
                className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm"
              >
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="font-medium text-gray-900">
                      {item.branch_name} · {item.room_name}
                    </p>
                    <p className="mt-0.5 text-sm text-gray-500">
                      {t("query.bookingCode")}<span className="font-mono">{item.booking_code}</span>
                    </p>
                    {phone.trim() && item.status !== "cancelled" && (
                      <a
                        href={`/api/guest/calendar?code=${encodeURIComponent(item.booking_code)}&phone=${encodeURIComponent(phone.trim())}`}
                        className="mt-2 inline-flex min-h-10 items-center gap-1.5 rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-1.5 text-xs font-semibold text-amber-950 hover:bg-amber-100"
                      >
                        {t("query.addToCalendar")}
                      </a>
                    )}
                    <p className="mt-1 flex items-center gap-1 text-sm text-gray-600">
                      <Calendar className="h-4 w-4" />
                      {format(parseISO(item.start_time), "yyyy/MM/dd (EEE)", {
                        locale: dateFnsLocale,
                      })}
                    </p>
                    <p className="flex items-center gap-1 text-sm text-gray-600">
                      <Clock className="h-4 w-4" />
                      {format(parseISO(item.start_time), "HH:mm")}–
                      {format(parseISO(item.end_time), "HH:mm")}
                    </p>
                    {item.total_price != null && (
                      <p className="mt-0.5 text-sm text-gray-600">${item.total_price}</p>
                    )}
                  </div>
                  <span
                    className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs font-medium ${
                      item.status === "cancelled"
                        ? "bg-gray-100 text-gray-600"
                        : item.status === "pending"
                          ? "bg-yellow-100 text-yellow-800"
                          : "bg-amber-100 text-amber-800"
                    }`}
                  >
                    {STATUS_LABELS[item.status] ?? item.status}
                  </span>
                </div>

                {/* 待審核提示 — pending 且需收訂金時顯示 */}
                {item.status === "pending" && item.deposit_required && (
                  <div className="mt-3 rounded-lg border border-yellow-200 bg-yellow-50 p-3 text-sm">
                    <p className="font-semibold text-yellow-800">{t("query.pendingReviewTitle")}</p>
                    <p className="mt-1 text-yellow-700">
                      {t("query.pendingReviewDesc")}
                    </p>
                  </div>
                )}

                {/* 付款審核狀態（截圖已送／被退回）*/}
                {!item.is_deposit_paid && item.payment_review_status === "pending_review" && (
                  <div className="mt-3 rounded-lg border border-blue-200 bg-blue-50 p-3 text-sm text-blue-900">
                    {t("query.paymentReviewPending")}
                  </div>
                )}
                {!item.is_deposit_paid && item.payment_review_status === "rejected" && (
                  <div role="alert" className="mt-3 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-900">
                    {t("query.paymentReviewRejected")}
                  </div>
                )}

                {/* 出席確認狀態 */}
                {["pending", "confirmed"].includes(item.status) && (
                  <div
                    className={`mt-3 rounded-lg border p-3 text-sm ${
                      item.guest_confirmed_at
                        ? "border-sky-200 bg-sky-50 text-sky-900"
                        : "border-gray-200 bg-gray-50 text-gray-700"
                    }`}
                  >
                    {item.guest_confirmed_at ? (
                      <p>{t("query.attendanceConfirmed")}</p>
                    ) : (
                      <div className="space-y-2">
                        <p>
                          {item.confirm_attendance_url
                            ? t("query.attendanceReady")
                            : t("query.attendancePending")}
                        </p>
                        {item.confirm_attendance_url && (
                          <a
                            href={item.confirm_attendance_url}
                            className="inline-flex min-h-[44px] items-center justify-center rounded-lg bg-sky-700 px-4 py-2 text-sm font-semibold text-white hover:bg-sky-800"
                          >
                            {t("query.attendanceConfirmCta")}
                          </a>
                        )}
                      </div>
                    )}
                  </div>
                )}

                {/* 訂金繳費資訊 — 管理員確認後才顯示 */}
                {item.deposit_required && isConfirmed && item.status !== "cancelled" && (
                  <div className="mt-4 rounded-xl border-2 border-amber-300 bg-amber-50 p-4 sm:p-5 text-base shadow-sm">
                    {item.is_deposit_paid ? (
                      <div className="flex items-center gap-3 text-emerald-800">
                        <div className="flex h-10 w-10 items-center justify-center rounded-full bg-emerald-100 shrink-0">
                          <span className="text-xl">✅</span>
                        </div>
                        <div>
                          <p className="font-bold text-lg">{t("query.depositPaidTitle")}</p>
                          <p className="text-sm mt-0.5 opacity-90">{t("query.depositPaidDesc")}</p>
                        </div>
                      </div>
                    ) : (
                      <>
                        <p className="font-bold text-lg text-amber-900 border-b border-amber-200 pb-2 mb-3">
                          {t("query.depositNeededTitle")}
                        </p>
                        <div className="space-y-2 text-gray-800 text-base">
                          {item.deposit_amount != null && (
                            <p className="flex items-center gap-2">
                              {t("query.depositHalfLabel")}
                              <span className="font-bold text-lg text-amber-700 font-mono tracking-wide">
                                NT$ {item.deposit_amount}
                              </span>
                            </p>
                          )}
                          <p className="text-sm text-amber-700 bg-amber-100 inline-block px-2 py-1 rounded">
                            {t("query.weekendDepositNote")}
                          </p>
                          {item.created_at && depositUrgency(item) === "past" ? (
                            <p
                              role="alert"
                              className="mt-2 rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm font-medium text-red-800"
                            >
                              {t("query.depositDeadlinePast", { deadline: depositDeadlineLabel(item) })}
                            </p>
                          ) : (
                            <p
                              className={`mt-2 rounded-lg border px-3 py-2 text-sm ${
                                depositUrgency(item) === "soon"
                                  ? "border-orange-300 bg-orange-50 font-medium text-orange-900"
                                  : "border-amber-200 bg-white text-amber-900"
                              }`}
                            >
                              {depositUrgency(item) === "soon"
                                ? t("query.depositDeadlineSoon", { deadline: depositDeadlineLabel(item) })
                                : t("query.depositDeadlineLabel", { deadline: depositDeadlineLabel(item) })}
                            </p>
                          )}
                        </div>

                        {/* 匯款帳戶 + LINE Pay + 官方 LINE */}
                        <div className="mt-5 rounded-lg border-2 border-gray-200 bg-white p-4 text-base text-gray-800 shadow-sm">
                          <p className="font-bold text-xl text-gray-900 mb-3 border-b-2 border-gray-100 pb-2">
                            {t("query.paymentStepsTitle")}
                          </p>

                          <div className="mb-5 pl-3 border-l-4 border-amber-400 bg-gray-50 p-3 rounded-r-lg">
                            <p className="font-bold text-lg text-amber-800 mb-2">
                              {t("query.step1Title")}
                            </p>
                            {item.payment_info?.trim() ? (
                              <div className="bg-white p-3 rounded border border-gray-200 shadow-sm mb-3 whitespace-pre-line text-base">
                                {item.payment_info.trim()}
                              </div>
                            ) : (
                              <p className="text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded p-3 mb-3">
                                {t("query.paymentInfoFallback")}
                              </p>
                            )}

                            {item.line_pay_url?.trim() && (
                              <>
                                <div className="flex items-center gap-3 my-2 opacity-60">
                                  <div className="h-px flex-1 bg-gray-300"></div>
                                  <span className="font-medium text-sm">{t("query.or")}</span>
                                  <div className="h-px flex-1 bg-gray-300"></div>
                                </div>

                                <div className="mt-2 text-center">
                                  <a
                                    href={item.line_pay_url.trim()}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    onClick={() => trackGuestEvent("payment_line_pay_click")}
                                    className="inline-flex w-full sm:w-auto justify-center items-center gap-2 rounded-lg bg-[#06C755] px-6 py-3 text-base font-bold text-white shadow hover:bg-[#05b34c] transition"
                                  >
                                    <span className="bg-white text-[#06C755] p-1 rounded font-black text-xs">LINE Pay</span>
                                    {t("query.linePayButton")}
                                  </a>
                                </div>
                              </>
                            )}
                          </div>

                          <div className="pl-3 border-l-4 border-[#06C755] bg-green-50/50 p-3 rounded-r-lg">
                            <p className="font-bold text-lg text-[#06C755] mb-2">
                              {t("query.step2Title")}
                            </p>
                            <p className="mb-4 text-gray-700 leading-relaxed text-base">
                              {t("query.step2DescPart1")}<strong>{t("query.step2DescBold1")}</strong>{t("query.step2DescPart2")}<strong>{t("query.step2DescBold2")}</strong>{t("query.step2DescPart3")}
                            </p>
                            <a
                              href={OFFICIAL_LINE_URL}
                              target="_blank"
                              rel="noopener noreferrer"
                              onClick={() => trackGuestEvent("payment_line_official_click")}
                              className="inline-flex w-full sm:w-auto justify-center items-center gap-2 rounded-lg border-2 border-[#06C755] bg-white px-6 py-3 text-base font-bold text-[#06C755] shadow-sm hover:bg-green-50 transition"
                            >
                              <span className="text-xl">💬</span>
                              {t("query.officialLineButton")}
                            </a>
                          </div>
                        </div>
                      </>
                    )}
                  </div>
                )}

                {/* 注意事項提醒 — 所有已確認的訂位都顯示 */}
                {isConfirmed && (
                  <div className="mt-2 rounded-lg border border-gray-200 bg-gray-50 p-2.5 text-xs text-gray-500">
                    {t("query.rentalReminder")}
                  </div>
                )}

                {canCancel(item) && (
                  <div className="mt-3 space-y-2">
                    <p className="text-xs text-gray-400">
                      {t("query.cancelDeadlineLabel", { deadline: cancelDeadline(item) })}
                    </p>
                    {confirmingCancelId === item.id && (
                      <div
                        role="alertdialog"
                        aria-modal="true"
                        aria-labelledby={`cancel-title-${item.id}`}
                        className="rounded-lg border border-red-200 bg-red-50 p-3 space-y-2"
                      >
                        <p id={`cancel-title-${item.id}`} className="text-sm font-medium text-red-900">
                          {t("query.cancelConfirmTitle")}
                        </p>
                        {item.is_deposit_paid && (
                          <p className="text-sm text-red-800">{t("query.cancelConfirmDepositWarning")}</p>
                        )}
                        <div className="flex gap-2">
                          <button
                            type="button"
                            onClick={() => setConfirmingCancelId(null)}
                            className="flex-1 rounded-lg border border-gray-300 bg-white py-2 text-sm text-gray-700 hover:bg-gray-50"
                          >
                            {t("query.cancelConfirmKeep")}
                          </button>
                          <button
                            type="button"
                            disabled={cancellingId === item.id}
                            onClick={() => cancel(item.id, item.booking_code)}
                            className="flex-1 rounded-lg bg-red-600 py-2 text-sm text-white hover:bg-red-700 disabled:opacity-50"
                          >
                            {cancellingId === item.id ? t("query.cancelling") : t("query.cancelConfirmProceed")}
                          </button>
                        </div>
                      </div>
                    )}
                    <div className="flex gap-2">
                      {canReschedule(item) && (
                        <button
                          type="button"
                          onClick={() =>
                            reschedulingItem?.id === item.id ? closeReschedule() : openReschedule(item)
                          }
                          className="flex-1 rounded-lg border border-amber-300 py-2 text-center text-sm text-amber-700 hover:bg-amber-50"
                        >
                          {reschedulingItem?.id === item.id ? t("query.rescheduleCancelButton") : t("query.rescheduleButton")}
                        </button>
                      )}
                      {confirmingCancelId !== item.id && (
                        <button
                          type="button"
                          disabled={cancellingId === item.id}
                          onClick={() => setConfirmingCancelId(item.id)}
                          className="flex-1 rounded-lg border border-red-200 py-2 text-sm text-red-700 hover:bg-red-50 disabled:opacity-50"
                        >
                          {t("query.cancelButton")}
                        </button>
                      )}
                    </div>
                  </div>
                )}
                {item.status !== "cancelled" && !canCancel(item) && (
                  <p className="mt-2 text-xs text-gray-500">
                    {t("query.cancelExpired", { deadline: cancelDeadline(item) })}
                  </p>
                )}

                {reschedulingItem?.id === item.id && (
                  <div
                    ref={reschedulePanelRef}
                    className="mt-3 rounded-lg border border-amber-200 bg-amber-50/60 p-3 space-y-3"
                  >
                    <label htmlFor={`reschedule-date-${item.id}`} className="block text-sm font-medium text-amber-900">
                      {t("query.reschedulePickDate", { hours: durationHoursOf(item) })}
                    </label>
                    <input
                      id={`reschedule-date-${item.id}`}
                      type="date"
                      value={rescheduleDate}
                      min={format(new Date(Date.now() + CANCEL_WINDOW_MS), "yyyy-MM-dd")}
                      onChange={(e) => fetchRescheduleSlots(e.target.value)}
                      className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                    />

                    <div>
                      <label htmlFor={`reschedule-guests-${item.id}`} className="block text-xs text-gray-500 mb-1">{t("query.rescheduleGuestCount")}</label>
                      <input
                        id={`reschedule-guests-${item.id}`}
                        type="number"
                        min={1}
                        value={rescheduleGuestCount}
                        onChange={(e) =>
                          setRescheduleGuestCount(e.target.value === "" ? "" : Number(e.target.value))
                        }
                        className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                      />
                    </div>

                    {rescheduleSlotsLoading && (
                      <p className="text-sm text-gray-500">{t("query.rescheduleSearching")}</p>
                    )}

                    {rescheduleError && (
                      <p className="text-sm text-red-700">{rescheduleError}</p>
                    )}

                    {!rescheduleSlotsLoading && rescheduleDate && !rescheduleError && (
                      <div className="space-y-2">
                        {validRescheduleStarts().length === 0 ? (
                          <p className="text-sm text-gray-500">{t("query.rescheduleNoSlots")}</p>
                        ) : (
                          <>
                            <p className="text-xs text-amber-800">{t("query.reschedulePickTime")}</p>
                            <div className="flex flex-wrap gap-2">
                              {validRescheduleStarts().map((opt) => (
                                <button
                                  key={opt.start}
                                  type="button"
                                  disabled={rescheduleSubmitting}
                                  onClick={() => setPendingReschedule(opt)}
                                  className={`rounded-lg border px-3 py-1.5 text-sm disabled:opacity-50 ${
                                    pendingReschedule?.start === opt.start
                                      ? "border-amber-600 bg-amber-100 text-amber-900"
                                      : "border-amber-400 bg-white text-amber-800 hover:bg-amber-100"
                                  }`}
                                >
                                  {formatTaipeiTime(opt.start, { hour12: false })}–
                                  {formatTaipeiTime(opt.end, { hour12: false })}
                                </button>
                              ))}
                            </div>
                            {pendingReschedule && (
                              <div className="rounded-lg border border-amber-300 bg-white p-3 space-y-2">
                                <p className="text-sm font-medium text-amber-900">
                                  {t("query.rescheduleConfirmTitle")}{" "}
                                  {formatTaipeiTime(pendingReschedule.start, { hour12: false })}–
                                  {formatTaipeiTime(pendingReschedule.end, { hour12: false })}
                                </p>
                                <div className="flex gap-2">
                                  <button
                                    type="button"
                                    onClick={() => setPendingReschedule(null)}
                                    className="flex-1 rounded-lg border border-gray-300 py-2 text-sm text-gray-700 hover:bg-gray-50"
                                  >
                                    {t("query.rescheduleCancelButton")}
                                  </button>
                                  <button
                                    type="button"
                                    disabled={rescheduleSubmitting}
                                    onClick={() =>
                                      confirmReschedule(pendingReschedule.start, pendingReschedule.end)
                                    }
                                    className="flex-1 rounded-lg bg-amber-600 py-2 text-sm text-white hover:bg-amber-700 disabled:opacity-50"
                                  >
                                    {rescheduleSubmitting
                                      ? t("query.rescheduleSearching")
                                      : t("query.rescheduleConfirmButton")}
                                  </button>
                                </div>
                              </div>
                            )}
                          </>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      </div>

      {unpaidDepositItem && (
        <div
          className="fixed inset-x-0 bottom-0 z-20 border-t border-amber-200 bg-white/95 px-4 pt-3 sticky-bottom-safe shadow-[0_-4px_12px_rgba(0,0,0,0.08)] backdrop-blur-sm"
          role="region"
          aria-label={t("query.depositNeededTitle")}
        >
          {unpaidDepositItems.length > 1 && (
            <div className="mb-2 flex flex-wrap items-center justify-center gap-2">
              <p className="text-xs font-medium text-amber-800">
                {t("query.paymentStickyCount", { count: unpaidDepositItems.length })}
              </p>
              {unpaidDepositItems.map((item, idx) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setStickyDepositIndex(idx)}
                  aria-label={t("query.paymentStickySwitch", { code: item.booking_code ?? "" })}
                  className={`min-h-[36px] rounded-full px-3 py-1 text-xs font-mono font-medium ${
                    idx === stickyDepositIndex
                      ? "bg-amber-600 text-white"
                      : "border border-amber-300 bg-white text-amber-800"
                  }`}
                >
                  {item.booking_code}
                </button>
              ))}
            </div>
          )}
          <p className="mb-2 text-center text-xs font-medium text-amber-900">
            {t("query.paymentStickyTitle", {
              amount: unpaidDepositItem.deposit_amount ?? "—",
            })}
          </p>
          <div className="flex gap-2">
            {unpaidDepositItem.line_pay_url?.trim() ? (
              <a
                href={unpaidDepositItem.line_pay_url.trim()}
                target="_blank"
                rel="noopener noreferrer"
                onClick={() =>
                  trackGuestEvent(
                    "payment_sticky_line_pay_click",
                    unpaidDepositItem.booking_code
                  )
                }
                className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-[#06C755] px-3 py-3 text-sm font-bold text-white shadow hover:bg-[#05b34c]"
              >
                <span className="rounded bg-white px-1 py-0.5 text-[10px] font-black text-[#06C755]">
                  LINE Pay
                </span>
                {t("query.paymentStickyLinePay")}
              </a>
            ) : (
              <a
                href={OFFICIAL_LINE_URL}
                target="_blank"
                rel="noopener noreferrer"
                onClick={() => trackGuestEvent("payment_sticky_line_official_click")}
                className="flex flex-1 items-center justify-center gap-1.5 rounded-lg border-2 border-[#06C755] bg-white px-3 py-3 text-sm font-bold text-[#06C755] hover:bg-green-50"
              >
                💬 {t("query.paymentStickyOfficialLine")}
              </a>
            )}
            <a
              href={OFFICIAL_LINE_URL}
              target="_blank"
              rel="noopener noreferrer"
              onClick={() => trackGuestEvent("payment_sticky_line_official_click")}
              className={`flex items-center justify-center rounded-lg border-2 border-[#06C755] bg-white px-3 py-3 text-sm font-bold text-[#06C755] hover:bg-green-50 ${
                unpaidDepositItem.line_pay_url?.trim() ? "min-w-[7rem]" : "hidden"
              }`}
            >
              💬 {t("query.paymentStickyOfficialLine")}
            </a>
          </div>
        </div>
      )}
    </main>
  );
}
