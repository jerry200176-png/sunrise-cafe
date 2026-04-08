"use client";

import { useCallback, useEffect, useState } from "react";
import { format, parseISO } from "date-fns";
import { zhTW } from "date-fns/locale";
import { Calendar, Clock, DoorOpen, Pencil, Users, X, Send } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { isDepositRequired } from "@/lib/booking-utils";
import type { Reservation, ReservationStatus, Room } from "@/types";

function isWeekend(dateStr: string): boolean {
  if (!dateStr) return false;
  const d = new Date(dateStr + "T12:00:00");
  const day = d.getDay();
  return day === 0 || day === 6;
}

function getPricePerHour(room: Room, dateStr: string): number {
  return isWeekend(dateStr) ? Number(room.price_weekend) : Number(room.price_weekday);
}

const RESERVATIONS_API = "/api/reservations";

const STATUS_LABELS: Record<string, string> = {
  pending: "待確認",
  confirmed: "已預約",
  checked_in: "已報到",
  cancelled: "已取消",
  completed: "已結帳",
  reserved: "已預約",
  paid: "已結帳",
};

const STATUS_OPTIONS: { value: ReservationStatus; label: string }[] = [
  { value: "pending", label: "待確認" },
  { value: "confirmed", label: "已預約" },
  { value: "checked_in", label: "已報到" },
  { value: "completed", label: "已結帳" },
  { value: "cancelled", label: "已取消" },
];

const STATUS_STYLES: Record<string, string> = {
  pending: "bg-yellow-100 text-yellow-800",
  confirmed: "bg-green-100 text-green-800",
  checked_in: "bg-emerald-100 text-emerald-800",
  cancelled: "bg-gray-100 text-gray-600",
  completed: "bg-blue-100 text-blue-800",
  reserved: "bg-amber-100 text-amber-800",
  paid: "bg-blue-100 text-blue-800",
};

const normalizeText = (value: string) =>
  value.toLowerCase().replace(/\s+/g, "");

interface ReservationListProps {
  branchId: string | null;
  rooms?: Room[];
}

