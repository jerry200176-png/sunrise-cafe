"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowLeft, Calendar, Clock } from "lucide-react";
import { format, parseISO } from "date-fns";
import { zhTW } from "date-fns/locale";

interface BookingItem {
  id: string;
  booking_code: string;
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
}

const STATUS_LABELS: Record<string, string> = {
  pending: "待確認",
  confirmed: "已預約",
  checked_in: "已報到",
  cancelled: "已取消",
  completed: "已結帳",
};

const LINE_PAY_URL =
  "https://qrcodepay.line.me/qr/payment/%252BmF6rR41PSp3R8NMydLA%252BRt1IvAFgPchBvtrJoR20aoZKY4Hr1qrbfaYSoPDUyu0";

export default function BookQueryPage() {
  const [phone, setPhone] = useState("");
  const [list, setList] = useState<BookingItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cancellingId, setCancellingId] = useState<string | null>(null);

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
        setError((data as { error?: string })?.error ?? "查詢失敗");
        return;
      }
      setList(Array.isArray(data) ? data : []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "連線失敗");
    } finally {
      setLoading(false);
    }
  };

  const cancel = async (id: string) => {
    if (!confirm("確定要取消此訂位嗎？")) return;
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
        setError((data as { error?: string })?.error ?? "取消失敗");
        return;
      }
      setList((prev) => prev.filter((r) => r.id !== id));
    } catch (e) {
      setError(e instanceof Error ? e.message : "連線失敗");
    } finally {
      setCancellingId(null);
    }
  };

  const canCancel = (item: BookingItem) => {
    if (item.status === "cancelled") return false;
    const start = new Date(item.start_time).getTime();
    const now = Date.now();
    return start - now >= 24 * 60 * 60 * 1000;
  };

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
          <h1 className="text-lg font-semibold text-gray-900">查詢我的訂位</h1>
        </div>
      </header>

      <div className="mx-auto max-w-lg px-4 py-6">
        <form onSubmit={search} className="mb-6 flex gap-2">
          <input
            type="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="輸入訂位電話"
            className="flex-1 rounded-lg border border-gray-300 px-4 py-2.5"
            required
          />
          <button
            type="submit"
            disabled={loading}
            className="rounded-lg bg-amber-600 px-4 py-2.5 text-white disabled:opacity-50"
          >
            {loading ? "查詢中…" : "查詢"}
          </button>
        </form>

        {error && (
          <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
            {error}
          </div>
        )}

        {list.length === 0 && !loading && phone && (
          <p className="text-center text-gray-500">找不到訂位紀錄</p>
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
                      訂位代號：<span className="font-mono">{item.booking_code}</span>
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
                    <p className="font-semibold text-yellow-800">⏳ 待審核</p>
                    <p className="mt-1 text-yellow-700">
                      您的預約正在審核中，確認後將提供繳費資訊，請留意通知。
                    </p>
                  </div>
                )}

                {/* 訂金繳費資訊 — 管理員確認後才顯示 */}
                {item.deposit_required && isConfirmed && item.status !== "cancelled" && (
                  <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm">
                    <p className="font-semibold text-gray-800">💰 訂金資訊</p>
                    <div className="mt-1.5 space-y-1 text-gray-700">
                      {item.deposit_amount != null && (
                        <p>
                          訂金金額：
                          <span className="font-semibold">NT$ {item.deposit_amount}</span>
                          <span className="text-xs text-gray-500 ml-1">（總價的 50%）</span>
                        </p>
                      )}
                      <p className="text-xs text-gray-500">
                        此預訂日期為週末／國定假日，需繳納訂金以完成確認
                      </p>
                    </div>

                    {/* 匯款帳戶 + LINE Pay */}
                    <div className="mt-3 rounded-md border border-gray-200 bg-white p-2.5 text-xs text-gray-700">
                      <p className="font-semibold text-gray-800 mb-1">繳費帳戶</p>
                      <p>銀行：台北富邦銀行 (012)</p>
                      <p>帳號：8212-0000-8489-6</p>
                      <p>戶名：昇昇咖啡張文霞</p>
                      <div className="mt-2 pt-2 border-t border-gray-100">
                        <a
                          href={LINE_PAY_URL}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 rounded-md bg-green-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-green-700"
                        >
                          使用 LINE Pay 付款 →
                        </a>
                      </div>
                    </div>
                  </div>
                )}

                {/* 注意事項提醒 — 所有已確認的訂位都顯示 */}
                {isConfirmed && (
                  <div className="mt-2 rounded-lg border border-gray-200 bg-gray-50 p-2.5 text-xs text-gray-500">
                    📌 帶外食沒關係，離場時請將垃圾自行帶走；若未帶走，將酌收清潔費 300 元。
                  </div>
                )}

                {canCancel(item) && (
                  <button
                    type="button"
                    disabled={cancellingId === item.id}
                    onClick={() => cancel(item.id)}
                    className="mt-3 w-full rounded-lg border border-red-200 py-2 text-sm text-red-700 hover:bg-red-50 disabled:opacity-50"
                  >
                    {cancellingId === item.id ? "取消中…" : "取消訂位"}
                  </button>
                )}
                {item.status !== "cancelled" && !canCancel(item) && (
                  <p className="mt-2 text-xs text-gray-500">
                    預約時間 24 小時內不可自行取消，如需變更請來電店家
                  </p>
                )}
              </li>
            );
          })}
        </ul>
      </div>
    </main>
  );
}
