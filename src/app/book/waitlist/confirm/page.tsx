"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { CheckCircle2, Clock, XCircle } from "lucide-react";

interface WaitlistDetail {
  status: "notified" | "waiting" | "booked" | "expired";
  customer_name: string;
  start_time: string;
  end_time: string;
  room_name: string;
  branch_name: string;
}

function formatRange(startIso: string, endIso: string) {
  const toTaipei = (s: string) =>
    new Date(new Date(s).toLocaleString("en-US", { timeZone: "Asia/Taipei" }));
  const start = toTaipei(startIso);
  const end = toTaipei(endIso);
  const dateLabel = start.toLocaleDateString("zh-TW", { month: "numeric", day: "numeric", weekday: "short" });
  const startLabel = start.toLocaleTimeString("zh-TW", { hour: "2-digit", minute: "2-digit", hour12: false });
  const endLabel = end.toLocaleTimeString("zh-TW", { hour: "2-digit", minute: "2-digit", hour12: false });
  return `${dateLabel} ${startLabel}–${endLabel}`;
}

function ConfirmContent() {
  const searchParams = useSearchParams();
  const token = searchParams.get("token") ?? "";

  const [loading, setLoading] = useState(true);
  const [detail, setDetail] = useState<WaitlistDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [bookingCode, setBookingCode] = useState<string | null>(null);

  useEffect(() => {
    if (!token) {
      setError("缺少確認連結參數");
      setLoading(false);
      return;
    }
    fetch(`/api/waitlist/confirm?token=${encodeURIComponent(token)}`)
      .then((r) => r.json())
      .then((d) => {
        if (d.error) {
          setError(d.error);
          return;
        }
        setDetail(d as WaitlistDetail);
      })
      .catch(() => setError("無法載入候補資訊"))
      .finally(() => setLoading(false));
  }, [token]);

  const handleConfirm = async () => {
    setConfirming(true);
    setError(null);
    try {
      const res = await fetch("/api/waitlist/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "確認失敗，請稍後再試");
        return;
      }
      setBookingCode(data.booking_code ?? null);
    } catch {
      setError("網路錯誤，請稍後再試");
    } finally {
      setConfirming(false);
    }
  };

  return (
    <main className="min-h-screen bg-gray-50">
      <div className="mx-auto max-w-lg px-4 py-12">
        <div className="rounded-2xl border border-amber-200 bg-white p-6 shadow-lg">
          {loading ? (
            <p className="text-center text-gray-500">載入中…</p>
          ) : bookingCode ? (
            <>
              <div className="flex justify-center text-green-600">
                <CheckCircle2 className="h-14 w-14" />
              </div>
              <h1 className="mt-4 text-center text-xl font-bold text-gray-900">候補確認成功！</h1>
              <p className="mt-2 text-center text-sm text-gray-500">已為您完成訂位申請，請保存訂位代號</p>
              <div className="mt-6 rounded-xl bg-amber-50 p-4 text-center">
                <p className="text-sm text-amber-800">訂位代號</p>
                <p className="mt-1 font-mono text-2xl font-bold tracking-wider text-amber-900">{bookingCode}</p>
              </div>
              <p className="mt-4 text-center text-xs text-gray-500">
                店家確認後將主動聯繫通知您繳納訂金，請勿提前匯款。
              </p>
              <Link
                href="/book/query"
                className="mt-5 block w-full rounded-lg bg-amber-600 py-3 text-center font-medium text-white hover:bg-amber-700"
              >
                查詢我的訂位
              </Link>
            </>
          ) : error ? (
            <>
              <div className="flex justify-center text-rose-500">
                <XCircle className="h-14 w-14" />
              </div>
              <h1 className="mt-4 text-center text-xl font-bold text-gray-900">無法確認候補</h1>
              <p className="mt-2 text-center text-sm text-gray-600">{error}</p>
              <Link
                href="/book/waitlist"
                className="mt-5 block w-full rounded-lg bg-amber-600 py-3 text-center font-medium text-white hover:bg-amber-700"
              >
                重新加入候補
              </Link>
            </>
          ) : detail && detail.status === "notified" ? (
            <>
              <div className="flex justify-center text-amber-500">
                <Clock className="h-14 w-14" />
              </div>
              <h1 className="mt-4 text-center text-xl font-bold text-gray-900">確認您的候補訂位</h1>
              <div className="mt-5 space-y-1 rounded-xl bg-amber-50 p-4 text-sm text-amber-900">
                <p>👤 {detail.customer_name}</p>
                <p>🏠 {detail.branch_name} — {detail.room_name}</p>
                <p>📅 {formatRange(detail.start_time, detail.end_time)}</p>
              </div>
              <p className="mt-4 text-center text-xs text-gray-500">
                此時段目前保留給您，確認後將直接送出訂位申請，店家確認後會通知您繳納訂金。
              </p>
              <button
                onClick={handleConfirm}
                disabled={confirming}
                className="mt-5 w-full rounded-lg bg-amber-600 py-3 text-center font-medium text-white hover:bg-amber-700 disabled:opacity-50"
              >
                {confirming ? "確認中…" : "立即確認訂位"}
              </button>
            </>
          ) : detail && detail.status === "booked" ? (
            <>
              <div className="flex justify-center text-green-600">
                <CheckCircle2 className="h-14 w-14" />
              </div>
              <h1 className="mt-4 text-center text-xl font-bold text-gray-900">此候補已完成訂位</h1>
              <p className="mt-2 text-center text-sm text-gray-600">您已確認過此候補，無需再次操作。</p>
              <Link
                href="/book/query"
                className="mt-5 block w-full rounded-lg bg-amber-600 py-3 text-center font-medium text-white hover:bg-amber-700"
              >
                查詢我的訂位
              </Link>
            </>
          ) : detail ? (
            <>
              <div className="flex justify-center text-rose-500">
                <XCircle className="h-14 w-14" />
              </div>
              <h1 className="mt-4 text-center text-xl font-bold text-gray-900">候補連結已失效</h1>
              <p className="mt-2 text-center text-sm text-gray-600">
                此候補連結已逾時或已被其他候補取代，請重新加入候補清單。
              </p>
              <Link
                href="/book/waitlist"
                className="mt-5 block w-full rounded-lg bg-amber-600 py-3 text-center font-medium text-white hover:bg-amber-700"
              >
                重新加入候補
              </Link>
            </>
          ) : null}
        </div>
      </div>
    </main>
  );
}

export default function WaitlistConfirmPage() {
  return (
    <Suspense fallback={
      <main className="min-h-screen bg-gray-50 flex items-center justify-center">
        <p className="text-gray-500">載入中...</p>
      </main>
    }>
      <ConfirmContent />
    </Suspense>
  );
}
