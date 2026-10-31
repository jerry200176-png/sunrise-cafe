"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Check, X, RefreshCw, Upload, AlertTriangle, Keyboard } from "lucide-react";
import { format, parseISO } from "date-fns";
import { zhTW } from "date-fns/locale";
import { parseLineImageMessageId } from "@/lib/payment-event-payload";
import type { AdminPaymentInteraction } from "@/lib/ops-log";
import { friendlyMessage, responseError, thrownMessage } from "@/lib/friendly-error";
import { fetchWithTimeout, readJsonWithTimeout } from "@/lib/fetch-with-timeout";
import { paymentSourceLabel, reservationStatusLabel } from "@/lib/status-labels";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { isInteractiveTarget } from "@/lib/payment-shortcuts";
import { AdminShell } from "@/components/admin/AdminShell";
import { ToastStack, type ToastItem, type ToastVariant } from "@/components/Toast";

type PendingItem = {
  id: string;
  reservation_id: string;
  booking_code: string;
  customer_name: string;
  phone: string;
  start_time: string;
  deposit_amount: number | null;
  reservation_status?: string;
  created_at: string;
  raw_payload: string | null;
  source: string;
  is_deposit_paid: boolean;
  reported_account_last_five: string | null;
  reported_amount: number | null;
  reported_at: string | null;
};

type RiskItem = {
  booking_code: string;
  customer_name: string;
  phone: string;
  status: string;
  deadline: string;
  deadline_passed?: boolean;
  would_auto_release: boolean;
};

type ReconcileResult = {
  bank_rows: number;
  matches: { booking_code: string; customer_name: string; confidence: string; bank_amount: number }[];
  unmatched: { amount: number; reason: string }[];
};

