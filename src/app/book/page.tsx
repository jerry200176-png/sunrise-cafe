"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import type { Branch, Room } from "@/types";
import { getDurationOptions } from "@/lib/booking-utils";

type Step = "branch" | "room" | "date" | "slot" | "form";

interface SlotItem {
  start: string;
  end: string;
  available: boolean;
}

export default function BookPage() {
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
  const [duration, setDuration] = useState(1);
  const [isHoliday, setIsHoliday] = useState(false);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [guestCount, setGuestCount] = useState<number | "">("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  
  // 這裡確保介面包含 image_url
  const [branchRoomsAvailability, setBranchRoomsAvailability] = useState<{
    rooms: {
      roomId: string;
      roomName: string;
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
      .then((d) => setBranches(Array.isArray(d) ? d : []))
      .catch(() => setBranches([]));
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
                capacity: number;
                price_weekday: number;
                price_weekend: number;
              }) => ({
                id: r.roomId,
                name: r.roomName,
                capacity: r.capacity,
                price_weekday: r.price_weekday,
                price_weekend: r.price_weekend,
                branch_id: branchId,
                type: null,
              })
            )
          );
        }
      })
      .catch((e) => {
        setError(e instanceof Error ? e.message : "無法載入空檔");
        setBranchRoomsAvailability(null);
      })
      .finally(() => setLoading(false));
  }, [step, branchId, date]);

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
        setError(e instanceof Error ? e.message : "無法載入時段");
        setSlots([]);
      })
      .finally(() => setLoading(false));
  }, [step, branchId, roomId, date]);

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
    const d = new Date(date + "T12:00:00");
    const day = d.getDay();
    const isWeekend = day === 0 || day === 6;
    const pricePerHour = isWeekend ? room.price_weekend : room.price_weekday;
    return Math.round(Number(pricePerHour) * duration);
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
    if (!selectedStart || !name.trim() || !phone.trim()) return;
    const start = new Date(selectedStart);
    const end = new Date(start.getTime() + duration * 60 * 60 * 1000);
    setSubmitting(true);
    setError(null);
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
        }),
      });
      const data = await res.json();
      setSubmitting(false);
      if (res.status === 409) {
        setError((data as { error?: string })?.error ?? "該時段已被預訂，請重新選擇");
        return;
      }
      if (!res.ok) {
        setError((data as { error?: string })?.error ?? "無法完成預約");
        return;
      }
      const code = (data as { booking_code?: string })?.booking_code;
      if (code) {
        const weekendFlag = isHoliday ? "1" : "0";
        window.location.href = `/book/success?code=${encodeURIComponent(code)}&weekend=${weekendFlag}`;
      } else {
        setError("預約成功，但未取得訂位代號");
      }
    } catch (e) {
      setSubmitting(false);
      setError(e instanceof Error ? e.message : "連線失敗");
    }
  };

  const formatSlotTime = (iso: string) =>
    new Date(iso).toLocaleTimeString("zh-TW", { hour: "2-digit", minute: "2-digit" });

  const today = new Date().toISOString().slice(0, 10);
  const summary = getSelectedSummary(); // 取得當前選擇摘要

  return (
    <main className="min-h-screen bg-gray-50">
      <header className="sticky top-0 z-10 border-b border-gray-200 bg-white">
        <div className="mx-auto flex max-w-lg items-center gap-3 px-4 py-3">
          <Link
            href="/"
            className="flex items-center justify-center rounded-lg p-2 text-gray-600 hover:bg-gray-100"
            aria-label="返回"
          >
            <ArrowLeft className="h-5 w-5" />
          </Link>
          <h1 className="text-lg font-semibold text-gray-900">我要訂位</h1>
        </div>
      </header>

      <div className="mx-auto max-w-lg px-4 py-6">
        {error && (
          <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
            {error}
            <p className="mt-2 text-xs text-red-600">
              若為線上網站，可開啟{" "}
              <a href="/api/booking-health" target="_blank" rel="noopener noreferrer" className="underline">
                /api/booking-health
              </a>{" "}
              檢查後端設定。
            </p>
          </div>
        )}

        {step === "branch" && (
          <>
            <h2 className="mb-3 text-sm font-medium text-gray-700">選擇分店</h2>
            <ul className="space-y-2">
              {branches.map((b) => (
                <li key={b.id}>
                  <button
                    type="button"
                    onClick={() => {
                      setBranchId(b.id);
                      setStep("date");
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
              <p className="text-sm text-gray-500">尚無分店資料</p>
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
              ← 重選分店
            </button>
            <h2 className="mb-3 text-sm font-medium text-gray-700">選擇日期</h2>
            <input
              type="date"
              min={today}
              value={date}
              onChange={(e) => {
                const next = e.target.value;
                setDate(next);
                if (next) {
                  const d = new Date(next + "T12:00:00");
                  const day = d.getDay();
                  setIsHoliday(day === 0 || day === 6);
                } else {
                  setIsHoliday(false);
                }
              }}
              className="w-full rounded-xl border border-gray-300 px-4 py-3 text-base"
            />
            <div className="mt-4 flex justify-end">
              <button
                type="button"
                disabled={!date}
                onClick={() => setStep("room")}
                className="rounded-lg bg-amber-600 px-4 py-2 text-white disabled:opacity-50"
              >
                下一步
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
              ← 重選日期
            </button>
            <h2 className="mb-2 text-sm font-medium text-gray-700">選擇包廂</h2>
            <p className="mb-3 text-xs text-gray-500">
              {date} · 以下為各包廂當日空檔
            </p>
            {loading ? (
              <p className="py-4 text-center text-gray-500">載入中…</p>
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
                      <button
                        type="button"
                        onClick={() => {
                          setRoomId(r.roomId);
                          setRoomName(r.roomName);
                          setBranchName(branchRoomsAvailability.branchName);
                          setStep("slot");
                        }}
                        className="w-full rounded-xl border border-gray-200 bg-white px-4 py-3 text-left shadow-sm hover:border-amber-400 hover:bg-amber-50/50"
                      >
                        {/* 圖片顯示區塊 */}
                        <div className="mb-2 overflow-hidden rounded-lg">
                          <div className="aspect-video w-full overflow-hidden rounded-lg bg-gray-100 flex items-center justify-center text-xs text-gray-500">
                            {imageUrl ? (
                              <>
                                {/* eslint-disable-next-line @next/next/no-img-element */}
                                <img
                                  src={imageUrl}
                                  alt={r.roomName}
                                  className="h-full w-full object-cover"
                                  loading="lazy"
                                  decoding="async"
                                  onError={(e) => {
                                    const img = e.currentTarget;
                                    img.style.display = "none";
                                  }}
                                />
                              </>
                            ) : (
                              // Fallback (若無圖片)
                              <span>無圖片</span>
                            )}
                          </div>
                        </div>

                        <span className="font-medium text-gray-900">{r.roomName}</span>
                        <p className="mt-0.5 text-sm text-gray-500">
                          {r.capacity} 人 · 平日 ${r.price_weekday}/時 · 假日 ${r.price_weekend}/時
                        </p>
                        <p className="mt-1.5 text-xs text-gray-600">
                          {freeCount > 0 ? (
                            <>可預約 {ranges.slice(0, 3).join("、")}{ranges.length > 3 ? " …" : ""}</>
                          ) : (
                            <span className="text-rose-600">本日已滿</span>
                          )}
                        </p>
                        <div className="mt-2 flex flex-wrap gap-0.5">
                          {r.slots.slice(0, 12).map((s) => (
                            <span
                              key={s.start}
                              className={`inline-block h-2 w-4 rounded-sm ${s.available ? "bg-green-300" : "bg-rose-200"}`}
                              title={formatSlotTime(s.start)}
                            />
                          ))}
                          {r.slots.length > 12 && (
                            <span className="text-xs text-gray-400">…</span>
                          )}
                        </div>
                      </button>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <div className="space-y-2">
                <p className="text-sm text-gray-500">無法載入包廂空檔，請重試或重選日期</p>
                <p className="text-xs text-gray-400">
                  若為線上網站，可開啟{" "}
                  <a href="/api/booking-health" target="_blank" rel="noopener noreferrer" className="underline">
                    /api/booking-health
                  </a>{" "}
                  檢查後端是否已設定 SUPABASE_SERVICE_ROLE_KEY 與 get_blocked_slots。
                </p>
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
              ← 重選包廂
            </button>
            <h2 className="mb-2 text-sm font-medium text-gray-700">選擇時段</h2>
            <p className="mb-3 text-xs text-gray-500">
              {branchName} · {roomName} · {date}
            </p>
            {loading ? (
              <p className="py-4 text-center text-gray-500">載入中…</p>
            ) : (
              <>
                {slots.length > 0 && (
                  <p className="mb-3 text-xs text-gray-600">
                    本日共 {slots.length} 個時段，{slots.filter((s) => s.available).length} 個可預約
                  </p>
                )}
                {isHoliday && (
                  <p className="mb-3 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
                    ⚠️ 假日訂位需預付 總金額 50% 作為訂金。請先送出申請，待管理員確認有位後，將透過 LINE/簡訊通知您匯款。
                  </p>
                )}
                <div className="mb-3 flex items-center gap-4 text-xs text-gray-600">
                  <span className="flex items-center gap-1">
                    <span className="inline-block h-4 w-4 rounded bg-green-200" /> 可預約
                  </span>
                  <span className="flex items-center gap-1 rounded border border-rose-200 bg-rose-50 px-1.5 py-0.5 text-rose-600">
                    <span className="inline-block h-3 w-3 rounded bg-rose-200" /> 已額滿
                  </span>
                </div>

                {/* 步驟 1：時數 */}
                <div className="mb-4">
                  <div className="mb-2 flex items-center justify-between">
                     <h3 className="text-sm font-bold text-gray-800">步驟 1：選擇租借時數</h3>
                  </div>
                  <select
                    value={duration}
                    onChange={(e) => {
                      setDuration(Number(e.target.value));
                      setSelectedStart("");
                    }}
                    className="w-full rounded-xl border border-gray-300 p-3"
                  >
                    {getDurationOptions().map((h) => (
                      <option key={h} value={h}>{h} 小時</option>
                    ))}
                  </select>
                </div>

                {duration === 1 && !slots.some((s) => s.available) && slots.length > 0 && (
                  <p className="mb-3 text-sm text-amber-700">
                    本日此時段已滿，請點擊上方「重選包廂」或返回重選日期選擇其他日期。
                  </p>
                )}
                {duration > 1 && !slots.some((s) => canSelectDuration(s.start)) && slots.length > 0 && (
                  <p className="mb-3 text-sm text-amber-700">
                    目前沒有連續 {duration} 小時的空檔。請改選 1 小時，或點擊上方「重選包廂」/重選日期選擇其他日期。
                  </p>
                )}

                {/* 步驟 2：時段 */}
                <div>
                   <h3 className="mb-2 text-sm font-bold text-gray-800">
                     步驟 2：選擇開始時間 <span className="text-xs font-normal text-gray-500">(綠色可預約)</span>
                   </h3>
                   <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
                     {slots.map((s) => {
                       const available = duration === 1 ? s.available : canSelectDuration(s.start);
                       return (
                         <button
                           key={s.start}
                           type="button"
                           disabled={!available}
                           onClick={() => setSelectedStart(s.start)}
                           className={`rounded-lg border py-3 text-sm font-medium ${
                             selectedStart === s.start
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
                    <p className="font-bold">📅 您選擇的是：</p>
                    <p>{summary.dateLabel} {summary.startLabel} ~ {summary.endLabel} (共 {duration} 小時)</p>
                  </div>
                )}

                <div className="mt-4 flex justify-end">
                  <button
                    type="button"
                    disabled={!selectedStart || !canSelectDuration(selectedStart)}
                    onClick={() => setStep("form")}
                    className="rounded-lg bg-amber-600 px-4 py-2 text-white disabled:opacity-50"
                  >
                    下一步 · 填寫資料
                  </button>
                </div>
              </>
            )}
          </>
        )}

        {step === "form" && (
          <>
            <button
              type="button"
              onClick={() => setStep("slot")}
              className="mb-3 text-sm text-amber-700"
            >
              ← 重選時段
            </button>
            <p className="mb-4 text-sm text-gray-600">
              {branchName} · {roomName} · {date}{" "}
              {selectedStart && formatSlotTime(selectedStart)} 起 {duration} 小時
            </p>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">姓名 *</label>
                <input
                  type="text"
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2.5"
                  placeholder="王小明"
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">手機號碼 *</label>
                <input
                  type="tel"
                  required
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2.5"
                  placeholder="0912345678 (請填寫正確手機)" 
                />
                <p className="mt-1 text-xs text-gray-500">
                  假日訂位將透過簡訊/LINE通知匯款，請務必填寫正確。
                </p>
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">Email</label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2.5"
                  placeholder="選填"
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">人數</label>
                <input
                  type="number"
                  min={1}
                  value={guestCount === "" ? "" : guestCount}
                  onChange={(e) =>
                    setGuestCount(e.target.value === "" ? "" : Number(e.target.value))
                  }
                  className="w-full rounded-lg border border-gray-300 px-3 py-2.5"
                  placeholder="選填"
                />
              </div>
              <button
                type="submit"
                disabled={submitting}
                className="w-full rounded-lg bg-amber-600 py-3 text-white hover:bg-amber-700 disabled:opacity-50"
              >
                {submitting ? "送出中…" : "確認預約"}
              </button>
            </form>
          </>
        )}
      </div>
    </main>
  );
}