export function ReservationList({ branchId, rooms = [] }: ReservationListProps) {
  const [reservations, setReservations] = useState<Reservation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<Reservation | null>(null);
  const [editName, setEditName] = useState("");
  const [editPhone, setEditPhone] = useState("");
  const [editDate, setEditDate] = useState("");
  const [editTime, setEditTime] = useState("");
  const [editDuration, setEditDuration] = useState(1);
  const [editTotalPrice, setEditTotalPrice] = useState<number | "">("");
  const [editGuestCount, setEditGuestCount] = useState<number | "">("");
  const [editNotes, setEditNotes] = useState("");
  const [editStatus, setEditStatus] = useState<ReservationStatus>("confirmed");
  const [editSubmitting, setEditSubmitting] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<"pending" | "upcoming" | "history">("pending");
  const [searchTerm, setSearchTerm] = useState("");
  const [sortBy, setSortBy] = useState<"time_desc" | "time_asc" | "price_desc" | "price_asc">(
    "time_asc"
  );
  const [sendingLine, setSendingLine] = useState(false);

  const fetchReservations = useCallback(async (showLoading = true) => {
    if (!branchId) {
      setReservations([]);
      setLoading(false);
      return;
    }
    if (showLoading) setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${RESERVATIONS_API}?branchId=${encodeURIComponent(branchId)}&_t=${Date.now()}`);
      const data = await res.json();
      if (!res.ok) {
        setError((data as { error?: string })?.error ?? "無法載入訂位");
        if (showLoading) setReservations([]);
      } else {
        setReservations((data as Reservation[]) ?? []);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "連線失敗");
      if (showLoading) setReservations([]);
    } finally {
      if (showLoading) setLoading(false);
    }
  }, [branchId]);

  useEffect(() => {
    fetchReservations();
  }, [fetchReservations]);

  useEffect(() => {
    if (!branchId) return;
    let timeoutId: NodeJS.Timeout;
    try {
      const channel = supabase
        .channel("reservations-changes")
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: "reservations" },
          () => {
            clearTimeout(timeoutId);
            timeoutId = setTimeout(() => {
              fetchReservations(false);
            }, 500);
          }
        )
        .subscribe();
      return () => {
        clearTimeout(timeoutId);
        supabase.removeChannel(channel);
      };
    } catch {
      return undefined;
    }
  }, [branchId, fetchReservations]);

  const toTaiwanParts = (iso: string) => {
    const d = new Date(iso);
    const tw = new Date(d.getTime() + 8 * 60 * 60 * 1000);
    return {
      date: tw.toISOString().slice(0, 10),
      time: `${String(tw.getUTCHours()).padStart(2, "0")}:${String(tw.getUTCMinutes()).padStart(2, "0")}`,
      ms: d.getTime(),
    };
  };

  const openEdit = (r: Reservation) => {
    setEditing(r);
    setEditName(r.customer_name);
    setEditPhone(r.phone);
    const startParts = toTaiwanParts(r.start_time);
    const endParts = toTaiwanParts(r.end_time);
    setEditDate(startParts.date);
    setEditTime(startParts.time);
    const diffHours = (endParts.ms - startParts.ms) / (60 * 60 * 1000);
    setEditDuration(diffHours > 0 ? Math.round(diffHours * 2) / 2 : 1);
    setEditTotalPrice(r.total_price != null ? Number(r.total_price) : "");
    setEditGuestCount(r.guest_count ?? "");
    setEditNotes(r.notes ?? "");
    setEditStatus(r.status as ReservationStatus);
    setEditError(null);
  };

  const closeEdit = () => {
    setEditing(null);
    setEditError(null);
  };

  const submitEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editing) return;
    setEditSubmitting(true);
    setEditError(null);
    try {
      const start = new Date(`${editDate}T${editTime}:00+08:00`);
      const end = new Date(start.getTime() + editDuration * 60 * 60 * 1000);
      const totalPrice =
        editTotalPrice === "" ? null : Number(editTotalPrice);
      const res = await fetch(`${RESERVATIONS_API}/${editing.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          customer_name: editName.trim(),
          phone: editPhone.trim(),
          start_time: start.toISOString(),
          end_time: end.toISOString(),
          total_price: totalPrice,
          guest_count: editGuestCount === "" ? null : Number(editGuestCount),
          notes: editNotes.trim() || null,
          status: editStatus,
        }),
      });
      const data = await res.json();
      setEditSubmitting(false);
      if (!res.ok) {
        setEditError((data as { error?: string })?.error ?? "無法更新");
        return;
      }
      closeEdit();
      fetchReservations(false);
    } catch (e) {
      setEditSubmitting(false);
      setEditError(e instanceof Error ? e.message : "連線失敗");
    }
  };

  const updateStatus = async (id: string, status: ReservationStatus) => {
    setReservations((prev) =>
      prev.map((r) => (r.id === id ? { ...r, status } : r))
    );
    try {
      await fetch(`${RESERVATIONS_API}/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      fetchReservations(false);
    } catch {
      fetchReservations(false);
    }
  };

  const updateDepositStatus = async (id: string, is_deposit_paid: boolean) => {
    setReservations((prev) =>
      prev.map((r) => (r.id === id ? { ...r, is_deposit_paid } : r))
    );
    try {
      await fetch(`${RESERVATIONS_API}/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ is_deposit_paid }),
      });
      fetchReservations(false);
    } catch {
      fetchReservations(false);
    }
  };

  const handleSendLine = async () => {
    if (!window.confirm("確定要手動發送明日訂位提醒到 LINE 群組嗎？")) return;
    setSendingLine(true);
    try {
      const res = await fetch("/api/admin/reminders/send-line", { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "發送失敗");
      alert(data.message || `成功發送，共 ${data.sent} 筆`);
      fetchReservations(false);
    } catch (err) {
      alert(err instanceof Error ? err.message : "發生未知錯誤");
    } finally {
      setSendingLine(false);
    }
  };

  if (!branchId) {
    return (
      <div className="rounded-xl border border-gray-200 bg-gray-50/50 p-8 text-center text-gray-500">
        請先選擇分店以查看訂位
      </div>
    );
  }

  if (loading) {
    return (
      <div className="rounded-xl border border-gray-200 bg-white p-8 text-center text-gray-500">
        載入中…
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-red-700">
        {error}
      </div>
    );
  }

  if (reservations.length === 0) {
    return (
      <div className="rounded-xl border border-gray-200 bg-white p-8 text-center text-gray-500">
        尚無訂位資料
      </div>
    );
  }

  const pendingList = reservations.filter((r) => r.status === "pending");
  const upcomingList = reservations.filter((r) =>
    ["confirmed", "paid", "checked_in"].includes(r.status)
  );
  const historyList = reservations.filter((r) =>
    ["cancelled", "completed"].includes(r.status)
  );
  const pendingCount = pendingList.length;

  const listForTab =
    activeTab === "pending" ? pendingList : activeTab === "upcoming" ? upcomingList : historyList;

  const roomNameMap = new Map(rooms.map((r) => [r.id, r.name]));
  const query = normalizeText(searchTerm.trim());
  const filteredList = listForTab.filter((r) => {
    if (!query) return true;
    const roomName = roomNameMap.get(r.room_id) ?? "";
    const haystack = [
      r.customer_name,
      r.phone,
      r.booking_code ?? "",
      roomName,
      r.notes ?? "",
    ]
      .join(" ")
      .toLowerCase();
    return normalizeText(haystack).includes(query);
  });
  const sortedList = [...filteredList].sort((a, b) => {
    switch (sortBy) {
      case "time_desc":
        return b.start_time.localeCompare(a.start_time);
      case "price_desc":
        return (Number(b.total_price) || 0) - (Number(a.total_price) || 0);
      case "price_asc":
        return (Number(a.total_price) || 0) - (Number(b.total_price) || 0);
      case "time_asc":
      default:
        return a.start_time.localeCompare(b.start_time);
    }
  });
  const showDateGroup = sortBy === "time_asc" || sortBy === "time_desc";
  const displayList: Array<{ type: "date"; date: string } | { type: "item"; item: Reservation }> =
    [];
  if (showDateGroup) {
    let lastDate = "";
    sortedList.forEach((r) => {
      const dateKey = r.start_time.slice(0, 10);
      if (dateKey !== lastDate) {
        displayList.push({ type: "date", date: dateKey });
        lastDate = dateKey;
      }
      displayList.push({ type: "item", item: r });
    });
  } else {
    sortedList.forEach((r) => displayList.push({ type: "item", item: r }));
  }

  return (
    <>
      <div className="mb-3 flex flex-wrap items-center gap-2 border-b border-gray-200 bg-gray-50 px-4 py-2">
        <button
          type="button"
          onClick={() => setActiveTab("pending")}
          className={`rounded-full px-3 py-1 text-xs font-medium ${activeTab === "pending"
            ? "bg-amber-600 text-white"
            : "bg-gray-100 text-gray-700 hover:bg-gray-200"
            }`}
        >
          待審核
          {pendingCount > 0 && (
            <span className="ml-1 rounded-full bg-red-600 px-1.5 py-0.5 text-[10px] font-bold text-white">
              {pendingCount}
            </span>
          )}
        </button>
        <button
          type="button"
          onClick={() => setActiveTab("upcoming")}
          className={`rounded-full px-3 py-1 text-xs font-medium ${activeTab === "upcoming"
            ? "bg-amber-600 text-white"
            : "bg-gray-100 text-gray-700 hover:bg-gray-200"
            }`}
        >
          訂位管理
        </button>
        <button
          type="button"
          onClick={() => setActiveTab("history")}
          className={`rounded-full px-3 py-1 text-xs font-medium ${activeTab === "history"
            ? "bg-amber-600 text-white"
            : "bg-gray-100 text-gray-700 hover:bg-gray-200"
            }`}
        >
          歷史紀錄
        </button>
        <button
          type="button"
          onClick={handleSendLine}
          disabled={sendingLine}
          className="ml-auto flex items-center gap-1 rounded-lg bg-green-600 px-3 py-1 text-xs font-semibold text-white hover:bg-green-700 disabled:opacity-50"
        >
          <Send className="h-3.5 w-3.5" />
          {sendingLine ? "發送中..." : "發送 LINE 明日提醒"}
        </button>
      </div>
      <div className="mb-3 flex flex-wrap items-center gap-2 px-4">
        <input
          type="text"
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm sm:w-64"
          placeholder="搜尋姓名/電話/代號/包廂/備註"
        />
        <select
          value={sortBy}
          onChange={(e) => setSortBy(e.target.value as typeof sortBy)}
          className="rounded-lg border border-gray-300 px-3 py-2 text-sm"
        >
          <option value="time_asc">時間：早 → 晚</option>
          <option value="time_desc">時間：晚 → 早</option>
          <option value="price_desc">金額：高 → 低</option>
          <option value="price_asc">金額：低 → 高</option>
        </select>
        <span className="text-xs text-gray-500">共 {sortedList.length} 筆</span>
      </div>

      <div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
        <ul className="divide-y divide-gray-100">
          {displayList.map((row) => {
            if (row.type === "date") {
              return (
                <li key={`date-${row.date}`} className="bg-gray-50 px-4 py-2 text-xs text-gray-500">
                  {format(parseISO(row.date), "yyyy/MM/dd (EEE)", { locale: zhTW })}
                </li>
              );
            }
            const r = row.item;
            const roomName = roomNameMap.get(r.room_id) ?? "—";
            return (
              <li key={r.id} className="space-y-2 p-4 hover:bg-gray-50/80">
                {/* Row 1: Name · Phone · Status */}
                <div className="flex items-center gap-3">
                  <span className="text-base font-semibold text-gray-900">{r.customer_name}</span>
                  <span className="text-sm text-gray-500">{r.phone}</span>
                  <span
                    className={`ml-auto shrink-0 rounded-full px-2.5 py-0.5 text-xs font-medium ${STATUS_STYLES[r.status] ?? "bg-gray-100 text-gray-700"
                      }`}
                  >
                    {STATUS_LABELS[r.status] ?? r.status}
                  </span>
                </div>

                {/* Row 2: Room · Code · Guest count · Date · Time · Price */}
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-gray-600">
                  <span className="flex items-center gap-1">
                    <DoorOpen className="h-3.5 w-3.5 text-gray-400" />
                    {roomName}
                  </span>
                  {r.booking_code && (
                    <span className="text-xs text-gray-500">
                      代號：<span className="font-mono">{r.booking_code}</span>
                    </span>
                  )}
                  {r.guest_count != null && (
                    <span className="flex items-center gap-1">
                      <Users className="h-3.5 w-3.5 text-gray-400" />
                      {r.guest_count} 人
                    </span>
                  )}
                  <span className="flex items-center gap-1">
                    <Calendar className="h-3.5 w-3.5 text-gray-400" />
                    {format(parseISO(r.start_time), "yyyy/MM/dd (EEE)", { locale: zhTW })}
                  </span>
                  <span className="flex items-center gap-1">
                    <Clock className="h-3.5 w-3.5 text-gray-400" />
                    {format(parseISO(r.start_time), "HH:mm")}–{format(parseISO(r.end_time), "HH:mm")}
                  </span>
                  {r.total_price != null && (
                    <span className="font-medium text-gray-800">${Number(r.total_price)}</span>
                  )}
                  {isDepositRequired(r.start_time.slice(0, 10)) && (
                    r.is_deposit_paid ? (
                      <span className="rounded-full bg-green-100 px-2 py-0.5 text-[11px] font-medium text-green-800 border border-green-200">
                        ✅ 已付訂金
                      </span>
                    ) : (
                      <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-800 border border-amber-200">
                        💰 需收訂金
                      </span>
                    )
                  )}
                </div>

                {/* Row 3: Notes (if any) */}
                {r.notes && (
                  <p className="text-sm text-gray-500 italic">備註：{r.notes}</p>
                )}

                {/* Row 4: Actions */}
                {activeTab === "pending" ? (
                  <div className="flex flex-wrap items-center gap-2 pt-1">
                    <button
                      type="button"
                      onClick={() => updateStatus(r.id, "confirmed")}
                      className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700"
                    >
                      ✅ 確認
                    </button>
                    <button
                      type="button"
                      onClick={async () => {
                        const ok = window.confirm("確定要將此訂位標記為取消/拒絕嗎？");
                        if (!ok) return;
                        await updateStatus(r.id, "cancelled");
                      }}
                      className="rounded-lg bg-red-50 px-3 py-1.5 text-xs font-semibold text-red-700 hover:bg-red-100"
                    >
                      ❌ 拒絕
                    </button>
                    {isDepositRequired(r.start_time.slice(0, 10)) && !r.is_deposit_paid && (
                      <button
                        type="button"
                        onClick={() => updateDepositStatus(r.id, true)}
                        className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-1.5 text-xs font-medium text-amber-800 hover:bg-amber-100"
                      >
                        ✅ 標記已付訂金
                      </button>
                    )}
                    {isDepositRequired(r.start_time.slice(0, 10)) && r.total_price != null && (
                      <button
                        type="button"
                        onClick={async () => {
                          const startDate = parseISO(r.start_time);
                          const endDate = parseISO(r.end_time);
                          const formattedDate = format(startDate, "yyyy/MM/dd (EEE)", {
                            locale: zhTW,
                          });
                          const timeRange = `${format(startDate, "HH:mm")}–${format(endDate, "HH:mm")}`;
                          const deposit = Math.ceil(Number(r.total_price) / 2);
                          const branchName = r.room_with_branch?.branch?.name ?? "";
                          const isDaan = branchName.includes("大安");
                          const linePayUrl =
                            "https://qrcodepay.line.me/qr/payment/%252BmF6rR41PSp3R8NMydLA%252BRt1IvAFgPchBvtrJoR20aoZKY4Hr1qrbfaYSoPDUyu0";
                          const text = isDaan
                            ? `您好，這裡是昇昇咖啡 (大安店)。\n\n收到您 ${formattedDate} ${timeRange} 的預約申請（${r.customer_name}）。\n確認該時段有空位，本筆訂單總金額為 $${r.total_price}，請於今日內匯款訂金 $${deposit}（總額一半）以保留座位。\n\n【匯款資訊】\n銀行：台北富邦銀行 (012)\n帳號：8212-00000-8489-6\n戶名：昇昇咖啡張文霞\n\n或者您可以使用 LINE Pay 付款：\n${linePayUrl}\n\n匯款後請回傳「末五碼」或「截圖」告知，謝謝！\n\n📌 帶外食沒關係，離場時請將垃圾自行帶走；若未帶走，將酌收清潔費 300 元。`
                            : `您好，這裡是昇昇咖啡。\n\n收到您 ${formattedDate} ${timeRange} 的預約申請（${r.customer_name}）。\n確認該時段有空位，本筆訂單總金額為 $${r.total_price}，請於今日內匯款訂金 $${deposit}（總額一半）以保留座位。\n\n請依照官網或現場指示完成付款，並回傳證明，謝謝！\n\n📌 帶外食沒關係，離場時請將垃圾自行帶走；若未帶走，將酌收清潔費 300 元。`;
                          try {
                            if (navigator.clipboard?.writeText) {
                              await navigator.clipboard.writeText(text);
                            } else {
                              const textarea = document.createElement("textarea");
                              textarea.value = text;
                              document.body.appendChild(textarea);
                              textarea.select();
                              document.execCommand("copy");
                              document.body.removeChild(textarea);
                            }
                            alert("已複製通知內容");
                          } catch {
                            alert("複製失敗，請手動複製。");
                          }
                        }}
                        className="rounded-lg border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-100"
                      >
                        📋 複製繳費通知
                      </button>
                    )}
                  </div>
                ) : activeTab === "upcoming" ? (
                  <div className="flex flex-wrap items-center gap-2 pt-1">
                    {r.status !== "checked_in" && r.status !== "completed" && (
                      <button
                        type="button"
                        onClick={() => updateStatus(r.id, "checked_in")}
                        className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-xs font-semibold text-emerald-700 hover:bg-emerald-100"
                      >
                        ✅ 已報到
                      </button>
                    )}
                    {r.status !== "completed" && (
                      <button
                        type="button"
                        onClick={() => updateStatus(r.id, "completed")}
                        className="rounded-lg border border-blue-200 bg-blue-50 px-3 py-1.5 text-xs font-semibold text-blue-700 hover:bg-blue-100"
                      >
                        💵 已結帳
                      </button>
                    )}
                    {isDepositRequired(r.start_time.slice(0, 10)) && !r.is_deposit_paid && (
                      <button
                        type="button"
                        onClick={() => updateDepositStatus(r.id, true)}
                        className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-1.5 text-xs font-medium text-amber-800 hover:bg-amber-100"
                      >
                        ✅ 標記訂金
                      </button>
                    )}
                    {r.status !== "cancelled" && (
                      <button
                        type="button"
                        onClick={async () => {
                          const ok = window.confirm("確定要將此訂位標記為取消嗎？");
                          if (!ok) return;
                          await updateStatus(r.id, "cancelled");
                        }}
                        className="rounded-lg border border-red-200 bg-red-50 px-3 py-1.5 text-xs font-semibold text-red-700 hover:bg-red-100"
                      >
                        ❌ 取消
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => openEdit(r)}
                      className="rounded-lg border border-gray-300 p-2 text-gray-600 hover:bg-gray-100"
                      aria-label="編輯訂位"
                    >
                      <Pencil className="h-4 w-4" />
                    </button>
                    <button
                      type="button"
                      onClick={async () => {
                        const ok = window.confirm("確定要永久刪除此訂位嗎？此動作無法復原！");
                        if (!ok) return;
                        try {
                          await fetch(`${RESERVATIONS_API}/${r.id}`, { method: "DELETE" });
                          fetchReservations(false);
                        } catch {
                          // ignore
                        }
                      }}
                      className="rounded-lg bg-red-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-red-700"
                    >
                      🗑️ 刪除
                    </button>
                  </div>
                ) : (
                  <div className="flex flex-wrap items-center gap-2 pt-1">
                    <button
                      type="button"
                      onClick={() => openEdit(r)}
                      className="rounded-lg border border-gray-300 p-2 text-gray-600 hover:bg-gray-100"
                      aria-label="檢視/編輯訂位"
                    >
                      <Pencil className="h-4 w-4" />
                    </button>
                    <button
                      type="button"
                      onClick={async () => {
                        const ok = window.confirm("確定要永久刪除此訂位歷史嗎？此動作無法復原！");
                        if (!ok) return;
                        try {
                          await fetch(`${RESERVATIONS_API}/${r.id}`, { method: "DELETE" });
                          fetchReservations(false);
                        } catch {
                          // ignore
                        }
                      }}
                      className="rounded-lg bg-red-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-red-700"
                    >
                      🗑️ 刪除
                    </button>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      </div>

      {editing && (
        <div
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50 p-0 sm:p-4 overscroll-contain"
          role="dialog"
          aria-modal="true"
          aria-labelledby="edit-reservation-title"
        >
          <div className="flex w-full max-h-[90dvh] sm:max-h-[85vh] sm:max-w-md flex-col rounded-t-2xl sm:rounded-xl bg-white shadow-xl">
            <div className="flex shrink-0 items-center justify-between border-b border-gray-200 px-4 py-3">
              <h2 id="edit-reservation-title" className="text-lg font-semibold">
                編輯訂位
              </h2>
              <button
                type="button"
                onClick={closeEdit}
                className="-mr-2 min-h-[44px] min-w-[44px] flex items-center justify-center rounded-lg text-gray-400 hover:bg-gray-100 hover:text-gray-600"
                aria-label="關閉"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <form onSubmit={submitEdit} className="flex min-h-0 flex-1 flex-col">
              <div className="min-h-0 flex-1 overflow-y-auto p-4 space-y-4">
                {editError && (
                  <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{editError}</p>
                )}
                <div>
                  <label className="mb-1 block text-sm font-medium text-gray-700">姓名 *</label>
                  <input
                    type="text"
                    required
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 focus:border-amber-600 focus:outline-none focus:ring-1 focus:ring-amber-600"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium text-gray-700">電話 *</label>
                  <input
                    type="tel"
                    required
                    value={editPhone}
                    onChange={(e) => setEditPhone(e.target.value)}
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 focus:border-amber-600 focus:outline-none focus:ring-1 focus:ring-amber-600"
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="mb-1 block text-sm font-medium text-gray-700">日期 *</label>
                    <input
                      type="date"
                      required
                      value={editDate}
                      onChange={(e) => setEditDate(e.target.value)}
                      className="w-full rounded-lg border border-gray-300 px-3 py-2 focus:border-amber-600 focus:outline-none focus:ring-1 focus:ring-amber-600"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-sm font-medium text-gray-700">開始時間 *</label>
                    <input
                      type="time"
                      required
                      value={editTime}
                      onChange={(e) => setEditTime(e.target.value)}
                      className="w-full rounded-lg border border-gray-300 px-3 py-2 focus:border-amber-600 focus:outline-none focus:ring-1 focus:ring-amber-600"
                    />
                  </div>
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium text-gray-700">時數 *</label>
                  <select
                    value={editDuration}
                    onChange={(e) => setEditDuration(Number(e.target.value))}
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 focus:border-amber-600 focus:outline-none focus:ring-1 focus:ring-amber-600"
                  >
                    {Array.from({ length: 19 }, (_, i) => 1 + i * 0.5).map((h) => (
                      <option key={h} value={h}>{h} 小時</option>
                    ))}
                  </select>
                </div>
                {editing && (() => {
                  const room = rooms.find((ro) => ro.id === editing.room_id);
                  if (!room || !editDate) return null;
                  const pricePerHour = getPricePerHour(room, editDate);
                  const estimated = Math.round(pricePerHour * editDuration);
                  const kind = isWeekend(editDate) ? "假日" : "平日";
                  return (
                    <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">
                      預估總價：<strong>${estimated}</strong>（{kind} ${pricePerHour}/時 × {editDuration} 小時）
                    </p>
                  );
                })()}
                <div>
                  <label className="mb-1 block text-sm font-medium text-gray-700">總價</label>
                  <input
                    type="number"
                    min={0}
                    value={editTotalPrice === "" ? "" : editTotalPrice}
                    onChange={(e) =>
                      setEditTotalPrice(e.target.value === "" ? "" : Number(e.target.value))
                    }
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 focus:border-amber-600 focus:outline-none focus:ring-1 focus:ring-amber-600"
                    placeholder="可依上方預估填寫"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium text-gray-700">人數</label>
                  <input
                    type="number"
                    min={1}
                    value={editGuestCount === "" ? "" : editGuestCount}
                    onChange={(e) => setEditGuestCount(e.target.value === "" ? "" : Number(e.target.value))}
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 focus:border-amber-600 focus:outline-none focus:ring-1 focus:ring-amber-600"
                    placeholder="選填"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium text-gray-700">備註</label>
                  <textarea
                    rows={2}
                    value={editNotes}
                    onChange={(e) => setEditNotes(e.target.value)}
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 focus:border-amber-600 focus:outline-none focus:ring-1 focus:ring-amber-600"
                    placeholder="選填"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium text-gray-700">狀態</label>
                  <select
                    value={editStatus}
                    onChange={(e) => setEditStatus(e.target.value as ReservationStatus)}
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 focus:border-amber-600 focus:outline-none focus:ring-1 focus:ring-amber-600"
                  >
                    {STATUS_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value}>{opt.label}</option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="flex shrink-0 gap-2 border-t border-gray-200 bg-white px-4 py-3">
                <button
                  type="button"
                  onClick={closeEdit}
                  className="min-h-[44px] flex-1 rounded-lg border border-gray-300 bg-white px-4 py-2 text-gray-700 hover:bg-gray-50"
                >
                  取消
                </button>
                <button
                  type="submit"
                  disabled={editSubmitting}
                  className="min-h-[44px] flex-1 rounded-lg bg-amber-600 px-4 py-2 text-white hover:bg-amber-700 disabled:opacity-50"
                >
                  {editSubmitting ? "儲存中…" : "儲存"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
