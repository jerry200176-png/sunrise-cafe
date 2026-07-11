"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, RefreshCw, LogOut, Clock, Bell, Trash2 } from "lucide-react";
import { format, parseISO } from "date-fns";
import { zhTW } from "date-fns/locale";

type WaitlistItem = {
  id: string;
  customer_name: string;
  phone: string;
  start_time: string;
  end_time: string;
  status: "waiting" | "notified" | string;
  created_at: string;
  notified_at: string | null;
  room_name: string;
  branch_name: string;
};

type StatusFilter = "all" | "waiting" | "notified";

const STATUS_LABEL: Record<string, string> = {
  waiting: "等候中",
  notified: "已通知",
};

export default function AdminWaitlistPage() {
  const [items, setItems] = useState<WaitlistItem[]>([]);
  const [filter, setFilter] = useState<StatusFilter>("all");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [removingId, setRemovingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/waitlist");
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "無法載入等位清單");
        setItems([]);
        return;
      }
      setItems(data.items ?? []);
    } catch {
      setError("載入失敗");
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const remove = async (id: string) => {
    if (!confirm("確定移除此等位紀錄？客人將不再收到此時段的通知。")) return;
    setRemovingId(id);
    try {
      const res = await fetch(`/api/admin/waitlist/${id}`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok) {
        alert(data.error ?? "移除失敗");
        return;
      }
      setItems((prev) => prev.filter((i) => i.id !== id));
    } finally {
      setRemovingId(null);
    }
  };

  const waitingCount = items.filter((i) => i.status === "waiting").length;
  const notifiedCount = items.filter((i) => i.status === "notified").length;
  const visible =
    filter === "all" ? items : items.filter((i) => i.status === filter);

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link href="/admin" className="text-gray-600 hover:text-gray-900">
            <ArrowLeft className="w-5 h-5" />
          </Link>
          <h1 className="text-lg font-bold text-gray-900">等位清單</h1>
        </div>
        <div className="flex items-center gap-2">
          <button type="button" onClick={load} className="p-2 text-gray-600 hover:bg-gray-100 rounded">
            <RefreshCw className="w-4 h-4" />
          </button>
          <Link href="/api/admin/logout" className="p-2 text-gray-600 hover:bg-gray-100 rounded">
            <LogOut className="w-4 h-4" />
          </Link>
        </div>
      </header>

      <main className="max-w-4xl mx-auto p-4 space-y-4">
        {error && (
          <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-red-800 text-sm">{error}</div>
        )}

        <div className="flex flex-wrap gap-2">
          {(
            [
              { key: "all" as const, label: `全部 (${items.length})` },
              { key: "waiting" as const, label: `等候中 (${waitingCount})` },
              { key: "notified" as const, label: `已通知 (${notifiedCount})` },
            ] as const
          ).map(({ key, label }) => (
            <button
              key={key}
              type="button"
              onClick={() => setFilter(key)}
              className={`rounded-full px-3 py-1 text-sm font-medium transition-colors ${
                filter === key
                  ? "bg-amber-600 text-white"
                  : "bg-white border border-gray-200 text-gray-700 hover:border-amber-300"
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        <section className="bg-white rounded-lg border">
          {loading ? (
            <p className="p-4 text-gray-500 text-sm">載入中…</p>
          ) : visible.length === 0 ? (
            <div className="p-8 text-center text-gray-500">
              <Clock className="w-10 h-10 mx-auto mb-2 text-gray-300" />
              <p className="text-sm">
                {items.length === 0 ? "目前無等位紀錄" : "此篩選無等位紀錄"}
              </p>
              {items.length === 0 && (
                <p className="text-xs mt-1 text-gray-400">客人從訂位頁加入等位後會顯示於此</p>
              )}
            </div>
          ) : (
            <ul className="divide-y">
              {visible.map((item) => (
                <li key={item.id} className="p-4 flex flex-wrap justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2 mb-1">
                      <p className="font-bold text-gray-900">{item.customer_name}</p>
                      <span
                        className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                          item.status === "notified"
                            ? "bg-blue-100 text-blue-800"
                            : "bg-amber-100 text-amber-800"
                        }`}
                      >
                        {item.status === "notified" ? (
                          <span className="inline-flex items-center gap-1">
                            <Bell className="w-3 h-3" /> {STATUS_LABEL.notified}
                          </span>
                        ) : (
                          STATUS_LABEL.waiting ?? item.status
                        )}
                      </span>
                    </div>
                    <p className="text-sm text-gray-600">{item.phone}</p>
                    <p className="text-sm text-gray-800 mt-1">
                      {item.branch_name} · {item.room_name}
                    </p>
                    <p className="text-sm text-gray-600">
                      {format(parseISO(item.start_time), "yyyy/MM/dd (EEE) HH:mm", { locale: zhTW })}
                      {" – "}
                      {format(parseISO(item.end_time), "HH:mm", { locale: zhTW })}
                    </p>
                    <p className="text-xs text-gray-400 mt-1">
                      加入於 {format(parseISO(item.created_at), "MM/dd HH:mm", { locale: zhTW })}
                      {item.notified_at &&
                        ` · 通知於 ${format(parseISO(item.notified_at), "MM/dd HH:mm", { locale: zhTW })}`}
                    </p>
                  </div>
                  <button
                    type="button"
                    disabled={removingId === item.id}
                    onClick={() => remove(item.id)}
                    className="inline-flex items-center gap-1 self-start rounded border border-gray-300 text-gray-600 px-3 py-1.5 text-sm hover:bg-gray-50 disabled:opacity-50"
                  >
                    <Trash2 className="w-4 h-4" /> 移除
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        <p className="text-xs text-gray-500">
          轉換率可於{" "}
          <Link href="/admin/executive" className="text-amber-700 hover:underline">
            Executive
          </Link>{" "}
          查看 <code className="bg-gray-100 px-1 rounded">waitlist_conversion_pct</code>
        </p>
      </main>
    </div>
  );
}
