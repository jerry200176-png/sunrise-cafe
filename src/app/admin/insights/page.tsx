"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  TrendingUp,
  Users,
  Percent,
  Clock,
  Building2,
  BarChart2,
  RefreshCw,
} from "lucide-react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import type { Branch } from "@/types";

interface BiSummary {
  days: number;
  today: { date: string; reservations: number; revenue: number };
  kpis: {
    revenue: number;
    booked_hours: number;
    available_room_hours: number;
    occupancy_rate: number | null;
    rev_per_available_room_hour: number | null;
    cancellation_rate: number | null;
    no_show_count: number;
    no_show_rate: number | null;
    booking_conversion_rate: number | null;
    customer_return_rate: number | null;
  };
  funnel: {
    booking_started: number;
    room_selected: number;
    slot_selected: number;
    booking_completed: number;
    booking_failed: number;
  } | null;
  funnel_conversion: {
    overall_conversion: number | null;
    room_step_rate: number | null;
    slot_step_rate: number | null;
    complete_step_rate: number | null;
  } | null;
  waitlist: {
    joined: number;
    notified: number;
    booked: number;
    recovery_rate: number | null;
  };
  peak_off_peak: {
    peak: { bookings: number; revenue: number };
    off_peak: { bookings: number; revenue: number };
  };
  by_hour: { hour: number; bookings: number; revenue: number }[];
  by_branch: {
    branch_name: string;
    reservations: number;
    revenue: number;
    occupancy_rate: number | null;
    rev_per_room_hour: number | null;
  }[];
  by_room: {
    room_name: string;
    utilization_rate: number | null;
    revenue: number;
  }[];
}

interface CustomerInsights {
  metrics: {
    unique_customers: number;
    returning_customers: number;
    loyal_customers: number;
    return_rate: number | null;
    new_customers: number;
    line_binding_rate: number | null;
  };
}

const PERIODS = [
  { label: "7 天", value: 7 },
  { label: "30 天", value: 30 },
  { label: "90 天", value: 90 },
];

function pct(v: number | null | undefined): string {
  if (v == null) return "—";
  return `${(v * 100).toFixed(1)}%`;
}

function MetricCard({
  icon: Icon,
  label,
  value,
  sub,
  color,
}: {
  icon: React.ElementType;
  label: string;
  value: string;
  sub?: string;
  color: string;
}) {
  return (
    <div className="rounded-2xl bg-white p-4 shadow-sm border border-gray-100">
      <div className={`mb-2 inline-flex rounded-lg p-2 ${color}`}>
        <Icon size={16} className="text-white" />
      </div>
      <p className="text-xl font-bold text-gray-900">{value}</p>
      <p className="text-xs text-gray-500">{label}</p>
      {sub && <p className="mt-1 text-[10px] text-gray-400">{sub}</p>}
    </div>
  );
}

