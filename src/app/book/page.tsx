"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import Image from "next/image";
import type { Branch, Room, RentalNoteSection } from "@/types";
import { getDurationOptions, getDepositAmount, isWeekendDate } from "@/lib/booking-utils";
import { normalizePhone } from "@/lib/phone-utils";
import { useLocale } from "@/lib/i18n/LocaleContext";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";

type Step = "branch" | "room" | "date" | "slot" | "form";

const BOOKING_STEP_ORDER: Step[] = ["branch", "date", "room", "slot", "form"];

interface SlotItem {
  start: string;
  end: string;
  available: boolean;
}

export default function BookPage() {
  const { t } = useLocale();
  const [step, setStep] = useState<Step>("branch");
  const [branches, setBranches] = useState<Branch[]>([]);
  const [rooms, setRooms] = useState<Room[]>([]);
  const [branchId, setBranchId] = useState("");
  const [roomId, setRoomId] = useState("");
  const [date, setDate] = useState("");
  const [slots, setSlots] = useState<SlotItem[]>([]);
  const [roomName, setRoomName] = useState("");
  const [branchName, setBranchName] = useState("");
  const [selectedStart, setSelectedStart] = useState("");
  const [duration, setDuration] = useState(2);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [guestCount, setGuestCount] = useState<number | "">("");
  const [agreeToTerms, setAgreeToTerms] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [rentalNotes, setRentalNotes] = useState<RentalNoteSection[]>([]);
  const [depositInfo, setDepositInfo] = useState<string | null>(null);
  const [lineUserId, setLineUserId] = useState<string | null>(null);
  const [availabilityRetry, setAvailabilityRetry] = useState(0);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const errorBannerRef = useRef<HTMLDivElement>(null);
  const stepPanelRef = useRef<HTMLDivElement>(null);

  const focusStepPanel = useCallback(() => {
    requestAnimationFrame(() => {
      stepPanelRef.current?.focus({ preventScroll: true });
    });
  }, []);

  const scrollToField = useCallback((fieldId: string) => {
    requestAnimationFrame(() => {
      const el = document.getElementById(fieldId);
      el?.scrollIntoView({ block: "center", behavior: "smooth" });
      if (el instanceof HTMLInputElement || el instanceof HTMLSelectElement) {
        el.focus();
      }
    });
  }, []);

  const changeStep = useCallback((next: Step) => {
    setStep(next);
    setError(null);
    setFieldErrors({});
    requestAnimationFrame(() => window.scrollTo({ top: 0, behavior: "smooth" }));
    focusStepPanel();
  }, [focusStepPanel]);

  const clearFormErrors = useCallback(() => {
    setError(null);
    setFieldErrors({});
  }, []);

  // 這裡確保介面包含 image_url
  const [branchRoomsAvailability, setBranchRoomsAvailability] = useState<{
    rooms: {
      roomId: string;
      roomName: string;
      roomType?: string | null;
      min_capacity?: number;
      capacity: number;
      price_weekday: number;
      price_weekend: number;
      slots: SlotItem[];
      image_url?: string | null;
    }[];
    branchName: string;
  } | null>(null);

  // Debug: 檢查是否有拿到 image_url 等房間資料（已在開發階段使用，可視需要再打開）
  // useEffect(() => {
  //   if (branchRoomsAvailability) {
  //     console.log("Debug Rooms Data:", branchRoomsAvailability.rooms);
  //   }
  // }, [branchRoomsAvailability]);

  useEffect(() => {
    fetch("/api/branches")
      .then((r) => r.json())
      .then((d) => {
        const branchesData = Array.isArray(d) ? d : [];
        setBranches(branchesData);
        if (branchesData.length === 1 && !branchId) {
          setBranchId(branchesData[0].id);
          changeStep("date");
        }
      })
      .catch(() => setBranches([]));
    fetch("/api/settings")
      .then((r) => r.json())
      .then((d) => {
        if (Array.isArray(d?.rental_notes)) setRentalNotes(d.rental_notes);
        if (d?.deposit_info) setDepositInfo(d.deposit_info);
      })
      .catch(() => { });
  }, [branchId, changeStep]);

  useEffect(() => {
    fetch("/api/booking-funnel", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ event: "booking_flow_entered" }),
    }).catch(() => {});
  }, []);

  useEffect(() => {
    if (!branchId) {
      setRooms([]);
      return;
    }
    setLoading(true);
    fetch(`/api/rooms?branchId=${encodeURIComponent(branchId)}`)
      .then((r) => r.json())
      .then((d) => setRooms(Array.isArray(d) ? d : []))
      .catch(() => setRooms([]))
      .finally(() => setLoading(false));
  }, [branchId]);

  useEffect(() => {
    if (step !== "room" || !branchId || !date) return;
    setLoading(true);
    setError(null);
    setBranchRoomsAvailability(null);
    fetch(
      `/api/availability?branchId=${encodeURIComponent(branchId)}&date=${encodeURIComponent(date)}`
    )
      .then((r) => r.json())
      .then((d) => {
        if (d.closed) {
          setError(t("book.error.closedDay"));
          setStep("date");
          return;
        }
        if (d.error) throw new Error(d.error);
        setBranchRoomsAvailability({
          rooms: d.rooms ?? [],
          branchName: d.branchName ?? "",
        });
        if (Array.isArray(d.rooms) && d.rooms.length > 0) {
          setRooms(
            d.rooms.map(
              (r: {
                roomId: string;
                roomName: string;
                roomType?: string | null;
                min_capacity?: number;
                capacity: number;
                price_weekday: number;
                price_weekend: number;
              }) => ({
                id: r.roomId,
                name: r.roomName,
                min_capacity: r.min_capacity,
                capacity: r.capacity,
                price_weekday: r.price_weekday,
                price_weekend: r.price_weekend,
                branch_id: branchId,
                type: r.roomType ?? null,
              })
            )
          );
        }
      })
      .catch((e) => {
        setError(e instanceof Error ? e.message : t("book.error.loadAvailabilityFailed"));
        setBranchRoomsAvailability(null);
      })
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, branchId, date, availabilityRetry]);

  useEffect(() => {
    if (step !== "slot" || !branchId || !roomId || !date) return;
    setLoading(true);
    setError(null);
    fetch(
      `/api/availability?branchId=${encodeURIComponent(branchId)}&roomId=${encodeURIComponent(roomId)}&date=${encodeURIComponent(date)}`
    )
      .then((r) => r.json())
      .then((d) => {
        if (d.error) throw new Error(d.error);
        setSlots(d.slots ?? []);
        setSelectedStart("");
        setRoomName(d.roomName ?? "");
        setBranchName(d.branchName ?? "");
      })
      .catch((e) => {
        setError(e instanceof Error ? e.message : t("book.error.loadSlotsFailed"));
        setSlots([]);
      })
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, branchId, roomId, date]);

  // LINE OAuth 回調：從 URL param 取得 user_id，並從 localStorage 還原表單
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const uid = params.get("line_user_id");
    if (!uid) return;
    setLineUserId(uid);
    const saved = localStorage.getItem("booking_form_state");
    if (saved) {
      try {
        const s = JSON.parse(saved) as {
          branchId?: string; roomId?: string; date?: string;
          selectedStart?: string; duration?: number;
          name?: string; phone?: string; email?: string;
          guestCount?: number | ""; step?: Step;
        };
        if (s.branchId) setBranchId(s.branchId);
        if (s.roomId) setRoomId(s.roomId);
        if (s.date) setDate(s.date);
        if (s.selectedStart) setSelectedStart(s.selectedStart);
        if (s.duration) setDuration(s.duration);
        if (s.name) setName(s.name);
        if (s.phone) setPhone(s.phone);
        if (s.email !== undefined) setEmail(s.email);
        if (s.guestCount !== undefined) setGuestCount(s.guestCount);
        if (s.step) setStep(s.step);
        localStorage.removeItem("booking_form_state");
      } catch { /* 略過 */ }
    }
    window.history.replaceState({}, "", "/book");
  }, []);

  useEffect(() => {
    if (step === "form") {
      requestAnimationFrame(() => document.getElementById("booking-name")?.focus());
    } else if (step === "date") {
      requestAnimationFrame(() => document.getElementById("booking-date")?.focus());
    }
  }, [step]);

  const canSelectDuration = (slotStart: string): boolean => {
    const startIdx = slots.findIndex((s) => s.start === slotStart);
    if (startIdx < 0) return false;
    const slotsNeeded = Math.ceil(duration);
    for (let i = 0; i < slotsNeeded; i++) {
      const s = slots[startIdx + i];
      if (!s?.available) return false;
    }
    return true;
  };

  const getTotalPrice = (): number | null => {
    const room = rooms.find((r) => r.id === roomId);
    if (!room || !date) return null;
    const pricePerHour = isWeekendDate(date)
      ? room.price_weekend
      : room.price_weekday;
    return Math.round(Number(pricePerHour) * duration);
  };

  const buildWaitlistHref = (room: string, startTime?: string, endTime?: string) => {
    const params = new URLSearchParams({
      branchId,
      roomId: room,
      date,
    });
    if (startTime) params.set("start", startTime.slice(11, 16));
    if (endTime) params.set("end", endTime.slice(11, 16));
    return `/book/waitlist?${params.toString()}`;
  };

  // UX Helper: 計算選擇摘要
  const getSelectedSummary = () => {
    if (!selectedStart || !date) return null;
    const start = new Date(selectedStart);
    const end = new Date(start.getTime() + duration * 60 * 60 * 1000);

    // 簡單格式化
    const dateLabel = new Date(date).toLocaleDateString("zh-TW", { month: "numeric", day: "numeric", weekday: "short" });
    const startLabel = start.toLocaleTimeString("zh-TW", { hour: "2-digit", minute: "2-digit", hour12: false });
    const endLabel = end.toLocaleTimeString("zh-TW", { hour: "2-digit", minute: "2-digit", hour12: false });

    return { dateLabel, startLabel, endLabel };
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedStart) return;

    const nextFieldErrors: Record<string, string> = {};
    if (!name.trim()) {
      nextFieldErrors["booking-name"] = t("book.error.nameRequired");
    }
    if (!phone.trim()) {
      nextFieldErrors["booking-phone"] = t("book.error.phoneRequired");
    } else if (!/^09\d{8}$/.test(normalizePhone(phone))) {
      nextFieldErrors["booking-phone"] = t("book.error.phoneInvalid");
    }
    if (rentalNotes.length > 0 && !agreeToTerms) {
      nextFieldErrors["booking-agree-terms"] = t("book.error.agreeRequired");
    }

    if (Object.keys(nextFieldErrors).length > 0) {
      setFieldErrors(nextFieldErrors);
      setError(t("book.error.formInvalid"));
      scrollToField(Object.keys(nextFieldErrors)[0]);
      return;
    }

    const start = new Date(selectedStart);
    const end = new Date(start.getTime() + duration * 60 * 60 * 1000);
    setSubmitting(true);
    clearFormErrors();

    // Validate guest count against room capacity
    if (guestCount !== "") {
      const gC = Number(guestCount);
      const rm = rooms.find((r) => r.id === roomId);
      if (rm) {
        if (rm.min_capacity && gC < rm.min_capacity) {
          setFieldErrors({ "booking-guest-count": t("book.error.minCapacity", { min: rm.min_capacity }) });
          setError(t("book.error.minCapacity", { min: rm.min_capacity }));
          scrollToField("booking-guest-count");
          setSubmitting(false);
          return;
        }
        if (gC > rm.capacity) {
          setFieldErrors({ "booking-guest-count": t("book.error.maxCapacity", { max: rm.capacity }) });
          setError(t("book.error.maxCapacity", { max: rm.capacity }));
          scrollToField("booking-guest-count");
          setSubmitting(false);
          return;
        }
      }
    }

    try {
      const res = await fetch("/api/reservations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          room_id: roomId,
          customer_name: name.trim(),
          phone: phone.trim(),
          email: email.trim() || null,
          start_time: start.toISOString(),
          end_time: end.toISOString(),
          total_price: getTotalPrice(),
          guest_count: guestCount === "" ? null : Number(guestCount),
          notes: null,
          line_user_id: lineUserId || null,
        }),
      });
      const data = await res.json();
      setSubmitting(false);
      if (res.status === 409) {
        setError((data as { error?: string })?.error ?? t("book.error.slotTaken"));
        errorBannerRef.current?.scrollIntoView({ block: "start", behavior: "smooth" });
        return;
      }
      if (!res.ok) {
        setError((data as { error?: string })?.error ?? t("book.error.bookingFailed"));
        errorBannerRef.current?.scrollIntoView({ block: "start", behavior: "smooth" });
        return;
      }
      const code = (data as { booking_code?: string })?.booking_code;
      if (code) {
        sessionStorage.setItem("booking_success_phone", phone.trim());
        const weekendFlag = isWeekendDate(date) ? "1" : "0";
        window.location.href = `/book/success?code=${encodeURIComponent(code)}&weekend=${weekendFlag}${lineUserId ? "&line_bound=1" : ""}`;
      } else {
        setError(t("book.error.noBookingCode"));
      }
    } catch (e) {
      setSubmitting(false);
      setError(e instanceof Error ? e.message : t("book.error.connectionFailed"));
      errorBannerRef.current?.scrollIntoView({ block: "start", behavior: "smooth" });
    }
  };

  const handleLineLogin = () => {
    localStorage.setItem(
      "booking_form_state",
      JSON.stringify({ branchId, roomId, date, selectedStart, duration, name, phone, email, guestCount, step })
    );
    const qs = new URLSearchParams({
      response_type: "code",
      client_id: "2009884734",
      redirect_uri: `${window.location.origin}/api/auth/line/callback`,
      scope: "profile",
      state: "prebooking",
    });
    window.location.href = `https://access.line.me/oauth2/v2.1/authorize?${qs}`;
  };

  const formatSlotTime = (iso: string) =>
    new Date(iso).toLocaleTimeString("zh-TW", { hour: "2-digit", minute: "2-digit" });

  const goToStep = (target: Step) => {
    const targetIdx = BOOKING_STEP_ORDER.indexOf(target);
    const currentIdx = BOOKING_STEP_ORDER.indexOf(step);
    if (targetIdx >= currentIdx) return;
    if (targetIdx < BOOKING_STEP_ORDER.indexOf("slot")) {
      setSelectedStart("");
    }
    if (targetIdx < BOOKING_STEP_ORDER.indexOf("room")) {
      setRoomId("");
      setRoomName("");
      setSlots([]);
      setBranchRoomsAvailability(null);
    }
    if (targetIdx < BOOKING_STEP_ORDER.indexOf("date")) {
      setDate("");
      setBranchId("");
    }
    setStep(target);
    setError(null);
    setFieldErrors({});
    requestAnimationFrame(() => window.scrollTo({ top: 0, behavior: "smooth" }));
    focusStepPanel();
  };

  const today = new Date().toISOString().slice(0, 10);
  const maxDate = (() => {
    const d = new Date();
    d.setMonth(d.getMonth() + 1);
    return d.toISOString().slice(0, 10);
  })();
  const summary = getSelectedSummary(); // 取得當前選擇摘要

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
              <h1 className="text-base font-medium tracking-wide text-stone-800">{t("book.headerTitle")}</h1>
            </div>
          </div>
          <LanguageSwitcher />
        </div>
      </header>

      <nav
        aria-label={t("book.headerTitle")}
        className="mx-auto max-w-lg px-4 pt-3 flex gap-1 overflow-x-auto"
      >
        {BOOKING_STEP_ORDER.map((s) => {
          const active = step === s;
          const stepIndex = BOOKING_STEP_ORDER.indexOf(s);
          const currentIndex = BOOKING_STEP_ORDER.indexOf(step);
          const done = stepIndex < currentIndex;
          return done ? (
            <button
              key={s}
              type="button"
              onClick={() => goToStep(s)}
              className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-medium bg-amber-100 text-amber-800 hover:bg-amber-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-500`}
            >
              {t(`book.steps.${s}` as "book.steps.branch")}
            </button>
          ) : (
            <span
              key={s}
              aria-current={active ? "step" : undefined}
              className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-medium ${
                active
                  ? "bg-amber-600 text-white"
                  : "bg-stone-100 text-stone-500"
              }`}
            >
              {t(`book.steps.${s}` as "book.steps.branch")}
            </span>
          );
        })}
      </nav>

      <div
        ref={stepPanelRef}
        tabIndex={-1}
        aria-labelledby={`booking-step-${step}-heading`}
        className={`mx-auto max-w-lg px-4 py-6 outline-none ${step === "form" ? "pb-28" : ""}`}
      >
        {error && (
          <div
            ref={errorBannerRef}
            role="alert"
            className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800"
          >
            {error}
          </div>
        )}

        {step === "branch" && (
          <>
            <h2 id="booking-step-branch-heading" className="mb-3 text-sm font-medium text-gray-700">{t("book.branch.title")}</h2>
            <ul className="space-y-2">
              {branches.map((b) => (
                <li key={b.id}>
                  <button
                    type="button"
                    onClick={() => {
                      setBranchId(b.id);
                      changeStep("date");
                    }}
                    className="w-full rounded-xl border border-gray-200 bg-white px-4 py-3 text-left shadow-sm hover:border-amber-400 hover:bg-amber-50/50"
                  >
                    <span className="font-medium text-gray-900">{b.name}</span>
                    {b.address && (
                      <p className="mt-0.5 text-sm text-gray-500">{b.address}</p>
                    )}
                  </button>
                </li>
              ))}
            </ul>
            {branches.length === 0 && !loading && (
              <p className="text-sm text-gray-500">{t("book.branch.empty")}</p>
            )}
          </>
        )}

        {step === "date" && (
          <>
            <button
              type="button"
              onClick={() => setStep("branch")}
              className="mb-3 text-sm text-amber-700"
            >
              {t("book.date.reselectBranch")}
            </button>
            <label id="booking-step-date-heading" htmlFor="booking-date" className="mb-3 block text-sm font-medium text-gray-700">{t("book.date.title")}</label>
            <input
              id="booking-date"
              type="date"
              min={today}
              max={maxDate}
              value={date}
              onChange={(e) => {
                const next = e.target.value;
                setDate(next);
              }}
              className="w-full rounded-xl border border-gray-300 px-4 py-3 text-base"
            />
            <div className="mt-4 flex justify-end">
              <button
                type="button"
                disabled={!date}
                onClick={() => changeStep("room")}
                className="rounded-lg bg-amber-600 px-4 py-2 text-white disabled:opacity-50"
              >
                {t("book.date.next")}
              </button>
            </div>
          </>
        )}

        {step === "room" && (
          <>
            <button
              type="button"
              onClick={() => setStep("date")}
              className="mb-3 text-sm text-amber-700"
            >
              {t("book.room.reselectDate")}
            </button>
            <h2 id="booking-step-room-heading" className="mb-2 text-sm font-medium text-gray-700">{t("book.room.title")}</h2>
            <p className="mb-3 text-xs text-gray-500">
              {t("book.room.subtitle", { date })}
            </p>
            {loading ? (
              <ul className="space-y-3" aria-busy="true" aria-live="polite">
                {[1, 2, 3].map((n) => (
                  <li key={n} className="animate-pulse rounded-xl border border-gray-200 bg-white p-4">
                    <div className="aspect-video w-full rounded-lg bg-gray-200" />
                    <div className="mt-3 h-4 w-2/3 rounded bg-gray-200" />
                    <div className="mt-2 h-3 w-full rounded bg-gray-100" />
                  </li>
                ))}
              </ul>
            ) : branchRoomsAvailability ? (
              <ul className="space-y-3">
                {branchRoomsAvailability.rooms.map((r) => {
                  const freeCount = r.slots.filter((s) => s.available).length;
                  const ranges: string[] = [];
                  const imageUrl =
                    r.image_url ??
                    rooms.find((rm) => rm.id === r.roomId)?.image_url ??
                    null;
                  let i = 0;
                  while (i < r.slots.length) {
                    if (r.slots[i].available) {
                      const start = formatSlotTime(r.slots[i].start);
                      let j = i;
                      while (j + 1 < r.slots.length && r.slots[j + 1].available) j++;
                      const end = formatSlotTime(r.slots[j].end);
                      ranges.push(`${start}–${end}`);
                      i = j + 1;
                    } else i++;
                  }
                  return (
                    <li key={r.roomId}>
                      {freeCount > 0 ? (
                        <button
                          type="button"
                          onClick={() => {
                            setRoomId(r.roomId);
                            setRoomName(r.roomName);
                            setBranchName(branchRoomsAvailability.branchName);
                            changeStep("slot");
                          }}
                          className="w-full rounded-xl border border-gray-200 bg-white px-4 py-3 text-left shadow-sm hover:border-amber-400 hover:bg-amber-50/50"
                        >
                          <div className="mb-2 overflow-hidden rounded-lg">
                            <div className="relative aspect-video w-full overflow-hidden rounded-lg bg-gray-100 flex items-center justify-center text-xs text-gray-500">
                              {imageUrl ? (
                                <Image
                                  src={imageUrl}
                                  alt={r.roomName}
                                  fill
                                  sizes="(max-width: 640px) 100vw, 512px"
                                  className="object-cover"
                                  onError={(e) => {
                                    e.currentTarget.style.display = "none";
                                  }}
                                />
                              ) : (
                                <span>{t("book.room.noImage")}</span>
                              )}
                            </div>
                          </div>
                          <div className="flex items-center gap-2">
                            <span className="font-medium text-gray-900">{r.roomName}</span>
                            {r.roomType && (
                              <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">
                                {r.roomType}
                              </span>
                            )}
                          </div>
                          <p className="mt-0.5 text-sm text-gray-500">
                            {r.min_capacity && r.min_capacity < r.capacity ? `${r.min_capacity}-${r.capacity}` : r.capacity} {t("book.room.people")} · {t("book.room.weekday")} ${r.price_weekday}{t("book.room.perHour")} · {t("book.room.weekend")} ${r.price_weekend}{t("book.room.perHour")}
                          </p>
                          <p className="mt-1.5 text-xs text-gray-600">
                            {t("book.room.availableRanges", { ranges: `${ranges.slice(0, 3).join("、")}${ranges.length > 3 ? " …" : ""}` })}
                          </p>
                          <div className="mt-2 flex flex-wrap gap-0.5">
                            {r.slots.slice(0, 12).map((s) => (
                              <span
                                key={s.start}
                                className={`inline-block h-2 w-4 rounded-sm ${s.available ? "bg-green-300" : "bg-rose-200"}`}
                                title={formatSlotTime(s.start)}
                              />
                            ))}
                          </div>
                        </button>
                      ) : (
                        <div className="w-full rounded-xl border border-rose-100 bg-white px-4 py-3 text-left shadow-sm">
                          <div className="flex items-center gap-2">
                            <span className="font-medium text-gray-900">{r.roomName}</span>
                            {r.roomType && (
                              <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">
                                {r.roomType}
                              </span>
                            )}
                          </div>
                          <p className="mt-1.5 text-sm text-rose-600">{t("book.room.full")}</p>
                          <p className="mt-1 text-xs text-gray-500">{t("book.waitlistHint")}</p>
                          <Link
                            href={buildWaitlistHref(r.roomId)}
                            className="mt-3 flex w-full items-center justify-center rounded-lg bg-amber-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-amber-700"
                          >
                            {t("book.waitlistCta")}
                          </Link>
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            ) : (
              <div className="space-y-3">
                <p className="text-sm text-gray-500">{t("book.room.loadError")}</p>
                <button
                  type="button"
                  onClick={() => {
                    setError(null);
                    setAvailabilityRetry((n) => n + 1);
                  }}
                  className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-2 text-sm font-medium text-amber-800 hover:bg-amber-100"
                >
                  {t("common.retry")}
                </button>
              </div>
            )}
          </>
        )}

        {step === "slot" && (
          <>
            <button
              type="button"
              onClick={() => setStep("room")}
              className="mb-3 text-sm text-amber-700"
            >
              {t("book.slot.reselectRoom")}
            </button>
            <h2 id="booking-step-slot-heading" className="mb-2 text-sm font-medium text-gray-700">{t("book.slot.title")}</h2>
            <p className="mb-3 text-xs text-gray-500">
              {branchName} · {roomName} · {date}
            </p>
            {loading ? (
              <div className="space-y-4" aria-busy="true" aria-live="polite">
                <div className="h-4 w-1/2 animate-pulse rounded bg-gray-200" />
                <div className="grid grid-cols-4 gap-2 sm:grid-cols-6">
                  {Array.from({ length: 12 }).map((_, i) => (
                    <div key={i} className="h-10 animate-pulse rounded-lg bg-gray-200" />
                  ))}
                </div>
              </div>
            ) : (
              <>
                {slots.length > 0 && (
                  <p className="mb-3 text-xs text-gray-600">
                    {t("book.slot.totalSlots", { count: slots.length, free: slots.filter((s) => s.available).length })}
                  </p>
                )}
                {getTotalPrice() != null && (
                  <div className="mb-3 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800 space-y-1">
                    <p>{t("book.slot.depositNotice")}</p>
                    <p className="font-semibold">
                      {t("book.slot.depositEstimate", { amount: getDepositAmount(getTotalPrice()!) })}
                    </p>
                    <p>{t("book.slot.depositInstruction")}</p>
                  </div>
                )}
                <div className="mb-3 flex items-center gap-4 text-xs text-gray-600">
                  <span className="flex items-center gap-1">
                    <span className="inline-block h-4 w-4 rounded bg-green-200" /> {t("book.slot.legendAvailable")}
                  </span>
                  <span className="flex items-center gap-1 rounded border border-rose-200 bg-rose-50 px-1.5 py-0.5 text-rose-600">
                    <span className="inline-block h-3 w-3 rounded bg-rose-200" /> {t("book.slot.legendFull")}
                  </span>
                </div>

                {/* 步驟 1：時數 */}
                <div className="mb-4">
                  <label htmlFor="booking-duration" className="mb-2 block text-sm font-bold text-gray-800">
                    {t("book.slot.durationTitle")}
                  </label>
                  <select
                    id="booking-duration"
                    value={duration}
                    onChange={(e) => {
                      setDuration(Number(e.target.value));
                      setSelectedStart("");
                    }}
                    className="w-full rounded-xl border border-gray-300 p-3"
                  >
                    {getDurationOptions().map((h) => (
                      <option key={h} value={h}>{t("book.slot.hoursUnit", { h })}</option>
                    ))}
                  </select>
                </div>

                {!slots.some((s) => canSelectDuration(s.start)) && slots.length > 0 && (
                  <div className="mb-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-3">
                    <p className="text-sm text-amber-800">
                      {t("book.slot.noContiguous", { duration })}
                    </p>
                    <p className="mt-1 text-xs text-amber-700">{t("book.slot.waitlistHint")}</p>
                    <Link
                      href={buildWaitlistHref(
                        roomId,
                        selectedStart || undefined,
                        selectedStart
                          ? new Date(
                              new Date(selectedStart).getTime() + duration * 60 * 60 * 1000
                            ).toISOString()
                          : undefined
                      )}
                      className="mt-2 inline-flex w-full items-center justify-center rounded-lg bg-amber-600 px-4 py-2 text-sm font-medium text-white hover:bg-amber-700 sm:w-auto"
                    >
                      {t("book.waitlistCta")}
                    </Link>
                  </div>
                )}

                {/* 步驟 2：時段 */}
                <div>
                  <h3 className="mb-2 text-sm font-bold text-gray-800">
                    {t("book.slot.timeTitle")} <span className="text-xs font-normal text-gray-500">{t("book.slot.timeTitleHint")}</span>
                  </h3>
                  <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
                    {slots.map((s) => {
                      const available = duration === 1 ? s.available : canSelectDuration(s.start);
                      return (
                        <button
                          key={s.start}
                          type="button"
                          disabled={!available}
                          aria-pressed={selectedStart === s.start}
                          aria-label={`${formatSlotTime(s.start)}${available ? "" : ` (${t("book.slot.legendFull")})`}`}
                          onClick={() => setSelectedStart(s.start)}
                          className={`rounded-lg border py-3 text-sm font-medium ${selectedStart === s.start
                            ? "border-amber-600 bg-amber-600 text-white"
                            : available
                              ? "border-green-300 bg-green-50 text-green-800 hover:bg-green-100"
                              : "cursor-not-allowed border border-rose-200 bg-rose-50 text-rose-600"
                            }`}
                        >
                          {formatSlotTime(s.start)}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Summary Bar: 預約摘要 */}
                {summary && (
                  <div className="mt-4 mb-2 rounded-lg bg-emerald-50 border border-emerald-100 p-3 text-sm text-emerald-900 animate-in fade-in slide-in-from-bottom-2">
                    <p className="font-bold">{t("book.slot.summaryLabel")}</p>
                    <p>{summary.dateLabel} {summary.startLabel} ~ {summary.endLabel} {t("book.slot.summaryDuration", { duration })}</p>
                  </div>
                )}

                <div className="mt-4 flex justify-end">
                  <button
                    type="button"
                    disabled={!selectedStart || !canSelectDuration(selectedStart)}
                    onClick={() => changeStep("form")}
                    className="rounded-lg bg-amber-600 px-4 py-2 text-white disabled:opacity-50"
                  >
                    {t("book.slot.nextStep")}
                  </button>
                </div>
              </>
            )}
          </>
        )}

        {step === "form" && (
          <>
            <h2 id="booking-step-form-heading" className="sr-only">{t("book.steps.form")}</h2>
            <button
              type="button"
              onClick={() => setStep("slot")}
              className="mb-3 text-sm text-amber-700"
            >
              {t("book.form.reselectSlot")}
            </button>
            <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50/80 p-4">
              <p className="text-sm text-gray-700">
                {branchName} · {roomName} · {date}{" "}
                {selectedStart && formatSlotTime(selectedStart)} {t("book.form.startFor", { duration })}
              </p>
              {getTotalPrice() != null && (
                <div className="mt-3 flex flex-wrap items-end justify-between gap-2 border-t border-amber-200/70 pt-3">
                  <div>
                    <p className="text-xs text-amber-800/80">{t("book.form.summaryTotal")}</p>
                    <p className="font-mono text-lg font-bold text-gray-900">
                      NT$ {getTotalPrice()!.toLocaleString()}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-xs text-amber-800/80">{t("book.form.summaryDeposit")}</p>
                    <p className="font-mono text-lg font-bold text-amber-800">
                      NT$ {getDepositAmount(getTotalPrice()!).toLocaleString()}
                    </p>
                  </div>
                </div>
              )}
              <p className="mt-2 text-xs text-amber-900/90">{t("book.form.summaryHint")}</p>
            </div>
            <form id="booking-form" noValidate onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label htmlFor="booking-name" className="mb-1 block text-sm font-medium text-gray-700">{t("book.form.name")}</label>
                <input
                  id="booking-name"
                  type="text"
                  autoComplete="name"
                  value={name}
                  onChange={(e) => {
                    setName(e.target.value);
                    if (fieldErrors["booking-name"]) {
                      setFieldErrors((prev) => {
                        const next = { ...prev };
                        delete next["booking-name"];
                        return next;
                      });
                    }
                  }}
                  aria-invalid={Boolean(fieldErrors["booking-name"])}
                  aria-describedby={fieldErrors["booking-name"] ? "booking-name-error" : undefined}
                  className={`w-full rounded-lg border px-3 py-2.5 ${fieldErrors["booking-name"] ? "border-red-400 bg-red-50" : "border-gray-300"}`}
                  placeholder={t("book.form.namePlaceholder")}
                />
                {fieldErrors["booking-name"] && (
                  <p id="booking-name-error" className="mt-1 text-xs text-red-600" role="alert">
                    {fieldErrors["booking-name"]}
                  </p>
                )}
              </div>
              <div>
                <label htmlFor="booking-phone" className="mb-1 block text-sm font-medium text-gray-700">{t("book.form.phone")}</label>
                <input
                  id="booking-phone"
                  type="tel"
                  autoComplete="tel"
                  inputMode="tel"
                  value={phone}
                  onChange={(e) => {
                    setPhone(e.target.value);
                    if (fieldErrors["booking-phone"]) {
                      setFieldErrors((prev) => {
                        const next = { ...prev };
                        delete next["booking-phone"];
                        return next;
                      });
                    }
                  }}
                  aria-invalid={Boolean(fieldErrors["booking-phone"])}
                  aria-describedby={fieldErrors["booking-phone"] ? "booking-phone-error booking-phone-hint" : "booking-phone-hint"}
                  className={`w-full rounded-lg border px-3 py-2.5 ${fieldErrors["booking-phone"] ? "border-red-400 bg-red-50" : "border-gray-300"}`}
                  placeholder={t("book.form.phonePlaceholder")}
                />
                {fieldErrors["booking-phone"] ? (
                  <p id="booking-phone-error" className="mt-1 text-xs text-red-600" role="alert">
                    {fieldErrors["booking-phone"]}
                  </p>
                ) : (
                  <p id="booking-phone-hint" className="mt-1 text-xs text-gray-500">
                    {t("book.form.phoneHint")}
                  </p>
                )}
              </div>
              <div>
                <label htmlFor="booking-email" className="mb-1 block text-sm font-medium text-gray-700">{t("book.form.email")}</label>
                <input
                  id="booking-email"
                  type="email"
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2.5"
                  placeholder={t("book.form.emailPlaceholder")}
                />
              </div>
              <div>
                <label htmlFor="booking-guest-count" className="mb-1 block text-sm font-medium text-gray-700">{t("book.form.guestCount")}</label>
                <input
                  id="booking-guest-count"
                  type="number"
                  min={1}
                  value={guestCount === "" ? "" : guestCount}
                  onChange={(e) => {
                    setGuestCount(e.target.value === "" ? "" : Number(e.target.value));
                    if (fieldErrors["booking-guest-count"]) {
                      setFieldErrors((prev) => {
                        const next = { ...prev };
                        delete next["booking-guest-count"];
                        return next;
                      });
                    }
                  }}
                  aria-invalid={Boolean(fieldErrors["booking-guest-count"])}
                  aria-describedby={fieldErrors["booking-guest-count"] ? "booking-guest-count-error" : undefined}
                  className={`w-full rounded-lg border px-3 py-2.5 ${fieldErrors["booking-guest-count"] ? "border-red-400 bg-red-50" : "border-gray-300"}`}
                  placeholder={t("book.form.guestCountPlaceholder")}
                />
                {fieldErrors["booking-guest-count"] && (
                  <p id="booking-guest-count-error" className="mt-1 text-xs text-red-600" role="alert">
                    {fieldErrors["booking-guest-count"]}
                  </p>
                )}
              </div>

              {rentalNotes.length > 0 && (
                <div className="mt-6 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
                  <h3 className="font-bold mb-3 text-amber-800 text-base">{t("book.form.rentalNotesTitle")}</h3>

                  <div className="space-y-3 text-amber-800">
                    {rentalNotes.map((section, i) => (
                      <div key={i}>
                        <p className="font-semibold mb-1">{section.title}</p>
                        <ul className="list-disc pl-5 space-y-0.5">
                          {section.items.map((item, j) => (
                            <li key={j}>{item}</li>
                          ))}
                        </ul>
                      </div>
                    ))}
                  </div>

                  <label htmlFor="booking-agree-terms" className={`flex items-start gap-2 cursor-pointer pt-3 mt-3 border-t border-amber-200/50 ${fieldErrors["booking-agree-terms"] ? "rounded-lg border border-red-300 bg-red-50/50 p-2" : ""}`}>
                    <input
                      id="booking-agree-terms"
                      type="checkbox"
                      checked={agreeToTerms}
                      onChange={(e) => {
                        setAgreeToTerms(e.target.checked);
                        if (fieldErrors["booking-agree-terms"]) {
                          setFieldErrors((prev) => {
                            const next = { ...prev };
                            delete next["booking-agree-terms"];
                            return next;
                          });
                        }
                      }}
                      aria-invalid={Boolean(fieldErrors["booking-agree-terms"])}
                      className="mt-0.5 h-4 w-4 rounded border-amber-300 text-amber-600 focus:ring-amber-500 cursor-pointer"
                    />
                    <span className="font-medium">{t("book.form.agreeNotes")}</span>
                  </label>
                  {fieldErrors["booking-agree-terms"] && (
                    <p className="mt-1 text-xs text-red-600" role="alert">
                      {fieldErrors["booking-agree-terms"]}
                    </p>
                  )}
                </div>
              )}

              {depositInfo && (
                <div className="rounded-xl border border-blue-200 bg-blue-50 p-4 text-sm text-blue-900">
                  <p className="font-bold mb-1">{t("book.form.depositInfoTitle")}</p>
                  <p className="whitespace-pre-line">{depositInfo}</p>
                </div>
              )}

              <div className="rounded-lg border border-green-200 bg-green-50 p-4">
                <p className="mb-2 text-sm font-medium text-gray-700">{t("book.form.lineSectionTitle")}</p>
                {lineUserId ? (
                  <p className="text-sm text-green-700">{t("book.form.lineBound")}</p>
                ) : (
                  <button
                    type="button"
                    onClick={handleLineLogin}
                    className="inline-flex items-center gap-2 rounded-lg bg-[#06C755] px-4 py-2 text-sm font-semibold text-white hover:bg-green-600 transition"
                  >
                    <span>💬</span>
                    {t("book.form.lineLogin")}
                  </button>
                )}
              </div>
            </form>
          </>
        )}
      </div>

      {step === "form" && (
        <div
          className="fixed inset-x-0 bottom-0 z-20 border-t border-amber-200 bg-white/95 px-4 py-3 shadow-[0_-4px_12px_rgba(0,0,0,0.08)] backdrop-blur-sm"
          role="region"
          aria-label={t("book.form.submit")}
        >
          {getTotalPrice() != null && (
            <p className="mb-2 text-center text-xs font-medium text-amber-900">
              {t("book.form.stickyDeposit", {
                deposit: getDepositAmount(getTotalPrice()!).toLocaleString(),
              })}
            </p>
          )}
          <button
            type="submit"
            form="booking-form"
            disabled={submitting || (rentalNotes.length > 0 && !agreeToTerms)}
            className="w-full rounded-lg bg-amber-600 py-3.5 text-base font-semibold text-white hover:bg-amber-700 disabled:opacity-50"
          >
            {submitting ? t("book.form.submitting") : t("book.form.submit")}
          </button>
        </div>
      )}
    </main>
  );
}