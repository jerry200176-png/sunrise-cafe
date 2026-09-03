"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  Calendar,
  ChevronLeft,
  ChevronRight,
  DollarSign,
  Users,
  Bell,
  RefreshCw,
  ListChecks,
  ClipboardCheck,
} from "lucide-react";
import { AdminShell } from "@/components/admin/AdminShell";
import { AdminEmptyState } from "@/components/admin/AdminEmptyState";
import { formatTaipeiTime } from "@/lib/datetime";
import type { Branch } from "@/types";
import { ToastStack, type ToastItem, type ToastVariant } from "@/components/Toast";

interface Stats {
  date: string;
  todayCount: number;
  todayRevenue: number;
  roomsInUseCount: number;
  roomsBookedCount?: number;
  totalRooms: number;
}

interface TrendPoint {
  date: string;
  count: number;
  revenue: number;
}

interface ReminderItem {
  id: string;
  booking_code: string | null;
  room_name: string;
  branch_name: string;
  start_time: string;
  end_time: string;
  customer_name: string;
  phone: string;
  email: string | null;
  is_notified: boolean;
  is_deposit_paid?: boolean;
  guest_confirmed_at?: string | null;
  status?: string;
}

interface TimelineRoom {
  roomId: string;
  roomName: string;
  reservations: {
    id?: string;
    start_time: string;
    end_time: string;
    customer_name: string;
    status: string;
    total_price: number | null;
    booking_code?: string | null;
    guest_count?: number | null;
    is_deposit_paid?: boolean | null;
  }[];
}

interface TimelineData {
  date: string;
  branchName: string;
  openTime: string;
  closeTime: string;
  rooms: TimelineRoom[];
}

const pad2 = (value: number) => String(value).padStart(2, "0");

const taipeiToday = () =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Taipei" }).format(new Date());

const formatTaipeiDate = (date: string) =>
  new Intl.DateTimeFormat("zh-TW", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
  }).format(new Date(`${date}T12:00:00+08:00`));

const formatTaipeiDateTime = (iso: string) => {
  const date = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Taipei" }).format(new Date(iso));
  return `${formatTaipeiDate(date)} ${formatTaipeiTime(iso)}`;
};

const reservationManagementHref = (branchId: string, reservationId?: string) =>
  reservationId
    ? `/admin?branchId=${encodeURIComponent(branchId)}&reservation=${encodeURIComponent(reservationId)}`
    : "/admin";

function shiftDate(date: string, days: number) {
  const [year, month, day] = date.split("-").map(Number);
  const shifted = new Date(Date.UTC(year, month - 1, day + days));
  return [shifted.getUTCFullYear(), shifted.getUTCMonth() + 1, shifted.getUTCDate()]
    .map((value) => String(value).padStart(2, "0"))
    .join("-");
}

function statusLabel(status: string) {
  return {
    pending: "待確認",
    confirmed: "已確認",
    checked_in: "使用中",
    completed: "已完成",
    cancelled: "已取消",
  }[status] ?? status;
}

function reservationTone(status: string) {
  return {
    pending: "border-amber-300 bg-amber-50 text-amber-950",
    confirmed: "border-emerald-300 bg-emerald-50 text-emerald-950",
    checked_in: "border-sky-300 bg-sky-50 text-sky-950",
    completed: "border-stone-300 bg-stone-100 text-stone-700",
    cancelled: "border-stone-200 bg-stone-100 text-stone-400 line-through",
  }[status] ?? "border-stone-300 bg-white text-stone-900";
}

const formatTwd = (value: number) =>
  new Intl.NumberFormat("zh-TW", {
    style: "currency",
    currency: "TWD",
    maximumFractionDigits: 0,
  }).format(value);

const parseHm = (
  value: string | null | undefined,
  fallback: { h: number; m: number }
) => {
  if (!value) return fallback;
  const [h, m] = String(value).split(":").map(Number);
  return {
    h: Number.isFinite(h) ? h : fallback.h,
    m: Number.isFinite(m) ? m : fallback.m,
  };
};

