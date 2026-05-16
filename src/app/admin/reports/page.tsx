"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { ArrowLeft, Download, TrendingUp, CalendarDays, XCircle, Wallet } from "lucide-react";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from "recharts";

interface Summary {
  total_revenue: number;
  total_bookings: number;
  cancellation_count: number;
  cancellation_rate: number;
  deposit_paid_count: number;
  deposit_recovery_rate: number;
}
interface MonthlyRow { month: string; revenue: number; bookings: number; }
interface RoomRow { name: string; bookings: number; revenue: number; }
interface HourRow { hour: number; label: string; count: number; }
interface ReportData { summary: Summary; monthly: MonthlyRow[]; by_room: RoomRow[]; by_hour: HourRow[]; }

const PERIODS = [
  { label: "近 3 個月", value: 3 },
  { label: "近 6 個月", value: 6 },
  { label: "近 12 個月", value: 12 },
];

function MetricCard({ icon: Icon, label, value, sub, color }: {
  icon: React.ElementType; label: string; value: string; sub?: string; color: string;
}) {
  return (
    <div className="rounded-2xl bg-white p-5 shadow-sm">
      <div className={`mb-3 inline-flex rounded-xl p-2 ${color}`}>
        <Icon size={18} className="text-white" />
      </div>
      <p className="text-2xl font-bold text-gray-800">{value}</p>
      <p className="text-sm text-gray-500">{label}</p>
      {sub && <p className="mt-1 text-xs text-gray-400">{sub}</p>}
    </div>
  );
}

function exportCSV(data: ReportData) {
  const rows = [
    ["月份", "訂位數", "營收（元）"],
    ...data.monthly.map((r) => [r.month, r.bookings, r.revenue]),
    [],
    ["包廂", "訂位數", "營收（元）"],
    ...data.by_room.map((r) => [r.name, r.bookings, r.revenue]),
  ];
  const csv = rows.map((r) => r.join(",")).join("\n");
  const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `sunrise-cafe-report-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

export default function ReportsPage() {
  const [period, setPeriod] = useState(6);
  const [data, setData] = useState<ReportData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/reports?months=${period}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error);
      setData(json);
    } catch (err) {
      setError(err instanceof Error ? err.message : "載入失敗");
    } finally {
      setLoading(false);
    }
  }, [period]);

  useEffect(() => { load(); }, [load]);

  const maxHour = Math.max(...(data?.by_hour.map((h) => h.count) ?? [1]), 1);

  return (
    <div className="min-h-screen bg-gray-50 px-4 py-6">
      <div className="mx-auto max-w-4xl">

        {/* Header */}
        <div className="mb-6 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link href="/admin" className="rounded-lg p-2 hover:bg-gray-100">
              <ArrowLeft size={18} className="text-gray-600" />
            </Link>
            <h1 className="text-xl font-bold text-gray-800">營收報表</h1>
          </div>
          <div className="flex items-center gap-2">
            <div className="flex rounded-lg border border-gray-200 bg-white overflow-hidden">
              {PERIODS.map((p) => (
                <button
                  key={p.value}
                  onClick={() => setPeriod(p.value)}
                  className={`px-3 py-1.5 text-sm ${period === p.value ? "bg-amber-500 text-white" : "text-gray-600 hover:bg-gray-50"}`}
                >
                  {p.label}
                </button>
              ))}
            </div>
            {data && (
              <button
                onClick={() => exportCSV(data)}
                className="flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-50"
              >
                <Download size={14} /> 匯出
              </button>
            )}
          </div>
        </div>

        {loading && <p className="py-20 text-center text-sm text-gray-400">載入中…</p>}
        {error && <p className="rounded-xl bg-red-50 p-4 text-sm text-red-600">{error}</p>}

        {data && (
          <div className="space-y-6">

            {/* 總覽指標 */}
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <MetricCard
                icon={TrendingUp} label="總營收" color="bg-amber-500"
                value={`$${data.summary.total_revenue.toLocaleString()}`}
              />
              <MetricCard
                icon={CalendarDays} label="總訂位" color="bg-blue-500"
                value={String(data.summary.total_bookings)}
              />
              <MetricCard
                icon={XCircle} label="取消率" color="bg-red-400"
                value={`${Math.round(data.summary.cancellation_rate * 100)}%`}
                sub={`共 ${data.summary.cancellation_count} 筆`}
              />
              <MetricCard
                icon={Wallet} label="訂金回收率" color="bg-green-500"
                value={`${Math.round(data.summary.deposit_recovery_rate * 100)}%`}
                sub={`${data.summary.deposit_paid_count} / ${data.summary.total_bookings} 筆`}
              />
            </div>

            {/* 月份趨勢 */}
            <div className="rounded-2xl bg-white p-5 shadow-sm">
              <h2 className="mb-4 font-semibold text-gray-700">月份營收趨勢</h2>
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={data.monthly} margin={{ top: 0, right: 0, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                  <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`} />
                  <Tooltip formatter={(v) => [`$${Number(v).toLocaleString()}`, "營收"]} />
                  <Bar dataKey="revenue" fill="#f59e0b" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>

            {/* 包廂 + 熱門時段 */}
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">

              {/* 包廂使用率 */}
              <div className="rounded-2xl bg-white p-5 shadow-sm">
                <h2 className="mb-4 font-semibold text-gray-700">包廂使用率</h2>
                <div className="space-y-3">
                  {data.by_room.map((r) => (
                    <div key={r.name}>
                      <div className="mb-1 flex justify-between text-sm">
                        <span className="text-gray-700">{r.name}</span>
                        <span className="text-gray-500">{r.bookings} 筆 · ${r.revenue.toLocaleString()}</span>
                      </div>
                      <div className="h-2 rounded-full bg-gray-100">
                        <div
                          className="h-2 rounded-full bg-amber-400"
                          style={{ width: `${Math.round((r.bookings / Math.max(...data.by_room.map((x) => x.bookings), 1)) * 100)}%` }}
                        />
                      </div>
                    </div>
                  ))}
                  {data.by_room.length === 0 && <p className="text-sm text-gray-400">無資料</p>}
                </div>
              </div>

              {/* 熱門時段 */}
              <div className="rounded-2xl bg-white p-5 shadow-sm">
                <h2 className="mb-4 font-semibold text-gray-700">熱門時段</h2>
                <div className="space-y-1.5">
                  {data.by_hour.map((h) => (
                    <div key={h.hour} className="flex items-center gap-2">
                      <span className="w-10 text-right text-xs text-gray-400">{h.label}</span>
                      <div className="flex-1 rounded-full bg-gray-100 h-2">
                        <div
                          className="h-2 rounded-full bg-blue-400"
                          style={{ width: `${Math.round((h.count / maxHour) * 100)}%` }}
                        />
                      </div>
                      <span className="w-6 text-xs text-gray-400">{h.count}</span>
                    </div>
                  ))}
                </div>
              </div>

            </div>
          </div>
        )}
      </div>
    </div>
  );
}
