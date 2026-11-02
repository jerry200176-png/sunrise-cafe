"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { RefreshCw, Clock, Bell, Trash2, Phone } from "lucide-react";
import { format, parseISO } from "date-fns";
import { zhTW } from "date-fns/locale";
import { friendlyMessage, thrownMessage } from "@/lib/friendly-error";
import { fetchWithTimeout, readJsonWithTimeout } from "@/lib/fetch-with-timeout";
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
type PendingWrite = { id: string | null; action: "remove" | "call" | "uncall" | "unknown" };
const PENDING_WRITE_KEY = "sunrise.waitlist.pending-write.v1";

const STATUS_LABEL: Record<string, string> = {
  waiting: "等候中",
  notified: "已通知",
};

function telHref(phone: string): string {
  const digits = phone.replace(/[^\d+]/g, "");
  return digits ? `tel:${digits}` : `tel:${phone}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isWaitlistPayload(value: unknown): value is { items: WaitlistItem[]; needs_call_count: number } {
  if (!isRecord(value) || !Array.isArray(value.items) || !Number.isFinite(value.needs_call_count)) return false;
  return value.items.every((item) => isRecord(item)
    && typeof item.id === "string" && typeof item.customer_name === "string" && typeof item.phone === "string"
    && typeof item.start_time === "string" && typeof item.end_time === "string" && typeof item.status === "string"
    && typeof item.created_at === "string" && typeof item.room_name === "string" && typeof item.branch_name === "string"
    && (item.notified_at === null || typeof item.notified_at === "string")
    && (item.staff_called_at === undefined || item.staff_called_at === null || typeof item.staff_called_at === "string")
    && typeof item.has_line === "boolean" && typeof item.needs_call === "boolean");
}

async function boundedError(response: Response): Promise<string> {
  try {
    const body = await readJsonWithTimeout<{ error?: unknown; message?: unknown }>(response.clone());
    return friendlyMessage(body?.error ?? body?.message, response.status);
  } catch {
    return friendlyMessage(undefined, response.status);
  }
}

export default function AdminWaitlistPage() {
  const [items, setItems] = useState<WaitlistItem[]>([]);
  const [needsCallCount, setNeedsCallCount] = useState(0);
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const [filter, setFilter] = useState<StatusFilter>("all");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [markingId, setMarkingId] = useState<string | null>(null);
  const [confirmRemoveId, setConfirmRemoveId] = useState<string | null>(null);
  const [pendingWrite, setPendingWrite] = useState<PendingWrite | null>(null);
  const [storageUnavailable, setStorageUnavailable] = useState(false);
  const [guardReady, setGuardReady] = useState(false);
  const [reviewReady, setReviewReady] = useState(false);
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const toastId = useRef(0);
  const loadSequence = useRef(0);
  const writeInFlight = useRef(false);
  const pendingRef = useRef<PendingWrite | null>(null);
  const pendingStoredRef = useRef<string | null>(null);

  const showToast = useCallback((message: string, variant: ToastVariant = "info") => {
    const id = ++toastId.current;
    setToasts((prev) => [...prev, { id, message, variant }]);
  }, []);

  const dismissToast = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const load = useCallback(async (manualReview = false) => {
    if (writeInFlight.current) return;
    const sequence = ++loadSequence.current;
    if (pendingRef.current) setReviewReady(false);
    setLoading(true);
    setError(null);
    try {
      const res = await fetchWithTimeout("/api/admin/waitlist");
      if (!res.ok) throw new Error(await boundedError(res));
      const data = await readJsonWithTimeout<unknown>(res);
      if (sequence !== loadSequence.current || writeInFlight.current) return;
      if (!isWaitlistPayload(data)) throw new Error("等位清單資料格式錯誤，請重新整理");
      setItems(data.items ?? []);
      setNeedsCallCount(data.needs_call_count ?? 0);
      if (manualReview && pendingRef.current) setReviewReady(true);
      setUpdatedAt(
        new Date().toLocaleTimeString("zh-TW", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Taipei" })
      );
    } catch (cause) {
      if (sequence === loadSequence.current) setError(thrownMessage(cause, "等位清單載入失敗，請重新整理"));
    } finally {
      if (sequence === loadSequence.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    try {
      const raw = window.sessionStorage.getItem(PENDING_WRITE_KEY);
      if (raw !== null) {
        pendingStoredRef.current = raw;
        let pending: PendingWrite = { id: null, action: "unknown" };
        try {
          const value: unknown = JSON.parse(raw);
          if (isRecord(value) && typeof value.id === "string" && value.id.length > 0 && value.id.length <= 200
              && (value.action === "remove" || value.action === "call" || value.action === "uncall")) {
            pending = { id: value.id, action: value.action };
          }
        } catch { /* Unknown stored content stays locked until reviewed. */ }
        pendingRef.current = pending;
        setPendingWrite(pending);
      }
    } catch {
      setStorageUnavailable(true);
    }
    setGuardReady(true);
    load();
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void load();
    }, 60_000);
    return () => window.clearInterval(timer);
  }, [load]);

  const performWrite = async (id: string, action: "remove" | "call" | "uncall") => {
    if (!guardReady || storageUnavailable || pendingRef.current || writeInFlight.current || loading || error) return;
    writeInFlight.current = true;
    const pending: PendingWrite = { id, action };
    const serialized = JSON.stringify(pending);
    try {
      try {
        window.sessionStorage.setItem(PENDING_WRITE_KEY, serialized);
        if (window.sessionStorage.getItem(PENDING_WRITE_KEY) !== serialized) throw new Error("storage unavailable");
      } catch {
        setStorageUnavailable(true);
        showToast("無法保存待核對狀態，操作未送出。請檢查瀏覽器儲存設定。", "error");
        return;
      }
      pendingRef.current = pending;
      pendingStoredRef.current = serialized;
      setPendingWrite(pending);
      setReviewReady(false);
      loadSequence.current++;
      setLoading(false);
      if (action === "remove") setRemovingId(id); else setMarkingId(id);
      const res = await fetchWithTimeout(`/api/admin/waitlist/${id}`, action === "remove"
        ? { method: "DELETE" }
        : { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ staff_called: action === "call" }) });
      if (!res.ok) throw new Error("unknown outcome");
      const data = await readJsonWithTimeout<unknown>(res);
      if (!isRecord(data) || data.ok !== true) throw new Error("unknown outcome");
      if (action !== "remove" && (data.id !== id || (action === "call"
        ? typeof data.staff_called_at !== "string" || !data.staff_called_at
        : data.staff_called_at !== null))) throw new Error("unknown outcome");
      const previous = items.find((item) => item.id === id);
      if (action === "remove") {
        setItems((prev) => prev.filter((item) => item.id !== id));
        if (previous?.needs_call) setNeedsCallCount((count) => Math.max(0, count - 1));
      } else {
        const stamp = data.staff_called_at as string | null;
        const needsCall = previous?.status === "waiting" && !previous.has_line && !stamp;
        setItems((prev) => prev.map((item) => item.id === id ? { ...item, staff_called_at: stamp, needs_call: needsCall } : item));
        if (previous && Boolean(previous.needs_call) !== Boolean(needsCall)) {
          setNeedsCallCount((count) => Math.max(0, count + (needsCall ? 1 : -1)));
        }
      }
      try {
        if (window.sessionStorage.getItem(PENDING_WRITE_KEY) !== serialized) throw new Error("storage changed");
        window.sessionStorage.removeItem(PENDING_WRITE_KEY);
        if (window.sessionStorage.getItem(PENDING_WRITE_KEY) !== null) throw new Error("storage unavailable");
        pendingRef.current = null;
        pendingStoredRef.current = null;
        setPendingWrite(null);
        showToast(action === "remove" ? "已移除等位紀錄" : action === "call" ? "已標記來電完成" : "已取消來電標記", "success");
      } catch {
        setStorageUnavailable(true);
        showToast("結果已回覆，但無法清除待核對狀態，請檢查瀏覽器儲存設定。", "error");
      }
    } catch {
      showToast("操作結果尚未確認，請重新整理清單並核對。", "error");
    } finally {
      loadSequence.current++;
      writeInFlight.current = false;
      setRemovingId(null);
      setMarkingId(null);
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
  const writesBlocked = !guardReady || storageUnavailable || Boolean(pendingWrite) || loading || Boolean(error) || removingId !== null || markingId !== null;

  return (
    <>
    <AdminShell
      title="等位清單"
      subtitle={loading && !updatedAt
        ? "載入中…"
        : error && !updatedAt
          ? "無法確認等位人數"
          : `${waitingCount} 位等候中${updatedAt ? ` · 更新於 ${updatedAt}` : ""}`}
      actions={
        <button
          type="button"
          onClick={() => void load(Boolean(pendingRef.current))}
          disabled={removingId !== null || markingId !== null}
          className="flex h-10 w-10 items-center justify-center rounded-xl text-stone-500 transition-[background-color] duration-200 hover:bg-stone-100"
          aria-label="重新整理"
        >
          <RefreshCw className="h-4 w-4" strokeWidth={1.5} />
        </button>
      }
    >
      <div className="space-y-4">
        {storageUnavailable && (
          <div className="rounded-2xl border border-red-200 bg-red-50 p-3 text-sm text-red-800" role="alert">
            瀏覽器無法保存待核對狀態，等位操作已暫停。請檢查儲存設定並重新載入。
          </div>
        )}
        {pendingWrite && !removingId && !markingId && (
          <div className="rounded-2xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950" role="alert">
            <p>上次等位操作的結果尚未確認。請重新整理清單，核對原紀錄後再決定是否繼續。</p>
            <p className="mt-1">{pendingWrite.id && items.some((item) => item.id === pendingWrite.id)
              ? `請核對「${items.find((item) => item.id === pendingWrite.id)?.customer_name}」的紀錄。`
              : "原紀錄目前不在清單中；請依實際情況核對。"}</p>
            <p className="mt-1">原請求仍可能稍後完成；這項限制只適用目前分頁，其他分頁或裝置不受保護。</p>
            <button type="button" disabled={loading || storageUnavailable} onClick={() => void load(true)} className="mt-2 min-h-[44px] rounded-lg border border-amber-700 px-3 disabled:opacity-50">重新整理核對</button>
            {reviewReady && !storageUnavailable && <button type="button" className="ml-2 mt-2 min-h-[44px] rounded-lg border border-amber-700 px-3" onClick={() => {
              if (!window.confirm("原請求仍可能稍後完成。已核對紀錄並了解再次操作的風險嗎？")) return;
              try {
                if (window.sessionStorage.getItem(PENDING_WRITE_KEY) !== pendingStoredRef.current) throw new Error("storage changed");
                window.sessionStorage.removeItem(PENDING_WRITE_KEY);
                if (window.sessionStorage.getItem(PENDING_WRITE_KEY) !== null) throw new Error("storage unavailable");
                pendingStoredRef.current = null;
                pendingRef.current = null;
                setPendingWrite(null);
                setReviewReady(false);
              } catch {
                setStorageUnavailable(true);
                showToast("無法清除待核對狀態，請檢查瀏覽器儲存設定。", "error");
              }
            }}>已核對，解除本分頁限制</button>}
          </div>
        )}
        {error && (
          <div className="rounded-2xl border border-red-200 bg-red-50 p-3 text-sm text-red-800" role="alert">
            {error}{updatedAt ? "（畫面是上一次的資料）" : ""}
          </div>
        )}

        {needsCallCount > 0 && (
          <div className="rounded-2xl border border-orange-200 bg-orange-50 p-3 text-sm text-orange-950">
            <p className="font-semibold">有 {needsCallCount} 位等候中客人未綁定 LINE</p>
            <p className="mt-0.5 text-orange-800/90">系統無法自動推播，請來電通知空位。</p>
          </div>
        )}

        {updatedAt && (
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
        )}

        <section className="overflow-hidden rounded-2xl border border-stone-200 bg-white shadow-sm">
          {loading && items.length === 0 ? (
            <p className="p-4 text-sm text-stone-500">載入中…</p>
          ) : error && items.length === 0 ? (
            <p className="p-4 text-sm text-stone-500">無法載入等位紀錄。</p>
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
                        disabled={writesBlocked}
                        onClick={() => void performWrite(item.id, item.staff_called_at ? "uncall" : "call")}
                        className="inline-flex min-h-[44px] items-center gap-1 rounded-lg border border-orange-300 bg-white px-3 py-1.5 text-sm font-medium text-orange-900 hover:bg-orange-50 disabled:opacity-50"
                      >
                        {item.staff_called_at ? "取消來電標記" : "標記已來電"}
                      </button>
                    )}
                    <button
                      type="button"
                      disabled={writesBlocked}
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
        onConfirm={() => confirmRemoveId && void performWrite(confirmRemoveId, "remove")}
        onCancel={() => setConfirmRemoveId(null)}
      />
      <ToastStack toasts={toasts} onDismiss={dismissToast} />
    </>
  );
}
