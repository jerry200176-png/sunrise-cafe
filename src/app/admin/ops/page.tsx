"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  Sun,
  AlertTriangle,
  ShieldCheck,
  Users,
  FlaskConical,
  RefreshCw,
  Copy,
  Check,
} from "lucide-react";

interface OpsException {
  code: string;
  severity: "info" | "warning" | "error";
  title: string;
  detail: string;
  count?: number;
}

interface MorningSummary {
  date: string;
  today: {
    reservations: number;
    revenue: number;
    pending_deposit: number;
    waitlist_waiting: number;
  };
  exceptions: OpsException[];
  line_message: string;
}

interface DqReport {
  summary: { total: number; error: number; warning: number; info: number };
  issues: { code: string; severity: string; message: string; count?: number }[];
}

interface RetentionOpportunities {
  counts: { inactive: number; review_candidates: number; anniversaries: number };
  privacy_note: string;
  inactive_customers: { phone_masked: string; last_booking: string; booking_count: number }[];
  review_invite_candidates: { customer_name: string; start_time: string }[];
  anniversary_opportunities: { phone_masked: string; anniversary_date: string; years: number }[];
}

interface Experiment {
  id: string;
  key: string;
  name: string;
  status: string;
  target_audience: string;
  start_at: string | null;
  end_at: string | null;
}

const severityColor = (s: string) => {
  if (s === "error") return "text-red-700 bg-red-50 border-red-200";
  if (s === "warning") return "text-amber-800 bg-amber-50 border-amber-200";
  return "text-stone-600 bg-stone-50 border-stone-200";
};