export default function InsightsPage() {
  const [days, setDays] = useState(30);
  const [branchId, setBranchId] = useState("");
  const [branches, setBranches] = useState<Branch[]>([]);
  const [bi, setBi] = useState<BiSummary | null>(null);
  const [customers, setCustomers] = useState<CustomerInsights | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/branches")
      .then((r) => r.json())
      .then((d) => setBranches(Array.isArray(d) ? d : []))
      .catch(() => setBranches([]));
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const q = new URLSearchParams({ days: String(days) });
      if (branchId) q.set("branchId", branchId);
      const [biRes, custRes] = await Promise.all([
        fetch(`/api/admin/bi/summary?${q}`),
        fetch(`/api/admin/customers/insights?days=${Math.max(days, 90)}`),
      ]);
      const biJson = await biRes.json();
      const custJson = await custRes.json();
      if (!biRes.ok) throw new Error(biJson.error ?? "BI 載入失敗");
      if (!custRes.ok) throw new Error(custJson.error ?? "客戶洞察載入失敗");
      setBi(biJson);
      setCustomers(custJson);
    } catch (e) {
      setError(e instanceof Error ? e.message : "載入失敗");
    } finally {
      setLoading(false);
    }
  }, [days, branchId]);

  useEffect(() => {
    load();
  }, [load]);

  const funnelSteps = bi?.funnel
    ? [
        { step: "開始訂位", count: bi.funnel.booking_started },
        { step: "選包廂", count: bi.funnel.room_selected },
        { step: "選時段", count: bi.funnel.slot_selected },
        { step: "完成", count: bi.funnel.booking_completed },
      ]
    : [];

  return (
    <div className="min-h-screen bg-gray-50 px-4 py-6">
      <div className="mx-auto max-w-5xl">
        <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <Link href="/admin" className="rounded-lg p-2 hover:bg-gray-100">
              <ArrowLeft size={18} className="text-gray-600" />
            </Link>
            <div>
              <h1 className="text-xl font-bold text-gray-900">商業洞察</h1>
              <p className="text-xs text-gray-500">營收 · 轉換 · 利用率 · 客戶留存</p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <select
              value={branchId}
              onChange={(e) => setBranchId(e.target.value)}
              className="rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-sm"
            >
              <option value="">全部分店</option>
              {branches.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
            <div className="flex rounded-lg border border-gray-200 bg-white overflow-hidden">
              {PERIODS.map((p) => (
                <button
                  key={p.value}
                  type="button"
                  onClick={() => setDays(p.value)}
                  className={`px-3 py-1.5 text-sm ${
                    days === p.value ? "bg-amber-500 text-white" : "text-gray-600 hover:bg-gray-50"
                  }`}
                >
                  {p.label}
                </button>
              ))}
            </div>
            <button
              type="button"
              onClick={load}
              className="rounded-lg border border-gray-200 bg-white p-2 hover:bg-gray-50"
              aria-label="重新整理"
            >
              <RefreshCw size={16} className="text-gray-600" />
            </button>
          </div>
        </div>

        {error && (
          <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
            {error}
          </div>
        )}

        {loading && !bi && (
          <p className="text-center text-sm text-gray-500 py-12">載入中…</p>
        )}

        {bi && (
          <>
            <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
              今日（{bi.today.date}）預約 <strong>{bi.today.reservations}</strong> 筆 · 營收{" "}
              <strong>NT$ {bi.today.revenue.toLocaleString()}</strong>
            </div>

            <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
              <MetricCard
                icon={TrendingUp}
                label={`近 ${days} 日營收`}
                value={`NT$ ${bi.kpis.revenue.toLocaleString()}`}
                color="bg-emerald-500"
              />
              <MetricCard
                icon={Percent}
                label="利用率"
                value={pct(bi.kpis.occupancy_rate)}
                sub={`${bi.kpis.booked_hours}h / ${bi.kpis.available_room_hours}h`}
                color="bg-blue-500"
              />
              <MetricCard
                icon={BarChart2}
                label="每可售房時營收"
                value={
                  bi.kpis.rev_per_available_room_hour != null
                    ? `NT$ ${bi.kpis.rev_per_available_room_hour}`
                    : "—"
                }
                color="bg-violet-500"
              />
              <MetricCard
                icon={Users}
                label="訂位轉換率"
                value={pct(bi.kpis.booking_conversion_rate)}
                sub="analytics 漏斗"
                color="bg-amber-500"
              />
              <MetricCard
                icon={Percent}
                label="取消率"
                value={pct(bi.kpis.cancellation_rate)}
                color="bg-rose-500"
              />
              <MetricCard
                icon={Clock}
                label="未到率（估）"
                value={pct(bi.kpis.no_show_rate)}
                sub={`${bi.kpis.no_show_count} 筆待確認`}
                color="bg-orange-500"
              />
              <MetricCard
                icon={Users}
                label="回訪率"
                value={pct(bi.kpis.customer_return_rate)}
                sub="依電話去重"
                color="bg-teal-500"
              />
              <MetricCard
                icon={TrendingUp}
                label="等位轉換"
                value={pct(bi.waitlist.recovery_rate)}
                sub={`${bi.waitlist.booked}/${bi.waitlist.joined} 筆`}
                color="bg-indigo-500"
              />
            </div>

            {funnelSteps.length > 0 && (
              <section className="mb-6 rounded-2xl bg-white p-5 shadow-sm">
                <h2 className="mb-4 text-sm font-semibold text-gray-800">訂位轉換漏斗</h2>
                <div className="space-y-2">
                  {funnelSteps.map((s, i) => {
                    const max = funnelSteps[0]?.count || 1;
                    const w = Math.max(4, (s.count / max) * 100);
                    return (
                      <div key={s.step} className="flex items-center gap-3">
                        <span className="w-16 text-xs text-gray-500">{s.step}</span>
                        <div className="flex-1 h-6 rounded bg-gray-100 overflow-hidden">
                          <div
                            className="h-full bg-amber-400 rounded"
                            style={{ width: `${w}%` }}
                          />
                        </div>
                        <span className="w-12 text-right text-xs font-medium text-gray-700">
                          {s.count}
                        </span>
                        {i > 0 && bi.funnel_conversion && (
                          <span className="w-14 text-right text-[10px] text-gray-400">
                            {i === 1 && pct(bi.funnel_conversion.room_step_rate)}
                            {i === 2 && pct(bi.funnel_conversion.slot_step_rate)}
                            {i === 3 && pct(bi.funnel_conversion.complete_step_rate)}
                          </span>
                        )}
                      </div>
                    );
                  })}
                </div>
              </section>
            )}

            <div className="mb-6 grid gap-6 lg:grid-cols-2">
              <section className="rounded-2xl bg-white p-5 shadow-sm">
                <h2 className="mb-3 text-sm font-semibold text-gray-800">尖峰 vs 離峰</h2>
                <div className="grid grid-cols-2 gap-3 text-sm">
                  <div className="rounded-lg bg-amber-50 p-3">
                    <p className="text-xs text-amber-700">尖峰 11:00–21:00</p>
                    <p className="font-bold text-amber-900">
                      {bi.peak_off_peak.peak.bookings} 筆 · NT${" "}
                      {bi.peak_off_peak.peak.revenue.toLocaleString()}
                    </p>
                  </div>
                  <div className="rounded-lg bg-gray-50 p-3">
                    <p className="text-xs text-gray-500">離峰</p>
                    <p className="font-bold text-gray-800">
                      {bi.peak_off_peak.off_peak.bookings} 筆 · NT${" "}
                      {bi.peak_off_peak.off_peak.revenue.toLocaleString()}
                    </p>
                  </div>
                </div>
              </section>

              {customers && (
                <section className="rounded-2xl bg-white p-5 shadow-sm">
                  <h2 className="mb-3 text-sm font-semibold text-gray-800">客戶分群</h2>
                  <ul className="space-y-2 text-sm text-gray-700">
                    <li>新客（1 次）：{customers.metrics.new_customers}</li>
                    <li>回訪（2–3 次）：{customers.metrics.returning_customers}</li>
                    <li>忠誠（4+ 次）：{customers.metrics.loyal_customers}</li>
                    <li>LINE 綁定率：{pct(customers.metrics.line_binding_rate)}</li>
                  </ul>
                </section>
              )}
            </div>

            {bi.by_hour.length > 0 && (
              <section className="mb-6 rounded-2xl bg-white p-5 shadow-sm">
                <h2 className="mb-4 text-sm font-semibold text-gray-800">時段分布</h2>
                <div className="h-56">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={bi.by_hour}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                      <XAxis
                        dataKey="hour"
                        tickFormatter={(h) => `${h}:00`}
                        fontSize={11}
                      />
                      <YAxis fontSize={11} />
                      <Tooltip
                        formatter={(v, name) => [
                          name === "revenue" ? `NT$ ${v}` : v,
                          name === "revenue" ? "營收" : "訂位數",
                        ]}
                      />
                      <Bar dataKey="bookings" fill="#f59e0b" name="bookings" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </section>
            )}

            {bi.by_branch.length > 0 && (
              <section className="mb-6 rounded-2xl bg-white p-5 shadow-sm">
                <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-gray-800">
                  <Building2 size={16} /> 分店比較
                </h2>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b text-left text-xs text-gray-500">
                        <th className="py-2 pr-4">分店</th>
                        <th className="py-2 pr-4">訂位</th>
                        <th className="py-2 pr-4">營收</th>
                        <th className="py-2 pr-4">利用率</th>
                        <th className="py-2">Rev/房時</th>
                      </tr>
                    </thead>
                    <tbody>
                      {bi.by_branch.map((b) => (
                        <tr key={b.branch_name} className="border-b border-gray-50">
                          <td className="py-2 pr-4 font-medium">{b.branch_name}</td>
                          <td className="py-2 pr-4">{b.reservations}</td>
                          <td className="py-2 pr-4">NT$ {b.revenue.toLocaleString()}</td>
                          <td className="py-2 pr-4">{pct(b.occupancy_rate)}</td>
                          <td className="py-2">
                            {b.rev_per_room_hour != null
                              ? `NT$ ${b.rev_per_room_hour}`
                              : "—"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            )}

            {bi.by_room.length > 0 && (
              <section className="rounded-2xl bg-white p-5 shadow-sm">
                <h2 className="mb-3 text-sm font-semibold text-gray-800">包廂利用率 Top</h2>
                <ul className="space-y-2">
                  {bi.by_room.slice(0, 8).map((r) => (
                    <li
                      key={r.room_name}
                      className="flex items-center justify-between text-sm"
                    >
                      <span className="text-gray-800">{r.room_name}</span>
                      <span className="text-gray-500">
                        {pct(r.utilization_rate)} · NT$ {r.revenue.toLocaleString()}
                      </span>
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </>
        )}
      </div>
    </div>
  );
}
