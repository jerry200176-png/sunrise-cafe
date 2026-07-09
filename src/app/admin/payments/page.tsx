"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Check, X, RefreshCw, LogOut, Upload, AlertTriangle } from "lucide-react";
import { format, parseISO } from "date-fns";
import { zhTW } from "date-fns/locale";

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
  const [reconcileResult, setReconcileResult] = useState<ReconcileResult | null>(null);

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

  const approve = async (id: string) => {
    const res = await fetch(`/api/admin/payments/${id}/approve`, { method: "POST" });
    if (!res.ok) {
      const d = await res.json();
      alert(d.error ?? "核准失敗");
      return;
    }
    await load();
  };

  const reject = async (id: string) => {
    if (!rejectNote.trim()) {
      alert("請填寫駁回原因");
      return;
    }
    const res = await fetch(`/api/admin/payments/${id}/reject`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ review_note: rejectNote }),
    });
    if (!res.ok) {
      const d = await res.json();
      alert(d.error ?? "駁回失敗");
      return;
    }
    setRejectId(null);
    setRejectNote("");
    await load();
  };

  const uploadCsv = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const form = new FormData();
    form.append("file", file);
    const res = await fetch("/api/admin/payments/reconcile", { method: "POST", body: form });
    const data = await res.json();
    if (!res.ok) {
      alert(data.error ?? "對帳失敗");
      return;
    }
    setReconcileResult(data);
    e.target.value = "";
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link href="/admin" className="text-gray-600 hover:text-gray-900">
            <ArrowLeft className="w-5 h-5" />
          </Link>
          <h1 className="text-lg font-bold text-gray-900">付款審核</h1>
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

      <main className="max-w-4xl mx-auto p-4 space-y-6">
        {migrationOk === false && (
          <div className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-amber-900">
            <p className="font-bold flex items-center gap-2">
              <AlertTriangle className="w-4 h-4" /> 資料庫 migration 尚未完成
            </p>
            <p className="text-sm mt-2">
              請至 Supabase SQL Editor 執行 <code className="bg-white px-1 rounded">supabase/migration-payment-events.sql</code>
            </p>
          </div>
        )}

        {error && (
          <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-red-800 text-sm">{error}</div>
        )}

        <section className="bg-white rounded-lg border p-4">
          <h2 className="font-bold text-gray-900 mb-3">待審核截圖 ({items.length})</h2>
          {loading ? (
            <p className="text-gray-500 text-sm">載入中…</p>
          ) : items.length === 0 ? (
            <p className="text-gray-500 text-sm">目前無待審核項目</p>
          ) : (
            <ul className="space-y-3">
              {items.map((item) => (
                <li key={item.id} className="border rounded-lg p-3">
                  <div className="flex flex-wrap justify-between gap-2">
                    <div>
                      <p className="font-bold">{item.customer_name}</p>
                      <p className="text-sm text-gray-600">
                        代號 {item.booking_code} · {item.phone}
                      </p>
                      <p className="text-sm text-gray-600">
                        {format(parseISO(item.start_time), "yyyy/MM/dd HH:mm", { locale: zhTW })}
                        {item.deposit_amount != null && ` · 訂金 NT$${item.deposit_amount}`}
                      </p>
                      <p className="text-xs text-gray-400 mt-1">
                        提交於 {format(parseISO(item.created_at), "MM/dd HH:mm", { locale: zhTW })}
                      </p>
                    </div>
                    <div className="flex gap-2 items-start">
                      <button
                        type="button"
                        onClick={() => approve(item.id)}
                        className="inline-flex items-center gap-1 rounded bg-green-600 text-white px-3 py-1.5 text-sm font-medium hover:bg-green-700"
                      >
                        <Check className="w-4 h-4" /> 核准
                      </button>
                      <button
                        type="button"
                        onClick={() => setRejectId(item.id)}
                        className="inline-flex items-center gap-1 rounded border border-red-300 text-red-700 px-3 py-1.5 text-sm hover:bg-red-50"
                      >
                        <X className="w-4 h-4" /> 駁回
                      </button>
                    </div>
                  </div>
                  {rejectId === item.id && (
                    <div className="mt-3 flex gap-2">
                      <input
                        className="flex-1 border rounded px-2 py-1 text-sm"
                        placeholder="駁回原因（必填）"
                        value={rejectNote}
                        onChange={(e) => setRejectNote(e.target.value)}
                      />
                      <button
                        type="button"
                        onClick={() => reject(item.id)}
                        className="text-sm bg-red-600 text-white px-3 rounded"
                      >
                        確認駁回
                      </button>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="bg-white rounded-lg border p-4">
          <h2 className="font-bold text-gray-900 mb-2 flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-amber-600" />
            訂金逾期風險（不自動取消）
          </h2>
          {risk.length === 0 ? (
            <p className="text-sm text-gray-500">無未付訂金訂位</p>
          ) : (
            <ul className="text-sm space-y-2">
              {risk.map((r) => (
                <li
                  key={r.booking_code}
                  className={r.would_auto_release ? "text-red-700 font-medium" : "text-gray-700"}
                >
                  {r.booking_code} {r.customer_name} · 期限{" "}
                  {format(parseISO(r.deadline), "MM/dd HH:mm", { locale: zhTW })}
                  {r.would_auto_release ? " · ⚠️ 下次 Cron 將自動釋放" : ""}
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="bg-white rounded-lg border p-4">
          <h2 className="font-bold text-gray-900 mb-3">銀行 CSV 對帳（MVP）</h2>
          <label className="inline-flex items-center gap-2 cursor-pointer text-sm text-blue-700">
            <Upload className="w-4 h-4" />
            上傳 CSV
            <input type="file" accept=".csv,text/csv" className="hidden" onChange={uploadCsv} />
          </label>
          {reconcileResult && (
            <div className="mt-3 text-sm space-y-2">
              <p>共 {reconcileResult.bank_rows} 筆 · 建議配對 {reconcileResult.matches.length} 筆</p>
              {reconcileResult.matches.map((m, i) => (
                <p key={i} className="text-green-700">
                  {m.booking_code} {m.customer_name} · NT${m.bank_amount} ({m.confidence})
                </p>
              ))}
              {reconcileResult.unmatched.map((u, i) => (
                <p key={i} className="text-gray-500">
                  未配對 NT${u.amount}: {u.reason}
                </p>
              ))}
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
