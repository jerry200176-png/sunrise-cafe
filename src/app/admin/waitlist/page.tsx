"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { RefreshCw, Clock, Bell, Trash2, Phone } from "lucide-react";
import { format, parseISO } from "date-fns";
import { zhTW } from "date-fns/locale";
import { friendlyMessage } from "@/lib/friendly-error";
import { AdminShell } from "@/components/admin/AdminShell";
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
  staff_called_at?: string | null;
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
  const [markingId, setMarkingId] = useState<string | null>(null);
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
        setError(friendlyMessage(data.error, res.status));
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
        showToast(friendlyMessage(data.error, res.status), "error");
        return;
      }
      setItems((prev) => prev.filter((i) => i.id !== id));
      showToast("已移除等位紀錄", "success");
    } finally {
      setRemovingId(null);
      setConfirmRemoveId(null);
    }
  };

  const markCalled = async (id: string, staff_called = true) => {
    setMarkingId(id);
    try {
      const res = await fetch(`/api/admin/waitlist/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ staff_called }),
      });
      const data = await res.json();
      if (!res.ok) {
        showToast(friendlyMessage(data.error, res.status), "error");
        return;
      }
      setItems((prev) => {
        const next = prev.map((i) => {
          if (i.id !== id) return i;
          const staff_called_at = (data.staff_called_at as string | null) ?? null;
          const needs_call = i.status === "waiting" && !i.has_line && !staff_called_at;
          return { ...i, staff_called_at, needs_call };
        });
        setNeedsCallCount(next.filter((i) => i.needs_call).length);
        return next;
      });
      showToast(staff_called ? "已標記來電完成" : "已取消來電標記", "success");
    } finally {
      setMarkingId(null);
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
    <>
    <AdminShell
      title="等位清單"
      subtitle={loading ? "載入中…" : `${waitingCount} 位等候中`}
      actions={
        <button
          type="button"
          onClick={() => void load()}
          className="flex h-10 w-10 items-center justify-center rounded-xl text-stone-500 transition-[background-color] duration-200 hover:bg-stone-100"
          aria-label="重新整理"
        >
          <RefreshCw className="h-4 w-4" strokeWidth={1.5} />
        </button>
      }
    >
      <div className="space-y-4">
        {error && (
          <div className="rounded-2xl border border-red-200 bg-red-50 p-3 text-sm text-red-800" role="alert">{error}</div>
        )}

        {needsCallCount > 0 && (
          <div className="rounded-2xl border border-orange-200 bg-orange-50 p-3 text-sm text-orange-950">
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
              className={`min-h-[44px] rounded-full px-3 py-1 text-sm font-medium transition-[background-color,border-color,color] duration-200 ${
                filter === key
                  ? "bg-amber-600 text-white"
                  : "border border-stone-200 bg-white text-stone-700 hover:border-amber-300"
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        <section className="overflow-hidden rounded-2xl border border-stone-200 bg-white shadow-sm">
          {loading ? (
            <p className="p-4 text-sm text-stone-500">載入中…</p>
          ) : visible.length === 0 ? (
            <div className="p-8 text-center text-stone-500">
              <Clock className="mx-auto mb-2 h-10 w-10 text-stone-300" strokeWidth={1.5} />
              <p className="text-sm">
                {items.length === 0 ? "目前無等位紀錄" : "此篩選無等位紀錄"}
              </p>
              {items.length === 0 && (
                <p className="mt-1 text-xs text-stone-400">客人從訂位頁加入等位後會顯示於此</p>
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
                      {item.staff_called_at && !item.has_line && (
                        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-700 border border-slate-200">
                          已來電
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
                      {item.staff_called_at &&
                        ` · 來電於 ${format(parseISO(item.staff_called_at), "MM/dd HH:mm", { locale: zhTW })}`}
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
                    {!item.has_line && item.status === "waiting" && (
                      <button
                        type="button"
                        disabled={markingId === item.id}
                        onClick={() => void markCalled(item.id, !item.staff_called_at)}
                        className="inline-flex min-h-[44px] items-center gap-1 rounded-lg border border-orange-300 bg-white px-3 py-1.5 text-sm font-medium text-orange-900 hover:bg-orange-50 disabled:opacity-50"
                      >
                        {item.staff_called_at ? "取消來電標記" : "標記已來電"}
                      </button>
                    )}
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

        <p className="text-xs text-stone-500">
          等位成功率可在{" "}
          <Link href="/admin/executive" className="font-medium text-amber-800 hover:underline">
            經營總覽
          </Link>{" "}
          看到
        </p>
      </div>
    </AdminShell>
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
    </>
  );
}
