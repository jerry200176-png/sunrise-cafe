"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Calendar, DollarSign, Users, LogOut, Bell, RefreshCw } from "lucide-react";
import { format, parseISO } from "date-fns";
import { zhTW } from "date-fns/locale";
import type { Branch } from "@/types";
import { ToastStack, type ToastItem, type ToastVariant } from "@/components/Toast";

interface Stats {
  date: string;
  todayCount: number;
  todayRevenue: number;
  roomsInUseCount: number;
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
    start_time: string;
    end_time: string;
    customer_name: string;
    status: string;
    total_price: number | null;
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
    end.setDate(end.getDate() + 1);
  }
  const startMs = start.getTime();
  const endMs = end.getTime();
  const marks: { label: string; percent: number }[] = [];
  const cursor = new Date(start);
  cursor.setMinutes(0, 0, 0);
  if (cursor.getTime() < startMs) cursor.setHours(cursor.getHours() + 1);
  while (cursor.getTime() <= endMs) {
    const percent = ((cursor.getTime() - startMs) / (endMs - startMs)) * 100;
    marks.push({
      label: format(cursor, "HH:mm"),
      percent: Math.max(0, Math.min(100, percent)),
    });
    cursor.setHours(cursor.getHours() + 1);
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
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
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
  }, [branchId, date]);

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

  return (
    <main className="min-h-screen bg-gray-50">
      <header className="border-b border-gray-200 bg-white">
        <div className="mx-auto flex max-w-4xl items-center justify-between gap-4 px-4 py-4">
          <div className="flex items-center gap-4">
            <Link
              href="/admin"
              className="rounded-lg p-2 text-gray-600 hover:bg-gray-100"
              aria-label="返回"
            >
              <ArrowLeft className="h-5 w-5" />
            </Link>
            <h1 className="text-xl font-bold text-gray-900">儀表板</h1>
          </div>
          <button
            type="button"
            onClick={async () => {
              await fetch("/api/admin/logout", { method: "POST" });
              window.location.href = "/admin/login";
            }}
            className="flex items-center gap-1.5 rounded-lg border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
          >
            <LogOut className="h-4 w-4" /> 登出
          </button>
        </div>
      </header>

      <div className="mx-auto max-w-4xl px-4 py-6 space-y-6">
        <div className="flex flex-wrap items-center gap-4">
          <select
            value={branchId}
            onChange={(e) => setBranchId(e.target.value)}
            className="rounded-lg border border-gray-300 px-3 py-2"
          >
            <option value="">請選擇分店</option>
            {branches.map((b) => (
              <option key={b.id} value={b.id}>{b.name}</option>
            ))}
          </select>
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="rounded-lg border border-gray-300 px-3 py-2"
          />
        </div>

        {error && (
          <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
            {error}
          </div>
        )}

        {loading && (
          <p className="text-gray-500">載入中…</p>
        )}

        {!loading && stats && (
          <>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
                <div className="flex items-center gap-2 text-gray-500">
                  <Calendar className="h-5 w-5" />
                  <span className="text-sm">今日總訂位數</span>
                </div>
                <p className="mt-2 text-2xl font-bold text-gray-900">{stats.todayCount}</p>
              </div>
              <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
                <div className="flex items-center gap-2 text-gray-500">
                  <Users className="h-5 w-5" />
                  <span className="text-sm">目前使用中包廂</span>
                </div>
                <p className="mt-2 text-2xl font-bold text-gray-900">
                  {stats.roomsInUseCount} / {stats.totalRooms}
                </p>
              </div>
              <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
                <div className="flex items-center gap-2 text-gray-500">
                  <DollarSign className="h-5 w-5" />
                  <span className="text-sm">今日預估營收</span>
                </div>
                <p className="mt-2 text-2xl font-bold text-gray-900">${stats.todayRevenue}</p>
              </div>
            </div>

            <section className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-lg font-semibold text-gray-900">近 7 日概況</h2>
                <span className="text-xs text-gray-500">結束日期：{date}</span>
              </div>
              {trendLoading ? (
                <p className="text-sm text-gray-500">載入統計中…</p>
              ) : trendError ? (
                <p className="text-sm text-red-600">{trendError}</p>
              ) : trend.length === 0 ? (
                <p className="text-sm text-gray-500">暫無統計資料</p>
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
                          {format(parseISO(p.date), "MM/dd")}
                        </span>
                        <span className="text-[11px] text-gray-600">{p.count} 筆</span>
                      </div>
                    );
                  })}
                </div>
                </div>
              )}
              <p className="mt-2 text-xs text-gray-500">
                橘色為營收、綠色為訂位筆數
              </p>
            </section>

            {timeline && (
              <section className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
                <h2 className="mb-4 text-lg font-semibold text-gray-900">
                  時間軸 · {timeline.branchName} · {format(parseISO(date), "yyyy/MM/dd (EEE)", { locale: zhTW })}
                </h2>

                {/* Mobile: 清單式 */}
                <div className="space-y-3 md:hidden">
                  {timeline.rooms.map((room) => (
                    <div key={room.roomId} className="rounded-lg border border-gray-200 bg-gray-50/50 p-3">
                      <p className="mb-2 text-sm font-semibold text-gray-800">{room.roomName}</p>
                      {room.reservations.length === 0 ? (
                        <p className="text-xs text-gray-400">今日無訂位</p>
                      ) : (
                        <ul className="space-y-2">
                          {room.reservations.map((r, i) => (
                            <li key={i} className="rounded-md border border-white bg-white px-2.5 py-2 text-sm">
                              <span className="font-medium text-gray-900">{r.customer_name}</span>
                              <span className="ml-2 text-xs text-gray-500">
                                {format(parseISO(r.start_time), "HH:mm")}–{format(parseISO(r.end_time), "HH:mm")}
                              </span>
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
                              return (
                                <div
                                  key={`${r.start_time}-${r.end_time}`}
                                  className="absolute top-1 bottom-1 z-10 rounded bg-amber-200 px-1 overflow-hidden"
                                  style={{
                                    left: `${left}%`,
                                    width: `${w}%`,
                                    minWidth: "4px",
                                  }}
                                  title={`${r.customer_name} ${format(parseISO(r.start_time), "HH:mm")}-${format(parseISO(r.end_time), "HH:mm")}`}
                                >
                                  <span className="block truncate text-xs text-amber-900">
                                    {r.customer_name} {format(parseISO(r.start_time), "HH:mm")}
                                  </span>
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
        <section className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
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
            <p className="text-sm text-gray-500">明日無需提醒的訂位</p>
          ) : (
            <ul className="space-y-3">
              {remindersForBranch.map((r) => {
                const startLabel = format(parseISO(r.start_time), "yyyy/MM/dd (EEE) HH:mm", {
                  locale: zhTW,
                });
                const endLabel = format(parseISO(r.end_time), "HH:mm");
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
      <ToastStack toasts={toasts} onDismiss={dismissToast} />
    </main>
  );
}
