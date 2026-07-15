"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ArrowLeft, RefreshCw, LogOut, Clock, Bell, Trash2, Phone } from "lucide-react";
import { format, parseISO } from "date-fns";
import { zhTW } from "date-fns/locale";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { ToastStack, type ToastItem, type ToastVariant } from "@/components/Toast";

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
  has_line?: boolean;
  needs_call?: boolean;
};

type StatusFilter = "all" | "waiting" | "notified" | "needs_call";

const STATUS_LABEL: Record<string, string> = {
  waiting: "等候中",
  notified: "已通知",
};

function telHref(phone: string): string {
  const digits = phone.replace(/[^\d+]/g, "");
  return digits ? `tel:${digits}` : `tel:${phone}`;
}

export default function AdminWaitlistPage() {
  const [items, setItems] = useState<WaitlistItem[]>([]);
  const [needsCallCount, setNeedsCallCount] = useState(0);
  const [filter, setFilter] = useState<StatusFilter>("all");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [confirmRemoveId, setConfirmRemoveId] = useState<string | null>(null);
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const toastId = useRef(0);

  const showToast = useCallback((message: string, variant: ToastVariant = "info") => {
    const id = ++toastId.current;
    setToasts((prev) => [...prev, { id, message, variant }]);
  }, []);

  const dismissToast = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/waitlist");
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "無法載入等位清單");
        setItems([]);
        setNeedsCallCount(0);
        return;
      }
      setItems(data.items ?? []);
      setNeedsCallCount(data.needs_call_count ?? 0);
    } catch {
      setError("載入失敗");
      setItems([]);
      setNeedsCallCount(0);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const remove = async (id: string) => {
    setRemovingId(id);
    try {
      const res = await fetch(`/api/admin/waitlist/${id}`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok) {
        showToast(data.error ?? "移除失敗", "error");
        return;
      }
      setItems((prev) => prev.filter((i) => i.id !== id));
      showToast("已移除等位紀錄", "success");
    } finally {
      setRemovingId(null);
      setConfirmRemoveId(null);
    }
  };

  const waitingCount = items.filter((i) => i.status === "waiting").length;
  const notifiedCount = items.filter((i) => i.status === "notified").length;
  const visible =
    filter === "all"
      ? items
      : filter === "needs_call"
        ? items.filter((i) => i.needs_call)
        : items.filter((i) => i.status === filter);

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

        {needsCallCount > 0 && (
          <div className="rounded-lg border border-orange-200 bg-orange-50 p-3 text-sm text-orange-950">
            <p className="font-semibold">有 {needsCallCount} 位等候中客人未綁定 LINE</p>
            <p className="mt-0.5 text-orange-800/90">系統無法自動推播，請來電通知空位。</p>
          </div>
        )}

        <div className="flex flex-wrap gap-2">
          {(
            [
              { key: "all" as const, label: `全部 (${items.length})` },
              { key: "waiting" as const, label: `等候中 (${waitingCount})` },
              { key: "needs_call" as const, label: `需電聯 (${needsCallCount})` },
              { key: "notified" as const, label: `已通知 (${notifiedCount})` },
            ] as const
          ).map(({ key, label }) => (
            <button
              key={key}
              type="button"
              onClick={() => setFilter(key)}
              className={`min-h-[44px] rounded-full px-3 py-1 text-sm font-medium transition-colors ${
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
                <li
                  key={item.id}
                  className={`p-4 flex flex-wrap justify-between gap-3 ${
                    item.needs_call ? "bg-orange-50/60" : ""
                  }`}
                >
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
                      {item.needs_call && (
                        <span className="rounded-full bg-orange-100 px-2 py-0.5 text-xs font-semibold text-orange-900 border border-orange-200">
                          需電話通知
                        </span>
                      )}
                      {item.has_line && item.status === "waiting" && (
                        <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-800 border border-emerald-100">
                          可 LINE 推播
                        </span>
                      )}
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
                  <div className="flex flex-wrap items-start gap-2">
                    <a
                      href={telHref(item.phone)}
                      className={`inline-flex min-h-[44px] items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-semibold ${
                        item.needs_call
                          ? "bg-orange-600 text-white hover:bg-orange-700"
                          : "border border-gray-300 text-gray-700 hover:bg-gray-50"
                      }`}
                    >
                      <Phone className="w-4 h-4" /> 撥打
                    </a>
                    <button
                      type="button"
                      disabled={removingId === item.id}
                      onClick={() => setConfirmRemoveId(item.id)}
                      className="inline-flex min-h-[44px] items-center gap-1 rounded border border-gray-300 text-gray-600 px-3 py-1.5 text-sm hover:bg-gray-50 disabled:opacity-50"
                    >
                      <Trash2 className="w-4 h-4" /> 移除
                    </button>
                  </div>
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
      <ConfirmDialog
        open={confirmRemoveId !== null}
        title="移除等位紀錄"
        message="確定移除此等位紀錄？客人將不再收到此時段的通知。"
        confirmLabel="移除"
        variant="danger"
        onConfirm={() => confirmRemoveId && void remove(confirmRemoveId)}
        onCancel={() => setConfirmRemoveId(null)}
      />
      <ToastStack toasts={toasts} onDismiss={dismissToast} />
    </div>
  );
}
