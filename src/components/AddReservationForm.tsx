"use client";

import { useState, useEffect } from "react";
import { X, Clock, Repeat, Users, StickyNote, User, Phone, Mail } from "lucide-react";
import { format, addMonths } from "date-fns";
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

const WEEKDAYS = [
  { value: 1, label: "一" },
  { value: 2, label: "二" },
  { value: 3, label: "三" },
  { value: 4, label: "四" },
  { value: 5, label: "五" },
  { value: 6, label: "六" },
  { value: 0, label: "日" },
];

// 產生 1~10 小時，間隔 0.5
const DURATION_OPTIONS = [];
for (let i = 1; i <= 10; i += 0.5) {
  DURATION_OPTIONS.push(i);
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
  // Form State
  const [roomId, setRoomId] = useState("");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [guestCount, setGuestCount] = useState<number | "">("");
  const [notes, setNotes] = useState("");
  
  // Time State
  const [date, setDate] = useState("");
  const [time, setTime] = useState("");
  const [duration, setDuration] = useState(1);
  
  // Recurring State
  const [repeatEnabled, setRepeatEnabled] = useState(false);
  const [endDate, setEndDate] = useState("");
  const [selectedWeekdays, setSelectedWeekdays] = useState<number[]>([]);

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 初始化預設結束日期 (一個月後)
  // Fix: 加上 endDate 依賴，解決 Vercel 警告
  useEffect(() => {
    if (open && !endDate) {
      setEndDate(format(addMonths(new Date(), 1), "yyyy-MM-dd"));
    }
  }, [open, endDate]); 

  // 當開啟重複預約且日期改變時，自動勾選當天的星期
  // Fix: 加上 selectedWeekdays.length 依賴，解決 Vercel 警告
  useEffect(() => {
    if (repeatEnabled && date && selectedWeekdays.length === 0) {
      const day = new Date(date).getDay();
      setSelectedWeekdays([day]);
    }
  }, [repeatEnabled, date, selectedWeekdays.length]); 

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
    setRepeatEnabled(false);
    setSelectedWeekdays([]);
    setEndDate(format(addMonths(new Date(), 1), "yyyy-MM-dd"));
    setError(null);
  };

  const handleClose = () => {
    reset();
    onClose();
  };

  const toggleWeekday = (day: number) => {
    setSelectedWeekdays((prev) =>
      prev.includes(day) ? prev.filter((d) => d !== day) : [...prev, day]
    );
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!branchId || !roomId) return;
    const room = rooms.find((r) => r.id === roomId);
    if (!room) return;

    setSubmitting(true);
    setError(null);

    try {
      if (repeatEnabled) {
        // --- 進階重複預約 ---
        if (selectedWeekdays.length === 0) {
          setError("請至少選擇一個重複的星期");
          setSubmitting(false);
          return;
        }

        const res = await fetch("/api/reservations/recurring/admin", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            room_id: roomId,
            customer_name: name.trim(),
            phone: phone.trim(),
            email: email.trim() || null,
            start_date: date,
            end_date: endDate,
            weekdays: selectedWeekdays,
            start_time: time,
            duration_hours: duration,
            guest_count: guestCount === "" ? null : Number(guestCount),
            notes: notes.trim() || null,
          }),
        });

        const data = await res.json();
        setSubmitting(false);

        if (!res.ok) {
          if (res.status === 409 && data.conflicts) {
            const conflictDates = data.conflicts.slice(0, 5).join(", ");
            const more = data.conflicts.length > 5 ? `...等 ${data.conflicts.length} 筆` : "";
            setError(`部分時段已有預約，操作取消。\n衝突日期：${conflictDates}${more}`);
          } else {
            setError(data.error || "無法建立週期預約");
          }
          return;
        }

        const created = data.created ?? 0;
        handleClose();
        onSuccess?.();
        alert(`成功建立 ${created} 筆預約！`);
        return;

      } else {
        // --- 單次預約 ---
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
            status: "confirmed",
          }),
        });

        const data = await res.json();
        setSubmitting(false);

        if (!res.ok) {
          const msg = (data as { error?: string })?.error ?? "無法新增訂位";
          setError(msg);
          return;
        }

        handleClose();
        onSuccess?.();
      }
    } catch (e) {
      setSubmitting(false);
      setError(e instanceof Error ? e.message : "連線失敗");
    }
  };

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50 p-0 sm:p-4 overscroll-contain backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="add-reservation-title"
    >
      <div className="flex w-full max-h-[90dvh] sm:max-h-[85vh] sm:max-w-lg flex-col rounded-t-2xl sm:rounded-xl bg-white shadow-xl">
        {/* Header */}
        <div className="flex shrink-0 items-center justify-between border-b border-gray-200 px-6 py-4">
          <h2 id="add-reservation-title" className="text-xl font-bold text-gray-800">
            新增後台預約
          </h2>
          <button
            type="button"
            onClick={handleClose}
            className="rounded-full p-2 text-gray-400 hover:bg-gray-100 hover:text-gray-600 transition-colors"
            aria-label="關閉"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Scrollable Content */}
        <form onSubmit={handleSubmit} className="flex min-h-0 flex-1 flex-col">
          <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4 space-y-6">
            {error && (
              <div className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700 whitespace-pre-line border border-red-100">
                {error}
              </div>
            )}

            {/* 基本資訊區塊 */}
            <div className="space-y-4">
              <div>
                <label htmlFor="room" className="mb-1.5 block text-sm font-semibold text-gray-700">
                  選擇包廂
                </label>
                {rooms.length === 0 ? (
                  <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-700">此分店尚無包廂，請先至管理後台新增。</p>
                ) : (
                  <select
                    id="room"
                    required
                    value={roomId}
                    onChange={(e) => setRoomId(e.target.value)}
                    className="w-full rounded-lg border border-gray-300 px-3 py-2.5 text-sm focus:border-amber-600 focus:outline-none focus:ring-1 focus:ring-amber-600"
                  >
                    <option value="">請選擇包廂</option>
                    {rooms.map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.name} ({r.capacity}人)
                      </option>
                    ))}
                  </select>
                )}
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label htmlFor="name" className="mb-1.5 flex items-center gap-1.5 text-sm font-semibold text-gray-700">
                    <User className="h-4 w-4" /> 姓名
                  </label>
                  <input
                    id="name"
                    required
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    className="w-full rounded-lg border border-gray-300 px-3 py-2.5 text-sm focus:ring-amber-600"
                    placeholder="客戶姓名"
                  />
                </div>
                <div>
                  <label htmlFor="phone" className="mb-1.5 flex items-center gap-1.5 text-sm font-semibold text-gray-700">
                    <Phone className="h-4 w-4" /> 電話
                  </label>
                  <input
                    id="phone"
                    required
                    type="tel"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    className="w-full rounded-lg border border-gray-300 px-3 py-2.5 text-sm focus:ring-amber-600"
                    placeholder="09xx..."
                  />
                </div>
              </div>
            </div>

            <div className="h-px bg-gray-100" />

            {/* 時間設定區塊 */}
            <div className="space-y-4">
              <h3 className="text-sm font-bold text-gray-900 flex items-center gap-2">
                <Clock className="h-4 w-4" /> 時間設定
              </h3>
              <div className="grid grid-cols-3 gap-3">
                <div className="col-span-1">
                  <label className="mb-1.5 block text-xs font-medium text-gray-500">日期</label>
                  <input
                    type="date"
                    required
                    value={date}
                    onChange={(e) => setDate(e.target.value)}
                    className="w-full rounded-lg border border-gray-300 px-2 py-2 text-sm"
                  />
                </div>
                <div className="col-span-1">
                  <label className="mb-1.5 block text-xs font-medium text-gray-500">開始時間</label>
                  <input
                    type="time"
                    required
                    value={time}
                    onChange={(e) => setTime(e.target.value)}
                    className="w-full rounded-lg border border-gray-300 px-2 py-2 text-sm"
                  />
                </div>
                <div className="col-span-1">
                  <label className="mb-1.5 block text-xs font-medium text-gray-500">時數</label>
                  <select
                    value={duration}
                    onChange={(e) => setDuration(Number(e.target.value))}
                    className="w-full rounded-lg border border-gray-300 px-2 py-2 text-sm"
                  >
                    {DURATION_OPTIONS.map((h) => (
                      <option key={h} value={h}>{h} 小時</option>
                    ))}
                  </select>
                </div>
              </div>
            </div>

            {/* 長期預約區塊 */}
            <div className="rounded-xl border border-blue-100 bg-blue-50/50 p-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Repeat className="h-5 w-5 text-blue-600" />
                  <div>
                    <span className="block text-sm font-bold text-gray-900">長期重複預約</span>
                    <span className="text-xs text-gray-500">開啟後可設定固定每週時段</span>
                  </div>
                </div>
                <label className="relative inline-flex cursor-pointer items-center">
                  <input
                    type="checkbox"
                    checked={repeatEnabled}
                    onChange={(e) => setRepeatEnabled(e.target.checked)}
                    className="peer sr-only"
                  />
                  <div className="peer h-6 w-11 rounded-full bg-gray-200 after:absolute after:top-[2px] after:left-[2px] after:h-5 after:w-5 after:rounded-full after:border after:border-gray-300 after:bg-white after:transition-all after:content-[''] peer-checked:bg-blue-600 peer-checked:after:translate-x-full peer-checked:after:border-white peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-300"></div>
                </label>
              </div>

              {repeatEnabled && (
                <div className="mt-4 space-y-4 border-t border-blue-100 pt-4 animate-in fade-in slide-in-from-top-2">
                  <div>
                    <label className="mb-2 block text-xs font-semibold text-gray-600">重複星期 (可複選)</label>
                    <div className="flex flex-wrap gap-2">
                      {WEEKDAYS.map((day) => (
                        <button
                          key={day.value}
                          type="button"
                          onClick={() => toggleWeekday(day.value)}
                          className={`flex h-8 w-8 items-center justify-center rounded-full text-sm font-medium transition-all ${
                            selectedWeekdays.includes(day.value)
                              ? "bg-blue-600 text-white shadow-md shadow-blue-200"
                              : "bg-white text-gray-600 border border-gray-200 hover:border-blue-300"
                          }`}
                        >
                          {day.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div>
                    <label className="mb-1 block text-xs font-semibold text-gray-600">
                      結束日期 (最多一年)
                    </label>
                    <input
                      type="date"
                      value={endDate}
                      onChange={(e) => setEndDate(e.target.value)}
                      min={date}
                      className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                    />
                    <p className="mt-1 text-xs text-gray-500">
                      將建立從 {date || "開始日期"} 至 {endDate} 符合星期的所有訂單。
                    </p>
                  </div>
                </div>
              )}
            </div>

            {/* 其他資訊區塊 */}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="mb-1.5 flex items-center gap-1.5 text-sm font-medium text-gray-700">
                  <Mail className="h-4 w-4" /> Email
                </label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2.5 text-sm"
                  placeholder="選填"
                />
              </div>
              <div>
                <label className="mb-1.5 flex items-center gap-1.5 text-sm font-medium text-gray-700">
                  <Users className="h-4 w-4" /> 人數
                </label>
                <input
                  type="number"
                  min={1}
                  value={guestCount}
                  onChange={(e) => setGuestCount(e.target.value === "" ? "" : Number(e.target.value))}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2.5 text-sm"
                  placeholder="選填"
                />
              </div>
            </div>

            <div>
              <label className="mb-1.5 flex items-center gap-1.5 text-sm font-medium text-gray-700">
                <StickyNote className="h-4 w-4" /> 備註
              </label>
              <textarea
                rows={2}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                className="w-full rounded-lg border border-gray-300 px-3 py-2.5 text-sm"
                placeholder="選填"
              />
            </div>

            {/* 價格預估 */}
            {!repeatEnabled && roomId && date && (() => {
              const room = rooms.find((r) => r.id === roomId);
              if (!room) return null;
              const pricePerHour = getPricePerHour(room, date);
              const estimated = Math.round(pricePerHour * duration);
              return (
                <div className="rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-900 border border-amber-100 flex justify-between items-center">
                  <span>單次預估總價</span>
                  <strong className="text-lg">${estimated}</strong>
                </div>
              );
            })()}
          </div>

          {/* Footer Actions */}
          <div className="flex shrink-0 gap-3 border-t border-gray-200 bg-gray-50/50 px-6 py-4">
            <button
              type="button"
              onClick={handleClose}
              className="flex-1 rounded-xl border border-gray-300 bg-white px-4 py-2.5 font-medium text-gray-700 hover:bg-gray-50 transition-colors"
            >
              取消
            </button>
            <button
              type="submit"
              disabled={submitting || !branchId || !roomId || rooms.length === 0}
              className="flex-1 rounded-xl bg-gray-900 px-4 py-2.5 font-medium text-white hover:bg-gray-800 disabled:opacity-50 disabled:hover:bg-gray-900 transition-colors shadow-sm"
            >
              {submitting ? "處理中..." : repeatEnabled ? "批次建立預約" : "建立預約"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}