export default function AdminOpsPage() {
  const [morning, setMorning] = useState<MorningSummary | null>(null);
  const [dq, setDq] = useState<DqReport | null>(null);
  const [retention, setRetention] = useState<RetentionOpportunities | null>(null);
  const [experiments, setExperiments] = useState<Experiment[]>([]);
  const [migrationRequired, setMigrationRequired] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [mRes, dqRes, rRes, eRes] = await Promise.all([
        fetch("/api/admin/ops/morning-summary"),
        fetch("/api/admin/data-quality/report?days=30"),
        fetch("/api/admin/retention/opportunities"),
        fetch("/api/admin/experiments"),
      ]);
      if (!mRes.ok) throw new Error("晨報載入失敗");
      setMorning(await mRes.json());
      if (dqRes.ok) setDq(await dqRes.json());
      if (rRes.ok) setRetention(await rRes.json());
      const eData = await eRes.json();
      if (eRes.ok) {
        setExperiments(eData.experiments ?? []);
        setMigrationRequired(Boolean(eData.migration_required));
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "載入失敗");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const copyLineMessage = async () => {
    if (!morning?.line_message) return;
    await navigator.clipboard.writeText(morning.line_message);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  if (loading && !morning) {
    return (
      <main className="min-h-screen bg-stone-50 p-6">
        <p className="text-stone-500">載入營運中心…</p>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-stone-50">
      <header className="border-b border-stone-200 bg-white shadow-sm">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-4 py-3.5">
          <div className="flex items-center gap-3">
            <Link href="/admin" className="rounded-lg p-1.5 text-stone-400 hover:bg-stone-100">
              <ArrowLeft className="h-5 w-5" />
            </Link>
            <div>
              <h1 className="text-base font-semibold text-stone-800">營運中心</h1>
              <p className="text-[10px] uppercase tracking-widest text-stone-400">Ops · Phase 5</p>
            </div>
          </div>
          <button
            type="button"
            onClick={load}
            className="inline-flex items-center gap-1.5 rounded-lg border border-stone-200 px-3 py-2 text-sm text-stone-600 hover:bg-stone-50"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
            重新整理
          </button>
        </div>
      </header>

      <div className="mx-auto max-w-5xl space-y-6 px-4 py-6">
        {error && (
          <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
            {error}
          </div>
        )}

        {morning && (
          <section className="rounded-2xl border border-amber-100 bg-gradient-to-br from-amber-50 to-orange-50/40 p-5 shadow-sm">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Sun className="h-5 w-5 text-amber-600" />
                <h2 className="font-semibold text-stone-800">今日晨報 · {morning.date}</h2>
              </div>
              <button
                type="button"
                onClick={copyLineMessage}
                className="inline-flex items-center gap-1.5 rounded-lg bg-white px-3 py-1.5 text-sm text-stone-600 ring-1 ring-amber-200 hover:bg-amber-50"
              >
                {copied ? <Check className="h-4 w-4 text-green-600" /> : <Copy className="h-4 w-4" />}
                複製 LINE 文案
              </button>
            </div>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {[
                { label: "今日預約", value: morning.today.reservations },
                { label: "預估營收", value: `NT$ ${morning.today.revenue.toLocaleString()}` },
                { label: "待付訂金", value: morning.today.pending_deposit },
                { label: "等位中", value: morning.today.waitlist_waiting },
              ].map(({ label, value }) => (
                <div key={label} className="rounded-xl bg-white/80 p-3 ring-1 ring-amber-100">
                  <p className="text-xs text-stone-500">{label}</p>
                  <p className="mt-1 text-lg font-semibold text-stone-800">{value}</p>
                </div>
              ))}
            </div>
          </section>
        )}

        {morning && (
          <section className="rounded-2xl border border-stone-200 bg-white p-5 shadow-sm">
            <div className="mb-3 flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-amber-500" />
              <h2 className="font-semibold text-stone-800">異常警示</h2>
              <span className="text-sm text-stone-400">({morning.exceptions.length})</span>
            </div>
            {morning.exceptions.length === 0 ? (
              <p className="text-sm text-green-700">✅ 目前無異常</p>
            ) : (
              <ul className="space-y-2">
                {morning.exceptions.map((ex) => (
                  <li
                    key={ex.code}
                    className={`rounded-lg border px-3 py-2 text-sm ${severityColor(ex.severity)}`}
                  >
                    <span className="font-medium">{ex.title}</span>
                    <span className="text-stone-600"> — {ex.detail}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}

        {dq && (
          <section className="rounded-2xl border border-stone-200 bg-white p-5 shadow-sm">
            <div className="mb-3 flex items-center gap-2">
              <ShieldCheck className="h-4 w-4 text-blue-500" />
              <h2 className="font-semibold text-stone-800">資料品質</h2>
              <span className="text-xs text-stone-400">
                錯誤 {dq.summary.error} · 警告 {dq.summary.warning} · 資訊 {dq.summary.info}
              </span>
            </div>
            {dq.issues.length === 0 ? (
              <p className="text-sm text-green-700">近 30 日檢查通過</p>
            ) : (
              <ul className="max-h-48 space-y-1 overflow-y-auto text-sm text-stone-600">
                {dq.issues.slice(0, 12).map((issue, i) => (
                  <li key={`${issue.code}-${i}`}>
                    <span className={`rounded px-1.5 py-0.5 text-xs ${severityColor(issue.severity)}`}>
                      {issue.code}
                    </span>{" "}
                    {issue.message}
                    {issue.count != null ? ` (${issue.count})` : ""}
                  </li>
                ))}
              </ul>
            )}
            <p className="mt-2 text-xs text-stone-400">
              欄位定義見 <code className="rounded bg-stone-100 px-1">docs/DATA_DICTIONARY.md</code>
            </p>
          </section>
        )}

        {retention && (
          <section className="rounded-2xl border border-stone-200 bg-white p-5 shadow-sm">
            <div className="mb-3 flex items-center gap-2">
              <Users className="h-4 w-4 text-violet-500" />
              <h2 className="font-semibold text-stone-800">客戶留存機會</h2>
            </div>
            <p className="mb-3 text-xs text-stone-400">{retention.privacy_note}</p>
            <div className="mb-4 grid grid-cols-3 gap-2 text-center">
              {[
                { label: "沉睡客戶", count: retention.counts.inactive },
                { label: "待邀評", count: retention.counts.review_candidates },
                { label: "週年紀念", count: retention.counts.anniversaries },
              ].map(({ label, count }) => (
                <div key={label} className="rounded-lg bg-stone-50 p-3">
                  <p className="text-2xl font-bold text-stone-800">{count}</p>
                  <p className="text-xs text-stone-500">{label}</p>
                </div>
              ))}
            </div>
            {retention.inactive_customers.length > 0 && (
              <div className="text-sm text-stone-600">
                <p className="mb-1 font-medium text-stone-700">沉睡客戶（範例）</p>
                <ul className="space-y-1">
                  {retention.inactive_customers.slice(0, 5).map((c, i) => (
                    <li key={i}>
                      {c.phone_masked} · 上次 {c.last_booking.slice(0, 10)} · {c.booking_count} 次
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </section>
        )}

        <section className="rounded-2xl border border-stone-200 bg-white p-5 shadow-sm">
          <div className="mb-3 flex items-center gap-2">
            <FlaskConical className="h-4 w-4 text-emerald-500" />
            <h2 className="font-semibold text-stone-800">成長實驗</h2>
          </div>
          {migrationRequired && (
            <p className="mb-2 text-sm text-amber-700">
              請執行 <code className="rounded bg-amber-50 px-1">migration-phase5-experiments.sql</code>
            </p>
          )}
          {experiments.length === 0 ? (
            <p className="text-sm text-stone-400">尚無實驗。透過 API POST /api/admin/experiments 建立。</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-xs text-stone-400">
                    <th className="pb-2 pr-3">名稱</th>
                    <th className="pb-2 pr-3">狀態</th>
                    <th className="pb-2 pr-3">受眾</th>
                    <th className="pb-2">期間</th>
                  </tr>
                </thead>
                <tbody>
                  {experiments.map((e) => (
                    <tr key={e.id} className="border-b border-stone-50">
                      <td className="py-2 pr-3 font-medium">{e.name}</td>
                      <td className="py-2 pr-3">{e.status}</td>
                      <td className="py-2 pr-3 text-stone-500">{e.target_audience}</td>
                      <td className="py-2 text-stone-500 text-xs">
                        {e.start_at?.slice(0, 10) ?? "—"} ~ {e.end_at?.slice(0, 10) ?? "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="mt-3 text-xs text-stone-400">
            轉換追蹤：analytics 事件含 <code className="rounded bg-stone-100 px-1">experiment</code> /{" "}
            <code className="rounded bg-stone-100 px-1">variant</code> 屬性
          </p>
        </section>

        <p className="text-center text-xs text-stone-400">
          <Link href="/admin/insights" className="text-amber-700 hover:underline">
            商業洞察
          </Link>
          {" · "}
          <Link href="/admin/dashboard" className="text-amber-700 hover:underline">
            儀表板
          </Link>
        </p>
      </div>
    </main>
  );
}
