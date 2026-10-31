"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import Link from "next/link";
import { responseError, thrownMessage } from "@/lib/friendly-error";
import { fetchWithTimeout, readJsonWithTimeout } from "@/lib/fetch-with-timeout";
import { useAdminBranches } from "@/lib/use-admin-branches";
import { csvRow } from "@/lib/csv";
import { ArrowLeft, Download, TrendingUp, CalendarDays, XCircle, Wallet, type LucideIcon } from "lucide-react";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from "recharts";

interface Summary {
  received_deposits: number;
  received_orders: number;
  expected_upcoming: number;
  unpaid_deposits: number;
  bookings: number;
  cancellation_count: number;
  cancellation_rate: number;
  deposit_paid_count: number;
  deposit_rate: number | null;
}
interface MonthlyRow { month: string; label: string; bookings: number; received_deposits: number; received_orders: number; }
interface RoomRow { name: string; bookings: number; booked_amount: number; }
interface HourRow { hour: number; label: string; count: number; }
interface ReportData { summary: Summary; monthly: MonthlyRow[]; by_room: RoomRow[]; by_hour: HourRow[]; }

const PERIODS = [
  { label: "近 3 個月", value: 3 },
  { label: "近 6 個月", value: 6 },
  { label: "近 12 個月", value: 12 },
];

