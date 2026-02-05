"use client";

import { useState } from "react";
import { X } from "lucide-react";
import type { Room } from "@/types";

/** 是否為假日（六、日） */
function isWeekend(dateStr: string): boolean {
  if (!dateStr) return false;
  const d = new Date(dateStr + "T12:00:00");
  const day = d.getDay(); // 0=Sun, 6=Sat
  return day === 0 || day === 6;
}

/** 依所選日期取得該包廂每小時單價（平日/假日） */
function getPricePerHour(room: Room, dateStr: string): number {
  return isWeekend(dateStr) ? Number(room.price_weekend) : Number(room.price_weekday);
}

interface AddReservationFormProps {
  branchId: string | null;
  rooms: Room[];
  open: boolean;
  onClose: () => void;
  onSuccess?: () => void;
}

export function AddReservationForm({
  branchId,
  rooms,
  open,
  onClose,
  onSuccess,
}: AddReservationFormProps) {
  const [roomId, setRoomId] = useState("");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [guestCount, setGuestCount] = useState<number | "">("");
  const [notes, setNotes] = useState("");
  const [date, setDate] = useState("");
  const [time, setTime] = useState("");
  const [duration, setDuration] = useState(1);
  const [repeatType, setRepeatType] = useState<"once" | "weekly">("once");
  const [repeatWeeks, setRepeatWeeks] = useState(4);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reset = () => {
    setRoomId("");
    setName("");
    setPhone("");
    setEmail("");
    setGuestCount("");
    setNotes("");
    setDate("");
    setTime("");
    setDuration(1);
    setRepeatType("once");
    setRepeatWeeks(4);
    setError(null);
  };

  const handleClose = () => {
    reset();
    onClose();
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!branchId || !roomId) return;
    const room = rooms.find((r) => r.id === roomId);
    if (!room) return;
    setSubmitting(true);
    setError(null);
    try {
      if (repeatType === "weekly") {
        const res = await fetch("/api/reservations/recurring", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            room_id: roomId,
            customer_name: name.trim(),
            phone: phone.trim(),
            email: email.trim() || null,
            start_date: date,
            start_time: time,
            duration_hours: duration,
            repeat_weeks: repeatWeeks,
            guest_count: guestCount === "" ? null : Number(guestCount),
            notes: notes.trim() || null,
          }),
        });
        const data = await res.json();
        setSubmitting(false);
        if (!res.ok) {
          setError((data as { error?: string })?.error ?? "無法建立週期預約");
          return;
        }
        const created = (data as { created?: number }).created ?? 0;
        const skipped = (data as { skipped?: number }).skipped ?? 0;
        handleClose();
        onSuccess?.();
        if (created > 0 || skipped > 0) {
          alert(`已建立 ${created} 筆訂位${skipped > 0 ? `，略過 ${skipped} 筆` : ""}`);
        }
        return;
      }
      const start = new Date(`${date}T${time}:00`);
      const end = new Date(start.getTime() + duration * 60 * 60 * 1000);
      const start_time = start.toISOString();
      const end_time = end.toISOString();
      const pricePerHour = getPricePerHour(room, date);
      const total_price = Math.round(pricePerHour * duration);
      const res = await fetch("/api/reservations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          room_id: roomId,
          customer_name: name.trim(),
          phone: phone.trim(),
          email: email.trim() || null,
          start_time,
          end_time,
          total_price,
          guest_count: guestCount === "" ? null : Number(guestCount),
          notes: notes.trim() || null,
        }),
      });
      const data = await res.json();
      setSubmitting(false);
      if (!res.ok) {
        const msg = (data as { error?: string })?.error ?? "無法新增訂位";
        if (res.status === 409) setError(msg);
        else setError(msg);
        return;
      }
      handleClose();
      onSuccess?.();
    } catch (e) {
      setSubmitting(false);
      setError(e instanceof Error ? e.message : "連線失敗");
    }
  };

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50 p-0 sm:p-4 overscroll-contain"
      role="dialog"
      aria-modal="true"
      aria-labelledby="add-reservation-title"
    >
      <div className="flex w-full max-h-[90dvh] sm:max-h-[85vh] sm:max-w-md flex-col rounded-t-2xl sm:rounded-xl bg-white shadow-xl">
        <div className="flex shrink-0 items-center justify-between border-b border-gray-200 px-4 py-3">
          <h2 id="add-reservation-title" className="text-lg font-semibold">
            新增訂位
          </h2>
          <button
            type="button"
            onClick={handleClose}
            className="-mr-2 min-h-[44px] min-w-[44px] flex items-center justify-center rounded-lg text-gray-400 hover:bg-gray-100 hover:text-gray-600 touch-manipulation"
            aria-label="關閉"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        <form onSubmit={handleSubmit} className="flex min-h-0 flex-1 flex-col">
          <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3 space-y-3 sm:space-y-4">
            {error && (
              <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
                {error}
              </p>
            )}
            <div>
              <label htmlFor="room" className="mb-1 block text-sm font-medium text-gray-700">
              包廂 *
              </label>
              {rooms.length === 0 ? (
                <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-700">此分店尚無包廂，請先至管理後台新增。</p>
              ) : (
                <select
                  id="room"
                  required
                  value={roomId}
                  onChange={(e) => setRoomId(e.target.value)}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2.5 text-base focus:border-amber-600 focus:outline-none focus:ring-1 focus:ring-amber-600 sm:text-sm [&>option]:text-sm"
                  aria-label="選擇包廂"
                >
                  <option value="">請選擇包廂</option>
                  {rooms.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.name}（{r.capacity} 人 · 平日 ${Number(r.price_weekday)}/時 · 假日 ${Number(r.price_weekend)}/時）
                    </option>
                  ))}
                </select>
              )}
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <label htmlFor="name" className="mb-1 block text-sm font-medium text-gray-700">姓名 *</label>
                <input
                  id="name"
                  type="text"
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2.5 text-base focus:border-amber-600 focus:outline-none focus:ring-1 focus:ring-amber-600 sm:text-sm"
                  placeholder="王小明"
                  autoComplete="name"
                />
              </div>
              <div>
                <label htmlFor="phone" className="mb-1 block text-sm font-medium text-gray-700">電話 *</label>
                <input
                  id="phone"
                  type="tel"
                  required
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2.5 text-base focus:border-amber-600 focus:outline-none focus:ring-1 focus:ring-amber-600 sm:text-sm"
                  placeholder="0912345678"
                  autoComplete="tel"
                />
              </div>
            </div>
            <div>
              <label htmlFor="email" className="mb-1 block text-sm font-medium text-gray-700">Email</label>
              <input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full rounded-lg border border-gray-300 px-3 py-2.5 text-base focus:border-amber-600 focus:outline-none focus:ring-1 focus:ring-amber-600 sm:text-sm"
                placeholder="選填"
              />
            </div>
            <div>
              <label htmlFor="guestCount" className="mb-1 block text-sm font-medium text-gray-700">人數</label>
              <input
                id="guestCount"
                type="number"
                min={1}
                value={guestCount === "" ? "" : guestCount}
                onChange={(e) => setGuestCount(e.target.value === "" ? "" : Number(e.target.value))}
                className="w-full rounded-lg border border-gray-300 px-3 py-2.5 text-base focus:border-amber-600 focus:outline-none focus:ring-1 focus:ring-amber-600 sm:text-sm"
                placeholder="選填"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label htmlFor="date" className="mb-1 block text-sm font-medium text-gray-700">日期 *</label>
                <input
                  id="date"
                  type="date"
                  required
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2.5 text-base focus:border-amber-600 focus:outline-none focus:ring-1 focus:ring-amber-600 sm:text-sm"
                />
              </div>
              <div>
                <label htmlFor="time" className="mb-1 block text-sm font-medium text-gray-700">開始時間 *</label>
                <input
                  id="time"
                  type="time"
                  required
                  value={time}
                  onChange={(e) => setTime(e.target.value)}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2.5 text-base focus:border-amber-600 focus:outline-none focus:ring-1 focus:ring-amber-600 sm:text-sm"
                />
              </div>
            </div>
            <div>
              <label htmlFor="duration" className="mb-1 block text-sm font-medium text-gray-700">時數 *</label>
              <select
                id="duration"
                value={duration}
                onChange={(e) => setDuration(Number(e.target.value))}
                className="w-full rounded-lg border border-gray-300 px-3 py-2.5 text-base focus:border-amber-600 focus:outline-none focus:ring-1 focus:ring-amber-600 sm:text-sm"
              >
                {[1, 2, 3, 4, 5, 6, 7, 8].map((h) => (
                  <option key={h} value={h}>{h} 小時</option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">重複</label>
              <select
                value={repeatType}
                onChange={(e) => setRepeatType(e.target.value as "once" | "weekly")}
                className="w-full rounded-lg border border-gray-300 px-3 py-2.5 text-base focus:border-amber-600 focus:outline-none focus:ring-1 focus:ring-amber-600 sm:text-sm"
              >
                <option value="once">單次</option>
                <option value="weekly">每週重複</option>
              </select>
            </div>
            {repeatType === "weekly" && (
              <div>
                <label htmlFor="repeatWeeks" className="mb-1 block text-sm font-medium text-gray-700">重複週數</label>
                <select
                  id="repeatWeeks"
                  value={repeatWeeks}
                  onChange={(e) => setRepeatWeeks(Number(e.target.value))}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2.5 text-base focus:border-amber-600 focus:outline-none focus:ring-1 focus:ring-amber-600 sm:text-sm"
                >
                  {[4, 5, 6, 7, 8, 9, 10, 11, 12].map((w) => (
                    <option key={w} value={w}>{w} 週</option>
                  ))}
                </select>
              </div>
            )}
            <div>
              <label htmlFor="notes" className="mb-1 block text-sm font-medium text-gray-700">備註</label>
              <textarea
                id="notes"
                rows={2}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                className="w-full rounded-lg border border-gray-300 px-3 py-2.5 text-base focus:border-amber-600 focus:outline-none focus:ring-1 focus:ring-amber-600 sm:text-sm"
                placeholder="例：需要投影機、慶生"
              />
            </div>
            {roomId && date && (() => {
              const room = rooms.find((r) => r.id === roomId);
              if (!room) return null;
              const pricePerHour = getPricePerHour(room, date);
              const estimated = Math.round(pricePerHour * duration);
              const kind = isWeekend(date) ? "假日" : "平日";
              return (
                <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">
                  預估總價：<strong>${estimated}</strong>（{kind} ${pricePerHour}/時 × {duration} 小時）
                </p>
              );
            })()}
          </div>
          <div className="flex shrink-0 gap-2 border-t border-gray-200 bg-white px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
            <button
              type="button"
              onClick={handleClose}
              className="min-h-[44px] flex-1 rounded-lg border border-gray-300 bg-white px-4 py-2.5 text-gray-700 hover:bg-gray-50 touch-manipulation active:bg-gray-100"
            >
              取消
            </button>
            <button
              type="submit"
              disabled={submitting || !branchId || !roomId || rooms.length === 0}
              className="min-h-[44px] flex-1 rounded-lg bg-amber-600 px-4 py-2.5 text-white hover:bg-amber-700 disabled:opacity-50 touch-manipulation active:bg-amber-800"
            >
              {submitting ? "送出中…" : "送出"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