const buildAxis = (date: string, openTime?: string, closeTime?: string) => {
  const open = parseHm(openTime, { h: 9, m: 0 });
  const close = parseHm(closeTime, { h: 21, m: 0 });
  const start = new Date(`${date}T${pad2(open.h)}:${pad2(open.m)}:00+08:00`);
  const end = new Date(`${date}T${pad2(close.h)}:${pad2(close.m)}:00+08:00`);
  if (end.getTime() <= start.getTime()) {
    end.setTime(end.getTime() + 24 * 60 * 60 * 1000);
  }
  const startMs = start.getTime();
  const endMs = end.getTime();
  const marks: { label: string; percent: number }[] = [];
  const firstMarkMs = Math.ceil(startMs / 3_600_000) * 3_600_000;
  for (let cursorMs = firstMarkMs; cursorMs <= endMs; cursorMs += 3_600_000) {
    const percent = ((cursorMs - startMs) / (endMs - startMs)) * 100;
    marks.push({
      label: formatTaipeiTime(new Date(cursorMs).toISOString()),
      percent: Math.max(0, Math.min(100, percent)),
    });
  }
  return {
    dayStart: start.toISOString(),
    dayEnd: end.toISOString(),
    startMs,
    endMs,
    marks,
  };
};

export default function AdminDashboardPage() {
  const [branches, setBranches] = useState<Branch[]>([]);
  const [branchId, setBranchId] = useState("");
  const [date, setDate] = useState(taipeiToday);
  const [refreshToken, setRefreshToken] = useState(0);
  const [stats, setStats] = useState<Stats | null>(null);
  const [trend, setTrend] = useState<TrendPoint[]>([]);
  const [trendLoading, setTrendLoading] = useState(false);
  const [trendError, setTrendError] = useState<string | null>(null);
  const [timeline, setTimeline] = useState<TimelineData | null>(null);
  const [reminders, setReminders] = useState<ReminderItem[]>([]);
  const [remindersLoading, setRemindersLoading] = useState(false);
  const [remindersError, setRemindersError] = useState<string | null>(null);
  const [remindersUpdating, setRemindersUpdating] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const toastId = useRef(0);

  const showToast = useCallback((message: string, variant: ToastVariant = "info") => {
    const id = ++toastId.current;
    setToasts((prev) => [...prev, { id, message, variant }]);
  }, []);

  const dismissToast = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  useEffect(() => {
    fetch("/api/branches")
      .then((r) => r.json())
      .then((d) => {
        const arr = Array.isArray(d) ? d : [];
        setBranches(arr);
        if (arr.length > 0 && !branchId) setBranchId(arr[0].id);
      })
      .catch(() => setBranches([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadReminders = useCallback(async () => {
    setRemindersLoading(true);
    setRemindersError(null);
    try {
      const res = await fetch("/api/admin/reminders");
      const data = await res.json();
      if (!res.ok) {
        throw new Error((data as { error?: string })?.error ?? "無法載入提醒");
      }
      setReminders(Array.isArray(data) ? (data as ReminderItem[]) : []);
    } catch (e) {
      setReminders([]);
      setRemindersError(e instanceof Error ? e.message : "載入提醒失敗");
    } finally {
      setRemindersLoading(false);
    }
  }, []);

  useEffect(() => {
    loadReminders();
  }, [loadReminders]);

  useEffect(() => {
    if (!branchId) {
      setStats(null);
      setTimeline(null);
      setTrend([]);
      setLoading(false);
      setTrendLoading(false);
      setTrendError(null);
      return;
    }
    setLoading(true);
    setTrendLoading(true);
    setError(null);
    setTrendError(null);
    fetch(
      `/api/admin/dashboard?branchId=${encodeURIComponent(branchId)}&date=${encodeURIComponent(date)}`
    )
      .then((r) => r.json())
      .then((data) => {
        if (data.error) throw new Error(data.error);
        setStats(data.stats ?? null);
        setTimeline(data.timeline ?? null);
        const points = Array.isArray(data.trend?.points) ? data.trend.points : [];
        setTrend(
          points.map((p: { date: string; count: number; revenue: number }) => ({
            date: p.date,
            count: Number(p.count) || 0,
            revenue: Number(p.revenue) || 0,
          }))
        );
      })
      .catch((e) => {
        const msg = e instanceof Error ? e.message : "載入失敗";
        setError(msg);
        setTrendError(msg);
        setStats(null);
        setTimeline(null);
        setTrend([]);
      })
      .finally(() => {
        setLoading(false);
        setTrendLoading(false);
      });
  }, [branchId, date, refreshToken]);

  const axis = buildAxis(date, timeline?.openTime, timeline?.closeTime);
  const timeToPercent = (iso: string) => {
    const t = new Date(iso).getTime();
    return Math.max(0, Math.min(100, ((t - axis.startMs) / (axis.endMs - axis.startMs)) * 100));
  };

  const selectedBranchName =
    branches.find((b) => b.id === branchId)?.name ?? "";
  const remindersForBranch =
    branchId && selectedBranchName
      ? reminders.filter((r) => r.branch_name === selectedBranchName)
      : reminders;
  const maxTrendRevenue = Math.max(1, ...trend.map((p) => p.revenue));
  const maxTrendCount = Math.max(1, ...trend.map((p) => p.count));
  const unpaidReminderCount = remindersForBranch.filter((r) => !r.is_deposit_paid).length;
  const awaitingAttendanceCount = remindersForBranch.filter(
    (r) => !r.guest_confirmed_at && !!r.status && ["pending", "confirmed"].includes(r.status)
  ).length;
  const unsentReminderCount = remindersForBranch.filter((r) => !r.is_notified).length;
  const attentionCount = remindersForBranch.filter(
    (r) => !r.is_deposit_paid || !r.guest_confirmed_at || !r.is_notified
  ).length;
  const viewingToday = date === taipeiToday();

  return (
    <>
    <AdminShell
      title="儀表板"
      subtitle="訂位與營運總覽"
      actions={
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => {
              setRefreshToken((value) => value + 1);
              void loadReminders();
            }}
            disabled={loading || remindersLoading}
            className="flex h-10 w-10 items-center justify-center rounded-xl text-stone-500 transition-[background-color,color] duration-200 hover:bg-stone-100 hover:text-stone-800 disabled:opacity-50"
            aria-label="重新整理儀表板"
          >
            <RefreshCw className={`h-4 w-4 ${loading || remindersLoading ? "animate-spin" : ""}`} strokeWidth={1.5} />
          </button>
          <Link
            href="/admin/today"
            className="rounded-xl bg-amber-600 px-3 py-2 text-sm font-medium text-white transition-[background-color] duration-200 hover:bg-amber-700"
          >
            今日場控
          </Link>
        </div>
      }
    >
      <div className="space-y-6">
        <div className="rounded-2xl border border-stone-200 bg-white p-4 shadow-sm" aria-label="儀表板篩選">
          <div className="flex flex-wrap items-end gap-3">
            <label className="min-w-[10rem] flex-1 text-xs font-medium text-stone-600">
              分店
              <select
                value={branchId}
                onChange={(e) => setBranchId(e.target.value)}
                className="mt-1.5 w-full rounded-xl border border-stone-300 bg-white px-3 py-2.5 text-sm text-stone-900 focus:border-amber-500 focus:outline-none focus:ring-2 focus:ring-amber-100"
              >
                <option value="">請選擇分店</option>
                {branches.map((b) => (
                  <option key={b.id} value={b.id}>{b.name}</option>
                ))}
              </select>
            </label>
            <label className="text-xs font-medium text-stone-600">
              查看日期
              <input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className="mt-1.5 block rounded-xl border border-stone-300 bg-white px-3 py-2.5 text-sm text-stone-900 focus:border-amber-500 focus:outline-none focus:ring-2 focus:ring-amber-100"
              />
            </label>
            <div className="flex items-end gap-1" aria-label="切換日期">
              <button
                type="button"
                onClick={() => setDate((value) => shiftDate(value, -1))}
                className="flex h-11 w-11 items-center justify-center rounded-xl border border-stone-300 text-stone-600 transition-[background-color,border-color] hover:border-amber-300 hover:bg-amber-50"
                aria-label="前一天"
              >
                <ChevronLeft className="h-4 w-4" strokeWidth={1.8} />
              </button>
              <button
                type="button"
                onClick={() => setDate((value) => shiftDate(value, 1))}
                className="flex h-11 w-11 items-center justify-center rounded-xl border border-stone-300 text-stone-600 transition-[background-color,border-color] hover:border-amber-300 hover:bg-amber-50"
                aria-label="後一天"
              >
                <ChevronRight className="h-4 w-4" strokeWidth={1.8} />
              </button>
            </div>
            <button
              type="button"
              onClick={() => setDate(taipeiToday())}
              disabled={date === taipeiToday()}
              className="min-h-11 rounded-xl border border-stone-300 px-3 py-2.5 text-sm font-medium text-stone-700 transition-[background-color,border-color] duration-200 hover:border-amber-300 hover:bg-amber-50 disabled:cursor-default disabled:opacity-45"
            >
              今天
            </button>
            <button
              type="button"
              onClick={() => setDate(shiftDate(taipeiToday(), 1))}
              disabled={date === shiftDate(taipeiToday(), 1)}
              className="min-h-11 rounded-xl border border-amber-300 bg-amber-50 px-3 py-2.5 text-sm font-medium text-amber-900 transition-[background-color,border-color] hover:border-amber-400 hover:bg-amber-100 disabled:cursor-default disabled:opacity-45"
            >
              明天
            </button>
          </div>
          <p className="mt-2 text-xs text-stone-500">日期與訂位時間以台北時區顯示。</p>
        </div>

        {error && (
          <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800" role="alert">
            {error}
          </div>
        )}

        {loading && (
          <p className="text-stone-500">載入中…</p>
        )}

        {!loading && stats && (
          <>
            <section className="rounded-2xl border border-amber-200 bg-amber-50/70 p-4" aria-labelledby="dashboard-attention-heading">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.16em] text-amber-800">先處理</p>
                  <h2 id="dashboard-attention-heading" className="mt-1 text-lg font-semibold text-stone-900">
                    {attentionCount > 0 ? `${attentionCount} 個營運提醒` : "今天目前沒有待處理提醒"}
                  </h2>
                  <p className="mt-1 text-sm text-stone-600">先看風險，再看趨勢與歷史數字。</p>
                </div>
                <ListChecks className="h-6 w-6 text-amber-700" strokeWidth={1.5} aria-hidden="true" />
              </div>
              <div className="mt-3 flex flex-wrap gap-2 text-xs font-medium">
                <Link href="/admin/today" className="rounded-full bg-white px-3 py-1.5 text-rose-800 ring-1 ring-rose-200 hover:bg-rose-50">
                  未付訂金 {unpaidReminderCount}
                </Link>
                <Link href="/admin/today" className="rounded-full bg-white px-3 py-1.5 text-amber-900 ring-1 ring-amber-200 hover:bg-amber-50">
                  待確認出席 {awaitingAttendanceCount}
                </Link>
                <span className="rounded-full bg-white px-3 py-1.5 text-stone-700 ring-1 ring-stone-200">
                  未發明日提醒 {unsentReminderCount}
                </span>
              </div>
            </section>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <div className="rounded-2xl border border-stone-200 bg-white p-4 shadow-sm">
                <div className="flex items-center gap-2 text-stone-500">
                  <Calendar className="h-5 w-5 text-amber-700" strokeWidth={1.5} />
                  <span className="text-sm">{viewingToday ? "今日" : `${date.slice(5)} `}總訂位數</span>
                </div>
                <p className="mt-2 text-2xl font-semibold tabular-nums text-stone-900">{stats.todayCount}</p>
              </div>
              <div className="rounded-2xl border border-stone-200 bg-white p-4 shadow-sm">
                <div className="flex items-center gap-2 text-stone-500">
                  <Users className="h-5 w-5 text-amber-700" strokeWidth={1.5} />
                  <span className="text-sm">{viewingToday ? "目前使用中包廂" : "當日有訂包廂"}</span>
                </div>
                <p className="mt-2 text-2xl font-semibold tabular-nums text-stone-900">
                  {viewingToday ? stats.roomsInUseCount : (stats.roomsBookedCount ?? 0)} / {stats.totalRooms}
                </p>
              </div>
              <div className="rounded-2xl border border-stone-200 bg-white p-4 shadow-sm">
                <div className="flex items-center gap-2 text-stone-500">
                  <DollarSign className="h-5 w-5 text-amber-700" strokeWidth={1.5} />
                  <span className="text-sm">{viewingToday ? "今日" : `${date.slice(5)} `}預估營收</span>
                </div>
                <p className="mt-2 text-2xl font-semibold tabular-nums text-stone-900">{formatTwd(stats.todayRevenue)}</p>
              </div>
            </div>

            <section className="rounded-2xl border border-stone-200 bg-white p-4 shadow-sm">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-lg font-semibold text-gray-900">近 7 日概況</h2>
                <span className="text-xs text-gray-500">結束日期：{date}</span>
              </div>
              {trendLoading ? (
                <p className="text-sm text-gray-500">載入統計中…</p>
              ) : trendError ? (
                <p className="text-sm text-red-600">{trendError}</p>
              ) : trend.length === 0 ? (
                <AdminEmptyState
                  icon={ClipboardCheck}
                  title="目前沒有趨勢資料"
                  description="選擇其他日期或先累積幾筆訂位，這裡會顯示營運變化。"
                />
              ) : (
                <div className="-mx-1 overflow-x-auto px-1 sm:mx-0 sm:px-0">
                <div className="flex gap-2 sm:grid sm:grid-cols-7 sm:gap-3">
                  {trend.map((p) => {
                    const revenuePercent = Math.max(
                      6,
                      Math.round((p.revenue / maxTrendRevenue) * 100)
                    );
                    const countPercent = Math.max(
                      6,
                      Math.round((p.count / maxTrendCount) * 100)
                    );
                    return (
                      <div key={p.date} className="flex min-w-[3.25rem] shrink-0 flex-col items-center gap-1 sm:min-w-0">
                        <div className="flex h-24 w-full items-end gap-1">
                          <div
                            className="flex-1 rounded bg-amber-200"
                            style={{ height: `${revenuePercent}%` }}
                            title={`營收 $${p.revenue}`}
                          />
                          <div
                            className="w-2 rounded bg-emerald-200"
                            style={{ height: `${countPercent}%` }}
                            title={`訂位 ${p.count} 筆`}
                          />
                        </div>
                        <span className="text-[11px] text-gray-500">
                          {p.date.slice(5).replace("-", "/")}
                        </span>
                        <span className="text-[11px] text-gray-600">{p.count} 筆</span>
                      </div>
                    );
                  })}
                </div>
                </div>
              )}
              <p className="mt-2 text-xs text-stone-500">
                橘色為營收、綠色為訂位筆數
              </p>
            </section>

            {timeline && (
              <section className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
                <h2 className="mb-4 text-lg font-semibold text-gray-900">
                  時間軸 · {timeline.branchName} · {formatTaipeiDate(date)}
                </h2>

                {/* Mobile: 清單式 */}
                <div className="space-y-3 md:hidden">
                  {timeline.rooms.map((room) => (
                    <div key={room.roomId} className="rounded-lg border border-gray-200 bg-gray-50/50 p-3">
                      <div className="mb-2 flex items-center justify-between gap-2">
                        <p className="text-sm font-semibold text-gray-800">{room.roomName}</p>
                        <span className="text-xs tabular-nums text-gray-500">{room.reservations.filter((r) => r.status !== "cancelled").length} 筆</span>
                      </div>
                      {room.reservations.filter((r) => r.status !== "cancelled").length === 0 ? (
                        <p className="text-xs text-gray-400">當日無訂位</p>
                      ) : (
                        <ul className="space-y-2">
                          {room.reservations.filter((r) => r.status !== "cancelled").map((r, i) => (
                            <li
                              key={r.id ?? `${r.start_time}-${r.end_time}-${i}`}
                              aria-label={`${r.customer_name} ${statusLabel(r.status)} ${r.is_deposit_paid ? "已付訂金" : "未付訂金"}`}
                              className={`rounded-md border px-2.5 py-2 text-sm ${reservationTone(r.status)}`}
                            >
                              <div className="flex items-center justify-between gap-2">
                                <span className="truncate font-medium">{r.customer_name}</span>
                                <span className="shrink-0 text-xs tabular-nums">
                                  {formatTaipeiTime(r.start_time)}–{formatTaipeiTime(r.end_time)}
                                </span>
                              </div>
                              <div className="mt-1 flex flex-wrap gap-x-2 gap-y-0.5 text-[11px] opacity-80">
                                <span>{statusLabel(r.status)}</span>
                                <span>{r.is_deposit_paid ? "已付訂金" : "未付訂金"}</span>
                                {r.guest_count ? <span>{r.guest_count} 人</span> : null}
                                {r.booking_code ? <span>{r.booking_code}</span> : null}
                              </div>
                              {r.id ? (
                                <Link
                                  href={reservationManagementHref(branchId, r.id)}
                                  className="mt-2 inline-flex min-h-10 items-center rounded-md border border-current/30 px-2.5 py-1.5 text-xs font-semibold no-underline hover:bg-white/60"
                                >
                                  開啟訂位管理
                                </Link>
                              ) : null}
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  ))}
                </div>

                {/* Desktop: Gantt */}
                <div className="hidden overflow-x-auto md:block">
                  <div className="min-w-[600px] space-y-3">
                    <div className="flex items-center gap-2 text-xs text-gray-500">
                      <div className="w-24 shrink-0">時間</div>
                      <div className="relative h-6 flex-1">
                        {axis.marks.map((mark) => (
                          <span
                            key={mark.label}
                            className="absolute top-0 -translate-x-1/2 text-[10px]"
                            style={{ left: `${mark.percent}%` }}
                          >
                            {mark.label}
                          </span>
                        ))}
                      </div>
                    </div>
                    {timeline.rooms.map((room) => (
                      <div key={room.roomId} className="flex items-stretch gap-2">
                        <div className="w-24 shrink-0 py-1 text-sm font-medium text-gray-700">
                          {room.roomName}
                        </div>
                        <div className="relative flex-1 rounded border border-gray-200 bg-gray-50/50 h-10">
                          {axis.marks.map((mark) => (
                            <span
                              key={`${room.roomId}-${mark.label}`}
                              className="pointer-events-none absolute top-0 bottom-0 w-px bg-gray-200/70"
                              style={{ left: `${mark.percent}%` }}
                            />
                          ))}
                          {room.reservations
                            .filter((r) => r.status !== "cancelled")
                            .map((r) => {
                              const left = timeToPercent(r.start_time);
                              const right = timeToPercent(r.end_time);
                              const w = Math.max(2, right - left);
                              const className = `absolute top-1 bottom-1 z-10 block overflow-hidden rounded border px-1 no-underline ${reservationTone(r.status)}`;
                              const style = {
                                left: `${left}%`,
                                width: `${w}%`,
                                minWidth: "4px",
                              };
                              const label = `${r.customer_name} ${statusLabel(r.status)} ${r.is_deposit_paid ? "已付訂金" : "未付訂金"}`;
                              const title = `${r.customer_name} ${formatTaipeiTime(r.start_time)}-${formatTaipeiTime(r.end_time)} · ${statusLabel(r.status)} · ${r.is_deposit_paid ? "已付訂金" : "未付訂金"}`;
                              const content = (
                                <span className="block truncate text-xs">
                                  {r.customer_name} {formatTaipeiTime(r.start_time)}
                                </span>
                              );
                              return r.id ? (
                                <Link
                                  key={r.id}
                                  href={reservationManagementHref(branchId, r.id)}
                                  aria-label={label}
                                  className={className}
                                  style={style}
                                  title={title}
                                >
                                  {content}
                                </Link>
                              ) : (
                                <div
                                  key={`${r.start_time}-${r.end_time}`}
                                  aria-label={label}
                                  className={className}
                                  style={style}
                                  title={title}
                                >
                                  {content}
                                </div>
                              );
                            })}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
                <p className="mt-2 hidden text-xs text-gray-500 md:block">
                  橫軸為營業時間；長條為預約時段（不含已取消）
                </p>
              </section>
            )}
          </>
        )}

        {/* 明日提醒獨立於 stats：儀表板 API 失敗時仍須可操作 */}
        <section id="tomorrow-reminders" className="rounded-2xl border border-stone-200 bg-white p-4 shadow-sm">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <h2 className="flex items-center gap-2 text-lg font-semibold text-gray-900">
              <Bell className="h-5 w-5 text-amber-600" />
              明日提醒
            </h2>
            <button
              type="button"
              onClick={loadReminders}
              className="inline-flex min-h-11 items-center gap-1.5 rounded-lg border border-gray-300 px-3 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
            >
              <RefreshCw className="h-3.5 w-3.5" />
              重新整理
            </button>
          </div>
          {remindersForBranch.length > 0 && (
            <div className="mb-3 flex flex-wrap gap-2 text-xs">
              <span className="rounded-full bg-red-50 px-2.5 py-1 font-medium text-red-800">
                未付訂金 {remindersForBranch.filter((r) => !r.is_deposit_paid).length}
              </span>
              <span className="rounded-full bg-amber-50 px-2.5 py-1 font-medium text-amber-900">
                待確認出席{" "}
                {
                  remindersForBranch.filter(
                    (r) =>
                      !r.guest_confirmed_at &&
                      !!r.status &&
                      ["pending", "confirmed"].includes(r.status)
                  ).length
                }
              </span>
              <span className="rounded-full bg-emerald-50 px-2.5 py-1 font-medium text-emerald-800">
                已確認出席 {remindersForBranch.filter((r) => !!r.guest_confirmed_at).length}
              </span>
              <span className="rounded-full bg-gray-100 px-2.5 py-1 font-medium text-gray-700">
                已推播提醒 {remindersForBranch.filter((r) => r.is_notified).length}/
                {remindersForBranch.length}
              </span>
            </div>
          )}
          {remindersLoading ? (
            <p className="text-sm text-gray-500">載入提醒中…</p>
          ) : remindersError ? (
            <p className="text-sm text-red-600">{remindersError}</p>
          ) : remindersForBranch.length === 0 ? (
            <AdminEmptyState
              icon={Bell}
              title="明日沒有需要提醒的訂位"
              description="有新的明日訂位時，提醒名單會出現在這裡。"
            />
          ) : (
            <ul className="space-y-3">
              {remindersForBranch.map((r) => {
                const startLabel = formatTaipeiDateTime(r.start_time);
                const endLabel = formatTaipeiTime(r.end_time);
                const message = `您好 ${r.customer_name}，提醒您明天 ${startLabel}–${endLabel} 的預約（${r.branch_name} ${r.room_name}）。如需更改請提前告知，謝謝！`;
                return (
                  <li key={r.id} className="rounded-lg border border-gray-200 p-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="min-w-0">
                        <p className="font-medium text-gray-900">
                          {r.customer_name} · {r.branch_name} {r.room_name}
                        </p>
                        <p className="text-sm text-gray-600">
                          {startLabel}–{endLabel}
                        </p>
                        <p className="text-sm text-gray-500">
                          {r.phone} {r.email ? `· ${r.email}` : ""}
                        </p>
                        <div className="mt-2 flex flex-wrap gap-1.5">
                          {!r.is_deposit_paid ? (
                            <span className="rounded bg-red-100 px-1.5 py-0.5 text-[11px] font-semibold text-red-800">
                              未付訂金
                            </span>
                          ) : (
                            <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-[11px] font-semibold text-emerald-800">
                              訂金已付
                            </span>
                          )}
                          {r.guest_confirmed_at ? (
                            <span className="rounded bg-sky-100 px-1.5 py-0.5 text-[11px] font-semibold text-sky-800">
                              已確認出席
                            </span>
                          ) : (
                            <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[11px] font-semibold text-amber-900">
                              待確認出席
                            </span>
                          )}
                          {r.is_notified && (
                            <span className="rounded bg-gray-100 px-1.5 py-0.5 text-[11px] font-semibold text-gray-600">
                              已提醒
                            </span>
                          )}
                        </div>
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        <button
                          type="button"
                          onClick={async () => {
                            try {
                              if (navigator.clipboard?.writeText) {
                                await navigator.clipboard.writeText(message);
                              } else {
                                const textarea = document.createElement("textarea");
                                textarea.value = message;
                                document.body.appendChild(textarea);
                                textarea.select();
                                document.execCommand("copy");
                                document.body.removeChild(textarea);
                              }
                              showToast("已複製提醒內容", "success");
                            } catch {
                              showToast("複製失敗，請手動複製。", "error");
                            }
                          }}
                          className="min-h-11 rounded-lg border border-gray-300 px-3 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
                        >
                          複製提醒
                        </button>
                        <button
                          type="button"
                          disabled={r.is_notified || remindersUpdating === r.id}
                          onClick={async () => {
                            setRemindersUpdating(r.id);
                            try {
                              await fetch(`/api/admin/reminders/${r.id}`, { method: "PATCH" });
                              setReminders((prev) =>
                                prev.map((item) =>
                                  item.id === r.id ? { ...item, is_notified: true } : item
                                )
                              );
                            } catch {
                              // ignore
                            } finally {
                              setRemindersUpdating(null);
                            }
                          }}
                          className={`min-h-11 rounded-lg px-3 py-2.5 text-sm font-semibold text-white disabled:opacity-60 ${r.is_notified
                              ? "bg-gray-400 cursor-not-allowed"
                              : "bg-emerald-600 hover:bg-emerald-700"
                            }`}
                        >
                          {r.is_notified ? "已通知" : "標記已通知"}
                        </button>
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </div>
    </AdminShell>
      <ToastStack toasts={toasts} onDismiss={dismissToast} />
    </>
  );
}