function MetricCard({ icon: Icon, label, value, sub, color }: {
  icon: LucideIcon; label: string; value: string; sub?: string; color: string;
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
    ["月份", "訂位數", "已收訂金（元）", "已收餐點（元）"],
    ...data.monthly.map((r) => [r.month, r.bookings, r.received_deposits, r.received_orders]),
    [],
    ["包廂", "訂位數", "訂位金額（元，預計）"],
    ...data.by_room.map((r) => [r.name, r.bookings, r.booked_amount]),
  ];
  const csv = rows.map(csvRow).join("\n");
  const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  const day = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Taipei", month: "2-digit", day: "2-digit" }).format(new Date());
  a.download = `昇咖啡營收報表-${day}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

export default function ReportsPage() {
  const [period, setPeriod] = useState(6);
  const [storedData, setStoredData] = useState<{ key: string; value: ReportData } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { branches, loading: branchesLoading, error: branchesError, retry: retryBranches } = useAdminBranches();
  const branchScopeKey = JSON.stringify(branches.map((branch) => branch.id).sort());
  const [branchId, setBranchId] = useState("");
  const branchUnavailable = !branchesLoading && !branchesError && Boolean(branchId) && !branches.some((branch) => branch.id === branchId);
  const requestSequence = useRef(0);
  const invalidateRequests = useCallback(() => { requestSequence.current++; }, []);
  const queryKey = JSON.stringify([period, branchId, branchScopeKey]);
  const data = !branchUnavailable && storedData?.key === queryKey ? storedData.value : null;

  useEffect(() => {
    if (branchUnavailable) setBranchId("");
  }, [branchUnavailable]);

  const load = useCallback(async () => {
    const requestId = ++requestSequence.current;
    setLoading(true);
    setError(null);
    try {
      const res = await fetchWithTimeout(`/api/admin/reports?months=${period}${branchId ? `&branchId=${encodeURIComponent(branchId)}` : ""}`);
      if (!res.ok) throw new Error(await responseError(res));
      const result = await readJsonWithTimeout<ReportData>(res);
      if (requestId === requestSequence.current) setStoredData({ key: queryKey, value: result });
    } catch (err) {
      if (requestId === requestSequence.current) setError(thrownMessage(err, "報表暫時讀不到，請重試"));
    } finally {
      if (requestId === requestSequence.current) setLoading(false);
    }
  }, [period, branchId, queryKey]);

  useEffect(() => {
    if (!branchUnavailable) void load();
    return invalidateRequests;
  }, [load, invalidateRequests, branchUnavailable]);

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
            <select
              value={branchId}
              onChange={(e) => setBranchId(e.target.value)}
              aria-label="分店"
              className="min-h-[44px] rounded-lg border border-gray-200 bg-white px-2 text-sm text-gray-700"
            >
              <option value="">全部分店</option>
              {branchesLoading && <option disabled value="__loading">載入分店…</option>}
              {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
            <div className="flex rounded-lg border border-gray-200 bg-white overflow-hidden">
              {PERIODS.map((p) => (
                <button
                  key={p.value}
                  onClick={() => setPeriod(p.value)}
                  className={`min-h-[44px] px-3 text-sm ${period === p.value ? "bg-amber-500 text-white" : "text-gray-600 hover:bg-gray-50"}`}
                >
                  {p.label}
                </button>
              ))}
            </div>
            {data && (
              <button
                onClick={() => exportCSV(data)}
                className="flex min-h-[44px] items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 text-sm text-gray-600 hover:bg-gray-50"
              >
                <Download size={14} /> 匯出
              </button>
            )}
          </div>
        </div>

        {branchesError && (
          <div role="alert" className="mb-4 flex flex-wrap items-center gap-2 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">
            <span>{branchesError}</span>
            <button type="button" onClick={() => void retryBranches()} className="underline">重試載入分店</button>
          </div>
        )}
        {!branchesLoading && !branchesError && branches.length === 0 && (
          <p role="status" className="mb-4 rounded-xl bg-gray-100 px-4 py-3 text-sm text-gray-600">目前沒有可選的分店；報表仍依帳號權限顯示。</p>
        )}

        {loading && !data && <p className="py-20 text-center text-sm text-gray-400">載入中…</p>}
        {error && <p className="rounded-xl bg-red-50 p-4 text-sm text-red-600">{error}</p>}

        {data && (
          <div className="space-y-6">

            {/* 已收到的錢：訂金和餐點分開，不加總 */}
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <MetricCard
                icon={Wallet} label="已收訂金" color="bg-green-500"
                value={`$${data.summary.received_deposits.toLocaleString()}`}
                sub="已確認收款"
              />
              <MetricCard
                icon={TrendingUp} label="已收餐點" color="bg-amber-500"
                value={`$${data.summary.received_orders.toLocaleString()}`}
                sub="已結帳的點餐"
              />
              <MetricCard
                icon={CalendarDays} label="預計訂位金額" color="bg-stone-400"
                value={`$${data.summary.expected_upcoming.toLocaleString()}`}
                sub={`還沒到；訂金還沒收 $${data.summary.unpaid_deposits.toLocaleString()}`}
              />
              <MetricCard
                icon={CalendarDays} label="訂位數" color="bg-blue-500"
                value={String(data.summary.bookings)}
                sub="不含已取消"
              />
              <MetricCard
                icon={XCircle} label="取消率" color="bg-red-400"
                value={`${Math.round(data.summary.cancellation_rate * 100)}%`}
                sub={`共 ${data.summary.cancellation_count} 筆`}
              />
              <MetricCard
                icon={Wallet} label="訂金收款率" color="bg-green-500"
                value={data.summary.deposit_rate == null ? "—" : `${Math.round(data.summary.deposit_rate * 100)}%`}
                sub={`${data.summary.deposit_paid_count} / ${data.summary.bookings} 筆已付訂金`}
              />
            </div>

            {/* 月份趨勢 */}
            <div className="rounded-2xl bg-white p-5 shadow-sm">
              <h2 className="mb-4 font-semibold text-gray-700">每月已收到的錢</h2>
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={data.monthly} margin={{ top: 0, right: 0, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                  <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => `$${Number(v).toLocaleString()}`} width={56} />
                  <Tooltip formatter={(v) => `$${Number(v).toLocaleString()}`} />
                  <Legend />
                  <Bar dataKey="received_deposits" name="訂金" fill="#22c55e" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="received_orders" name="餐點" fill="#f59e0b" radius={[4, 4, 0, 0]} />
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
                        <span className="text-gray-500">{r.bookings} 筆 · 訂位金額 ${r.booked_amount.toLocaleString()}</span>
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