export default function AdminPaymentsPage() {
  const [items, setItems] = useState<PendingItem[]>([]);
  const [risk, setRisk] = useState<RiskItem[]>([]);
  const [migrationOk, setMigrationOk] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [rejectId, setRejectId] = useState<string | null>(null);
  const [rejectNote, setRejectNote] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [reconcileResult, setReconcileResult] = useState<ReconcileResult | null>(null);
  const [confirmApproveId, setConfirmApproveId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  // 同步鎖：state 更新有延遲，連按時第二次請求會搶在 re-render 前送出
  const inFlight = useRef(false);
  const loadSequence = useRef(0);
  const confirmVia = useRef<AdminPaymentInteraction>("click");
  const rejectInputRef = useRef<HTMLInputElement>(null);
  const itemRefs = useRef<(HTMLLIElement | null)[]>([]);
  const itemsRef = useRef<PendingItem[]>([]);
  itemsRef.current = items;
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
    if (inFlight.current) return;
    const sequence = ++loadSequence.current;
    setLoading(true);
    setError(null);
    setItems([]);
    setRisk([]);
    setMigrationOk(null);
    try {
      const [statusRes, pendingRes, riskRes] = await Promise.all([
        fetchWithTimeout("/api/admin/payments/migration-status"),
        fetchWithTimeout("/api/admin/payments/pending"),
        fetchWithTimeout("/api/admin/payments/reconcile"),
      ]);
      if (sequence !== loadSequence.current) return;
      if (!statusRes.ok) {
        throw new Error(await responseError(statusRes));
      }
      const status = await readJsonWithTimeout<{ payment_events_ready?: boolean; error?: string }>(statusRes);
      if (sequence !== loadSequence.current) return;
      setMigrationOk(Boolean(status.payment_events_ready));

      if (!status.payment_events_ready) {
        setItems([]);
        setError("付款審核功能尚未開通，請聯絡工程人員");
      } else if (pendingRes.ok) {
        const pending = await readJsonWithTimeout<PendingItem[]>(pendingRes);
        if (sequence !== loadSequence.current) return;
        setItems(pending);
      } else {
        setItems([]);
        setError(await responseError(pendingRes));
      }

      if (riskRes.ok) {
        const r = await readJsonWithTimeout<{ items?: RiskItem[] }>(riskRes);
        if (sequence !== loadSequence.current) return;
        setRisk(r.items ?? []);
      } else if (sequence === loadSequence.current) {
        const riskError = await responseError(riskRes);
        if (sequence === loadSequence.current) {
          setError((current) => current ? `${current}；風險資料：${riskError}` : `風險資料無法更新：${riskError}`);
        }
      }
    } catch (cause) {
      if (sequence === loadSequence.current) {
        setError(thrownMessage(cause, "付款資料載入失敗，請重新整理"));
      }
    } finally {
      if (sequence === loadSequence.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (items.length === 0) {
      setSelectedIndex(0);
      return;
    }
    setSelectedIndex((i) => Math.min(i, items.length - 1));
  }, [items.length]);

  useEffect(() => {
    const el = itemRefs.current[selectedIndex];
    el?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [selectedIndex, items.length]);

  useEffect(() => {
    if (rejectId) rejectInputRef.current?.focus();
  }, [rejectId]);

  const approve = useCallback(async (id: string, interaction: AdminPaymentInteraction = "click") => {
    if (inFlight.current) return;
    inFlight.current = true;
    loadSequence.current++;
    setLoading(false);
    setBusyId(id);
    try {
      const res = await fetch(`/api/admin/payments/${id}/approve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ interaction }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        showToast(friendlyMessage(d.error, res.status), "error");
        return;
      }
      const data = (await res.json().catch(() => ({}))) as {
        notification?: { status?: string; error?: string } | null;
      };
      if (data.notification && data.notification.status !== "accepted_by_platform") {
        showToast("款項已確認，但沒能通知客人，請手動傳 LINE", "error");
      } else {
        showToast("已確認收款", "success");
      }
      const approved = itemsRef.current.find((i) => i.id === id);
      setItems((prev) => prev.filter((i) => i.id !== id));
      if (approved) setRisk((prev) => prev.filter((r) => r.booking_code !== approved.booking_code));
    } catch {
      showToast("連不上系統，請確認網路後再試", "error");
    } finally {
      inFlight.current = false;
      setBusyId(null);
    }
  }, [showToast]);

  const reject = useCallback(async (id: string, interaction: AdminPaymentInteraction = "click") => {
    if (!rejectNote.trim()) {
      showToast("請填寫駁回原因", "error");
      return;
    }
    if (inFlight.current) return;
    inFlight.current = true;
    loadSequence.current++;
    setLoading(false);
    setBusyId(id);
    try {
      const res = await fetch(`/api/admin/payments/${id}/reject`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ review_note: rejectNote, interaction }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        showToast(friendlyMessage(d.error, res.status), "error");
        return;
      }
      showToast("已駁回", "success");
      setRejectId(null);
      setRejectNote("");
      setItems((prev) => prev.filter((i) => i.id !== id));
      const rejected = itemsRef.current.find((i) => i.id === id);
      if (rejected) setRisk((prev) => prev.filter((r) => r.booking_code !== rejected.booking_code));
    } catch {
      showToast("連不上系統，請確認網路後再試", "error");
    } finally {
      inFlight.current = false;
      setBusyId(null);
    }
  }, [rejectNote, showToast]);

  const openReject = useCallback((id: string) => {
    setRejectId(id);
    setRejectNote("");
  }, []);

  const closeReject = useCallback(() => {
    setRejectId(null);
    setRejectNote("");
  }, []);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (items.length === 0) return;
      if (confirmApproveId) return; // 確認視窗開著時，快速鍵全部停用
      const target = e.target as HTMLElement;
      const inRejectInput = target.tagName === "INPUT" || target.tagName === "TEXTAREA";

      if (e.key === "Escape") {
        if (rejectId) {
          e.preventDefault();
          closeReject();
        }
        return;
      }

      if (inRejectInput) {
        if (e.key === "Enter" && rejectId && rejectNote.trim()) {
          e.preventDefault();
          void reject(rejectId, "keyboard");
        }
        return;
      }

      if (e.key === "j" || e.key === "ArrowDown") {
        e.preventDefault();
        setSelectedIndex((i) => Math.min(i + 1, items.length - 1));
        return;
      }
      if (e.key === "k" || e.key === "ArrowUp") {
        e.preventDefault();
        setSelectedIndex((i) => Math.max(i - 1, 0));
        return;
      }

      const selected = items[selectedIndex];
      if (!selected) return;

      if ((e.key === "a" || e.key === "Enter") && !rejectId) {
        // 焦點在按鈕／連結上時，Enter 屬於那個按鈕（例如「駁回」），不能當成核准
        if (isInteractiveTarget(e.target)) return;
        e.preventDefault();
        confirmVia.current = "keyboard";
        setConfirmApproveId(selected.id);
        return;
      }
      if (e.key === "r" && !rejectId) {
        e.preventDefault();
        openReject(selected.id);
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [items, selectedIndex, rejectId, rejectNote, confirmApproveId, reject, openReject, closeReject]);

  const uploadCsv = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const form = new FormData();
    form.append("file", file);
    const res = await fetch("/api/admin/payments/reconcile", { method: "POST", body: form });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      showToast(friendlyMessage(data.error, res.status), "error");
      return;
    }
    setReconcileResult(data);
    e.target.value = "";
  };

  return (
    <>
    <AdminShell
      title="付款審核"
      subtitle={migrationOk === false ? "功能尚未開通" : `待審核 ${items.length} 筆`}
      actions={
        <button
          type="button"
          onClick={() => void load()}
          disabled={loading || busyId !== null}
          className="flex h-10 w-10 items-center justify-center rounded-xl text-stone-500 transition-[background-color] duration-200 hover:bg-stone-100"
          aria-label="重新整理"
        >
          <RefreshCw className="h-4 w-4" strokeWidth={1.5} />
        </button>
      }
    >
      <div className="space-y-6">
        {migrationOk === false && (
          <div className="rounded-2xl border border-amber-300 bg-amber-50 p-4 text-amber-900">
            <p className="font-semibold flex items-center gap-2">
              <AlertTriangle className="w-4 h-4" strokeWidth={1.5} /> 付款審核功能尚未開通
            </p>
            <p className="text-sm mt-2">
              系統還沒準備好付款審核，請聯絡工程人員處理。
            </p>
          </div>
        )}

        {error && (
          <div className="rounded-2xl border border-red-200 bg-red-50 p-3 text-red-800 text-sm" role="alert">{error}</div>
        )}

        <section className="rounded-2xl border border-stone-200 bg-white p-4 shadow-sm">
          <h2 className="font-semibold text-stone-900 mb-3">待審核付款 ({items.length})</h2>
          {loading ? (
            <p className="text-stone-500 text-sm">載入中…</p>
          ) : items.length === 0 ? (
            <p className="text-stone-500 text-sm">目前無待審核項目</p>
          ) : (
            <ul className="space-y-3">
              {items.map((item, index) => (
                <li
                  key={item.id}
                  ref={(el) => {
                    itemRefs.current[index] = el;
                  }}
                  className={`rounded-xl border p-3 transition-[box-shadow,border-color,background-color] duration-200 ${
                    index === selectedIndex
                      ? "border-amber-300 bg-amber-50/50 ring-2 ring-amber-500/70"
                      : "border-stone-200"
                  }`}
                  onClick={() => setSelectedIndex(index)}
                >
                  <div className="flex flex-wrap justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2 mb-1">
                        <p className="font-semibold text-stone-900">{item.customer_name}</p>
                        <span className={`rounded-full px-2 py-0.5 text-xs ${item.source === "bank_transfer" ? "bg-amber-100 text-amber-900" : "bg-stone-100 text-stone-600"}`}>
                          {paymentSourceLabel(item.source)}
                        </span>
                      </div>
                      <p className="text-sm text-stone-600">
                        代號 {item.booking_code} · {item.phone}
                      </p>
                      <p className="text-sm text-stone-600">
                        {format(parseISO(item.start_time), "yyyy/MM/dd HH:mm", { locale: zhTW })}
                        {item.deposit_amount != null && ` · 訂金 NT$${item.deposit_amount}`}
                      </p>
                      <p className="text-xs text-stone-500 mt-1">
                        訂位狀態：{item.reservation_status ? reservationStatusLabel(item.reservation_status) : "—"} · 訂金狀態：{item.is_deposit_paid ? "已確認" : "待核對"}
                      </p>
                      <p className="text-xs text-stone-400 mt-1">
                        提交於 {format(parseISO(item.created_at), "MM/dd HH:mm", { locale: zhTW })}
                      </p>
                      {item.source === "bank_transfer" && (
                        <div className="mt-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-950">
                          <p>應收訂金：<strong>NT${item.deposit_amount ?? "—"}</strong> · 客人回報：<strong>NT${item.reported_amount ?? "—"}</strong></p>
                          <p className="mt-1">帳號後五碼：<strong>{item.reported_account_last_five ?? "—"}</strong>{item.reported_at ? ` · 回報於 ${format(parseISO(item.reported_at), "MM/dd HH:mm", { locale: zhTW })}` : ""}</p>
                          <p className="mt-1 text-xs text-amber-800">請以銀行入帳紀錄核對後，再確認已收到款項。</p>
                        </div>
                      )}
                      {item.source === "line_image" ? (
                        parseLineImageMessageId(item.raw_payload) ? (
                          <div className="mt-2">
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img
                              src={`/api/admin/payments/${item.id}/image`}
                              alt="付款截圖"
                              className="max-w-xs rounded-lg border border-stone-200"
                            />
                          </div>
                        ) : (
                          <p className="mt-2 rounded-lg border border-amber-200 bg-amber-50 px-2 py-1.5 text-xs text-amber-900">
                            截圖未存入後台（舊版紀錄），請至 LINE 群組核對付款截圖後再核准。
                          </p>
                        )
                      ) : item.raw_payload?.trim() ? (
                        <p className="mt-2 rounded-lg border border-stone-200 bg-stone-50 px-2 py-1.5 text-xs text-stone-800 whitespace-pre-wrap break-words">
                          客人訊息：{item.raw_payload.trim()}
                        </p>
                      ) : null}
                    </div>
                    <div className="flex gap-2 items-start">
                      <button
                        type="button"
                        onClick={() => { confirmVia.current = "click"; setConfirmApproveId(item.id); }}
                        disabled={busyId !== null}
                        className="inline-flex min-h-[44px] items-center gap-1 rounded-xl bg-emerald-600 text-white px-4 py-2 text-sm font-medium transition-[background-color] duration-200 hover:bg-emerald-700 disabled:opacity-60"
                      >
                        <Check className="w-4 h-4" strokeWidth={1.5} /> 確認已收款
                      </button>
                      <button
                        type="button"
                        onClick={() => setRejectId(item.id)}
                        className="inline-flex min-h-[44px] items-center gap-1 rounded-xl border border-red-300 text-red-700 px-4 py-2 text-sm transition-[background-color] duration-200 hover:bg-red-50"
                      >
                        <X className="w-4 h-4" strokeWidth={1.5} /> 駁回
                      </button>
                    </div>
                  </div>
                  {rejectId === item.id && (
                    <div className="mt-3 flex gap-2">
                      <input
                        ref={rejectInputRef}
                        className="flex-1 rounded-xl border border-stone-300 px-2 py-1.5 text-sm focus:border-amber-500 focus:outline-none"
                        placeholder="駁回原因（必填）"
                        value={rejectNote}
                        onChange={(e) => setRejectNote(e.target.value)}
                      />
                      <button
                        type="button"
                        onClick={() => reject(item.id)}
                        disabled={busyId !== null}
                        className="min-h-[44px] rounded-xl bg-red-600 px-4 text-sm text-white disabled:opacity-60 transition-[background-color] duration-200 hover:bg-red-700"
                      >
                        確認駁回
                      </button>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
          {items.length > 0 && (
            <p className="mt-4 hidden items-center gap-2 text-xs text-stone-500 md:flex">
              <Keyboard className="w-3.5 h-3.5 shrink-0" strokeWidth={1.5} />
              <span>
                <kbd className="px-1 rounded bg-stone-100">↑</kbd>/<kbd className="px-1 rounded bg-stone-100">↓</kbd> 或{" "}
                <kbd className="px-1 rounded bg-stone-100">j</kbd>/<kbd className="px-1 rounded bg-stone-100">k</kbd> 切換 ·{" "}
                <kbd className="px-1 rounded bg-stone-100">Enter</kbd>/<kbd className="px-1 rounded bg-stone-100">a</kbd> 核准 ·{" "}
                <kbd className="px-1 rounded bg-stone-100">r</kbd> 駁回 · <kbd className="px-1 rounded bg-stone-100">Esc</kbd> 取消
              </span>
            </p>
          )}
        </section>

        <section className="rounded-2xl border border-stone-200 bg-white p-4 shadow-sm">
          <h2 className="mb-2 flex items-center gap-2 font-semibold text-stone-900">
            <AlertTriangle className="w-4 h-4 text-amber-600" strokeWidth={1.5} />
            訂金快到期的訂位
          </h2>
          {risk.length === 0 ? (
            <p className="text-sm text-stone-500">無未付訂金訂位</p>
          ) : (
            <ul className="space-y-2 text-sm">
              {risk.map((r) => (
                <li
                  key={r.booking_code}
                  className={r.would_auto_release || r.deadline_passed ? "font-medium text-red-700" : "text-stone-700"}
                >
                  {r.booking_code} {r.customer_name} · 期限{" "}
                  {format(parseISO(r.deadline), "MM/dd HH:mm", { locale: zhTW })}
                  {r.would_auto_release ? " · 今晚系統會自動取消" : r.deadline_passed ? " · 已逾期（不會自動取消）" : ""}
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="rounded-2xl border border-stone-200 bg-white p-4 shadow-sm">
          <h2 className="mb-3 font-semibold text-stone-900">用銀行明細檔對帳</h2>
          <label className="inline-flex cursor-pointer items-center gap-2 text-sm font-medium text-amber-800">
            <Upload className="w-4 h-4" strokeWidth={1.5} />
            上傳銀行明細檔
            <input type="file" accept=".csv,text/csv" className="hidden" onChange={uploadCsv} />
          </label>
          {reconcileResult && (
            <div className="mt-3 space-y-2 text-sm">
              <p>共 {reconcileResult.bank_rows} 筆 · 建議配對 {reconcileResult.matches.length} 筆</p>
              {reconcileResult.matches.map((m, i) => (
                <p key={i} className="text-emerald-700">
                  {m.booking_code} {m.customer_name} · NT${m.bank_amount} （把握度：{({ high: "高", medium: "中", low: "低" } as Record<string, string>)[m.confidence] ?? "—"}）
                </p>
              ))}
              {reconcileResult.unmatched.map((u, i) => (
                <p key={i} className="text-stone-500">
                  對不上訂位 NT${u.amount}
                </p>
              ))}
            </div>
          )}
        </section>
      </div>
    </AdminShell>
      <ConfirmDialog
        open={confirmApproveId !== null}
        title="確認已收到這筆款項？"
        message={(() => {
          const it = items.find((i) => i.id === confirmApproveId);
          return it
            ? `${it.customer_name}${it.deposit_amount != null ? ` 的訂金 NT$${it.deposit_amount}` : ""}。按「確認已收款」後會標記為已付訂金，並用 LINE 通知客人。`
            : "";
        })()}
        confirmLabel="確認已收款"
        variant="default"
        onConfirm={() => {
          const id = confirmApproveId;
          setConfirmApproveId(null);
          if (id) void approve(id, confirmVia.current);
        }}
        onCancel={() => setConfirmApproveId(null)}
      />
      <ToastStack toasts={toasts} onDismiss={dismissToast} />
    </>
  );
}
