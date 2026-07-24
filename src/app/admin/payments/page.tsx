"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Check, X, RefreshCw, Upload, AlertTriangle, Keyboard } from "lucide-react";
import { format, parseISO } from "date-fns";
import { zhTW } from "date-fns/locale";
import { parseLineImageMessageId } from "@/lib/payment-event-payload";
import type { AdminPaymentInteraction } from "@/lib/ops-log";
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
  created_at: string;
  raw_payload: string | null;
  source: string;
};

type RiskItem = {
  booking_code: string;
  customer_name: string;
  phone: string;
  status: string;
  deadline: string;
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
  const rejectInputRef = useRef<HTMLInputElement>(null);
  const itemRefs = useRef<(HTMLLIElement | null)[]>([]);
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
      const [statusRes, pendingRes, riskRes] = await Promise.all([
        fetch("/api/admin/payments/migration-status"),
        fetch("/api/admin/payments/pending"),
        fetch("/api/admin/payments/reconcile"),
      ]);
      const status = await statusRes.json();
      setMigrationOk(Boolean(status.payment_events_ready));

      if (!status.payment_events_ready) {
        setItems([]);
        setError(status.instructions ?? "請先執行 payment_events migration");
      } else if (pendingRes.ok) {
        setItems(await pendingRes.json());
      } else {
        const p = await pendingRes.json();
        setError(p.error ?? "無法載入待審核列表");
      }

      if (riskRes.ok) {
        const r = await riskRes.json();
        setRisk(r.items ?? []);
      }
    } catch {
      setError("載入失敗");
    } finally {
      setLoading(false);
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
    const res = await fetch(`/api/admin/payments/${id}/approve`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ interaction }),
    });
    if (!res.ok) {
      const d = await res.json();
      showToast(d.error ?? "核准失敗", "error");
      return;
    }
    showToast("已核准付款", "success");
    setItems((prev) => prev.filter((i) => i.id !== id));
  }, [showToast]);

  const reject = useCallback(async (id: string, interaction: AdminPaymentInteraction = "click") => {
    if (!rejectNote.trim()) {
      showToast("請填寫駁回原因", "error");
      return;
    }
    const res = await fetch(`/api/admin/payments/${id}/reject`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ review_note: rejectNote, interaction }),
    });
    if (!res.ok) {
      const d = await res.json();
      showToast(d.error ?? "駁回失敗", "error");
      return;
    }
    showToast("已駁回", "success");
    setRejectId(null);
    setRejectNote("");
    setItems((prev) => prev.filter((i) => i.id !== id));
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
        e.preventDefault();
        void approve(selected.id, "keyboard");
        return;
      }
      if (e.key === "r" && !rejectId) {
        e.preventDefault();
        openReject(selected.id);
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [items, selectedIndex, rejectId, rejectNote, approve, reject, openReject, closeReject]);

  const uploadCsv = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const form = new FormData();
    form.append("file", file);
    const res = await fetch("/api/admin/payments/reconcile", { method: "POST", body: form });
    const data = await res.json();
    if (!res.ok) {
      showToast(data.error ?? "對帳失敗", "error");
      return;
    }
    setReconcileResult(data);
    e.target.value = "";
  };

  return (
    <>
    <AdminShell
      title="付款審核"
      subtitle={migrationOk === false ? "需先完成 migration" : `待審核 ${items.length} 筆`}
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
      <div className="space-y-6">
        {migrationOk === false && (
          <div className="rounded-2xl border border-amber-300 bg-amber-50 p-4 text-amber-900">
            <p className="font-semibold flex items-center gap-2">
              <AlertTriangle className="w-4 h-4" strokeWidth={1.5} /> 資料庫 migration 尚未完成
            </p>
            <p className="text-sm mt-2">
              請至 Supabase SQL Editor 執行 <code className="bg-white px-1 rounded">supabase/migration-payment-events.sql</code>
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
                        <span className="rounded-full bg-stone-100 px-2 py-0.5 text-xs text-stone-600">
                          {item.source === "line_image" ? "LINE 截圖" : item.source === "line_text" ? "LINE 文字" : item.source}
                        </span>
                      </div>
                      <p className="text-sm text-stone-600">
                        代號 {item.booking_code} · {item.phone}
                      </p>
                      <p className="text-sm text-stone-600">
                        {format(parseISO(item.start_time), "yyyy/MM/dd HH:mm", { locale: zhTW })}
                        {item.deposit_amount != null && ` · 訂金 NT$${item.deposit_amount}`}
                      </p>
                      <p className="text-xs text-stone-400 mt-1">
                        提交於 {format(parseISO(item.created_at), "MM/dd HH:mm", { locale: zhTW })}
                      </p>
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
                        onClick={() => approve(item.id)}
                        className="inline-flex items-center gap-1 rounded-xl bg-emerald-600 text-white px-3 py-1.5 text-sm font-medium transition-[background-color] duration-200 hover:bg-emerald-700"
                      >
                        <Check className="w-4 h-4" strokeWidth={1.5} /> 核准
                      </button>
                      <button
                        type="button"
                        onClick={() => setRejectId(item.id)}
                        className="inline-flex items-center gap-1 rounded-xl border border-red-300 text-red-700 px-3 py-1.5 text-sm transition-[background-color] duration-200 hover:bg-red-50"
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
                        className="rounded-xl bg-red-600 px-3 text-sm text-white transition-[background-color] duration-200 hover:bg-red-700"
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
            <p className="mt-4 flex items-center gap-2 text-xs text-stone-500">
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
            訂金逾期風險（不自動取消）
          </h2>
          {risk.length === 0 ? (
            <p className="text-sm text-stone-500">無未付訂金訂位</p>
          ) : (
            <ul className="space-y-2 text-sm">
              {risk.map((r) => (
                <li
                  key={r.booking_code}
                  className={r.would_auto_release ? "font-medium text-red-700" : "text-stone-700"}
                >
                  {r.booking_code} {r.customer_name} · 期限{" "}
                  {format(parseISO(r.deadline), "MM/dd HH:mm", { locale: zhTW })}
                  {r.would_auto_release ? " · 下次 Cron 將自動釋放" : ""}
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="rounded-2xl border border-stone-200 bg-white p-4 shadow-sm">
          <h2 className="mb-3 font-semibold text-stone-900">銀行 CSV 對帳（MVP）</h2>
          <label className="inline-flex cursor-pointer items-center gap-2 text-sm font-medium text-amber-800">
            <Upload className="w-4 h-4" strokeWidth={1.5} />
            上傳 CSV
            <input type="file" accept=".csv,text/csv" className="hidden" onChange={uploadCsv} />
          </label>
          {reconcileResult && (
            <div className="mt-3 space-y-2 text-sm">
              <p>共 {reconcileResult.bank_rows} 筆 · 建議配對 {reconcileResult.matches.length} 筆</p>
              {reconcileResult.matches.map((m, i) => (
                <p key={i} className="text-emerald-700">
                  {m.booking_code} {m.customer_name} · NT${m.bank_amount} ({m.confidence})
                </p>
              ))}
              {reconcileResult.unmatched.map((u, i) => (
                <p key={i} className="text-stone-500">
                  未配對 NT${u.amount}: {u.reason}
                </p>
              ))}
            </div>
          )}
        </section>
      </div>
    </AdminShell>
      <ToastStack toasts={toasts} onDismiss={dismissToast} />
    </>
  );
}
