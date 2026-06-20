"use client";

import { useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { ArrowLeft, Calendar, Clock } from "lucide-react";
import { format, parseISO } from "date-fns";
import { zhTW } from "date-fns/locale";
import { useLocale } from "@/lib/i18n/LocaleContext";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";

interface BookingItem {
  id: string;
  booking_code: string;
  room_id: string;
  branch_id: string | null;
  room_name: string;
  branch_name: string;
  start_time: string;
  end_time: string;
  status: string;
  total_price: number | null;
  guest_count: number | null;
  customer_name: string;
  deposit_required: boolean;
  deposit_amount: number | null;
  is_deposit_paid?: boolean;
}

interface AvailabilitySlot {
  start: string;
  end: string;
  available: boolean;
}

const LINE_PAY_URL =
  "https://qrcodepay.line.me/qr/payment/%252BmF6rR41PSp3R8NMydLA%252BRt1IvAFgPchBvtrJoR20aoZKY4Hr1qrbfaYSoPDUyu0";

const OFFICIAL_LINE_URL = "https://lin.ee/cxcV0lo";

export default function BookQueryPage() {
  const { t } = useLocale();
  const STATUS_LABELS: Record<string, string> = {
    pending: t("query.status.pending"),
    confirmed: t("query.status.confirmed"),
    checked_in: t("query.status.checked_in"),
    cancelled: t("query.status.cancelled"),
    completed: t("query.status.completed"),
  };
  const [phone, setPhone] = useState("");
  const [list, setList] = useState<BookingItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cancellingId, setCancellingId] = useState<string | null>(null);
  const [reschedulingItem, setReschedulingItem] = useState<BookingItem | null>(null);
  const [rescheduleDate, setRescheduleDate] = useState("");
  const [rescheduleSlots, setRescheduleSlots] = useState<AvailabilitySlot[]>([]);
  const [rescheduleSlotsLoading, setRescheduleSlotsLoading] = useState(false);
  const [rescheduleGuestCount, setRescheduleGuestCount] = useState<number | "">("");
  const [rescheduleSubmitting, setRescheduleSubmitting] = useState(false);
  const [rescheduleError, setRescheduleError] = useState<string | null>(null);

  const search = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!phone.trim()) return;
    setLoading(true);
    setError(null);
    setList([]);
    try {
      const res = await fetch(
        `/api/my-bookings?phone=${encodeURIComponent(phone.trim())}`
      );
      const data = await res.json();
      if (!res.ok) {
        setError((data as { error?: string })?.error ?? t("query.searchFailed"));
        return;
      }
      setList(Array.isArray(data) ? data : []);
    } catch (e) {
      setError(e instanceof Error ? e.message : t("query.connectionFailed"));
    } finally {
      setLoading(false);
    }
  };

  const cancel = async (id: string, item: BookingItem) => {
    const msg = item.is_deposit_paid
      ? t("query.confirmCancelDepositPaid")
      : t("query.confirmCancel");
    if (!confirm(msg)) return;
    setCancellingId(id);
    setError(null);
    try {
      const res = await fetch("/api/cancel-booking", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, phone: phone.trim() }),
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
    return format(d, "yyyy/MM/dd (EEE) HH:mm", { locale: zhTW });
  };

  const canReschedule = (item: BookingItem) => {
    if (!["pending", "confirmed"].includes(item.status)) return false;
    return canCancel(item);
  };

  const durationHoursOf = (item: BookingItem) =>
    Math.round(
      (new Date(item.end_time).getTime() - new Date(item.start_time).getTime()) / (60 * 60 * 1000)
    );

  const openReschedule = (item: BookingItem) => {
    setReschedulingItem(item);
    setRescheduleDate("");
    setRescheduleSlots([]);
    setRescheduleGuestCount(item.guest_count ?? "");
    setRescheduleError(null);
  };

  const closeReschedule = () => {
    setReschedulingItem(null);
    setRescheduleSlots([]);
    setRescheduleError(null);
  };

  const fetchRescheduleSlots = async (date: string) => {
    if (!reschedulingItem?.branch_id || !date) return;
    setRescheduleDate(date);
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

  // 找出連續可用、長度等於原訂位時長的起始時段
  const validRescheduleStarts = () => {
    if (!reschedulingItem) return [];
    const duration = durationHoursOf(reschedulingItem);
    const options: { start: string; end: string }[] = [];
    for (let i = 0; i + duration <= rescheduleSlots.length; i++) {
      const window = rescheduleSlots.slice(i, i + duration);
      if (window.every((s) => s.available)) {
        options.push({ start: window[0].start, end: window[window.length - 1].end });
      }
    }
    return options;
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

      <div className="mx-auto max-w-lg px-4 py-6">
        <form onSubmit={search} className="mb-6 flex gap-2">
          <label htmlFor="query-phone" className="sr-only">{t("query.phonePlaceholder")}</label>
          <input
            id="query-phone"
            type="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder={t("query.phonePlaceholder")}
            className="flex-1 rounded-lg border border-gray-300 px-4 py-2.5"
            required
          />
          <button
            type="submit"
            disabled={loading}
            className="rounded-lg bg-amber-600 px-4 py-2.5 text-white disabled:opacity-50"
          >
            {loading ? t("query.searching") : t("query.searchButton")}
          </button>
        </form>

        {error && (
          <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
            {error}
          </div>
        )}

        {list.length === 0 && !loading && phone && (
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
                    <p className="mt-1 flex items-center gap-1 text-sm text-gray-600">
                      <Calendar className="h-4 w-4" />
                      {format(parseISO(item.start_time), "yyyy/MM/dd (EEE)", {
                        locale: zhTW,
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
                            <div className="bg-white p-3 rounded border border-gray-200 shadow-sm mb-3">
                              <p className="font-bold text-gray-700 flex items-center gap-1.5 mb-1">
                                <span className="text-xl">🏦</span> {t("query.bankTransfer")}
                              </p>
                              <p className="font-mono text-lg tracking-wide select-all">台北富邦銀行 (012)</p>
                              <p className="font-mono text-xl font-bold tracking-wider select-all text-blue-700 my-1">8212-00000-8489-6</p>
                              <p className="text-base font-semibold">{t("query.accountName")}</p>
                            </div>

                            <div className="flex items-center gap-3 my-2 opacity-60">
                              <div className="h-px flex-1 bg-gray-300"></div>
                              <span className="font-medium text-sm">{t("query.or")}</span>
                              <div className="h-px flex-1 bg-gray-300"></div>
                            </div>

                            <div className="mt-2 text-center">
                              <a
                                href={LINE_PAY_URL}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex w-full sm:w-auto justify-center items-center gap-2 rounded-lg bg-[#06C755] px-6 py-3 text-base font-bold text-white shadow hover:bg-[#05b34c] transition"
                              >
                                <span className="bg-white text-[#06C755] p-1 rounded font-black text-xs">LINE Pay</span>
                                {t("query.linePayButton")}
                              </a>
                            </div>
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
                      <button
                        type="button"
                        disabled={cancellingId === item.id}
                        onClick={() => cancel(item.id, item)}
                        className="flex-1 rounded-lg border border-red-200 py-2 text-sm text-red-700 hover:bg-red-50 disabled:opacity-50"
                      >
                        {cancellingId === item.id ? t("query.cancelling") : t("query.cancelButton")}
                      </button>
                    </div>
                  </div>
                )}
                {item.status !== "cancelled" && !canCancel(item) && (
                  <p className="mt-2 text-xs text-gray-500">
                    {t("query.cancelExpired", { deadline: cancelDeadline(item) })}
                  </p>
                )}

                {reschedulingItem?.id === item.id && (
                  <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50/60 p-3 space-y-3">
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
                      <div className="flex flex-wrap gap-2">
                        {validRescheduleStarts().length === 0 ? (
                          <p className="text-sm text-gray-500">{t("query.rescheduleNoSlots")}</p>
                        ) : (
                          validRescheduleStarts().map((opt) => (
                            <button
                              key={opt.start}
                              type="button"
                              disabled={rescheduleSubmitting}
                              onClick={() => confirmReschedule(opt.start, opt.end)}
                              className="rounded-lg border border-amber-400 bg-white px-3 py-1.5 text-sm text-amber-800 hover:bg-amber-100 disabled:opacity-50"
                            >
                              {format(parseISO(opt.start), "HH:mm")}–
                              {format(parseISO(opt.end), "HH:mm")}
                            </button>
                          ))
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
    </main>
  );
}
